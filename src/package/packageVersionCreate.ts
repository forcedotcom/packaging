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
  Lifecycle,
  Logger,
  LoggerLevel,
  Messages,
  NamedPackageDir,
  ScratchOrgInfo,
  SfdcUrl,
  SfProject,
} from '@salesforce/core';
import { ComponentSetBuilder, ConvertResult, MetadataConverter } from '@salesforce/source-deploy-retrieve';
import SettingsGenerator from '@salesforce/core/lib/org/scratchOrgSettingsGenerator';
import * as xml2js from 'xml2js';
import { PackageDirDependency } from '@salesforce/core/lib/sfProject';
import { uniqid } from '../utils/uniqid';
import * as pkgUtils from '../utils/packageUtils';
import { BuildNumberToken, VersionNumber } from '../utils';
import {
  MDFolderForArtifactOptions,
  PackageDescriptorJson,
  PackageType,
  PackageVersionCreateOptions,
  PackageVersionCreateRequest,
  PackageVersionCreateRequestResult,
  PackagingSObjects,
} from '../interfaces';
import { copyDir, getPackageAliasesFromId, getAncestorId, zipDir } from '../utils';
import { PackageProfileApi } from './packageProfileApi';
import { byId } from './packageVersionCreateRequest';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_version_create');

const logger = Logger.childFromRoot('packageVersionCreate');

const DESCRIPTOR_FILE = 'package2-descriptor.json';

export class PackageVersionCreate {
  private apiVersionFromPackageXml: string;
  private readonly project: SfProject;
  private readonly connection: Connection;
  private packageObject: NamedPackageDir;
  private packageType: PackageType;
  private packageId: string;
  private packageAlias: string;

  public constructor(private options: PackageVersionCreateOptions) {
    this.connection = this.options.connection;
    this.project = this.options.project;
  }

  public createPackageVersion(): Promise<Partial<PackageVersionCreateRequestResult>> {
    try {
      return this.packageVersionCreate();
    } catch (err) {
      throw pkgUtils.applyErrorAction(pkgUtils.massageErrorMessage(err as Error));
    }
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

  private async validateDependencyValues(dependency: PackageDescriptorJson): Promise<void> {
    // If valid 04t package, just return it to be used straight away.
    if (dependency.subscriberPackageVersionId) {
      pkgUtils.validateId(pkgUtils.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, dependency.subscriberPackageVersionId);
      return;
    }

    if (dependency.packageId && dependency.package) {
      throw messages.createError('errorPackageAndPackageIdCollision', []);
    }

    const packageIdFromAlias = pkgUtils.getPackageIdFromAlias(dependency.packageId || dependency.package, this.project);

    // If valid 04t package, just return it to be used straight away.
    if (pkgUtils.validateIdNoThrow(pkgUtils.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, packageIdFromAlias)) {
      dependency.subscriberPackageVersionId = packageIdFromAlias;

      return;
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
    const result = await this.connection.tooling.query<{ Id: string }>(query);

    if (!result.records || result.records.length !== 1) {
      throw messages.createError('errorNoIdInHub', [dependency.packageId]);
    }
  }

  /**
   * A dependency in the workspace config file may be specified using either a subscriber package version id (04t)
   * or a package Id (0Ho) + a version number.  Additionally, a build number may be the actual build number, or a
   * keyword: LATEST or RELEASED (meaning the latest or released build number for a given major.minor.patch).
   *
   * This method resolves a package Id + version number to a subscriber package version id (04t)
   * and adds it as a SubscriberPackageVersionId parameter in the dependency object.
   */
  private async retrieveSubscriberPackageVersionId(dependency: PackageDescriptorJson): Promise<PackageDescriptorJson> {
    await this.validateDependencyValues(dependency);
    if (dependency.subscriberPackageVersionId) {
      delete dependency.package;

      // if a 04t id is specified just use it.
      return dependency;
    }

    const versionNumber = VersionNumber.from(dependency.versionNumber);
    const buildNumber = versionNumber.build;

    // use the dependency.branch if present otherwise use the branch of the version being created
    const branch = dependency.branch || dependency.branch === '' ? dependency.branch : this.options.branch;
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
    const query = `SELECT SubscriberPackageVersionId FROM Package2Version WHERE Package2Id = '${dependency.packageId}' AND MajorVersion = ${versionNumber.major} AND MinorVersion = ${versionNumber.minor} AND PatchVersion = ${versionNumber.patch} AND BuildNumber = ${resolvedBuildNumber} ${branchOrReleasedCondition}`;
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
      return `${versionNumber.build}`;
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
    if (results.records?.length === 0 || results.records[0].expr0 == null) {
      if (versionNumber.build === BuildNumberToken.RELEASED_BUILD_NUMBER_TOKEN) {
        throw messages.createError('noReleaseVersionFound', [packageId, versionNumber.toString()]);
      } else {
        throw messages.createError('noReleaseVersionFoundForBranch', [packageId, branch, versionNumber.toString()]);
      }
    }
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    return `${results.records[0].expr0}`;
  }

  private async createRequestObject(
    preserveFiles: boolean,
    packageVersTmpRoot: string,
    packageVersBlobZipFile: string
  ): Promise<PackageVersionCreateRequest> {
    const zipFileBase64 = fs.readFileSync(packageVersBlobZipFile).toString('base64');
    const requestObject = {
      Package2Id: this.packageId,
      VersionInfo: zipFileBase64,
      Tag: this.options.tag,
      Branch: this.options.branch,
      InstallKey: this.options.installationkey,
      Instance: this.options.buildinstance,
      SourceOrg: this.options.sourceorg,
      CalculateCodeCoverage: this.options.codecoverage || false,
      SkipValidation: this.options.skipvalidation || false,
    };

    if (preserveFiles) {
      const message = messages.getMessage('tempFileLocation', [packageVersTmpRoot]);
      await Lifecycle.getInstance().emit('PackageVersion/create-preserveFiles', {
        location: packageVersTmpRoot,
        message,
      });
      logger.info(message);
      return requestObject;
    } else {
      return fs.promises.rm(packageVersTmpRoot, { recursive: true, force: true }).then(() => requestObject);
    }
  }

  /**
   * Convert the list of command line options to a JSON object that can be used to create an Package2VersionCreateRequest entity.
   *
   * @returns {{Package2Id: (*|p|boolean), Package2VersionMetadata: *, Tag: *, Branch: number}}
   * @private
   */
  private async createPackageVersionCreateRequestFromOptions(): Promise<PackageVersionCreateRequest> {
    const preserveFiles = !!(this.options.preserve || process.env.SFDX_PACKAGE2_VERSION_CREATE_PRESERVE);
    const uniqueHash = uniqid({ template: `${this.packageId}-%s` });
    const packageVersTmpRoot = path.join(os.tmpdir(), `${uniqueHash}`);
    const packageVersMetadataFolder = path.join(packageVersTmpRoot, 'md-files');
    const unpackagedMetadataFolder = path.join(packageVersTmpRoot, 'unpackaged-md-files');
    const packageVersProfileFolder = path.join(packageVersMetadataFolder, 'profiles');
    const packageVersBlobDirectory = path.join(packageVersTmpRoot, 'package-version-info');
    const metadataZipFile = path.join(packageVersBlobDirectory, 'package.zip');
    const unpackagedMetadataZipFile = path.join(packageVersBlobDirectory, 'unpackaged-metadata-package.zip');
    const settingsZipFile = path.join(packageVersBlobDirectory, 'settings.zip');
    const packageVersBlobZipFile = path.join(packageVersTmpRoot, 'package-version-info.zip');
    const sourceBaseDir = path.join(this.project.getPath(), this.packageObject.path ?? '');

    const mdOptions = {
      deploydir: packageVersMetadataFolder,
      sourceDir: sourceBaseDir,
    };

    // Stores any additional client side info that might be needed later on in the process
    const clientSideInfo = new Map<string, string>();
    await fs.promises.mkdir(packageVersBlobDirectory, { recursive: true });
    const settingsGenerator = new SettingsGenerator({ asDirectory: true });
    // Copy all the metadata from the workspace to a tmp folder
    await this.generateMDFolderForArtifact(mdOptions);
    const packageDescriptorJson = this.packageObject as PackageDescriptorJson;

    if (packageDescriptorJson.package) {
      delete packageDescriptorJson.package;
      packageDescriptorJson.id = this.packageId;
    }

    const definitionFile = this.options.definitionfile
      ? this.options.definitionfile
      : packageDescriptorJson.definitionFile;
    if (definitionFile) {
      // package2-descriptor.json sent to the server should contain only the features, snapshot & orgPreferences
      // defined in the definition file.
      delete packageDescriptorJson.features;
      delete packageDescriptorJson.orgPreferences;
      delete packageDescriptorJson.definitionFile;
      delete packageDescriptorJson.snapshot;

      const definitionFilePayload = await fs.promises.readFile(definitionFile, 'utf8');
      const definitionFileJson = JSON.parse(definitionFilePayload) as ScratchOrgInfo;

      // Load any settings from the definition
      await settingsGenerator.extract(definitionFileJson);
      if (settingsGenerator.hasSettings() && definitionFileJson.orgPreferences) {
        // this is not allowed, exit with an error
        throw messages.createError('signupDuplicateSettingsSpecified');
      }

      ['country', 'edition', 'language', 'features', 'orgPreferences', 'snapshot', 'release', 'sourceOrg'].forEach(
        (prop) => {
          const propValue = definitionFileJson[prop];
          if (propValue) {
            packageDescriptorJson[prop] = propValue;
          }
        }
      );
    }

    this.resolveApexTestPermissions(packageDescriptorJson);

    // All dependencies for the packaging dir should be resolved to an 04t id to be passed to the server.
    // (see _retrieveSubscriberPackageVersionId for details)
    const dependencies = packageDescriptorJson.dependencies;

    // branch can be set via options or descriptor; option takes precedence
    this.options.branch = this.options.branch ?? packageDescriptorJson.branch;

    const resultValues = await Promise.all(
      !dependencies ? [] : dependencies.map((dependency) => this.retrieveSubscriberPackageVersionId(dependency))
    );
    const ancestorId = await getAncestorId(
      packageDescriptorJson,
      this.options.project,
      this.options.connection,
      this.options.versionnumber ?? packageDescriptorJson.versionNumber,
      this.options.skipancestorcheck
    );
    // If dependencies exist, the resultValues array will contain the dependencies populated with a resolved
    // subscriber pkg version id.
    if (resultValues.length > 0) {
      packageDescriptorJson.dependencies = resultValues as PackageDirDependency[];
    }

    this.cleanPackageDescriptorJson(packageDescriptorJson);
    this.setPackageDescriptorJsonValues(packageDescriptorJson);

    await fs.promises.mkdir(packageVersTmpRoot, { recursive: true });
    await fs.promises.mkdir(packageVersBlobDirectory, { recursive: true });

    if (Reflect.has(packageDescriptorJson, 'ancestorVersion')) {
      delete packageDescriptorJson.ancestorVersion;
    }
    packageDescriptorJson.ancestorId = ancestorId;

    await fs.promises.writeFile(
      path.join(packageVersBlobDirectory, DESCRIPTOR_FILE),
      JSON.stringify(packageDescriptorJson),
      'utf-8'
    );
    await this.cleanGeneratedPackage(
      packageVersMetadataFolder,
      packageVersProfileFolder,
      unpackagedMetadataFolder,
      metadataZipFile,
      settingsZipFile,
      packageVersBlobDirectory,
      packageVersBlobZipFile,
      unpackagedMetadataZipFile,
      clientSideInfo,
      settingsGenerator
    );

    return this.createRequestObject(preserveFiles, packageVersTmpRoot, packageVersBlobZipFile);
  }

  private async cleanGeneratedPackage(
    packageVersMetadataFolder: string,
    packageVersProfileFolder: string,
    unpackagedMetadataFolder: string,
    metadataZipFile: string,
    settingsZipFile: string,
    packageVersBlobDirectory: string,
    packageVersBlobZipFile: string,
    unpackagedMetadataZipFile: string,
    clientSideInfo: Map<string, string>,
    settingsGenerator: SettingsGenerator
  ): Promise<void> {
    // As part of the source convert process, the package.xml has been written into the tmp metadata directory.
    // The package.xml may need to be manipulated due to processing profiles in the workspace or additional
    // metadata exclusions. If necessary, read the existing package.xml and then re-write it.
    const currentPackageXml = await fs.promises.readFile(path.join(packageVersMetadataFolder, 'package.xml'), 'utf8');
    // convert to json
    const packageJson = await xml2js.parseStringPromise(currentPackageXml);
    fs.mkdirSync(packageVersMetadataFolder, { recursive: true });
    fs.mkdirSync(packageVersProfileFolder, { recursive: true });

    // Apply any necessary exclusions to typesArr.
    let typesArr = packageJson.Package.types as Array<{ name: string[]; members: string[] }>;
    this.apiVersionFromPackageXml = packageJson.Package.version;

    const hasUnpackagedMetadata = await this.resolveUnpackagedMetadata(
      this.packageObject,
      unpackagedMetadataFolder,
      clientSideInfo,
      this.options.codecoverage
    );

    // if we're using unpackaged metadata, don't package the profiles located there
    if (hasUnpackagedMetadata) {
      typesArr = this.options.profileApi.filterAndGenerateProfilesForManifest(typesArr, [
        clientSideInfo.get('UnpackagedMetadataPath'),
      ]);
    } else {
      typesArr = this.options.profileApi.filterAndGenerateProfilesForManifest(typesArr);
    }

    // Next generate profiles and retrieve any profiles that were excluded because they had no matching nodes.
    const excludedProfiles = this.options.profileApi.generateProfiles(
      packageVersProfileFolder,
      {
        Package: typesArr,
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
    const profiles = this.options.profileApi.getProfileInformation();
    profiles.forEach((profile) => {
      if (logger.shouldLog(LoggerLevel.DEBUG)) {
        logger.debug(profile.logDebug());
      } else if (logger.shouldLog(LoggerLevel.INFO)) {
        logger.info(profile.logInfo());
      }
    });

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
  }

  private resolveApexTestPermissions(packageDescriptorJson: PackageDescriptorJson): void {
    // Process permissionSet and permissionSetLicenses that should be enabled when running Apex tests
    // This only applies if code coverage is enabled
    if (this.options.codecoverage) {
      // Assuming no permission sets are named 0, 0n, null, undefined, false, NaN, and the empty string
      if (packageDescriptorJson.apexTestAccess?.permissionSets) {
        let permSets = packageDescriptorJson.apexTestAccess.permissionSets;
        if (!Array.isArray(permSets)) {
          permSets = permSets.split(',');
        }
        packageDescriptorJson.permissionSetNames = permSets.map((s) => s.trim());
      }

      if (packageDescriptorJson.apexTestAccess?.permissionSetLicenses) {
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
    // Add the Unpackaged Metadata, if any, to the output directory, only when code coverage is specified
    if (codeCoverage && packageDescriptorJson.unpackagedMetadata && packageDescriptorJson.unpackagedMetadata.path) {
      const unpackagedPath = path.join(process.cwd(), packageDescriptorJson.unpackagedMetadata.path);
      if (!fs.existsSync(unpackagedPath)) {
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
      return true;
    }
    return false;
  }

  private async packageVersionCreate(): Promise<Partial<PackageVersionCreateRequestResult>> {
    // For the first rollout of validating sfdx-project.json data against schema, make it optional and defaulted
    // to false. Validation only occurs if the optional validateschema option has been specified.
    if (this.options.validateschema) {
      await this.project.getSfProjectJson().schemaValidate();
    }

    // Check for empty packageDirectories
    if (this.project.getPackageDirectories()?.length === 0) {
      throw messages.createError('errorEmptyPackageDirs');
    }

    // from the packageDirectories in sfdx-project.json, find the correct package entry either by finding a matching package (name) or path
    this.packageAlias = getPackageAliasesFromId(this.options.packageId, this.options.project).join();
    this.packageId = this.options.packageId;
    // set on the class, so we can access them in other methods without redoing this logic
    this.packageObject = this.project
      .getPackageDirectories()
      .find((pkg) => pkg.package === this.packageAlias || pkg['id'] === this.options.packageId);
    this.options.profileApi = await this.resolveUserLicenses(this.packageObject.includeProfileUserLicenses);

    // At this point, the packageIdFromAlias should have been resolved to an Id.  Now, we
    // need to validate that the Id is correct.
    pkgUtils.validateId(pkgUtils.BY_LABEL.PACKAGE_ID, this.packageId);

    await this.validateOptionsForPackageType();

    const request = await this.createPackageVersionCreateRequestFromOptions();
    const createResult = await this.connection.tooling.create('Package2VersionCreateRequest', request);
    if (!createResult.success) {
      const errStr = createResult.errors?.join(', ') ?? createResult.errors;
      throw messages.createError('failedToCreatePVCRequest', [
        createResult.id ? ` [${createResult.id}]` : '',
        errStr.toString(),
      ]);
    }
    return (await byId(createResult.id, this.connection))[0];
  }

  private async resolveUserLicenses(includeUserLicenses: boolean): Promise<PackageProfileApi> {
    const shouldGenerateProfileInformation = logger.shouldLog(LoggerLevel.INFO) || logger.shouldLog(LoggerLevel.DEBUG);

    return await PackageProfileApi.create({
      project: this.project,
      includeUserLicenses,
      generateProfileInformation: shouldGenerateProfileInformation,
    });
  }

  private async validateOptionsForPackageType(): Promise<void> {
    this.packageType = await pkgUtils.getPackageType(this.packageId, this.connection);

    if (this.packageType === 'Unlocked') {
      // Don't allow scripts in unlocked packages
      if (this.options.postinstallscript || this.options.uninstallscript) {
        throw messages.createError('errorScriptsNotApplicableToUnlockedPackage');
      }

      // Don't allow ancestor in unlocked packages
      if (this.packageObject.ancestorId || this.packageObject.ancestorVersion) {
        throw messages.createError('errorAncestorNotApplicableToUnlockedPackage');
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
  private setPackageDescriptorJsonValues(packageDescriptorJson: PackageDescriptorJson): void {
    const options = this.options;
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
    if (packageDescriptorJson.releaseNotesUrl && !SfdcUrl.isValidUrl(packageDescriptorJson.releaseNotesUrl)) {
      throw messages.createError('malformedUrl', ['releaseNotesUrl', packageDescriptorJson.releaseNotesUrl]);
    }

    if (options.postinstallurl) {
      packageDescriptorJson.postInstallUrl = options.postinstallurl;
    }
    if (packageDescriptorJson.postInstallUrl && !SfdcUrl.isValidUrl(packageDescriptorJson.postInstallUrl)) {
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
