/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as util from 'util';
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
import {
  ComponentSet,
  ComponentSetBuilder,
  ConvertResult,
  MetadataConverter,
} from '@salesforce/source-deploy-retrieve';
import { uniqid } from '@salesforce/core/lib/testSetup';
import SettingsGenerator from '@salesforce/core/lib/org/scratchOrgSettingsGenerator';
import * as xml2js from 'xml2js';
import { AsyncCreatable, Duration } from '@salesforce/kit';
import { PackageDirDependency } from '@salesforce/core/lib/sfProject';
import * as pkgUtils from '../utils/packageUtils';
import { consts } from '../constants';
import { copyDir, zipDir } from '../utils';
import { BuildNumberToken, VersionNumber } from '../utils/versionNumber';
import { Package2VersionCreateRequestResult, PackagingSObjects } from '../interfaces';
import { ProfileApi } from './profileApi';
import { PackageVersionCreateRequestApi } from './packageVersionCreateRequestApi';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

const logger = Logger.childFromRoot('packageVersionCreate');

const DESCRIPTOR_FILE = 'package2-descriptor.json';

const POLL_INTERVAL_WITHOUT_VALIDATION_SECONDS = 5;

export type MDFolderForArtifactOptions = {
  packageName?: string;
  sourceDir?: string;
  outputDir?: string;
  manifest?: string;
  sourcePaths?: string[];
  metadataPaths?: string[];
  deploydir?: string;
};

export type PackageVersionOptions = {
  connection: Connection;
  project: SfProject;
};

type PackageVersionCreateOptions = {
  branch: string;
  buildinstance: string;
  codecoverage: boolean;
  definitionfile: string;
  installationkey: string;
  installationkeybypass: boolean;
  package: string;
  path: string;
  postinstallscript: string;
  postinstallurl: string;
  preserve: boolean;
  releasenotesurl: string;
  skipancestorcheck: boolean;
  skipvalidation: boolean;
  sourceorg: string;
  tag: string;
  uninstallscript: string;
  validateschema: boolean;
  versiondescription: string;
  versionname: string;
  versionnumber: string;
  wait: Duration;
};

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

export class PackageVersion extends AsyncCreatable<PackageVersionOptions> {
  private pollInterval: Duration;
  private apiVersionFromPackageXml: string;
  private packageVersionCreateRequestApi: PackageVersionCreateRequestApi;
  private packageDirs: NamedPackageDir[] = [];
  private profileApi: ProfileApi;
  private readonly project: SfProject;
  private readonly connection: Connection;

  protected constructor(private options: PackageVersionOptions) {
    super(options);
    this.connection = this.options.connection;
    this.project = this.options.project;
  }

  public createPackageVersion(
    context: PackageVersionCreateOptions
  ): Promise<Partial<Package2VersionCreateRequestResult>> {
    return this._createPackageVersion(context).catch((err: Error) => {
      // TODO: until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      err = pkgUtils.massageErrorMessage(err);
      throw pkgUtils.applyErrorAction(err);
    });
  }

  public rejectWithInstallKeyError() {
    // This command also requires either the installationkey flag or installationkeybypass flag
    const errorString = messages.getMessage('errorMissingFlagsInstallationKey', [
      '--installationkey',
      '--installationkeybypass',
    ]);
    const error = new Error(errorString);
    error['name'] = 'requiredFlagMissing';
    return Promise.reject(error);
  }

  protected init(): Promise<void> {
    return;
  }

  // convert source to mdapi format and copy to tmp dir packaging up
  private async _generateMDFolderForArtifact(options: MDFolderForArtifactOptions): Promise<ConvertResult> {
    const componentSet = await ComponentSetBuilder.build({
      sourceapiversion: this.project.getSfProjectJson().get('sourceApiVersion') as string,
      sourcepath: options.sourcePaths,
      manifest: {
        manifestPath: options.manifest,
        directoryPaths: this.project.getPackageDirectories().map((dir) => dir.path),
      },
      metadata: {
        metadataEntries: options.metadataPaths,
        directoryPaths: this.project.getPackageDirectories().map((dir) => dir.path),
      },
    });

    const packageName = options.packageName;
    const outputDirectory = path.resolve(options.outputDir);
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

  private _validateDependencyValues(dependency: PackageDescriptorJson) {
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
  private async _retrieveSubscriberPackageVersionId(
    dependency: PackageDescriptorJson,
    branchFromFlagOrDef: string
  ): Promise<PackageDescriptorJson> {
    await this._validateDependencyValues(dependency);
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
    const resolvedBuildNumber = await this._resolveBuildNumber(versionNumber, dependency.packageId, branch);
    // now that we have a full build number, query for the associated 04t.
    // because the build number may not be unique across versions, add in conditionals for
    // the branch or the RELEASED token (if used)
    const branchOrReleasedCondition =
      buildNumber === BuildNumberToken.RELEASED_BUILD_NUMBER_TOKEN
        ? 'AND IsReleased = true'
        : `AND Branch = ${branchString}`;
    const query = `SELECT SubscriberPackageVersionId FROM Package2Version WHERE Package2Id = '${dependency.packageId}' AND MajorVersion = ${versionNumber[0]} AND MinorVersion = ${versionNumber[1]} AND PatchVersion = ${versionNumber[2]} AND BuildNumber = ${resolvedBuildNumber} ${branchOrReleasedCondition}`;
    const pkgVerQueryResult = await this.connection.tooling.query(query);
    const subRecords = pkgVerQueryResult.records;
    if (!subRecords || subRecords.length !== 1) {
      throw new Error(
        `No version number was found in Dev Hub for package id ${
          dependency.packageId
        } and branch ${branchString} and version number ${versionNumber.toString()} that resolved to build number ${resolvedBuildNumber}`
      );
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

  private async _resolveBuildNumber(versionNumber: VersionNumber, packageId: string, branch: string): Promise<string> {
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
        throw new Error(
          `No released version was found in Dev Hub for package id ${packageId} and version number ${versionNumber.toString()}`
        );
      } else {
        throw new Error(
          `No version number was found in Dev Hub for package id ${packageId} and branch ${branch} and version number ${versionNumber.toString()}`
        );
      }
    }
    return `${results.records[0].expr0}`;
  }

  private async _createRequestObject(
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
      CalculateCodeCoverage: options.codecoverage,
      SkipValidation: options.skipvalidation,
    };

    if (preserveFiles) {
      logger.info(messages.getMessage('tempFileLocation', [packageVersTmpRoot]));
      return requestObject;
    } else {
      return fs.promises.unlink(packageVersTmpRoot).then(() => requestObject);
    }
  }

  private _getPackageDescriptorJsonFromPackageId(packageId: string, flags: { path: string }) {
    const artDir = flags.path;

    const packageDescriptorJson = this.packageDirs.find((packageDir) => {
      const packageDirPackageId = pkgUtils.getPackageIdFromAlias(packageDir.package, this.project);
      return !!packageDirPackageId && packageDirPackageId === packageId ? packageDir : null;
    });

    if (!packageDescriptorJson) {
      throw new Error(`${consts.WORKSPACE_CONFIG_FILENAME} does not contain a packaging directory for ${artDir}`);
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
  private async _createPackageVersionCreateRequestFromOptions(
    options: PackageVersionCreateOptions,
    packageId: string,
    versionNumberString: string
  ): Promise<PackageVersionCreateRequest> {
    const artDir = options.path;
    const preserveFiles = !util.isNullOrUndefined(
      options.preserve || process.env.SFDX_PACKAGE2_VERSION_CREATE_PRESERVE
    );
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
      sourcedir: sourceBaseDir,
    };

    // Stores any additional client side info that might be needed later on in the process
    const clientSideInfo = new Map<string, string>();

    const settingsGenerator = new SettingsGenerator();
    // Copy all of the metadata from the workspace to a tmp folder
    await this._generateMDFolderForArtifact(mdOptions);
    const packageDescriptorJson = this._getPackageDescriptorJsonFromPackageId(
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
    // @ts-ignore
    const [hasUnpackagedMetadata, unpackagedPromise] = await this._resolveUnpackagedMetadata(
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
      dependencies
        ? []
        : dependencies.map((dependency) => this._retrieveSubscriberPackageVersionId(dependency, options.branch))
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

    this._cleanPackageDescriptorJson(packageDescriptorJson);
    this._setPackageDescriptorJsonValues(packageDescriptorJson, options);

    await fs.promises.mkdir(packageVersTmpRoot, { recursive: true });
    await fs.promises.mkdir(packageVersBlobDirectory, { recursive: true });

    if (Object.prototype.hasOwnProperty.call(packageDescriptorJson, 'ancestorVersion')) {
      delete packageDescriptorJson.ancestorVersion;
    }
    packageDescriptorJson.ancestorId = ancestorId;

    await fs.promises.writeFile(
      path.join(packageVersBlobDirectory, DESCRIPTOR_FILE),
      // TODO: need to make sure packageDescriptorJson contains the right values for the descriptor
      JSON.stringify(packageDescriptorJson, undefined, 2),
      'utf-8'
    );
    // As part of the source convert process, the package.xml has been written into the tmp metadata directory.
    // The package.xml may need to be manipulated due to processing profiles in the workspace or additional
    // metadata exclusions. If necessary, read the existing package.xml and then re-write it.
    const currentPackageXml = await fs.promises.readFile(path.join(packageVersMetadataFolder, 'package.xml'), 'utf8');
    // convert to json
    const packageJson = xml2js.parseStringAsync(currentPackageXml);
    fs.mkdirSync(packageVersMetadataFolder, { recursive: true });
    fs.mkdirSync(packageVersProfileFolder, { recursive: true });

    // Apply any necessary exclusions to typesArr.
    let typesArr = packageJson.Package.types;
    this.apiVersionFromPackageXml = packageJson.Package.version;

    // if we're using unpackaged metadata, don't package the profiles located there
    if (hasUnpackagedMetadata) {
      typesArr = this.profileApi.filterAndGenerateProfilesForManifest(typesArr, [
        clientSideInfo.get('UnpackagedMetadataPath'),
      ]);
    } else {
      typesArr = this.profileApi.filterAndGenerateProfilesForManifest(typesArr);
    }

    // Next generate profiles and retrieve any profiles that were excluded because they had no matching nodes.
    const excludedProfiles = this.profileApi.generateProfiles(
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
    const profiles = this.profileApi.getProfileInformation();
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
    zipDir(packageVersMetadataFolder, metadataZipFile);
    if (hasUnpackagedMetadata) {
      // Zip the unpackagedMetadataFolder folder and put the zip in {packageVersBlobDirectory}/{unpackagedMetadataZipFile}
      await zipDir(unpackagedMetadataFolder, unpackagedMetadataZipFile);
    }
    // Zip up the expanded settings (if present)
    if (settingsGenerator.hasSettings()) {
      await settingsGenerator.createDeploy();
      const settingsRoot: string = settingsGenerator.getShapeDirName();
      // The SettingsGenerator now generates md files in source format, not mdapi format,
      // so we need to convert to mdapi format here.
      const compSet = ComponentSet.fromSource(settingsRoot);
      compSet.apiVersion = this.apiVersionFromPackageXml;
      compSet.sourceApiVersion = this.apiVersionFromPackageXml;
      const mdConverter = new MetadataConverter();
      const convertResult = await mdConverter.convert(compSet, 'metadata', {
        type: 'directory',
        outputDirectory: path.join(settingsRoot, 'pkgMdSettings'),
        genUniqueDir: false,
      });
      zipDir(convertResult.packagePath, settingsZipFile);
    }
    // Zip the Version Info and package.zip files into another zip
    zipDir(packageVersBlobDirectory, packageVersBlobZipFile);

    return this._createRequestObject(packageId, options, preserveFiles, packageVersTmpRoot, packageVersBlobZipFile);
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

  private async _resolveUnpackagedMetadata(
    packageDescriptorJson: PackageDescriptorJson,
    unpackagedMetadataFolder: string,
    clientSideInfo: Map<string, string>,
    codeCoverage: boolean
  ) {
    let unpackagedPromise = null;
    let hasUnpackagedMetadata = false;
    // Add the Unpackaged Metadata, if any, to the output directory, only when code coverage is specified
    if (codeCoverage && packageDescriptorJson.unpackagedMetadata && packageDescriptorJson.unpackagedMetadata.path) {
      hasUnpackagedMetadata = true;
      const unpackagedPath = path.join(process.cwd(), packageDescriptorJson.unpackagedMetadata.path);
      try {
        fs.statSync(unpackagedPath);
      } catch (err) {
        throw new Error(
          `Unpackaged metadata directory '${packageDescriptorJson.unpackagedMetadata.path}' was specified but does not exist`
        );
      }
      fs.mkdirSync(unpackagedMetadataFolder, { recursive: true });
      unpackagedPromise = this._generateMDFolderForArtifact({
        deploydir: unpackagedMetadataFolder,
        sourceDir: unpackagedPath,
      });
      // Set which package is the "unpackaged" package
      clientSideInfo.set('UnpackagedMetadataPath', packageDescriptorJson.unpackagedMetadata.path);
    }
    return [hasUnpackagedMetadata, unpackagedPromise];
  }

  // TODO: return type?
  private _getPackagePropertyFromPackage(packageDirs, options: PackageVersionCreateOptions) {
    let foundByPackage = packageDirs.find((x) => x['package'] === options.package);
    let foundById = packageDirs.find((x) => x['id'] === options.package);

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
        foundByPackage = packageDirs.find((x) => x['package'] === pkgId);
        foundById = packageDirs.find((x) => x['id'] === pkgId);

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

  private _getPackageValuePropertyFromDirectory(directoryFlag: string, options: PackageVersionCreateOptions) {
    const packageValue = this._getConfigPackageDirectoriesValue(
      this.project.getPackageDirectories(),
      'package',
      'path',
      options.path,
      directoryFlag,
      options
    );
    const packageIdValue = this._getConfigPackageDirectoriesValue(
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
  private _getConfigPackageDirectoriesValue(
    packageDirs,
    propertyToLookup: string,
    knownProperty: string,
    knownValue: string,
    knownFlag: string,
    options: PackageVersionCreateOptions
  ) {
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

  // eslint-disable-next-line complexity
  private async _createPackageVersion(
    options: PackageVersionCreateOptions
  ): Promise<Partial<Package2VersionCreateRequestResult>> {
    this.packageVersionCreateRequestApi = new PackageVersionCreateRequestApi({ connection: this.connection });

    let pollInterval = Duration.seconds(pkgUtils.POLL_INTERVAL_SECONDS);
    let maxRetries = 0;

    if (options.wait.milliseconds > 0) {
      if (options.skipvalidation === true) {
        pollInterval = Duration.seconds(POLL_INTERVAL_WITHOUT_VALIDATION_SECONDS);
      }
      maxRetries = (60 / pollInterval.seconds) * options.wait.seconds;
    }

    // For the first rollout of validating sfdx-project.json data against schema, make it optional and defaulted
    // to false. Validation only occurs if the hidden -j (--validateschema) flag has been specified.
    if (options.validateschema) {
      await this.project.getSfProjectJson().schemaValidate();
    }

    // Check for empty packageDirectories
    if (this.project.getSfProjectJson().getContents().packageDirectories?.length === 0) {
      throw messages.createError('errorEmptyPackageDirs');
    }

    const canonicalPackageProperty = this.resolveCanonicalPackageProperty(options);

    const resolvedPackageId = pkgUtils.getPackageIdFromAlias(options.package, this.project);

    // At this point, the packageIdFromAlias should have been resolved to an Id.  Now, we
    // need to validate that the Id is correct.
    pkgUtils.validateId(pkgUtils.BY_LABEL.PACKAGE_ID, resolvedPackageId);

    await this._validateFlagsForPackageType(resolvedPackageId, options);

    const versionNumberString = await this.validateVersionNumber(canonicalPackageProperty, resolvedPackageId, options);

    try {
      fs.statSync(path.join(process.cwd(), options.path));
    } catch (err) {
      throw new Error(`Directory '${options.path}' does not exist`);
    }

    this.resolveUserLicenses(canonicalPackageProperty, options);

    await this.resolveOrgDependentPollingTime(resolvedPackageId, options, pollInterval, maxRetries);

    const request = await this._createPackageVersionCreateRequestFromOptions(
      options,
      resolvedPackageId,
      versionNumberString
    );
    const createResult = await this.connection.tooling.create('Package2VersionCreateRequest', request);
    if (!createResult.success) {
      const errStr =
        createResult.errors && createResult.errors.length ? createResult.errors.join(', ') : createResult.errors;
      throw new Error(`Failed to create request${createResult.id ? ` [${createResult.id}]` : ''}: ${errStr}`);
    }
    let result;
    if (options.wait && options.wait.milliseconds > 0) {
      pollInterval = pollInterval ?? Duration.seconds(options.wait.seconds / maxRetries);
      if (pollInterval) {
        result = await pkgUtils.pollForStatusWithInterval(
          createResult.id,
          maxRetries,
          resolvedPackageId,
          options.branch,
          this.project,
          this.connection,
          pollInterval
        );
      }
    } else {
      result = await this.packageVersionCreateRequestApi.byId(createResult.id);
    }
    return result;
  }

  // TODO: should be in pkg utils
  private resolveCanonicalPackageProperty(options: PackageVersionCreateOptions) {
    let canonicalPackageProperty: 'id' | 'package';

    if (!options.package) {
      const packageValProp = this._getPackageValuePropertyFromDirectory(options.path, options);
      options.package = packageValProp.packageValue;
      canonicalPackageProperty = packageValProp.packageProperty;
    } else if (!options.path) {
      canonicalPackageProperty = this._getPackagePropertyFromPackage(this.project.getPackageDirectories(), options);
      options.path = this._getConfigPackageDirectoriesValue(
        this.project.getPackageDirectories(),
        'path',
        canonicalPackageProperty,
        options.package,
        'package',
        options
      );
    } else {
      canonicalPackageProperty = this._getPackagePropertyFromPackage(this.project.getPackageDirectories(), options);
      this._getConfigPackageDirectoriesValue(
        this.project.getPackageDirectories(),
        canonicalPackageProperty,
        'path',
        options.path,
        'path',
        options
      );

      const expectedPackageId = this._getConfigPackageDirectoriesValue(
        this.packageDirs,
        canonicalPackageProperty,
        'path',
        options.path,
        'path',
        options
      );

      // This will throw an error if the package id flag value doesn't match
      // any of the :id values in the package dirs.
      this._getConfigPackageDirectoriesValue(
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
  ) {
    // validate the versionNumber flag value if specified, otherwise the descriptor value
    const versionNumberString = options.versionnumber
      ? options.versionnumber
      : (this._getConfigPackageDirectoriesValue(
          this.packageDirs,
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

  private resolveUserLicenses(canonicalPackageProperty: 'id' | 'package', options: PackageVersionCreateOptions) {
    // Check for an includeProfileUserLiceneses flag in the packageDirectory
    const includeProfileUserLicenses = this._getConfigPackageDirectoriesValue(
      this.packageDirs,
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
    this.profileApi = new ProfileApi(
      this.project,
      includeProfileUserLicenses as boolean,
      shouldGenerateProfileInformation
    );
  }

  private async resolveOrgDependentPollingTime(
    resolvedPackageId: string,
    options: PackageVersionCreateOptions,
    pollInterval: Duration,
    maxRetries: number
  ) {
    // If we are polling check to see if the package is Org-Dependent, if so, update the poll time
    if (options.wait) {
      const query = `SELECT IsOrgDependent FROM Package2 WHERE Id = '${resolvedPackageId}'`;
      try {
        const pkgQueryResult = await this.connection.singleRecordQuery<PackagingSObjects.Package2>(query, {
          tooling: true,
        });
        if (pkgQueryResult.IsOrgDependent) {
          pollInterval = Duration.seconds(POLL_INTERVAL_WITHOUT_VALIDATION_SECONDS);
          maxRetries = (60 / this.pollInterval.seconds) * options.wait.seconds;
        }
      } catch {
        // do nothing
      }
    }
  }

  private async _validateFlagsForPackageType(packageId: string, options: PackageVersionCreateOptions): Promise<void> {
    const packageType = await pkgUtils.getPackage2Type(packageId, this.connection);

    if (packageType === 'Unlocked') {
      if (options.postinstallscript || options.uninstallscript) {
        // migrate coreMessages to messages
        throw messages.createError('version_create.errorScriptsNotApplicableToUnlockedPackage');
      }

      // Don't allow ancestor in unlocked packages

      const packageDescriptorJson = this._getPackageDescriptorJsonFromPackageId(packageId, options);

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
  private _cleanPackageDescriptorJson(packageDescriptorJson: PackageDescriptorJson): void {
    if (typeof packageDescriptorJson.default !== 'undefined') {
      delete packageDescriptorJson.default; // for client-side use only, not needed
    }
    if (typeof packageDescriptorJson.includeProfileUserLicenses !== 'undefined') {
      delete packageDescriptorJson.includeProfileUserLicenses; // for client-side use only, not needed
    }

    if (typeof packageDescriptorJson.unpackagedMetadata !== 'undefined') {
      delete packageDescriptorJson.unpackagedMetadata; // for client-side use only, not needed
    }

    if (typeof packageDescriptorJson.branch !== 'undefined') {
      delete packageDescriptorJson.branch; // for client-side use only, not needed
    }
  }

  /**
   * Sets default or override values for packageDescriptorJSON attribs
   */
  private _setPackageDescriptorJsonValues(
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
      throw new Error(messages.getMessage('malformedUrl', ['releaseNotesUrl', packageDescriptorJson.releaseNotesUrl]));
    }

    if (options.postinstallurl) {
      packageDescriptorJson.postInstallUrl = options.postinstallurl;
    }
    if (packageDescriptorJson.postInstallUrl && !pkgUtils.validUrl(packageDescriptorJson.postInstallUrl)) {
      throw new Error(messages.getMessage('malformedUrl', ['postInstallUrl', packageDescriptorJson.postInstallUrl]));
    }

    if (options.postinstallscript) {
      packageDescriptorJson.postInstallScript = options.postinstallscript;
    }
    if (options.uninstallscript) {
      packageDescriptorJson.uninstallScript = options.uninstallscript;
    }
  }
}
