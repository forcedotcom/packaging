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
  PackageDir,
  ScratchOrgInfo,
  SfdcUrl,
  SfProject
} from '@salesforce/core';
import {
  ComponentSet,
  ComponentSetBuilder,
  ComponentSetOptions,
  ConvertResult,
  MetadataConverter
} from '@salesforce/source-deploy-retrieve';
import SettingsGenerator from '@salesforce/core/lib/org/scratchOrgSettingsGenerator';
import * as xml2js from 'xml2js';
import { PackageDirDependency } from '@salesforce/core/lib/sfProject';
import { cloneJson, ensureArray } from '@salesforce/kit';
import * as pkgUtils from '../utils/packageUtils';
import {
  BY_LABEL,
  copyDescriptorProperties,
  copyDir,
  getPackageVersionId,
  getPackageVersionNumber,
  uniqid,
  validateId,
  VERSION_NUMBER_SEP,
  zipDir
} from '../utils/packageUtils';
import {
  MDFolderForArtifactOptions,
  PackageDescriptorJson,
  PackageType,
  PackageVersionCreateOptions,
  PackageVersionCreateRequest,
  PackageVersionCreateRequestResult,
  PackageVersionEvents,
  PackagingSObjects
} from '../interfaces';
import { PackageProfileApi } from './packageProfileApi';
import { byId } from './packageVersionCreateRequest';
import { Package } from './package';
import { BuildNumberToken, VersionNumber } from './versionNumber';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_version_create');
const DESCRIPTOR_FILE = 'package2-descriptor.json';

export class PackageVersionCreate {
  private apiVersionFromPackageXml: string | undefined;
  private readonly project: SfProject;
  private readonly connection: Connection;
  private packageObject!: NamedPackageDir & PackageDescriptorJson;
  private packageId!: string;
  private pkg?: Package;
  private readonly logger: Logger;
  private metadataResolver: MetadataResolver;

  public constructor(private options: PackageVersionCreateOptions) {
    this.connection = this.options.connection;
    this.project = this.options.project;
    this.logger = Logger.childFromRoot('packageVersionCreate');
    this.metadataResolver = new MetadataResolver();
  }

  public createPackageVersion(): Promise<Partial<PackageVersionCreateRequestResult>> {
    try {
      return this.packageVersionCreate();
    } catch (err) {
      if (err instanceof Error) {
        throw pkgUtils.applyErrorAction(pkgUtils.massageErrorMessage(err));
      }
      throw err;
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

    const idOrPackage = dependency.packageId ?? dependency.package;
    if (!idOrPackage) {
      throw messages.createError('errorPackageOrPackageIdMissing', []);
    }

    const packageIdFromAlias = this.project.getPackageIdFromAlias(idOrPackage) ?? idOrPackage;

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
    this.validateVersionNumber(
      dependency.versionNumber,
      BuildNumberToken.LATEST_BUILD_NUMBER_TOKEN,
      BuildNumberToken.RELEASED_BUILD_NUMBER_TOKEN
    );
    await this.validatePatchVersion(dependency.versionNumber, dependency.packageId);

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

    if (!dependency.versionNumber) {
      throw messages.createError('errorDependencyPair', [JSON.stringify(dependency)]);
    }
    if (!dependency.packageId) {
      throw messages.createError('errorDependencyPair', [JSON.stringify(dependency)]);
    }

    const versionNumber = VersionNumber.from(dependency.versionNumber);
    const buildNumber = versionNumber.build;

    // use the dependency.branch if present otherwise use the branch of the version being created
    const branch = dependency.branch === '' ? dependency.branch : this.options.branch;
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
        resolvedBuildNumber
      ]);
    }

    dependency.subscriberPackageVersionId = pkgVerQueryResult.records[0].SubscriberPackageVersionId;

    // warn user of the resolved build number when LATEST and RELEASED keywords are used
    if (versionNumber.isbuildKeyword()) {
      versionNumber.build = resolvedBuildNumber;

      if (buildNumber === BuildNumberToken.LATEST_BUILD_NUMBER_TOKEN) {
        this.logger.info(
          messages.getMessage('buildNumberResolvedForLatest', [
            dependency.package,
            versionNumber.toString(),
            branchString,
            dependency.subscriberPackageVersionId
          ])
        );
      } else if (buildNumber === BuildNumberToken.RELEASED_BUILD_NUMBER_TOKEN) {
        this.logger.info(
          messages.getMessage('buildNumberResolvedForReleased', [
            dependency.package,
            versionNumber.toString(),
            dependency.subscriberPackageVersionId
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

  private async resolveBuildNumber(
    versionNumber: VersionNumber,
    packageId: string,
    branch: string | undefined
  ): Promise<string> {
    if (!versionNumber.isbuildKeyword()) {
      // The build number is already specified so just return it using the tooling query result obj structure
      return `${versionNumber.build}`;
    }
    // query for the LATEST or RELEASED build number (excluding deleted versions)
    let branchCondition = '';
    let releasedCondition = '';
    if (versionNumber.build === BuildNumberToken.LATEST_BUILD_NUMBER_TOKEN) {
      // respect the branch when querying for LATEST
      const branchString = !branch || branch === '' ? 'null' : `'${branch}'`;
      branchCondition = `AND Branch = ${branchString}`;
    } else if (versionNumber.build === BuildNumberToken.RELEASED_BUILD_NUMBER_TOKEN) {
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
    const requestObject: PackageVersionCreateRequest = {
      Package2Id: this.packageId,
      VersionInfo: zipFileBase64,
      Tag: this.options.tag,
      Branch: this.options.branch,
      InstallKey: this.options.installationkey,
      Instance: this.options.buildinstance,
      SourceOrg: this.options.sourceorg,
      CalculateCodeCoverage: this.options.codecoverage ?? false,
      SkipValidation: this.options.skipvalidation ?? false,
      // note: the createRequest's Language corresponds to the AllPackageVersion's language
      Language: this.options.language
    };

    // Ensure we only include the Language property for a connection api version
    // of v57.0 or higher.
    if (this.connection.getApiVersion() < '57.0') {
      if (requestObject.Language) {
        this.logger.warn(
          `The language option is only valid for API version 57.0 and higher. Ignoring ${requestObject.Language}`
        );
      }
      delete requestObject.Language;
    }

    if (preserveFiles) {
      const message = messages.getMessage('tempFileLocation', [packageVersTmpRoot]);
      await Lifecycle.getInstance().emit(PackageVersionEvents.create['preserve-files'], {
        location: packageVersTmpRoot,
        message
      });
      this.logger.info(message);
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
    const preserveFiles = !!(this.options.preserve ?? process.env.SFDX_PACKAGE2_VERSION_CREATE_PRESERVE);
    const uniqueHash = uniqid({ template: `${this.packageId}-%s` });
    const packageVersTmpRoot = path.join(os.tmpdir(), `${uniqueHash}`);
    const packageVersMetadataFolder = path.join(packageVersTmpRoot, 'md-files');
    const unpackagedMetadataFolder = path.join(packageVersTmpRoot, 'unpackaged-md-files');
    const seedMetadataFolder = path.join(packageVersTmpRoot, 'seed-md-files');
    const packageVersProfileFolder = path.join(packageVersMetadataFolder, 'profiles');
    const packageVersBlobDirectory = path.join(packageVersTmpRoot, 'package-version-info');
    const metadataZipFile = path.join(packageVersBlobDirectory, 'package.zip');
    const unpackagedMetadataZipFile = path.join(packageVersBlobDirectory, 'unpackaged-metadata-package.zip');
    const seedMetadataZipFile = path.join(packageVersBlobDirectory, 'seed-metadata-package.zip');
    const settingsZipFile = path.join(packageVersBlobDirectory, 'settings.zip');
    const packageVersBlobZipFile = path.join(packageVersTmpRoot, 'package-version-info.zip');
    const sourceBaseDir = path.join(this.project.getPath(), this.packageObject?.path ?? '');

    const mdOptions: MDFolderForArtifactOptions = {
      deploydir: packageVersMetadataFolder,
      sourceDir: sourceBaseDir,
      sourceApiVersion: (this.project?.getSfProjectJson()?.get('sourceApiVersion') as string) ?? undefined
    };

    // Stores any additional client side info that might be needed later on in the process
    const clientSideInfo = new Map<string, string>();
    await fs.promises.mkdir(packageVersBlobDirectory, { recursive: true });
    const settingsGenerator = new SettingsGenerator({ asDirectory: true });
    const packageDescriptorJson = cloneJson(this.packageObject) as PackageDescriptorJson;
    const apvLanguage = packageDescriptorJson.language;

    // Copy all the metadata from the workspace to a tmp folder
    const componentSet = await this.metadataResolver.generateMDFolderForArtifact(mdOptions);
    this.verifyHasSource(componentSet);

    if (packageDescriptorJson.package) {
      delete packageDescriptorJson.package;
      packageDescriptorJson.id = this.packageId;
    }

    if (packageDescriptorJson.language) {
      // the cloneJson() call above added the packageDir's language to the descriptor;
      // remove that from the descriptor here; it will be set correctly from the definitionFile values below
      delete packageDescriptorJson.language;
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
      const definitionFileJson = JSON.parse(definitionFilePayload) as ScratchOrgInfo & Record<string, unknown>;

      // Load any settings from the definition
      await settingsGenerator.extract(definitionFileJson);
      if (settingsGenerator.hasSettings() && definitionFileJson.orgPreferences) {
        // this is not allowed, exit with an error
        throw messages.createError('signupDuplicateSettingsSpecified');
      }

      copyDescriptorProperties(packageDescriptorJson, definitionFileJson);
    }

    this.resolveApexTestPermissions(packageDescriptorJson);

    // All dependencies for the packaging dir should be resolved to an 04t id to be passed to the server.
    // (see _retrieveSubscriberPackageVersionId for details)
    const dependencies = packageDescriptorJson.dependencies;

    // branch and APV language can be set via options or packageDirectory; option takes precedence
    this.options.branch = this.options.branch ?? packageDescriptorJson.branch;
    this.options.language = this.options.language ?? apvLanguage;

    const resultValues = await Promise.all(
      !dependencies ? [] : dependencies.map((dependency) => this.retrieveSubscriberPackageVersionId(dependency))
    );

    const versionNumber = this.options.versionnumber ?? packageDescriptorJson.versionNumber;
    if (!versionNumber) {
      throw messages.createError('versionNumberRequired');
    }
    const ancestorId = await this.getAncestorId(
      packageDescriptorJson,
      this.options.project,
      versionNumber,
      !!this.options.skipancestorcheck
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
      seedMetadataFolder,
      metadataZipFile,
      settingsZipFile,
      packageVersBlobDirectory,
      packageVersBlobZipFile,
      unpackagedMetadataZipFile,
      seedMetadataZipFile,
      clientSideInfo,
      settingsGenerator
    );

    return this.createRequestObject(preserveFiles, packageVersTmpRoot, packageVersBlobZipFile);
  }

  private verifyHasSource(componentSet: ConvertResult): void {
    if (componentSet?.converted?.length === 0) {
      throw messages.createError('noSourceInRootDirectory', [this.packageObject.path ?? '<unknown>']);
    }
  }

  private async cleanGeneratedPackage(
    packageVersMetadataFolder: string,
    packageVersProfileFolder: string,
    unpackagedMetadataFolder: string,
    seedMetadataFolder: string,
    metadataZipFile: string,
    settingsZipFile: string,
    packageVersBlobDirectory: string,
    packageVersBlobZipFile: string,
    unpackagedMetadataZipFile: string,
    seedMetadataZipFile: string,
    clientSideInfo: Map<string, string>,
    settingsGenerator: SettingsGenerator
  ): Promise<void> {
    // As part of the source convert process, the package.xml has been written into the tmp metadata directory.
    // The package.xml may need to be manipulated due to processing profiles in the workspace or additional
    // metadata exclusions. If necessary, read the existing package.xml and then re-write it.
    const currentPackageXml = await fs.promises.readFile(path.join(packageVersMetadataFolder, 'package.xml'), 'utf8');
    // convert to json
    const packageJson = (await xml2js.parseStringPromise(currentPackageXml)) as {
      Package: { types: Array<{ name: string[]; members: string[] }>; version: string };
    };
    if (!packageJson?.Package) {
      throw messages.createError('packageXmlDoesNotContainPackage');
    }
    if (!packageJson?.Package.types) {
      throw messages.createError('packageXmlDoesNotContainPackageTypes');
    }
    fs.mkdirSync(packageVersMetadataFolder, { recursive: true });
    fs.mkdirSync(packageVersProfileFolder, { recursive: true });

    this.apiVersionFromPackageXml = packageJson.Package.version;

    const sourceApiVersion = this.project?.getSfProjectJson()?.get('sourceApiVersion') as string;
    const hasSeedMetadata = await this.metadataResolver.resolveMetadata(
      this.packageObject.seedMetadata?.path,
      seedMetadataFolder,
      'seedMDDirectoryDoesNotExist',
      sourceApiVersion
    );

    let hasUnpackagedMetadata = false;
    const unpackagedMetadataPath = this.packageObject.unpackagedMetadata?.path;
    if (this.options.codecoverage) {
      hasUnpackagedMetadata = await this.metadataResolver.resolveMetadata(
        unpackagedMetadataPath,
        unpackagedMetadataFolder,
        'unpackagedMDDirectoryDoesNotExist',
        sourceApiVersion
      );
    }

    // don't package the profiles from any unpackagedMetadata dir in the project
    const profileExcludeDirs = this.project
      .getPackageDirectories()
      .filter((packageDir) => (packageDir as PackageDescriptorJson).unpackagedMetadata?.path)
      .map((packageDir) => (packageDir as PackageDescriptorJson).unpackagedMetadata?.path) ?? [];

    const typesArr = this.options?.profileApi?.filterAndGenerateProfilesForManifest(packageJson.Package.types, profileExcludeDirs);

    // Next generate profiles and retrieve any profiles that were excluded because they had no matching nodes.
    const excludedProfiles = this.options?.profileApi?.generateProfiles(
      packageVersProfileFolder,
      {
        Package: typesArr
      },
      profileExcludeDirs
    );

    if (excludedProfiles?.length) {
      const profileIdx = typesArr.findIndex((e) => e.name[0] === 'Profile');
      typesArr[profileIdx].members = typesArr[profileIdx].members.filter((e) => !excludedProfiles.includes(e));
    }

    packageJson.Package.types = typesArr;

    // Re-write the package.xml in case profiles have been added or removed
    const xmlBuilder = new xml2js.Builder({
      xmldec: { version: '1.0', encoding: 'UTF-8' }
    });
    const xml = xmlBuilder.buildObject(packageJson);

    // Log information about the profiles being packaged up
    const profiles = this.options?.profileApi?.getProfileInformation() ?? [];
    profiles.forEach((profile) => {
      if (this.logger.shouldLog(LoggerLevel.DEBUG)) {
        this.logger.debug(profile.logDebug());
      } else if (this.logger.shouldLog(LoggerLevel.INFO)) {
        this.logger.info(profile.logInfo());
      }
    });

    await fs.promises.writeFile(path.join(packageVersMetadataFolder, 'package.xml'), xml, 'utf-8');
    // Zip the packageVersMetadataFolder folder and put the zip in {packageVersBlobDirectory}/package.zip
    await zipDir(packageVersMetadataFolder, metadataZipFile);
    if (hasSeedMetadata) {
      // Zip the seedMetadataFolder folder and put the zip in {packageVersBlobDirectory}/{seedMetadataZipFile}
      await zipDir(seedMetadataFolder, seedMetadataZipFile);
    }
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

  // eslint-disable-next-line complexity
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

    // either options.packageId or options.path is required
    if (!this.options.packageId && !this.options.path) {
      throw messages.createError('errorMissingPackageIdOrPath');
    }

    // establish the package Id (0ho) and load the package directory
    let packageName: string | undefined;
    let packageObject: PackageDir | undefined;
    if (this.options.packageId) {
      const pkg = this.options.packageId;
      // for backward compatibility allow for a packageDirectory package property to be an id (0Ho) instead of an alias.
      packageName = (await this.getPackageDirFromId(pkg))?.package;
      if (!packageName) {
        packageName = pkg.startsWith('0Ho') ? this.project.getAliasesFromPackageId(pkg).find((alias) => alias) : pkg;
        if (!packageName) throw messages.createError('errorMissingPackage', [this.options.packageId]);
      }
      packageObject = this.project.findPackage(
        (namedPackageDir) => namedPackageDir.package === packageName || namedPackageDir.name === packageName
      );
    } else {
      // We'll either have a package ID or alias, or a directory path
      if (!this.options.path) {
        throw messages.createError('errorMissingPackagePath', [JSON.stringify(this.options)]);
      }
      packageObject = this.project.getPackageFromPath(this.options.path);
      packageName = packageObject?.package;
      if (!packageName) throw messages.createError('errorCouldNotFindPackageUsingPath', [this.options.path]);
    }

    if (!packageObject) {
      throw messages.createError('errorCouldNotFindPackageDir', [
        this.options.packageId ? 'packageId or alias' : 'path',
        this.options.packageId ?? this.options.path
      ]);
    } else {
      this.packageObject = packageObject as NamedPackageDir;
    }

    this.packageId = this.project.getPackageIdFromAlias(packageName) ?? packageName;

    this.options.profileApi = await this.resolveUserLicenses(!!this.packageObject.includeProfileUserLicenses);

    // At this point, the packageIdFromAlias should have been resolved to an Id.  Now, we
    // need to validate that the Id is correct.
    pkgUtils.validateId(pkgUtils.BY_LABEL.PACKAGE_ID, this.packageId);

    try {
      await this.validateOptionsForPackageType();
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'NOT_FOUND') {
          // this means the 0Ho package was not found in the org. throw a better error.
          throw messages.createError('errorNoIdInHub', [this.packageId]);
        }
      }
      throw error;
    }

    const request = await this.createPackageVersionCreateRequestFromOptions();
    const createResult = await this.connection.tooling.create('Package2VersionCreateRequest', request);
    if (!createResult.success) {
      const errStr = createResult.errors?.join(', ') ?? createResult.errors;
      const id: string = createResult.id ?? '';
      throw messages.createError('failedToCreatePVCRequest', [id === '' ? '' : ` [${id}]`, errStr.toString()]);
    }
    return (await byId(createResult.id, this.connection))[0];
  }

  private async getPackageDirFromId(pkg: string): Promise<PackageDir | undefined> {
    let dir: PackageDir[];
    if (pkg.startsWith('0Ho')) {
      dir = (await this.project.getSfProjectJson().getPackageDirectories()).filter((p) => p.package === pkg);
      if (dir.length === 1) {
        return dir[0];
      }
    }
  }

  private async getPackageType(): Promise<PackageType | undefined> {
    // this.packageId should be an 0Ho package Id at this point
    if (!this.pkg) {
      this.pkg = new Package({
        packageAliasOrId: this.packageId,
        project: this.project,
        connection: this.connection
      });
    }
    return this.pkg.getType();
  }

  private async resolveUserLicenses(includeUserLicenses: boolean): Promise<PackageProfileApi> {
    const shouldGenerateProfileInformation =
      this.logger.shouldLog(LoggerLevel.INFO) || this.logger.shouldLog(LoggerLevel.DEBUG);

    return PackageProfileApi.create({
      project: this.project,
      includeUserLicenses,
      generateProfileInformation: shouldGenerateProfileInformation
    });
  }

  private async validateOptionsForPackageType(): Promise<void> {
    if ((await this.getPackageType()) === 'Unlocked') {
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
  // eslint-disable-next-line class-methods-use-this
  private cleanPackageDescriptorJson(packageDescriptorJson: PackageDescriptorJson): PackageDescriptorJson {
    delete packageDescriptorJson.default; // for client-side use only, not needed
    delete packageDescriptorJson.includeProfileUserLicenses; // for client-side use only, not needed
    delete packageDescriptorJson.unpackagedMetadata; // for client-side use only, not needed
    delete packageDescriptorJson.seedMetadata; // for client-side use only, not needed
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
        versionNumber?.split(pkgUtils.VERSION_NUMBER_SEP)[3] === BuildNumberToken.NEXT_BUILD_NUMBER_TOKEN
          ? versionNumber.substring(
            0,
            versionNumber.indexOf(pkgUtils.VERSION_NUMBER_SEP + BuildNumberToken.NEXT_BUILD_NUMBER_TOKEN)
          )
          : versionNumber;

      this.logger.warn(messages.getMessage('defaultVersionName', [packageDescriptorJson.versionName]));
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

  // eslint-disable-next-line class-methods-use-this
  private validateVersionNumber(
    versionNumberString: string,
    supportedBuildNumberToken: string,
    supportedBuildNumberToken2?: string
  ): string {
    const versionNumber = VersionNumber.from(versionNumberString);
    // build number can be a number or valid token
    if (
      Number.isNaN(parseInt(`${versionNumber.build}`, 10)) &&
      versionNumber.build !== supportedBuildNumberToken &&
      versionNumber.build !== supportedBuildNumberToken2
    ) {
      if (supportedBuildNumberToken2) {
        throw messages.createError('errorInvalidBuildNumberForKeywords', [
          versionNumberString,
          supportedBuildNumberToken,
          supportedBuildNumberToken2
        ]);
      } else {
        throw messages.createError('errorInvalidBuildNumber', [versionNumberString, supportedBuildNumberToken]);
      }
    }

    return versionNumberString;
  }

  private async validatePatchVersion(versionNumberString: string, packageId: string): Promise<void> {
    const query = `SELECT ContainerOptions FROM Package2 WHERE id ='${packageId}'`;
    const queryResult = await this.connection.tooling.query(query);

    if (queryResult.records === null || queryResult.records.length === 0) {
      throw messages.createError('errorInvalidPackageId', [packageId]);
    }

    // Enforce a patch version of zero (0) for Locked packages only
    if (queryResult.records[0].ContainerOptions === 'Locked') {
      const versionNumber = VersionNumber.from(versionNumberString);
      if (versionNumber.patch !== '0') {
        throw messages.createError('errorInvalidPatchNumber', [versionNumberString]);
      }
    }
  }

  // eslint-disable-next-line complexity
  private async getAncestorId(
    packageDescriptorJson: PackageDescriptorJson,
    project: SfProject,
    versionNumberString: string,
    skipAncestorCheck: boolean
  ): Promise<string> {
    // If an id property is present, use it.  Otherwise, look up the package id from the package property.
    const packageId =
      packageDescriptorJson.id ??
      project.getPackageIdFromAlias(packageDescriptorJson.package ?? '') ??
      packageDescriptorJson.package;

    // No need to proceed if Unlocked
    if ((await this.getPackageType()) === 'Unlocked') {
      return '';
    }

    let ancestorId = '';
    // ancestorID can be alias, 05i, or 04t;
    // validate and convert to 05i, as needed

    const versionNumber = VersionNumber.from(versionNumberString);

    let origSpecifiedAncestor = packageDescriptorJson.ancestorId ?? '';
    let highestReleasedVersion: PackagingSObjects.Package2Version | null = null;

    const explicitUseHighestRelease =
      packageDescriptorJson.ancestorId === BuildNumberToken.HIGHEST_VERSION_NUMBER_TOKEN ||
      packageDescriptorJson.ancestorVersion === BuildNumberToken.HIGHEST_VERSION_NUMBER_TOKEN;
    const explicitUseNoAncestor =
      packageDescriptorJson.ancestorId === BuildNumberToken.NONE_VERSION_NUMBER_TOKEN ||
      packageDescriptorJson.ancestorVersion === BuildNumberToken.NONE_VERSION_NUMBER_TOKEN;
    if (
      (explicitUseHighestRelease || explicitUseNoAncestor) &&
      packageDescriptorJson.ancestorId &&
      packageDescriptorJson.ancestorVersion
    ) {
      if (packageDescriptorJson.ancestorId !== packageDescriptorJson.ancestorVersion) {
        // both ancestorId and ancestorVersion specified, HIGHEST and/or NONE are used, the values disagree
        throw messages.createError('errorAncestorIdVersionHighestOrNoneMismatch', [
          packageDescriptorJson.ancestorId,
          packageDescriptorJson.ancestorVersion
        ]);
      }
    }

    if (explicitUseNoAncestor && skipAncestorCheck) {
      return '';
    } else {
      const result = await this.getAncestorIdHighestRelease(
        packageId,
        versionNumberString,
        explicitUseHighestRelease,
        skipAncestorCheck
      );
      if (result.finalAncestorId) {
        return result.finalAncestorId;
      }
      highestReleasedVersion = result.highestReleasedVersion;
    }
    // at this point if explicitUseHighestRelease=true, we have returned the ancestorId or thrown an error
    // highestReleasedVersion should be null only if skipAncestorCheck or if there is no existing released package version

    if (!explicitUseNoAncestor && packageDescriptorJson.ancestorId) {
      ancestorId = project.getPackageIdFromAlias(packageDescriptorJson.ancestorId) ?? packageDescriptorJson.ancestorId;
      validateId([BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, BY_LABEL.PACKAGE_VERSION_ID], ancestorId);
      ancestorId = (await getPackageVersionId(ancestorId, this.connection)) ?? '';
    }

    if (!explicitUseNoAncestor && packageDescriptorJson.ancestorVersion) {
      const regNumbers = new RegExp('^[0-9]+$');
      const versionNumberSplit = packageDescriptorJson.ancestorVersion.split(VERSION_NUMBER_SEP);
      if (
        versionNumberSplit.length < 3 ||
        versionNumberSplit.length > 4 ||
        !versionNumberSplit[0].match(regNumbers) ||
        !versionNumberSplit[1].match(regNumbers) ||
        !versionNumberSplit[2].match(regNumbers)
      ) {
        throw new Error(
          messages.getMessage('errorInvalidAncestorVersionFormat', [packageDescriptorJson.ancestorVersion])
        );
      }

      const query =
        'SELECT Id, IsReleased FROM Package2Version ' +
        `WHERE Package2Id = '${packageId}' AND MajorVersion = ${versionNumberSplit[0]} AND MinorVersion = ${versionNumberSplit[1]} AND PatchVersion = ${versionNumberSplit[2]}`;

      let queriedAncestorId: string;
      const ancestorVersionResult = await this.connection.tooling.query<PackagingSObjects.Package2Version>(query);
      if (!ancestorVersionResult.totalSize) {
        throw messages.createError('errorNoMatchingAncestor', [packageDescriptorJson.ancestorVersion, packageId]);
      } else {
        const releasedAncestor = ancestorVersionResult.records.find((rec) => rec.IsReleased === true);
        if (!releasedAncestor) {
          throw messages.createError('errorAncestorNotReleased', [packageDescriptorJson.ancestorVersion]);
        } else {
          queriedAncestorId = releasedAncestor.Id;
        }
      }

      // check for discrepancy between queried ancestorId and descriptor's ancestorId
      if (packageDescriptorJson?.ancestorId && ancestorId !== queriedAncestorId) {
        throw messages.createError('errorAncestorIdVersionMismatch', [
          packageDescriptorJson.ancestorVersion,
          packageDescriptorJson.ancestorId
        ]);
      }
      ancestorId = queriedAncestorId;
      origSpecifiedAncestor = packageDescriptorJson.ancestorVersion;
    }

    return this.validateAncestorId(
      ancestorId,
      highestReleasedVersion,
      explicitUseNoAncestor,
      versionNumber.patch !== '0',
      skipAncestorCheck,
      origSpecifiedAncestor
    );
  }

  // eslint-disable-next-line class-methods-use-this
  private validateAncestorId(
    ancestorId: string,
    highestReleasedVersion: PackagingSObjects.Package2Version | null | undefined,
    explicitUseNoAncestor: boolean,
    isPatch: boolean,
    skipAncestorCheck: boolean,
    origSpecifiedAncestor: string
  ): string {
    if (explicitUseNoAncestor) {
      if (!highestReleasedVersion) {
        return '';
      } else {
        // the explicitUseNoAncestor && skipAncestorCheck case is handled above
        throw messages.createError('errorAncestorNoneNotAllowed', [getPackageVersionNumber(highestReleasedVersion)]);
      }
    }
    if (!isPatch && !skipAncestorCheck) {
      if (highestReleasedVersion) {
        if (highestReleasedVersion.Id !== ancestorId) {
          throw messages.createError('errorAncestorNotHighest', [
            origSpecifiedAncestor,
            getPackageVersionNumber(highestReleasedVersion)
          ]);
        }
      } else {
        // looks like the initial version:create - allow
        ancestorId = '';
      }
    }
    return ancestorId;
  }

  private async getAncestorIdHighestRelease(
    packageId: string | undefined,
    versionNumberString: string,
    explicitUseHighestRelease: boolean,
    skipAncestorCheck: boolean
  ): Promise<{ finalAncestorId: string | null; highestReleasedVersion: PackagingSObjects.Package2Version | null }> {
    type Package2VersionResult = Partial<
      Pick<
        PackagingSObjects.Package2Version,
        'Id' | 'SubscriberPackageVersionId' | 'MajorVersion' | 'MinorVersion' | 'PatchVersion'
      >
    >;

    if (!packageId) {
      throw messages.createError('packageIdCannotBeUndefined');
    }

    const versionNumber = versionNumberString.split(VERSION_NUMBER_SEP);
    const isPatch = versionNumber[2] !== '0';

    const result: { finalAncestorId: string | null; highestReleasedVersion: PackagingSObjects.Package2Version | null } =
      {
        finalAncestorId: null,
        highestReleasedVersion: null
      };

    if (isPatch && explicitUseHighestRelease) {
      // based on server-side validation, whatever ancestor is specified for a patch is
      // tightly controlled; therefore we only need concern ourselves if explicitUseHighestRelease == true;
      // equally applies when skipAncestorCheck == true

      // gather appropriate matching major.minor.0
      const query =
        `SELECT Id FROM Package2Version WHERE Package2Id = '${packageId}' ` +
        'AND IsReleased = True AND IsDeprecated = False AND PatchVersion = 0 ' +
        `AND MajorVersion = ${versionNumber[0]} AND MinorVersion = ${versionNumber[1]} ` +
        'ORDER BY MajorVersion Desc, MinorVersion Desc, PatchVersion Desc, BuildNumber Desc LIMIT 1';
      const majorMinorVersionResult = await this.connection.tooling.query<Package2VersionResult>(query);
      const majorMinorVersionRecords = majorMinorVersionResult.records;
      if (majorMinorVersionRecords && majorMinorVersionRecords?.length === 1 && majorMinorVersionRecords[0]) {
        result.finalAncestorId = majorMinorVersionRecords[0].Id ?? null;
      } else {
        const majorMinorNotFound = `${versionNumber[0]}.${versionNumber[1]}.0`;
        throw messages.createError('errorNoMatchingMajorMinorForPatch', [majorMinorNotFound]);
      }
    } else if (!isPatch && (explicitUseHighestRelease || !skipAncestorCheck)) {
      // ancestor must be set to latest released major.minor version
      const query =
        'SELECT Id, SubscriberPackageVersionId, MajorVersion, MinorVersion, PatchVersion FROM Package2Version ' +
        `WHERE Package2Id = '${packageId}' AND IsReleased = True AND IsDeprecated = False AND PatchVersion = 0 ` +
        'ORDER BY MajorVersion Desc, MinorVersion Desc, PatchVersion Desc, BuildNumber Desc LIMIT 1';
      const highestVersionResult = await this.connection.tooling.query<Package2VersionResult>(query);
      const highestVersionRecords = highestVersionResult.records;
      if (highestVersionRecords?.[0]) {
        result.highestReleasedVersion = highestVersionRecords[0] as PackagingSObjects.Package2Version;
        if (explicitUseHighestRelease) {
          result.finalAncestorId = result.highestReleasedVersion.Id;
        }
      } else if (explicitUseHighestRelease) {
        // there is no eligible ancestor version
        throw messages.createError('errorNoMatchingAncestor', [versionNumberString, packageId]);
      }
    }
    return result;
  }
}

export class MetadataResolver {
  public async resolveMetadata(
    metadataRelativePath: string | undefined,
    metadataOutputPath: string,
    errorMessageLabel: string,
    sourceApiVersion?: string
  ): Promise<boolean> {
    if (metadataRelativePath) {
      const metadataFullPath = path.join(process.cwd(), metadataRelativePath);
      if (!fs.existsSync(metadataFullPath)) {
        throw messages.createError(errorMessageLabel, [metadataRelativePath]);
      }

      fs.mkdirSync(metadataOutputPath, { recursive: true });
      await this.generateMDFolderForArtifact({
        deploydir: metadataOutputPath,
        sourceDir: metadataFullPath,
        sourceApiVersion
      });
      return true;
    }
    return false;
  }

  // convert source to mdapi format and copy to tmp dir packaging up
  public async generateMDFolderForArtifact(options: MDFolderForArtifactOptions): Promise<ConvertResult> {
    const sourcePaths = ensureArray(options.sourcePaths ?? options.sourceDir ? options.sourceDir : undefined).filter(
      (srcPath) => srcPath
    );
    const componentSetOptions: ComponentSetOptions = {
      sourceapiversion: options.sourceApiVersion,
      ...(sourcePaths.length > 0 ? { sourcepath: sourcePaths } : {})
    };

    if (!options.deploydir) {
      throw messages.createError('deploydirCannotBeUndefined', [JSON.stringify(options)]);
    }

    const componentSet = await ComponentSetBuilder.build(componentSetOptions);
    const packageName = options.packageName;
    const outputDirectory = path.resolve(options.deploydir);
    const convertResult = await this.convertMetadata(componentSet, outputDirectory, packageName);

    if (packageName) {
      // SDR will build an output path like /output/directory/packageName/package.xml
      // this was breaking from toolbelt, so to revert it we copy the directory up a level and delete the original
      if (!convertResult.packagePath) {
        throw messages.createError('packagePathCannotBeUndefined');
      }
      copyDir(convertResult.packagePath, outputDirectory);
      try {
        fs.rmSync(convertResult.packagePath, { recursive: true });
      } catch (e) {
        // rmdirSync is being deprecated and emits a warning
        // but rmSync is introduced in node 14 so fall back to rmdirSync
        fs.rmdirSync(convertResult.packagePath, { recursive: true });
      }

      convertResult.packagePath = outputDirectory;
    }
    return convertResult;
  }

  /**
   * Extracted into a method for UT purposes
   *
   * @param componentSet CS to convert
   * @param outputDirectory where to place the converted MD
   * @param packageName the packagename related to the CS
   * @private
   */
  // eslint-disable-next-line class-methods-use-this
  private async convertMetadata(
    componentSet: ComponentSet,
    outputDirectory: string,
    packageName: string | undefined
  ): Promise<ConvertResult> {
    const converter = new MetadataConverter();
    return converter.convert(componentSet, 'metadata', {
      type: 'directory',
      outputDirectory,
      packageName,
      genUniqueDir: false
    });
  }
}
