/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  Connection,
  Logger,
  LoggerLevel,
  Messages,
  NamedPackageDir,
  PackageDir,
  ScratchOrgInfo,
  SfProject,
} from '@salesforce/core';
import { ComponentSetBuilder, ConvertResult, MetadataConverter } from '@salesforce/source-deploy-retrieve';
import { uniqid } from '@salesforce/core/lib/testSetup';
import SettingsGenerator from '@salesforce/core/lib/org/scratchOrgSettingsGenerator';
import * as xml2js from 'xml2js';
import { Duration } from '@salesforce/kit';
import { PackageDirDependency } from '@salesforce/core/lib/sfProject';
import * as pkgUtils from '../utils/packageUtils';
import { consts } from '../constants';
import { copyDir, zipDir } from '../utils';
import { BuildNumberToken, VersionNumber } from '../utils/versionNumber';
import {
  MDFolderForArtifactOptions,
  PackageVersionCreateRequestResult,
  PackageVersionCreateOptions,
  PackagingSObjects,
} from '../interfaces';
import { PackageProfileApi } from './packageProfileApi';
import { list, byId } from './packageVersionCreateRequest';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

const logger = Logger.childFromRoot('packageVersionCreate');

const DESCRIPTOR_FILE = 'package2-descriptor.json';

const POLL_INTERVAL_WITHOUT_VALIDATION_SECONDS = 5;

type PackageDescriptorJson = Partial<NamedPackageDir> &
  Partial<{
    id: string;
    features: string[];
    orgPreferences: string[];
    snapshot: string;
    unpackagedMetadata: NamedPackageDir;
    apexTestAccess: { permissionSets: string[] | string; permissionSetLicenses: string[] | string };
    permissionSetNames: string[];
    permissionSetLicenseDeveloperNames: string[];
    branch: string;
    subscriberPackageVersionId: string;
    packageId: string;
    versionName: string;
  }>;

type PackageVersionCreateRequest = {
  Package2Id: string;
  VersionInfo: string;
  Tag: string;
  Branch: string;
  InstallKey: string;
  Instance: string;
  SourceOrg: string;
  CalculateCodeCoverage: boolean;
  SkipValidation: boolean;
};

export class PackageVersionCreate {
  private apiVersionFromPackageXml: string;
  private readonly project: SfProject;
  private readonly connection: Connection;

  public constructor(private options: PackageVersionCreateOptions) {
    this.connection = this.options.connection;
    this.project = this.options.project;
  }

  public createPackageVersion(): Promise<Partial<PackageVersionCreateRequestResult>> {
    return this.packageVersionCreate(this.options).catch((err: Error) => {
      // TODO: until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      err = pkgUtils.massageErrorMessage(err);
      throw pkgUtils.applyErrorAction(err);
    });
  }

  public async listRequest(createdlastdays?: number, status?: string): Promise<PackageVersionCreateRequestResult[]> {
    return list({ createdlastdays, status, connection: this.connection });
  }

  public async listRequestById(id: string, connection: Connection): Promise<PackageVersionCreateRequestResult[]> {
    return byId(id, connection);
  }

  // convert source to mdapi format and copy to tmp dir packaging up
  private async generateMDFolderForArtifact(options: MDFolderForArtifactOptions): Promise<ConvertResult> {
    const sourcepath = options.sourcePaths ?? [options.sourceDir];
    const componentSet = await ComponentSetBuilder.build({
      sourceapiversion: this.project.getSfProjectJson().get('sourceApiVersion') as string,
      sourcepath,
    });
    const packageName = options.packageName;
    const outputDirectory = path.resolve(options.deploydir);
    const converter = new MetadataConverter();
    const convertResult = await converter.convert(componentSet, 'metadata', {
      type: 'directory',
      outputDirectory,
      packageName,
      genUniqueDir: false,
    });

    if (packageName) {
      // SDR will build an output path like /output/directory/packageName/package.xml
      // this was breaking from toolbelt, so to revert it we copy the directory up a level and delete the original
      copyDir(convertResult.packagePath, outputDirectory);
      try {
        fs.rmSync(convertResult.packagePath, { recursive: true });
      } catch (e) {
        // rmdirSync is being deprecated and emits a warning
        // but rmSync is introduced in node 14 so fall back to rmdirSync
        fs.rmdirSync(convertResult.packagePath, { recursive: true });
      }

      convertResult.packagePath = outputDirectory;
      return convertResult;
    }
  }

  private validateDependencyValues(dependency: PackageDescriptorJson) {
    // If valid 04t package, just return it to be used straight away.
    if (dependency.subscriberPackageVersionId) {
      pkgUtils.validateId(pkgUtils.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, dependency.subscriberPackageVersionId);
      return Promise.resolve();
    }

    if (dependency.packageId && dependency.package) {
      throw messages.createError('errorPackageAndPackageIdCollision', []);
    }

    const packageIdFromAlias = pkgUtils.getPackageIdFromAlias(dependency.packageId || dependency.package, this.project);

    // If valid 04t package, just return it to be used straight away.
    if (pkgUtils.validateIdNoThrow(pkgUtils.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, packageIdFromAlias)) {
      dependency.subscriberPackageVersionId = packageIdFromAlias;
      return Promise.resolve();
    }

    if (!packageIdFromAlias || !dependency.versionNumber) {
      throw messages.createError('errorDependencyPair', [JSON.stringify(dependency)]);
    }

    // Just override dependency.packageId value to the resolved alias.
    dependency.packageId = packageIdFromAlias;

    pkgUtils.validateId(pkgUtils.BY_LABEL.PACKAGE_ID, dependency.packageId);
    pkgUtils.validateVersionNumber(
      dependency.versionNumber,
      BuildNumberToken.LATEST_BUILD_NUMBER_TOKEN,
      BuildNumberToken.RELEASED_BUILD_NUMBER_TOKEN
    );

    // Validate that the Package2 id exists on the server
    const query = `SELECT Id FROM Package2 WHERE Id = '${dependency.packageId}'`;
    return this.connection.tooling.query(query).then((pkgQueryResult) => {
      const subRecords = pkgQueryResult.records;
      if (!subRecords || subRecords.length !== 1) {
        throw messages.createError('errorNoIdInHub', [dependency.packageId]);
      }
    });
  }

  /**
   *  A dependency in the workspace config file may be specified using either a subscriber package version id (04t)
   *  or a package Id (0Ho) + a version number.  Additionally, a build number may be the actual build number, or a
   *  keyword: LATEST or RELEASED (meaning the latest or released build number for a given major.minor.patch).
   *
   *  This method resolves a package Id + version number to a subscriber package version id (04t)
   *  and adds it as a SubscriberPackageVersionId parameter in the dependency object.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async retrieveSubscriberPackageVersionId(
    dependency: PackageDescriptorJson,
    branchFromFlagOrDef: string
  ): Promise<PackageDescriptorJson> {
    await this.validateDependencyValues(dependency);
    if (dependency.subscriberPackageVersionId) {
      delete dependency.package;

      // if a 04t id is specified just use it.
      return dependency;
    }

    const versionNumber = VersionNumber.from(dependency.versionNumber);
    const buildNumber = versionNumber.build;

    // use the dependency.branch if present otherwise use the branch of the version being created
    const branch = dependency.branch || dependency.branch === '' ? dependency.branch : branchFromFlagOrDef;
    const branchString = !branch || branch === '' ? 'null' : `'${branch}'`;

    // resolve a build number keyword to an actual number, if needed
    const resolvedBuildNumber = await this.resolveBuildNumber(versionNumber, dependency.packageId, branch);
    // now that we have a full build number, query for the associated 04t.
    // because the build number may not be unique across versions, add in conditionals for
    // the branch or the RELEASED token (if used)
    const branchOrReleasedCondition =
      buildNumber === BuildNumberToken.RELEASED_BUILD_NUMBER_TOKEN
        ? 'AND IsReleased = true'
        : `AND Branch = ${branchString}`;
    const query = `SELECT SubscriberPackageVersionId FROM Package2Version WHERE Package2Id = '${dependency.packageId}' AND MajorVersion = ${versionNumber[0]} AND MinorVersion = ${versionNumber[1]} AND PatchVersion = ${versionNumber[2]} AND BuildNumber = ${resolvedBuildNumber} ${branchOrReleasedCondition}`;
    const pkgVerQueryResult = await this.connection.tooling.query<PackagingSObjects.Package2Version>(query);
    const subRecords = pkgVerQueryResult.records;
    if (!subRecords || subRecords.length !== 1) {
      throw messages.createError('versionNumberNotFoundInDevHub', [
        dependency.packageId,
        branchString,
        versionNumber.toString(),
        resolvedBuildNumber,
      ]);
    }

    dependency.subscriberPackageVersionId = pkgVerQueryResult.records[0].SubscriberPackageVersionId;

    // warn user of the resolved build number when LATEST and RELEASED keywords are used
    if (versionNumber.isbuildKeyword()) {
      versionNumber.build = resolvedBuildNumber;

      if (buildNumber === BuildNumberToken.LATEST_BUILD_NUMBER_TOKEN) {
        logger.info(
          messages.getMessage('buildNumberResolvedForLatest', [
            dependency.package,
            versionNumber.toString(),
            branchString,
            dependency.subscriberPackageVersionId,
          ])
        );
      } else if (buildNumber === BuildNumberToken.RELEASED_BUILD_NUMBER_TOKEN) {
        logger.info(
          messages.getMessage('buildNumberResolvedForReleased', [
            dependency.package,
            versionNumber.toString(),
            dependency.subscriberPackageVersionId,
          ])
        );
      }
    }

    delete dependency.packageId;
    delete dependency.package;
    delete dependency.versionNumber;
    delete dependency.branch;

    return dependency;
  }

  private async resolveBuildNumber(versionNumber: VersionNumber, packageId: string, branch: string): Promise<string> {
    if (!versionNumber.isbuildKeyword()) {
      // The build number is already specified so just return it using the tooling query result obj structure
      return versionNumber.build;
    }
    // query for the LATEST or RELEASED build number (excluding deleted versions)
    let branchCondition = '';
    let releasedCondition = '';
    if (versionNumber[3] === BuildNumberToken.LATEST_BUILD_NUMBER_TOKEN) {
      // respect the branch when querying for LATEST
      const branchString = !branch || branch === '' ? 'null' : `'${branch}'`;
      branchCondition = `AND Branch = ${branchString}`;
    } else if (versionNumber[3] === BuildNumberToken.RELEASED_BUILD_NUMBER_TOKEN) {
      releasedCondition = 'AND IsReleased = true';
    }
    const query = `SELECT MAX(BuildNumber) FROM Package2Version WHERE Package2Id = '${packageId}' AND IsDeprecated != true AND MajorVersion = ${versionNumber.major} AND MinorVersion = ${versionNumber.minor} AND PatchVersion = ${versionNumber.patch} ${branchCondition} ${releasedCondition}`;
    const results = await this.connection.tooling.query(query);
    const records = results.records;
    if (!records || records.length === 0 || records[0].expr0 == null) {
      if (versionNumber.build === BuildNumberToken.RELEASED_BUILD_NUMBER_TOKEN) {
        throw messages.createError('noReleaseVersionFound', [packageId, versionNumber.toString()]);
      } else {
        throw messages.createError('noReleaseVersionFoundForBranch', [packageId, branch, versionNumber.toString()]);
      }
    }
    return `${results.records[0].expr0}`;
  }

  private async createRequestObject(
    packageId: string,
    options: PackageVersionCreateOptions,
    preserveFiles: boolean,
    packageVersTmpRoot: string,
    packageVersBlobZipFile: string
  ): Promise<PackageVersionCreateRequest> {
    const zipFileBase64 = fs.readFileSync(packageVersBlobZipFile).toString('base64');
    const requestObject = {
      Package2Id: packageId,
      VersionInfo: zipFileBase64,
      Tag: options.tag,
      Branch: options.branch,
      InstallKey: options.installationkey,
      Instance: options.buildinstance,
      SourceOrg: options.sourceorg,
      CalculateCodeCoverage: options.codecoverage || false,
      SkipValidation: options.skipvalidation || false,
    };

    if (preserveFiles) {
      logger.info(messages.getMessage('tempFileLocation', [packageVersTmpRoot]));
      return requestObject;
    } else {
      return fs.promises.rm(packageVersTmpRoot, { recursive: true, force: true }).then(() => requestObject);
    }
  }

  private getPackageDescriptorJsonFromPackageId(packageId: string, options: PackageVersionCreateOptions) {
    const artDir = options.path;

    const packageDescriptorJson = this.project.getPackageDirectories().find((packageDir) => {
      const packageDirPackageId = pkgUtils.getPackageIdFromAlias(packageDir.package, this.project);
      return !!packageDirPackageId && packageDirPackageId === packageId ? packageDir : null;
    });

    if (!packageDescriptorJson) {
      throw messages.createError('packagingDirNotFoundInConfigFile', [consts.WORKSPACE_CONFIG_FILENAME, artDir]);
    }

    return packageDescriptorJson;
  }

  /**
   * Convert the list of command line options to a JSON object that can be used to create an Package2VersionCreateRequest entity.
   *
   * @param options
   * @param packageId
   * @param versionNumberString
   * @returns {{Package2Id: (*|p|boolean), Package2VersionMetadata: *, Tag: *, Branch: number}}
   * @private
   */
  private async createPackageVersionCreateRequestFromOptions(
    options: PackageVersionCreateOptions,
    packageId: string,
    versionNumberString: string
  ): Promise<PackageVersionCreateRequest> {
    const artDir = options.path;
    const preserveFiles = !!(options.preserve || process.env.SFDX_PACKAGE2_VERSION_CREATE_PRESERVE);
    const uniqueHash = uniqid({ template: `${packageId}-%s` });
    const packageVersTmpRoot = path.join(os.tmpdir(), `${uniqueHash}`);
    const packageVersMetadataFolder = path.join(packageVersTmpRoot, 'md-files');
    const unpackagedMetadataFolder = path.join(packageVersTmpRoot, 'unpackaged-md-files');
    const packageVersProfileFolder = path.join(packageVersMetadataFolder, 'profiles');
    const packageVersBlobDirectory = path.join(packageVersTmpRoot, 'package-version-info');
    const metadataZipFile = path.join(packageVersBlobDirectory, 'package.zip');
    const unpackagedMetadataZipFile = path.join(packageVersBlobDirectory, 'unpackaged-metadata-package.zip');
    const settingsZipFile = path.join(packageVersBlobDirectory, 'settings.zip');
    const packageVersBlobZipFile = path.join(packageVersTmpRoot, 'package-version-info.zip');
    const sourceBaseDir = path.join(this.project.getPath(), artDir);

    const mdOptions = {
      deploydir: packageVersMetadataFolder,
      sourceDir: sourceBaseDir,
    };

    // Stores any additional client side info that might be needed later on in the process
    const clientSideInfo = new Map<string, string>();
    await fs.promises.mkdir(packageVersBlobDirectory, { recursive: true });
    const settingsGenerator = new SettingsGenerator({ asDirectory: true });
    // Copy all of the metadata from the workspace to a tmp folder
    await this.generateMDFolderForArtifact(mdOptions);
    const packageDescriptorJson = this.getPackageDescriptorJsonFromPackageId(
      packageId,
      options
    ) as PackageDescriptorJson;

    if (packageDescriptorJson.package) {
      delete packageDescriptorJson.package;
      packageDescriptorJson.id = packageId;
    }

    const definitionFile = options.definitionfile ? options.definitionfile : packageDescriptorJson.definitionFile;
    if (definitionFile) {
      // package2-descriptor.json sent to the server should contain only the features, snapshot & orgPreferences
      // defined in the definition file.
      delete packageDescriptorJson.features;
      delete packageDescriptorJson.orgPreferences;
      delete packageDescriptorJson.definitionFile;
      delete packageDescriptorJson.snapshot;

      const definitionFilePayload = await fs.promises.readFile(definitionFile, 'utf8');
      const definitionFileJson = JSON.parse(definitionFilePayload) as ScratchOrgInfo;

      const pkgProperties = [
        'country',
        'edition',
        'language',
        'features',
        'orgPreferences',
        'snapshot',
        'release',
        'sourceOrg',
      ];

      // Load any settings from the definition
      await settingsGenerator.extract(definitionFileJson);
      if (settingsGenerator.hasSettings() && definitionFileJson.orgPreferences) {
        // this is not allowed, exit with an error
        return Promise.reject(messages.createError('signupDuplicateSettingsSpecified'));
      }

      pkgProperties.forEach((prop) => {
        const propValue = definitionFileJson[prop];
        if (propValue) {
          packageDescriptorJson[prop] = propValue;
        }
      });
    }
    const hasUnpackagedMetadata = await this.resolveUnpackagedMetadata(
      packageDescriptorJson,
      unpackagedMetadataFolder,
      clientSideInfo,
      options.codecoverage
    );

    this.resolveApexTestPermissions(packageDescriptorJson, options);

    // All dependencies for the packaging dir should be resolved to an 04t id to be passed to the server.
    // (see _retrieveSubscriberPackageVersionId for details)
    const dependencies = packageDescriptorJson.dependencies;

    // branch can be set via flag or descriptor; flag takes precedence
    options.branch = options.branch ? options.branch : packageDescriptorJson.branch;

    const resultValues = await Promise.all(
      !dependencies
        ? []
        : dependencies.map((dependency) => this.retrieveSubscriberPackageVersionId(dependency, options.branch))
    );
    const ancestorId = await pkgUtils.getAncestorId(
      packageDescriptorJson as PackageDir,
      this.connection,
      this.project,
      versionNumberString,
      options.skipancestorcheck
    );
    // If dependencies exist, the resultValues array will contain the dependencies populated with a resolved
    // subscriber pkg version id.
    if (resultValues.length > 0) {
      packageDescriptorJson.dependencies = resultValues as PackageDirDependency[];
    }

    this.cleanPackageDescriptorJson(packageDescriptorJson);
    this.setPackageDescriptorJsonValues(packageDescriptorJson, options);

    await fs.promises.mkdir(packageVersTmpRoot, { recursive: true });
    await fs.promises.mkdir(packageVersBlobDirectory, { recursive: true });

    if (Reflect.has(packageDescriptorJson, 'ancestorVersion')) {
      delete packageDescriptorJson.ancestorVersion;
    }
    packageDescriptorJson.ancestorId = ancestorId;

    await fs.promises.writeFile(
      path.join(packageVersBlobDirectory, DESCRIPTOR_FILE),
      // TODO: need to make sure packageDescriptorJson contains the right values for the descriptor
      JSON.stringify(packageDescriptorJson),
      'utf-8'
    );
    // As part of the source convert process, the package.xml has been written into the tmp metadata directory.
    // The package.xml may need to be manipulated due to processing profiles in the workspace or additional
    // metadata exclusions. If necessary, read the existing package.xml and then re-write it.
    const currentPackageXml = await fs.promises.readFile(path.join(packageVersMetadataFolder, 'package.xml'), 'utf8');
    // convert to json
    const packageJson = await xml2js.parseStringPromise(currentPackageXml);
    fs.mkdirSync(packageVersMetadataFolder, { recursive: true });
    fs.mkdirSync(packageVersProfileFolder, { recursive: true });

    // Apply any necessary exclusions to typesArr.
    let typesArr = packageJson.Package.types;
    this.apiVersionFromPackageXml = packageJson.Package.version;

    // if we're using unpackaged metadata, don't package the profiles located there
    if (hasUnpackagedMetadata) {
      typesArr = options.profileApi.filterAndGenerateProfilesForManifest(typesArr, [
        clientSideInfo.get('UnpackagedMetadataPath'),
      ]);
    } else {
      typesArr = options.profileApi.filterAndGenerateProfilesForManifest(typesArr);
    }

    // Next generate profiles and retrieve any profiles that were excluded because they had no matching nodes.
    const excludedProfiles = options.profileApi.generateProfiles(
      packageVersProfileFolder,
      {
        Package: { types: typesArr },
      },
      [clientSideInfo.get('UnpackagedMetadataPath')]
    );

    if (excludedProfiles.length > 0) {
      const profileIdx = typesArr.findIndex((e) => e.name[0] === 'Profile');
      typesArr[profileIdx].members = typesArr[profileIdx].members.filter((e) => excludedProfiles.indexOf(e) === -1);
    }

    packageJson.Package.types = typesArr;

    // Re-write the package.xml in case profiles have been added or removed
    const xmlBuilder = new xml2js.Builder({
      xmldec: { version: '1.0', encoding: 'UTF-8' },
    });
    const xml = xmlBuilder.buildObject(packageJson);

    // Log information about the profiles being packaged up
    const profiles = options.profileApi.getProfileInformation();
    profiles.forEach((profile) => {
      if (logger.shouldLog(LoggerLevel.DEBUG)) {
        logger.debug(profile.logDebug());
      } else if (logger.shouldLog(LoggerLevel.INFO)) {
        logger.info(profile.logInfo());
      }
    });

    // TODO: confirm that param xml is writeable
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await fs.promises.writeFile(path.join(packageVersMetadataFolder, 'package.xml'), xml, 'utf-8');
    // Zip the packageVersMetadataFolder folder and put the zip in {packageVersBlobDirectory}/package.zip
    await zipDir(packageVersMetadataFolder, metadataZipFile);
    if (hasUnpackagedMetadata) {
      // Zip the unpackagedMetadataFolder folder and put the zip in {packageVersBlobDirectory}/{unpackagedMetadataZipFile}
      await zipDir(unpackagedMetadataFolder, unpackagedMetadataZipFile);
    }
    // Zip up the expanded settings (if present)
    if (settingsGenerator.hasSettings()) {
      await settingsGenerator.createDeploy();
      await settingsGenerator.createDeployPackageContents(this.apiVersionFromPackageXml);
      await zipDir(
        `${settingsGenerator.getDestinationPath()}${path.sep}${settingsGenerator.getShapeDirName()}`,
        settingsZipFile
      );
    }
    // Zip the Version Info and package.zip files into another zip
    await zipDir(packageVersBlobDirectory, packageVersBlobZipFile);

    return this.createRequestObject(packageId, options, preserveFiles, packageVersTmpRoot, packageVersBlobZipFile);
  }

  private resolveApexTestPermissions(
    packageDescriptorJson: Partial<PackageDir & { name: string; fullPath: string }> &
      Partial<{
        id: string;
        features: string[];
        orgPreferences: string[];
        snapshot: string;
        unpackagedMetadata: NamedPackageDir;
        apexTestAccess: { permissionSets: string[] | string; permissionSetLicenses: string[] | string };
        permissionSetNames: string[];
        permissionSetLicenseDeveloperNames: string[];
        branch: string;
        subscriberPackageVersionId: string;
        packageId: string;
        versionName: string;
      }>,
    options: PackageVersionCreateOptions
  ) {
    // Process permissionSet and permissionSetLicenses that should be enabled when running Apex tests
    // This only applies if code coverage is enabled
    if (options.codecoverage) {
      // Assuming no permission sets are named 0, 0n, null, undefined, false, NaN, and the empty string
      if (packageDescriptorJson.apexTestAccess && packageDescriptorJson.apexTestAccess.permissionSets) {
        let permSets = packageDescriptorJson.apexTestAccess.permissionSets;
        if (!Array.isArray(permSets)) {
          permSets = permSets.split(',');
        }
        packageDescriptorJson.permissionSetNames = permSets.map((s) => s.trim());
      }

      if (packageDescriptorJson.apexTestAccess && packageDescriptorJson.apexTestAccess.permissionSetLicenses) {
        let permissionSetLicenses = packageDescriptorJson.apexTestAccess.permissionSetLicenses;
        if (!Array.isArray(permissionSetLicenses)) {
          permissionSetLicenses = permissionSetLicenses.split(',');
        }
        packageDescriptorJson.permissionSetLicenseDeveloperNames = permissionSetLicenses.map((s) => s.trim());
      }
    }

    delete packageDescriptorJson.apexTestAccess;
  }

  private async resolveUnpackagedMetadata(
    packageDescriptorJson: PackageDescriptorJson,
    unpackagedMetadataFolder: string,
    clientSideInfo: Map<string, string>,
    codeCoverage: boolean
  ): Promise<boolean> {
    let hasUnpackagedMetadata = false;
    // Add the Unpackaged Metadata, if any, to the output directory, only when code coverage is specified
    if (codeCoverage && packageDescriptorJson.unpackagedMetadata && packageDescriptorJson.unpackagedMetadata.path) {
      hasUnpackagedMetadata = true;
      const unpackagedPath = path.join(process.cwd(), packageDescriptorJson.unpackagedMetadata.path);
      try {
        fs.statSync(unpackagedPath);
      } catch (err) {
        throw messages.createError('unpackagedMDDirectoryDoesNotExist', [
          packageDescriptorJson.unpackagedMetadata.path,
        ]);
      }
      fs.mkdirSync(unpackagedMetadataFolder, { recursive: true });
      await this.generateMDFolderForArtifact({
        deploydir: unpackagedMetadataFolder,
        sourceDir: unpackagedPath,
      });
      // Set which package is the "unpackaged" package
      clientSideInfo.set('UnpackagedMetadataPath', packageDescriptorJson.unpackagedMetadata.path);
    }
    return hasUnpackagedMetadata;
  }

  private getPackagePropertyFromPackage(
    packageDirs: NamedPackageDir[],
    options: PackageVersionCreateOptions
  ): 'package' | 'id' {
    let foundByPackage = packageDirs.some((x) => x['package'] === options.package);
    let foundById = packageDirs.some((x) => x['id'] === options.package);

    if (foundByPackage && foundById) {
      throw messages.createError('errorPackageAndIdCollision', []);
    }

    // didn't find anything? let's see if we can reverse look up
    if (!foundByPackage && !foundById) {
      // is it an alias?
      const pkgId = pkgUtils.getPackageIdFromAlias(options.package, this.project);

      if (pkgId === options.package) {
        // not an alias, or not a valid one, try to reverse lookup an alias in case this is an id
        const aliases = pkgUtils.getPackageAliasesFromId(options.package, this.project);

        // if we found an alias, try to look that up in the config.
        foundByPackage = aliases.some((alias) => packageDirs.find((x) => x['package'] === alias));
      } else {
        // it is an alias; try to lookup it's id in the config
        foundByPackage = packageDirs.some((x) => x['package'] === pkgId);
        foundById = packageDirs.some((x) => x['id'] === pkgId);

        if (!foundByPackage && !foundById) {
          // check if any configs use a different alias to that same id
          const aliases = pkgUtils.getPackageAliasesFromId(pkgId, this.project);
          foundByPackage = aliases.some((alias) => {
            const pd = packageDirs.find((x) => x['package'] === alias);
            if (pd) {
              // if so, set this.options.package.flags.package to be this alias instead of the alternate
              options.package = alias;
            }
            return pd;
          });
        }
      }
      // if we still didn't find anything, throw the error
      if (!foundByPackage && !foundById) {
        throw messages.createError('errorMissingPackage', [pkgId]);
      }
    }

    return foundByPackage ? 'package' : 'id';
  }

  private getPackageValuePropertyFromDirectory(
    directoryFlag: string,
    options: PackageVersionCreateOptions
  ): { packageProperty: 'id' | 'package'; packageValue: string } {
    const packageValue = this.getConfigPackageDirectoriesValue(
      this.project.getPackageDirectories(),
      'package',
      'path',
      options.path,
      directoryFlag,
      options
    );
    const packageIdValue = this.getConfigPackageDirectoriesValue(
      this.project.getPackageDirectories(),
      'id',
      'path',
      options.path,
      directoryFlag,
      options
    );

    let packagePropVal: { packageProperty: 'id' | 'package'; packageValue: string };

    if (!packageValue && !packageIdValue) {
      throw messages.createError('errorMissingPackage', []);
    } else if (packageValue && packageIdValue) {
      throw messages.createError('errorPackageAndIdCollision', []);
    } else if (packageValue) {
      packagePropVal = {
        packageProperty: 'package',
        packageValue,
      };
    } else {
      packagePropVal = {
        packageProperty: 'id',
        packageValue: packageIdValue,
      };
    }

    return packagePropVal;
  }

  /**
   * Returns the property value that corresponds to the propertyToLookup.  This value found for a particular
   * package directory element that matches the knownProperty and knownValue.  In other words, we locate a package
   * directory element whose knownProperty matches the knownValue, then we grab the value for the propertyToLookup
   * and return it.
   *
   * @param packageDirs The list of all the package directories from the sfdx-project.json
   * @param propertyToLookup The property ID whose value we want to find
   * @param knownProperty The JSON property in the packageDirectories that is already known
   * @param knownValue The value that corresponds to the knownProperty in the packageDirectories JSON
   * @param knownFlag The flag details e.g. short/long name, etc. Only used for the error message
   * @param options
   */
  private getConfigPackageDirectoriesValue(
    packageDirs,
    propertyToLookup: string,
    knownProperty: string,
    knownValue: string,
    knownFlag: string,
    options: PackageVersionCreateOptions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    let value;
    let packageDir = packageDirs.find((x) => x[knownProperty] === knownValue);
    if (!packageDir && knownFlag === 'path' && knownValue.endsWith(path.sep)) {
      // if this is the directory flag, try removing the trailing slash added by CLI auto-complete
      const dirWithoutTrailingSlash = knownValue.slice(0, -1);
      packageDir = packageDirs.find((x) => x[knownProperty] === dirWithoutTrailingSlash);
      if (packageDir) {
        // TODO: how to deal with this side effect?
        options.path = dirWithoutTrailingSlash;
      }
    }
    // didn't find it with the package property, try a reverse lookup with alias and id
    if (!packageDir && knownProperty === 'package') {
      const pkgId = pkgUtils.getPackageIdFromAlias(knownValue, this.project);
      if (pkgId !== knownValue) {
        packageDir = packageDirs.find((x) => x[knownProperty] === pkgId);
      } else {
        const aliases = pkgUtils.getPackageAliasesFromId(knownValue, this.project);
        aliases.some((alias) => {
          packageDir = packageDirs.find((x) => x[knownProperty] === alias);
          return packageDir;
        });
      }
    }

    if (packageDir) {
      value = packageDir[propertyToLookup];
    } else {
      throw messages.createError('errorNoMatchingPackageDirectory', [`--${knownFlag}`, knownValue, knownProperty]);
    }
    return value;
  }

  private async packageVersionCreate(
    options: PackageVersionCreateOptions
  ): Promise<Partial<PackageVersionCreateRequestResult>> {
    // For the first rollout of validating sfdx-project.json data against schema, make it optional and defaulted
    // to false. Validation only occurs if the hidden -j (--validateschema) flag has been specified.
    if (options.validateschema) {
      await this.project.getSfProjectJson().schemaValidate();
    }

    // Check for empty packageDirectories
    if (this.project.getPackageDirectories()?.length === 0) {
      throw messages.createError('errorEmptyPackageDirs');
    }

    const canonicalPackageProperty = this.resolveCanonicalPackageProperty(options);

    const resolvedPackageId = pkgUtils.getPackageIdFromAlias(options.package, this.project);

    // At this point, the packageIdFromAlias should have been resolved to an Id.  Now, we
    // need to validate that the Id is correct.
    pkgUtils.validateId(pkgUtils.BY_LABEL.PACKAGE_ID, resolvedPackageId);

    await this.validateFlagsForPackageType(resolvedPackageId, options);

    const versionNumberString = await this.validateVersionNumber(canonicalPackageProperty, resolvedPackageId, options);

    try {
      fs.statSync(path.join(process.cwd(), options.path));
    } catch (err) {
      throw messages.createError('directoryDoesNotExist', [options.path]);
    }

    options.profileApi = await this.resolveUserLicenses(canonicalPackageProperty, options);

    const request = await this.createPackageVersionCreateRequestFromOptions(
      options,
      resolvedPackageId,
      versionNumberString
    );
    const createResult = await this.connection.tooling.create('Package2VersionCreateRequest', request);
    if (!createResult.success) {
      const errStr =
        createResult.errors && createResult.errors.length ? createResult.errors.join(', ') : createResult.errors;
      throw messages.createError('failedToCreatePVCRequest', [
        createResult.id ? ` [${createResult.id}]` : '',
        errStr.toString(),
      ]);
    }
    let pollInterval = Duration.seconds(pkgUtils.POLL_INTERVAL_SECONDS);
    let maxRetries = 0;

    if (options.wait?.milliseconds > 0) {
      if (options.skipvalidation === true) {
        pollInterval = Duration.seconds(POLL_INTERVAL_WITHOUT_VALIDATION_SECONDS);
      }
      maxRetries = (60 / pollInterval.seconds) * options.wait.seconds;
    }
    [pollInterval, maxRetries] = await this.resolveOrgDependentPollingTime(
      resolvedPackageId,
      options,
      pollInterval,
      maxRetries
    );

    return (await this.listRequestById(createResult.id, this.connection))[0];
  }

  private resolveCanonicalPackageProperty(options: PackageVersionCreateOptions): 'package' | 'id' {
    let canonicalPackageProperty: 'id' | 'package';

    if (!options.package) {
      const packageValProp = this.getPackageValuePropertyFromDirectory(options.path, options);
      options.package = packageValProp.packageValue;
      canonicalPackageProperty = packageValProp.packageProperty;
    } else if (!options.path) {
      canonicalPackageProperty = this.getPackagePropertyFromPackage(this.project.getPackageDirectories(), options);
      options.path = this.getConfigPackageDirectoriesValue(
        this.project.getPackageDirectories(),
        'path',
        canonicalPackageProperty,
        options.package,
        'package',
        options
      );
    } else {
      canonicalPackageProperty = this.getPackagePropertyFromPackage(this.project.getPackageDirectories(), options);
      this.getConfigPackageDirectoriesValue(
        this.project.getPackageDirectories(),
        canonicalPackageProperty,
        'path',
        options.path,
        'path',
        options
      );

      const expectedPackageId = this.getConfigPackageDirectoriesValue(
        this.project.getPackageDirectories(),
        canonicalPackageProperty,
        'path',
        options.path,
        'path',
        options
      );

      // This will throw an error if the package id flag value doesn't match
      // any of the :id values in the package dirs.
      this.getConfigPackageDirectoriesValue(
        this.project.getPackageDirectories(),
        'path',
        canonicalPackageProperty,
        options.package,
        'package',
        options
      );

      // This will throw an error if the package id flag value doesn't match
      // the correct corresponding directory with that packageId.
      if (options.package !== expectedPackageId) {
        throw messages.createError('errorDirectoryIdMismatch', ['--path', options.path, '--package', options.package]);
      }
    }
    return canonicalPackageProperty;
  }

  // TODO: should be in pkg utils
  private async validateVersionNumber(
    canonicalPackageProperty: 'id' | 'package',
    resolvedPackageId: string,
    options: PackageVersionCreateOptions
  ): Promise<string> {
    // validate the versionNumber flag value if specified, otherwise the descriptor value
    const versionNumberString = options.versionnumber
      ? options.versionnumber
      : (this.getConfigPackageDirectoriesValue(
          this.project.getPackageDirectories(),
          'versionNumber',
          canonicalPackageProperty,
          options.package,
          'package',
          options
        ) as string);

    pkgUtils.validateVersionNumber(versionNumberString, BuildNumberToken.NEXT_BUILD_NUMBER_TOKEN, null);
    await pkgUtils.validatePatchVersion(this.connection, versionNumberString, resolvedPackageId);
    return versionNumberString;
  }

  private async resolveUserLicenses(
    canonicalPackageProperty: 'id' | 'package',
    options: PackageVersionCreateOptions
  ): Promise<PackageProfileApi> {
    // Check for an includeProfileUserLiceneses flag in the packageDirectory
    const includeProfileUserLicenses = this.getConfigPackageDirectoriesValue(
      this.project.getPackageDirectories(),
      'includeProfileUserLicenses',
      canonicalPackageProperty,
      options.package,
      'package',
      options
    );
    if (
      includeProfileUserLicenses !== undefined &&
      includeProfileUserLicenses !== true &&
      includeProfileUserLicenses !== false
    ) {
      throw messages.createError('errorProfileUserLicensesInvalidValue', [includeProfileUserLicenses] as string[]);
    }
    const shouldGenerateProfileInformation = logger.shouldLog(LoggerLevel.INFO) || logger.shouldLog(LoggerLevel.DEBUG);
    return PackageProfileApi.create({
      project: this.project,
      includeUserLicenses: includeProfileUserLicenses as boolean,
      generateProfileInformation: shouldGenerateProfileInformation,
    });
  }

  private async resolveOrgDependentPollingTime(
    resolvedPackageId: string,
    options: PackageVersionCreateOptions,
    pollInterval: Duration,
    maxRetries: number
  ): Promise<[Duration, number]> {
    let pi = pollInterval;
    let mr = maxRetries;
    // If we are polling check to see if the package is Org-Dependent, if so, update the poll time
    if (options.wait) {
      const query = `SELECT IsOrgDependent FROM Package2 WHERE Id = '${resolvedPackageId}'`;
      try {
        const pkgQueryResult = await this.connection.singleRecordQuery<PackagingSObjects.Package2>(query, {
          tooling: true,
        });
        if (pkgQueryResult.IsOrgDependent) {
          pi = Duration.seconds(POLL_INTERVAL_WITHOUT_VALIDATION_SECONDS);
          mr = (60 / pollInterval.seconds) * options.wait.seconds;
        }
      } catch {
        // do nothing
      }
    }
    return [pi, mr];
  }

  private async validateFlagsForPackageType(packageId: string, options: PackageVersionCreateOptions): Promise<void> {
    const packageType = await pkgUtils.getPackageType(packageId, this.connection);

    if (packageType === 'Unlocked') {
      if (options.postinstallscript || options.uninstallscript) {
        // migrate coreMessages to messages
        throw messages.createError('version_create.errorScriptsNotApplicableToUnlockedPackage');
      }

      // Don't allow ancestor in unlocked packages

      const packageDescriptorJson = this.getPackageDescriptorJsonFromPackageId(packageId, options);

      const ancestorId = packageDescriptorJson.ancestorId;
      const ancestorVersion = packageDescriptorJson.ancestorVersion;

      if (ancestorId || ancestorVersion) {
        throw messages.createError('version_create.errorAncestorNotApplicableToUnlockedPackage');
      }
    }
  }

  /**
   * Cleans invalid attribute(s) from the packageDescriptorJSON
   */
  private cleanPackageDescriptorJson(packageDescriptorJson: PackageDescriptorJson): PackageDescriptorJson {
    delete packageDescriptorJson.default; // for client-side use only, not needed
    delete packageDescriptorJson.includeProfileUserLicenses; // for client-side use only, not needed
    delete packageDescriptorJson.unpackagedMetadata; // for client-side use only, not needed
    delete packageDescriptorJson.branch; // for client-side use only, not needed
    delete packageDescriptorJson.fullPath; // for client-side use only, not needed
    delete packageDescriptorJson.name; // for client-side use only, not needed
    return packageDescriptorJson;
  }

  /**
   * Sets default or override values for packageDescriptorJSON attribs
   */
  private setPackageDescriptorJsonValues(
    packageDescriptorJson: PackageDescriptorJson,
    options: PackageVersionCreateOptions
  ): void {
    if (options.versionname) {
      packageDescriptorJson.versionName = options.versionname;
    }
    if (options.versiondescription) {
      packageDescriptorJson.versionDescription = options.versiondescription;
    }
    if (options.versionnumber) {
      packageDescriptorJson.versionNumber = options.versionnumber;
    }

    // default versionName to versionNumber if unset, stripping .NEXT if present
    if (!packageDescriptorJson.versionName) {
      const versionNumber = packageDescriptorJson.versionNumber;
      packageDescriptorJson.versionName =
        versionNumber.split(pkgUtils.VERSION_NUMBER_SEP)[3] === BuildNumberToken.NEXT_BUILD_NUMBER_TOKEN
          ? versionNumber.substring(
              0,
              versionNumber.indexOf(pkgUtils.VERSION_NUMBER_SEP + BuildNumberToken.NEXT_BUILD_NUMBER_TOKEN)
            )
          : versionNumber;
      logger.warn(options, messages.getMessage('defaultVersionName', [packageDescriptorJson.versionName]));
    }

    if (options.releasenotesurl) {
      packageDescriptorJson.releaseNotesUrl = options.releasenotesurl;
    }
    if (packageDescriptorJson.releaseNotesUrl && !pkgUtils.validUrl(packageDescriptorJson.releaseNotesUrl)) {
      throw messages.createError('malformedUrl', ['releaseNotesUrl', packageDescriptorJson.releaseNotesUrl]);
    }

    if (options.postinstallurl) {
      packageDescriptorJson.postInstallUrl = options.postinstallurl;
    }
    if (packageDescriptorJson.postInstallUrl && !pkgUtils.validUrl(packageDescriptorJson.postInstallUrl)) {
      throw messages.createError('malformedUrl', ['postInstallUrl', packageDescriptorJson.postInstallUrl]);
    }

    if (options.postinstallscript) {
      packageDescriptorJson.postInstallScript = options.postinstallscript;
    }
    if (options.uninstallscript) {
      packageDescriptorJson.uninstallScript = options.uninstallscript;
    }
  }
}
