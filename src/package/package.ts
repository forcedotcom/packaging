/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { Connection, Messages, SfError, SfProject } from '@salesforce/core';
import { ComponentSetBuilder, MetadataConverter } from '@salesforce/source-deploy-retrieve';
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
  PackageVersionMetadataDownloadOptions,
  PackageVersionMetadataDownloadResult,
} from '../interfaces';
import {
  applyErrorAction,
  BY_LABEL,
  massageErrorMessage,
  validateId,
  isDirEmpty,
  uniqid,
  unzipBuffer,
} from '../utils/packageUtils';
import { createPackage } from './packageCreate';
import { convertPackage } from './packageConvert';
import { listPackageVersions } from './packageVersionList';
import { deletePackage } from './packageDelete';
import { PackageAncestry } from './packageAncestry';

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
      packageId =
        this.options.project.getPackageIdFromAlias(this.options.packageAliasOrId) ?? this.options.packageAliasOrId;
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
   * Returns all the packages that are available in the org.
   *
   * @param connection
   */
  public static async list(connection: Connection): Promise<PackagingSObjects.Package2[]> {
    return (
      await connection.tooling.query<PackagingSObjects.Package2>(
        `select ${this.getPackage2Fields(connection).toString()} from Package2 ORDER BY NamespacePrefix, Name`,
        {
          autoFetch: true,
          maxFetch: 10_000,
        }
      )
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
      const id = project.getPackageIdFromAlias(pkg) ?? pkg;

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
    project: SfProject,
    connection: Connection
  ): Promise<PackageAncestry> {
    return PackageAncestry.create({
      packageId,
      project,
      connection,
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
    // Validate the destination path is suitable to extract package version metadata (must be new or empty)
    const destinationFolder = options.destinationFolder || 'force-app/';
    const destinationPath = path.join(project.getPath(), destinationFolder);
    if (!fs.existsSync(destinationPath)) {
      fs.mkdirSync(destinationPath, { recursive: true });
    }
    if (!isDirEmpty(destinationPath)) {
      throw messages.createError('sourcesDownloadDirectoryNotEmpty');
    }

    // Get the MetadataZip URL from the MetadataPackageVersion record
    const { allPackageVersionId } = options;
    const versionInfo: PackagingSObjects.MetadataPackageVersion = (await connection.tooling
      .sobject('MetadataPackageVersion')
      .retrieve(allPackageVersionId)) as PackagingSObjects.MetadataPackageVersion;

    if (!versionInfo.MetadataZip) {
      throw messages.createError('unableToAccessMetadataZip');
    }

    const responseBase64 = await connection.tooling.request<string>(versionInfo.MetadataZip, {
      encoding: 'base64',
    });
    const buffer = Buffer.from(responseBase64, 'base64');

    // Unzip the metadata zip file into a tmp directory. It still needs to be converted to source format.
    const uniqueId = uniqid({ template: `${allPackageVersionId}-%s` });
    const tmpDir = path.join(os.tmpdir(), uniqueId);
    fs.mkdirSync(tmpDir, { recursive: true });
    await unzipBuffer(buffer, tmpDir);

    // Convert the files from metadata -> source format and copy them into the project directory (e.g. force-app/main/default)
    const componentSet = await ComponentSetBuilder.build({
      sourcepath: [tmpDir],
    });
    const converter = new MetadataConverter();
    const convertResult = await converter.convert(componentSet, 'source', {
      type: 'directory',
      outputDirectory: destinationPath,
      genUniqueDir: false,
    });

    return convertResult;
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
    if (!this.packageData ?? force) {
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
