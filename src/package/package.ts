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
import type { Schema } from '@jsforce/jsforce-node';
import { Connection, Messages, SfError, SfProject } from '@salesforce/core';
import {
  ConvertPackageOptions,
  PackageCreateOptions,
  PackageOptions,
  PackageSaveResult,
  PackageType,
  PackageUpdateOptions,
  PackageVersionCreateRequestResult,
  PackageVersionListOptions,
  PackageVersionListResult,
  PackageVersionMetadataDownloadOptions,
  PackageVersionMetadataDownloadResult,
  PackagingSObjects,
} from '../interfaces';
import { applyErrorAction, BY_LABEL, massageErrorMessage, validateId } from '../utils/packageUtils';
import { createPackage } from './packageCreate';
import { convertPackage } from './packageConvert';
import { retrievePackageVersionMetadata } from './packageVersionRetrieve';
import { listPackageVersions } from './packageVersionList';
import { deletePackage } from './packageDelete';
import { PackageAncestry } from './packageAncestry';
import { PackageVersionDependency } from './packageVersionDependency';

const packagePrefixes = {
  PackageId: '0Ho',
  SubscriberPackageVersionId: '04t',
  PackageInstallRequestId: '0Hf',
  PackageUninstallRequestId: '06y',
};

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package');

export const Package2Fields = [
  'Id',
  'IsDeleted',
  'CreatedDate',
  'CreatedById',
  'LastModifiedDate',
  'LastModifiedById',
  'SystemModstamp',
  'SubscriberPackageId',
  'Name',
  'Description',
  'NamespacePrefix',
  'ContainerOptions',
  'IsDeprecated',
  'IsOrgDependent',
  'ConvertedFromPackageId',
  'PackageErrorUsername',
  'AppAnalyticsEnabled',
];

/**
 * Provides the ability to list, create, update, delete, convert, and get version
 * ancestry for a 2nd generation package.
 *
 * **Examples**
 *
 * Create a new instance and get the ID (0Ho):
 *
 * `const id = new Package({connection, project, packageOrAliasId}).getId();`
 *
 * Create a new package in the org:
 *
 * `const myPkg = await Package.create(connection, project, options);`
 *
 * List all packages in the org:
 *
 * `const pkgList = await Package.list(connection);`
 */
export class Package {
  private readonly packageId: string;
  private packageData?: PackagingSObjects.Package2;

  public constructor(private options: PackageOptions) {
    let packageId = this.options.packageAliasOrId;
    if (!packageId.startsWith(packagePrefixes.PackageId)) {
      packageId = this.options.project
        ? this.options.project.getPackageIdFromAlias(this.options.packageAliasOrId) ?? this.options.packageAliasOrId
        : this.options.packageAliasOrId;
      if (packageId === this.options.packageAliasOrId) {
        throw messages.createError('packageAliasNotFound', [this.options.packageAliasOrId]);
      }
    }

    if (packageId.startsWith(packagePrefixes.PackageId)) {
      this.packageId = packageId;
    } else {
      throw messages.createError('invalidPackageId', [this.options.packageAliasOrId, packagePrefixes.PackageId]);
    }
  }

  /**
   * Create a new package.
   *
   * @param connection - instance of Connection
   * @param project - instance of SfProject
   * @param options - options for creating a package - see PackageCreateOptions
   * @returns Package
   */
  public static async create(
    connection: Connection,
    project: SfProject,
    options: PackageCreateOptions
  ): Promise<{ Id: string }> {
    return createPackage(connection, project, options);
  }

  /**
   * Returns all the packages that are available in the org, up to 10,000. If more records are
   * needed use the `SF_ORG_MAX_QUERY_LIMIT` env var.
   *
   * @param connection
   */
  public static async list(connection: Connection): Promise<PackagingSObjects.Package2[]> {
    const query = `select ${this.getPackage2Fields(
      connection
    ).toString()} from Package2 ORDER BY NamespacePrefix, Name`;
    return (await connection.autoFetchQuery<PackagingSObjects.Package2 & Schema>(query, { tooling: true }))?.records;
  }

  /**
   * Returns the package versions in the org.
   * See {@link PackageVersionListOptions} for list options
   *
   * @param connection - connection to the org
   * @param project - instance of SfProject
   * @param options - see {@link PackageVersionListOptions}
   */
  public static async listVersions(
    connection: Connection,
    project?: SfProject,
    options?: PackageVersionListOptions
  ): Promise<PackageVersionListResult[]> {
    // resolve/verify packages
    const packages = options?.packages?.map((pkg) => {
      const id = project ? project.getPackageIdFromAlias(pkg) ?? pkg : pkg;

      // validate ID
      if (id.startsWith('0Ho')) {
        validateId(BY_LABEL.PACKAGE_ID, id);
        return id;
      } else {
        throw messages.createError('invalidPackageId', [id, '0Ho']);
      }
    });
    const opts = options ?? {};
    opts.packages = packages ?? [];

    return (await listPackageVersions(connection, opts)).records;
  }

  /**
   * create a PackageAncestry instance
   *
   * @param packageId to get version information for
   * @param project SfProject instance
   * @param connection Hub Org Connection
   */
  public static async getAncestry(
    packageId: string,
    project: SfProject | undefined,
    connection: Connection
  ): Promise<PackageAncestry> {
    return PackageAncestry.create({
      packageId,
      project,
      connection,
    });
  }

  /**
   * create a PackageVersionDependency instance
   *
   * @param packageVersionId to get version information for
   * @param project SfProject instance
   * @param connection Hub Org Connection
   * @param options flags for the command line
   */
  public static async getDependencyGraph(
    packageVersionId: string,
    project: SfProject | undefined,
    connection: Connection,
    options?: { verbose?: boolean; edgeDirection?: 'root-first' | 'root-last' }
  ): Promise<PackageVersionDependency> {
    return PackageVersionDependency.create({
      packageVersionId,
      project,
      connection,
      verbose: options?.verbose ?? false,
      edgeDirection: options?.edgeDirection ?? 'root-first',
    });
  }

  /**
   * Convert a 1st generation package to a 2nd generation package.
   * See {@link ConvertPackageOptions} for conversion options.
   *
   * @param pkgId the 1GP package ID (033) of the package to convert
   * @param connection
   * @param options {@link ConvertPackageOptions}
   * @param project
   */
  public static async convert(
    pkgId: string,
    connection: Connection,
    options: ConvertPackageOptions,
    project?: SfProject
  ): Promise<PackageVersionCreateRequestResult> {
    return convertPackage(pkgId, connection, options, project);
  }

  /**
   * Download the metadata files for a previously published package version, convert them to source format, and put them into a new project folder within the sfdx project.
   *
   * @param project
   * @param options {@link PackageVersionMetadataDownloadOptions}
   * @param connection
   * @returns
   */
  public static async downloadPackageVersionMetadata(
    project: SfProject,
    options: PackageVersionMetadataDownloadOptions,
    connection: Connection
  ): Promise<PackageVersionMetadataDownloadResult> {
    return retrievePackageVersionMetadata(project, options, connection);
  }

  private static getPackage2Fields(connection: Connection): string[] {
    const apiVersion = connection.getApiVersion();
    return Package2Fields.filter((field) => (apiVersion >= '59.0' ? true : field !== 'AppAnalyticsEnabled'));
  }

  /**
   * Returns the package ID of the package.
   *
   * @returns {string} package ID (0Ho)
   */
  public getId(): string {
    return this.packageId;
  }

  /**
   * Returns the package type of the package.
   *
   * @returns {Promise<PackageType>}
   */
  public async getType(): Promise<PackageType | undefined> {
    return (await this.getPackageData())?.ContainerOptions;
  }

  /**
   * Returns the list of package versions for the package.
   * See {@link PackageVersionListOptions} for list options
   *
   * @param options
   * @returns {Promise<PackageVersionListResult[]>}
   */
  public async getPackageVersions(options?: PackageVersionListOptions): Promise<PackageVersionListResult[]> {
    const packageOptions = {
      packages: [this.packageId],
    };

    return Package.listVersions(this.options.connection, this.options.project, {
      ...packageOptions,
      ...options,
    });
  }

  /**
   * Deletes the package.
   *
   */
  public async delete(): Promise<PackageSaveResult> {
    return deletePackage(this.getId(), this.options.project, this.options.connection, false);
  }

  /**
   * Un-Deletes the package.
   *
   */
  public async undelete(): Promise<PackageSaveResult> {
    return deletePackage(this.getId(), this.options.project, this.options.connection, true);
  }

  /**
   * Updates the package using the values defined in the options.
   * See {@link PackageUpdateOptions} for update options.
   *
   * @param options
   */
  public async update(options: PackageUpdateOptions): Promise<PackageSaveResult> {
    try {
      // filter out any undefined values and their keys
      const opts = Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined)
      ) as PackageUpdateOptions;

      if (opts.AppAnalyticsEnabled !== undefined && this.options.connection.getApiVersion() < '59.0') {
        throw messages.createError('appAnalyticsEnabledApiPriorTo59Error');
      }

      const result = await this.options.connection.tooling.update('Package2', opts);
      if (!result.success) {
        throw new SfError(result.errors.join(', '));
      }
      return result;
    } catch (err) {
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      throw err;
    }
  }

  /**
   * Returns the package data for the package.
   *
   * @param force force a refresh of the package data
   */
  public async getPackageData(force = false): Promise<PackagingSObjects.Package2 | undefined> {
    if (!this.packageData || force) {
      this.packageData = (await this.options.connection.tooling
        .sobject('Package2')
        .retrieve(this.packageId)) as PackagingSObjects.Package2;
      if (!this.packageData) {
        throw messages.createError('packageNotFound', [this.packageId]);
      }
    }
    return this.packageData;
  }
}
