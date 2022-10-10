/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
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
  PackagingSObjects,
} from '../interfaces';
import {
  applyErrorAction,
  BY_LABEL,
  getPackageAliasesFromId,
  getPackageIdFromAlias,
  massageErrorMessage,
  validateId,
} from '../utils';
import { createPackage } from './packageCreate';

import { convertPackage } from './packageConvert';
import { listPackageVersions } from './packageVersionList';
import { deletePackage } from './packageDelete';

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
];

/**
 * Package class.
 *
 * This class provides the base implementation for a package.
 * To create a new instance of a package, use the static async Package.create({connection, project, packageOrAliasId}) method.
 */
export class Package {
  private readonly packageId: string;
  private packageData: PackagingSObjects.Package2;
  public constructor(private options: PackageOptions) {
    let packageId = this.options.packageAliasOrId;
    if (!packageId.startsWith(packagePrefixes.PackageId)) {
      packageId = getPackageIdFromAlias(this.options.packageAliasOrId, this.options.project);
      if (packageId === this.options.packageAliasOrId) {
        throw messages.createError('packageAliasNotFound', [this.options.packageAliasOrId]);
      }
    }

    if (packageId.startsWith(packagePrefixes.PackageId)) {
      this.packageId = packageId;
      this.verifyAliasForId();
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
   * Returns all the packages that are available in the org.
   *
   * @param connection
   */
  public static async list(connection: Connection): Promise<PackagingSObjects.Package2[]> {
    return (
      await connection.tooling.query<PackagingSObjects.Package2>(`select ${Package2Fields.toString()} from Package2`)
    )?.records;
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
    project: SfProject,
    options?: PackageVersionListOptions
  ): Promise<PackageVersionListResult[]> {
    // resolve/verify packages
    const packages = options?.packages?.map((pkg) => {
      const id = getPackageIdFromAlias(pkg, project);

      // validate ID
      if (id.startsWith('0Ho')) {
        validateId(BY_LABEL.PACKAGE_ID, id);
        return id;
      } else {
        throw messages.createError('errorInvalidPackageVersionId', [id]);
      }
    });
    const opts = options || ({} as PackageVersionListOptions);
    opts.packages = packages || [];

    return (await listPackageVersions({ ...opts, ...{ connection } })).records;
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
   * Returns the package ID of the package.
   *
   * @returns {string} package ID
   */
  public getId(): string {
    return this.packageId;
  }

  /**
   * Returns the package type of the package.
   *
   * @returns {Promise<PackageType>}
   */
  public async getType(): Promise<PackageType> {
    return (await this.getPackageData()).ContainerOptions;
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
    } as PackageVersionListOptions);
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
      Object.keys(options).forEach((key) => options[key] === undefined && delete options[key]);

      const result = await this.options.connection.tooling.update('Package2', options);
      if (!result.success) {
        throw new SfError(result.errors.join(', '));
      }
      return result;
    } catch (err) {
      throw applyErrorAction(massageErrorMessage(err as Error));
    }
  }

  /**
   * Returns the package data for the package.
   *
   * @param force force a refresh of the package data
   */
  public async getPackageData(force = false): Promise<PackagingSObjects.Package2> {
    if (!this.packageData || force) {
      this.packageData = (await this.options.connection.tooling
        .sobject('Package2')
        .retrieve(this.packageId)) as PackagingSObjects.Package2;
    }
    return this.packageData;
  }

  private verifyAliasForId(): void {
    if (getPackageAliasesFromId(this.packageId, this.options.project).length === 0) {
      throw new SfError(messages.getMessage('couldNotFindAliasForId', [this.packageId]));
    }
  }
}
