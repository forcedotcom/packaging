/*
 * Copyright 2025, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Connection, Logger, Messages, validateSalesforceId, SfError, SfProject } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { Nullable, Optional } from '@salesforce/ts-types';
import {
  InstalledPackages,
  PackageDescriptorJson,
  PackageInstallCreateRequest,
  PackageInstallOptions,
  PackageType,
  PackagingSObjects,
  SubscriberPackageVersionOptions,
} from '../interfaces';
import { applyErrorAction, escapeInstallationKey, massageErrorMessage, numberToDuration } from '../utils/packageUtils';
import { createPackageInstallRequest, getStatus, pollStatus, waitForPublish } from './packageInstall';
import { getUninstallErrors, uninstallPackage } from './packageUninstall';
import { PackageVersionCreate } from './packageVersionCreate';
import { VersionNumber } from './versionNumber';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'subscriber_package_version');
const pkgMessages = Messages.loadMessages('@salesforce/packaging', 'package');

type SPV = PackagingSObjects.SubscriberPackageVersion;
// these fields have been identified as requiring additional serverside resources in order to calculate their values
// and are therefore not returned by default
// these will require additional queries to retrieve
const highCostQueryFields = [
  'AppExchangeDescription',
  'AppExchangeLogoUrl',
  'AppExchangePackageName',
  'AppExchangePublisherName',
  'CspTrustedSite',
  'Dependencies',
  'PostInstallUrl',
  'ReleaseNotesUrl',
  'RemoteSiteSettings',
  //  'InstallValidationStatus', // This requires extra resources on the server, but is commonly used, so let it load as part of the default query
  'Profiles',
];

export const SubscriberPackageVersionFields = [
  'AppExchangeDescription',
  'AppExchangeLogoUrl',
  'AppExchangePackageName',
  'AppExchangePublisherName',
  'BuildNumber',
  'CspTrustedSites',
  'Dependencies',
  'Description',
  'Id',
  'InstallValidationStatus',
  'IsBeta',
  'IsDeprecated',
  'IsManaged',
  'IsOrgDependent',
  'IsPasswordProtected',
  'IsSecurityReviewed',
  'MajorVersion',
  'MinorVersion',
  'Name',
  'Package2ContainerOptions',
  'PatchVersion',
  'PostInstallUrl',
  'Profiles',
  'PublisherName',
  'ReleaseNotesUrl',
  'ReleaseState',
  'RemoteSiteSettings',
  'SubscriberPackageId',
];

let logger: Logger;
const getLogger = (): Logger => {
  if (!logger) {
    logger = Logger.childFromRoot('subscriberPackageVersion');
  }
  return logger;
};

const allZeroesInstallOptions: PackageInstallOptions = {
  pollingFrequency: Duration.minutes(0),
  pollingTimeout: Duration.minutes(0),
  publishFrequency: Duration.minutes(0),
  publishTimeout: Duration.minutes(0),
};

/**
 * Provides the ability to get, list, install, and uninstall 2nd
 * generation subscriber package versions.
 *
 * **Examples**
 *
 * List all 2GP installed packages in the org:
 *
 * `const installedPkgs = await SubscriberPackageVersion.installedList(connection);`
 *
 * Install a 2GP subscriber package version:
 *
 * `const installStatus = await new SubscriberPackageVersion(options).install(request, options);`
 */
export class SubscriberPackageVersion {
  private readonly password: Optional<string>;
  private readonly connection: Connection;
  private readonly id: string;
  private data?: PackagingSObjects.SubscriberPackageVersion;

  public constructor(private options: SubscriberPackageVersionOptions) {
    this.connection = this.options.connection;

    if (!this.options?.aliasOrId) {
      throw messages.createError('errorInvalidAliasOrId', [this.options?.aliasOrId]);
    }

    try {
      const project = SfProject.getInstance();
      this.id = project.getPackageIdFromAlias(this.options.aliasOrId) ?? this.options.aliasOrId;
    } catch (error) {
      const message = error instanceof Error ? error.message : error;
      getLogger().debug(message);
      this.id = this.options.aliasOrId;
    }

    // validate ID
    if (!this.id.startsWith('04t') || !validateSalesforceId(this.id)) {
      throw messages.createError('errorInvalidAliasOrId', [this.options.aliasOrId]);
    }

    this.password = this.options.password;
  }

  /**
   * Fetches the status of a package version install request and will wait for the install to complete, if requested
   * Package Version install emits the following events:
   * - PackageEvents.install['subscriber-status']
   *
   * @param connection
   * @param packageInstallRequestOrId
   * @param installationKey
   * @param options
   */
  public static async installStatus(
    connection: Connection,
    packageInstallRequestOrId: string | PackagingSObjects.PackageInstallRequest,
    installationKey?: string | undefined | Nullable<string>,
    options?: PackageInstallOptions
  ): Promise<PackagingSObjects.PackageInstallRequest> {
    const id = typeof packageInstallRequestOrId === 'string' ? packageInstallRequestOrId : packageInstallRequestOrId.Id;
    const packageInstallRequest = await getStatus(connection, id);
    const pollingTimeout = numberToDuration(options?.pollingTimeout);
    if (pollingTimeout.milliseconds <= 0) {
      return packageInstallRequest;
    } else {
      await waitForPublish(
        connection,
        packageInstallRequest.SubscriberPackageVersionKey,
        options?.publishFrequency ?? 0,
        options?.publishTimeout ?? 0,
        installationKey
      );
      return pollStatus(connection, id, options);
    }
  }

  /**
   * list the packages installed in the org
   *
   * @param conn: Connection to the org
   */
  public static async installedList(conn: Connection): Promise<InstalledPackages[]> {
    try {
      const query =
        'SELECT Id, SubscriberPackageId, SubscriberPackage.NamespacePrefix, SubscriberPackage.Name, SubscriberPackageVersion.Id, SubscriberPackageVersion.Name, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion, SubscriberPackageVersion.PatchVersion, SubscriberPackageVersion.BuildNumber FROM InstalledSubscriberPackage ORDER BY SubscriberPackageId';
      return (await conn.tooling.query<InstalledPackages>(query)).records;
    } catch (err) {
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      throw err;
    }
  }

  /**
   * Reports on the progress of a package version uninstall.
   *
   * @param id the 06y package version uninstall request id
   * @param connection
   */
  public static async uninstallStatus(
    id: string,
    connection: Connection
  ): Promise<PackagingSObjects.SubscriberPackageVersionUninstallRequest> {
    if (!id.startsWith('06y') || !validateSalesforceId(id)) {
      throw messages.createError('packageVersionUninstallRequestIdInvalid', [id]);
    }
    const result = (await connection.tooling.retrieve(
      'SubscriberPackageVersionUninstallRequest',
      id
    )) as PackagingSObjects.SubscriberPackageVersionUninstallRequest;
    if (result.Status === 'Error') {
      const errorDetails = await getUninstallErrors(connection, id);
      const errors = errorDetails.map((record, index) => `(${index + 1}) ${record.Message}`);
      const errHeader = errors.length > 0 ? `\n=== Errors\n${errors.join('\n')}` : '';
      const err = pkgMessages.getMessage('defaultErrorMessage', [id, result.Id]);

      throw new SfError(`${err}${errHeader}`, 'UNINSTALL_ERROR', [pkgMessages.getMessage('action')]);
    }
    return result;
  }

  /**
   * Retrieves the package version create request.
   *
   * @param installRequestId
   * @param connection
   */
  public static async getInstallRequest(
    installRequestId: string,
    connection: Connection
  ): Promise<PackagingSObjects.PackageInstallRequest> {
    if (!installRequestId.startsWith('0Hf') || !validateSalesforceId(installRequestId)) {
      throw messages.createError('packageVersionInstallRequestIdInvalid', [installRequestId]);
    }
    const installRequest = await getStatus(connection, installRequestId);
    if (!installRequest) {
      throw messages.createError('packageVersionInstallRequestNotFound', [installRequestId]);
    }
    return installRequest;
  }

  /**
   * Resolve fields from a packageDirectories entry to a SubscriberPackageVersionId (04t).
   * Specifically uses the `versionNumber` and `packageId` fields, as well as an optional
   * `branch` field.
   *
   * @param connection A connection object to the org
   * @param pkgDescriptor Fields from a packageDirectories entry in sfdx-project.json.
   * The `versionNumber` and `packageId` fields are required. Optionally, the `branch` and
   * `package` fields can be passed.
   * @returns the SubscriberPackageVersionId (04t)
   */
  public static async resolveId(
    connection: Connection,
    pkgDescriptor: Partial<PackageDescriptorJson>
  ): Promise<string> {
    const pvc = new PackageVersionCreate({ connection, project: SfProject.getInstance() });
    return pvc.retrieveSubscriberPackageVersionId(pkgDescriptor);
  }

  /**
   * Get the package version ID for this SubscriberPackageVersion.
   *
   * @returns The SubscriberPackageVersion Id (04t).
   */
  public getId(): Promise<string> {
    return Promise.resolve(this.id);
  }

  /**
   * Get the package type for this SubscriberPackageVersion.
   *
   * @returns {PackageType} The package type ("Managed" or "Unlocked") for this SubscriberPackageVersion.
   */
  public async getPackageType(): Promise<PackageType> {
    return this.getField<SPV['Package2ContainerOptions']>('Package2ContainerOptions');
  }

  /**
   * Get the password passed in the constructor
   *
   * @returns {string} the password
   */
  public getPassword(): Optional<string> {
    return this.password;
  }

  /**
   * Get the subscriber package Id (033) for this SubscriberPackageVersion.
   *
   * @returns {string} The subscriber package Id (033).
   */
  public async getSubscriberPackageId(): Promise<string> {
    return this.getField<SPV['SubscriberPackageId']>('SubscriberPackageId');
  }

  /**
   * Get a VersionNumber instance for this SubscriberPackageVersion.
   *
   * @returns {VersionNumber} The version number.
   */
  public async getVersionNumber(): Promise<VersionNumber> {
    const majorVersion = await this.getField<SPV['MajorVersion']>('MajorVersion');
    const minorVersion = await this.getField<SPV['MinorVersion']>('MinorVersion');
    const patchVersion = await this.getField<SPV['PatchVersion']>('PatchVersion');
    const buildNumber = await this.getField<SPV['BuildNumber']>('BuildNumber');
    return new VersionNumber(majorVersion, minorVersion, patchVersion, buildNumber);
  }

  /**
   * Is the package a managed package?
   */
  public async isManaged(): Promise<boolean> {
    return this.getField<SPV['IsManaged']>('IsManaged');
  }

  /**
   * Is the SubscriberPackageVersion deprecated?
   *
   * @returns {boolean} True if the SubscriberPackageVersion is deprecated.
   */
  public async isDeprecated(): Promise<boolean> {
    return this.getField<SPV['IsDeprecated']>('IsDeprecated');
  }

  /**
   * Is the SubscriberPackageVersion password protected?
   *
   * @returns {boolean} True if the SubscriberPackageVersion is password protected.
   */
  public async isPasswordProtected(): Promise<boolean> {
    return this.getField<SPV['IsPasswordProtected']>('IsPasswordProtected');
  }

  /**
   * Is the SubscriberPackageVersion org dependent?
   *
   * @returns {boolean} True if the SubscriberPackageVersion is org dependent.
   */
  public async isOrgDependent(): Promise<boolean> {
    return this.getField<SPV['IsOrgDependent']>('IsOrgDependent');
  }

  /**
   * Return remote site settings for the SubscriberPackageVersion.
   *
   * @returns {RemoteSiteSettings} The remote site settings.
   */
  public async getRemoteSiteSettings(): Promise<PackagingSObjects.SubscriberPackageRemoteSiteSettings> {
    return this.getField<SPV['RemoteSiteSettings']>('RemoteSiteSettings');
  }

  /**
   * Return CSP trusted sites for the SubscriberPackageVersion.
   *
   * @returns {CspTrustedSites} The CSP trusted sites.
   */
  public async getCspTrustedSites(): Promise<PackagingSObjects.SubscriberPackageCspTrustedSites> {
    return this.getField<SPV['CspTrustedSites']>('CspTrustedSites');
  }

  /**
   * Get the installation validation status for the SubscriberPackageVersion.
   *
   * @returns {InstallationValidationStatus} The installation validation status.
   */
  public async getInstallValidationStatus(): Promise<PackagingSObjects.InstallValidationStatus> {
    return this.getField<SPV['InstallValidationStatus']>('InstallValidationStatus');
  }

  /**
   * Get the SubscriberPackageVersion SObject data for this SubscriberPackageVersion.
   *
   * @param force - force a refresh of the subscriber package version data.
   * @returns {PackagingSObjects.SubscriberPackageVersion} SObject data.
   */
  public async getData(
    options: { force?: boolean; includeHighCostFields?: boolean } = { force: false, includeHighCostFields: false }
  ): Promise<SPV | undefined> {
    if (!this.data || Boolean(options.force) || options.includeHighCostFields) {
      const queryFields = this.getFieldsForQuery(options);
      if (queryFields.length === 0) {
        return this.data;
      }
      try {
        let query = `SELECT ${queryFields.toString()} FROM SubscriberPackageVersion WHERE Id ='${await this.getId()}'`;
        if (this.password) {
          query = `${query} AND InstallationKey ='${escapeInstallationKey(this.password)}'`;
        }
        this.data = await this.connection.singleRecordQuery<SPV>(query, { tooling: true });
      } catch (err) {
        if (err instanceof Error) {
          if (err.message === 'Request failed') {
            // Use a better error message. This is typically a bad ID.
            const errMsg = messages.getMessage('errorInvalidIdNoRecordFound', [this.options.aliasOrId]);
            err.message = `${errMsg} - (${err.message})`;
          }
          throw SfError.create({
            name: err.name,
            message: err.message,
            cause: err,
          });
        } else {
          throw SfError.wrap(err);
        }
      }
    }
    return this.data;
  }

  /**
   * Wait for the subscriber package version to be replicated across instances and available to be queried against
   *
   * @param options.publishFrequency - how often to check for the package version to be published
   * @param options.publishTimeout - how long to wait for the package version to be published
   * @param options.installationKey - the installation key for the package version
   */
  public async waitForPublish(
    options: {
      publishFrequency: Duration;
      publishTimeout: Duration;
      installationKey?: string;
    } = { publishFrequency: Duration.seconds(5), publishTimeout: Duration.minutes(5) }
  ): Promise<void> {
    await waitForPublish(
      this.connection,
      await this.getId(),
      options.publishFrequency,
      options.publishTimeout,
      options.installationKey
    );
  }

  /**
   * Installs a package version in a subscriber org.
   *
   * Package Version install emits the following events:
   * - PackageEvents.install.warning
   * - PackageEvents.install.presend
   * - PackageEvents.install.postsend
   * - PackageEvents.install['subscriber-status']
   *
   * @param pkgInstallCreateRequest
   * @param options
   */
  public async install(
    pkgInstallCreateRequest: PackageInstallCreateRequest,
    options: PackageInstallOptions = allZeroesInstallOptions
  ): Promise<PackagingSObjects.PackageInstallRequest> {
    try {
      // before starting the install, check to see if the package version is available for install
      await waitForPublish(
        this.connection,
        await this.getId(),
        options.publishFrequency,
        options.publishTimeout,
        pkgInstallCreateRequest.Password
      );
      const pkgVersionInstallRequest = await createPackageInstallRequest(
        this.connection,
        pkgInstallCreateRequest,
        await this.getPackageType()
      );
      return await SubscriberPackageVersion.installStatus(
        this.connection,
        pkgVersionInstallRequest.Id,
        pkgInstallCreateRequest.Password,
        options
      );
    } catch (err) {
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      throw err;
    }
  }

  /**
   * Uninstalls a package version from a subscriber org.
   *
   * @param frequency
   * @param wait
   */
  public async uninstall(
    frequency: Duration = Duration.milliseconds(0),
    wait: Duration = Duration.milliseconds(0)
  ): Promise<PackagingSObjects.SubscriberPackageVersionUninstallRequest> {
    return uninstallPackage(await this.getId(), this.connection, frequency, wait);
  }

  /**
   * Returns an array of RSS and CSP external sites for the package.
   *
   * @param installationKey The installation key (if any) for the subscriber package version.
   * @returns an array of RSS and CSP site URLs, or undefined if the package doesn't have any.
   */
  public async getExternalSites(): Promise<Optional<string[]>> {
    getLogger().debug(`Checking package: [${await this.getId()}] for external sites`);

    const remoteSiteSettings = await this.getRemoteSiteSettings();
    const cspTrustedSites = await this.getCspTrustedSites();

    const rssUrls = remoteSiteSettings?.settings ? remoteSiteSettings.settings?.map((rss) => rss.url) : [];
    const cspUrls = cspTrustedSites?.settings ? cspTrustedSites?.settings.map((csp) => csp.endpointUrl) : [];

    const sites = [...rssUrls, ...cspUrls];
    return sites.length > 0 ? sites : undefined;
  }

  /**
   * Return dependencies for the SubscriberPackageVersion.
   *
   * @returns {Dependencies} The dependencies.
   */
  public async getDependencies(): Promise<PackagingSObjects.SubscriberPackageDependencies> {
    return this.getField<SPV['Dependencies']>('Dependencies');
  }

  /**
   * Return a field value from the SubscriberPackageVersion SObject using the field name.
   *
   * @param field
   */
  public async getField<T>(field: string): Promise<T> {
    if (!this.data || !Reflect.has(this.data, field)) {
      await this.getData({ includeHighCostFields: highCostQueryFields.includes(field) });
    }
    return Reflect.get(this.data ?? {}, field) as T;
  }

  // eslint-disable-next-line class-methods-use-this
  private getFieldsForQuery(options: { force?: boolean; includeHighCostFields?: boolean }): string[] {
    return SubscriberPackageVersionFields.filter(
      (field) => !highCostQueryFields.includes(field) || options.includeHighCostFields
    );
  }
}
