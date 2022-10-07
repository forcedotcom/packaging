/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages, sfdc, SfError, SfProject } from '@salesforce/core';
import { AsyncCreatable, Duration } from '@salesforce/kit';
import { QueryResult } from 'jsforce';
import { Optional } from '@salesforce/ts-types';
import {
  IPackage,
  PackageOptions,
  PackagingSObjects,
  PackageInstallOptions,
  PackageInstallCreateRequest,
  PackageIdType,
  ConvertPackageOptions,
  PackageVersionCreateRequestResult,
  PackageSaveResult,
  PackageUpdateOptions,
} from '../interfaces';
import { listPackages } from './packageList';
import { getExternalSites, getStatus, installPackage, waitForPublish } from './packageInstall';
import { convertPackage } from './packageConvert';
import { uninstallPackage } from './packageUninstall';

type PackageInstallRequest = PackagingSObjects.PackageInstallRequest;

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
 */
export class Package extends AsyncCreatable<PackageOptions> implements IPackage {
  public constructor(private options: PackageOptions) {
    super(options);
  }

  /**
   * Given a Salesforce ID for a package resource and the type of resource,
   * ensures the ID is valid.
   *
   * Valid ID types and prefixes for packaging resources:
   * 1. package ID (0Ho)
   * 2. subscriber package version ID (04t)
   * 3. package install request ID (0Hf)
   * 4. package uninstall request ID (06y)
   *
   * @param id Salesforce ID for a specific package resource
   * @param type The type of package ID
   */
  public static validateId(id: string, type: PackageIdType): void {
    const prefix = packagePrefixes[type];
    if (!id.startsWith(prefix)) {
      throw messages.createError('invalidPackageId', [type, id, prefix]);
    }
    if (!sfdc.validateSalesforceId(id)) {
      throw messages.createError('invalidIdLength', [type, id]);
    }
  }

  public async convert(
    pkgId: string,
    options: ConvertPackageOptions,
    project?: SfProject
  ): Promise<PackageVersionCreateRequestResult> {
    const apiVersion = project.getSfProjectJson().get('sourceApiVersion') as string;
    return await convertPackage(pkgId, this.options.connection, options, apiVersion);
  }

  public create(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public delete(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public async install(
    pkgInstallCreateRequest: PackageInstallCreateRequest,
    options?: PackageInstallOptions
  ): Promise<PackageInstallRequest> {
    return installPackage(this.options.connection, pkgInstallCreateRequest, options);
  }

  public async getInstallStatus(installRequestId: string): Promise<PackageInstallRequest> {
    return getStatus(this.options.connection, installRequestId);
  }

  public list(): Promise<QueryResult<PackagingSObjects.Package2>> {
    return listPackages(this.options.connection);
  }

  public async uninstall(
    id: string,
    wait: Duration
  ): Promise<PackagingSObjects.SubscriberPackageVersionUninstallRequest> {
    return await uninstallPackage(id, this.options.connection, wait);
  }

  /**
   * Reports on the uninstall progress of a package.
   *
   * @param id the 06y package uninstall request id
   */
  public async uninstallReport(id: string): Promise<PackagingSObjects.SubscriberPackageVersionUninstallRequest> {
    const result = (await this.options.connection.tooling.retrieve(
      'SubscriberPackageVersionUninstallRequest',
      id
    )) as PackagingSObjects.SubscriberPackageVersionUninstallRequest;
    if (result.Status === 'Error') {
      const errorDetails = await this.options.connection.tooling.query<{ Message: string }>(
        `SELECT Message FROM PackageVersionUninstallRequestError WHERE ParentRequest.Id = '${id}' ORDER BY Message`
      );
      const errors: string[] = [];
      errorDetails.records.forEach((record) => {
        errors.push(`(${errors.length + 1}) ${record.Message}`);
      });
      const errHeader = errors.length > 0 ? `\n=== Errors\n${errors.join('\n')}` : '';
      const err = messages.getMessage('defaultErrorMessage', [id, result.Id]);

      throw new SfError(`${err}${errHeader}`, 'UNINSTALL_ERROR', [messages.getMessage('action')]);
    }
    return result;
  }

  public async update(options: PackageUpdateOptions): Promise<PackageSaveResult> {
    // filter out any undefined values and their keys
    Object.keys(options).forEach((key) => options[key] === undefined && delete options[key]);

    const result = await this.options.connection.tooling.update('Package2', options);
    if (!result.success) {
      throw new SfError(result.errors.join(', '));
    }
    return result;
  }

  public async getPackage(packageId: string): Promise<PackagingSObjects.Package2> {
    const package2 = await this.options.connection.tooling.sobject('Package2').retrieve(packageId);
    return package2 as unknown as PackagingSObjects.Package2;
  }

  public async getExternalSites(
    subscriberPackageVersionId: string,
    installationKey?: string
  ): Promise<Optional<string[]>> {
    return getExternalSites(this.options.connection, subscriberPackageVersionId, installationKey);
  }

  public async waitForPublish(
    subscriberPackageVersionId: string,
    timeout: number | Duration,
    installationKey?: string
  ): Promise<void> {
    return waitForPublish(this.options.connection, subscriberPackageVersionId, timeout, installationKey);
  }

  protected init(): Promise<void> {
    return Promise.resolve(undefined);
  }
}
