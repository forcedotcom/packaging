/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Connection, Messages, SfError, SfProject } from '@salesforce/core';
import {
  PackageOptions,
  PackagingSObjects,
  ConvertPackageOptions,
  PackageVersionCreateRequestResult,
  PackageSaveResult,
  PackageUpdateOptions,
  PackageType,
  PackageCreateOptions,
  PackageVersionListResult,
  Package2Fields,
  PackageVersionListOptions,
} from '../interfaces';
import {
  applyErrorAction,
  BY_LABEL,
  combineSaveErrors,
  getPackageAliasesFromId,
  getPackageIdFromAlias,
  massageErrorMessage,
  validateId,
} from '../utils';
import { createPackage } from './packageCreate';

import { convertPackage } from './packageConvert';
import { listPackageVersions } from './packageVersionList';

const packagePrefixes = {
  PackageId: '0Ho',
  SubscriberPackageVersionId: '04t',
  PackageInstallRequestId: '0Hf',
  PackageUninstallRequestId: '06y',
};

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package');

/**
 * Package class.
 *
 * This class provides the base implementation for a package.
 * To create a new instance of a package, use the static async Package.create({connection, project, packageOrAliasId}) method.
 */
export class Package {
  private packageId: string;
  private packageData: PackagingSObjects.Package2;
  public constructor(private options: PackageOptions) {
    this.init();
  }

  public static async create(options: PackageOptions): Promise<Package> {
    return new Package(options);
  }
  /**
   * Create a new package.
   *
   * @param connection - instance of Connection
   * @param project - instance of SfProject
   * @param options - options for creating a package - see PackageCreateOptions
   * @returns Package
   */
  public static async createPackage(
    connection: Connection,
    project: SfProject,
    options: PackageCreateOptions
  ): Promise<Package> {
    const packageId = await createPackage(connection, project, options);
    return await Package.create({ connection, project, packageAliasOrId: packageId.Id });
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

  public static async listVersions(
    connection: Connection,
    project: SfProject,
    options?: PackageVersionListOptions
  ): Promise<PackageVersionListResult[]> {
    // resolve/verify packages
    const packages = options?.packages.map((pkg) => {
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

  public static async convert(
    pkgId: string,
    connection: Connection,
    options: ConvertPackageOptions,
    project?: SfProject
  ): Promise<PackageVersionCreateRequestResult> {
    return await convertPackage(pkgId, connection, options, project);
  }

  /**
   * Returns the package ID for the package alias.
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
   *
   * @param options
   * @returns {Promise<PackageVersionListResult[]>}
   */
  public async getPackageVersions(options?: PackageVersionListOptions): Promise<PackageVersionListResult[]> {
    // This should be calling PackageVersion.list() here, but that method is not implemented yet.
    const packageOptions = {
      packages: [this.packageId],
    };

    return Package.listVersions(this.options.connection, this.options.project, {
      ...packageOptions,
      ...options,
    } as PackageVersionListOptions);
  }

  public async delete(): Promise<PackageSaveResult> {
    const updateResult = await this.options.connection.tooling.delete('Package2', [this.packageId]).catch((err) => {
      throw applyErrorAction(massageErrorMessage(err as Error));
    });
    if (updateResult[0]?.success) {
      throw combineSaveErrors('Package2', 'update', updateResult[0]?.errors);
    }
    return updateResult[0];
  }

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

  protected init(): void {
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

  private verifyAliasForId(): void {
    if (getPackageAliasesFromId(this.packageId, this.options.project).length === 0) {
      throw new SfError(messages.getMessage('couldNotFindAliasForId', [this.packageId]));
    }
  }
}
