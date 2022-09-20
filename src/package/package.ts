/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages, SfError } from '@salesforce/core';
import { AsyncCreatable, Duration } from '@salesforce/kit';
import { QueryResult } from 'jsforce';
import { Optional } from '@salesforce/ts-types';
import {
  IPackage,
  PackageOptions,
  PackagingSObjects,
  PackageInstallOptions,
  PackageInstallCreateRequest,
  ConvertPackageOptions,
  PackageVersionCreateRequestResult,
  PackageSaveResult,
  PackageUpdateOptions,
} from '../interfaces';
import { listPackages } from './packageList';
import { getExternalSites, getStatus, installPackage, waitForPublish } from './packageInstall';
import { convertPackage } from './packageConvert';
import { uninstallPackage } from './packageUninstall';
import { PackagingIdResolver } from './PackagingIdResolver';

type PackageInstallRequest = PackagingSObjects.PackageInstallRequest;

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package');

/**
 * Package class.
 *
 * This class provides the base implementation for a package.
 */
export class Package extends AsyncCreatable<PackageOptions> implements IPackage {
  private packagingIdResolver: PackagingIdResolver;

  public constructor(private options: PackageOptions) {
    super(options);
    this.packagingIdResolver = PackagingIdResolver.init(options.project);
  }

  public async convert(package1Id: string, options: ConvertPackageOptions): Promise<PackageVersionCreateRequestResult> {
    const pkg1Id = this.packagingIdResolver.resolve(package1Id, 'Package1Id');
    return convertPackage(pkg1Id, this.options.connection, options, this.options.project);
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
    pkgInstallCreateRequest.SubscriberPackageVersionKey = this.packagingIdResolver.resolve(
      pkgInstallCreateRequest.SubscriberPackageVersionKey,
      'SubscriberPackageVersionId'
    );
    return installPackage(this.options.connection, pkgInstallCreateRequest, options);
  }

  public async getInstallStatus(installRequestId: string): Promise<PackageInstallRequest> {
    installRequestId = this.packagingIdResolver.resolve(installRequestId, 'PackageInstallRequestId');
    return getStatus(this.options.connection, installRequestId);
  }

  public list(): Promise<QueryResult<PackagingSObjects.Package2>> {
    return listPackages(this.options.connection);
  }

  /**
   *
   * @param idOrAlias The alias for, or 04t subscriber package version ID.
   * @param wait
   * @returns
   */
  public async uninstall(
    idOrAlias: string,
    wait: Duration
  ): Promise<PackagingSObjects.SubscriberPackageVersionUninstallRequest> {
    const subscriberPackageVersionId = this.packagingIdResolver.resolve(idOrAlias, 'SubscriberPackageVersionId');
    return uninstallPackage(subscriberPackageVersionId, this.options.connection, wait);
  }

  /**
   * Gets the status of a package uninstall request.
   *
   * @param uninstallRequestId the 06y package uninstall request id
   */
  public async getUninstallStatus(
    uninstallRequestId: string
  ): Promise<PackagingSObjects.SubscriberPackageVersionUninstallRequest> {
    uninstallRequestId = this.packagingIdResolver.resolve(uninstallRequestId, 'PackageUninstallRequestId');
    const result = (await this.options.connection.tooling.retrieve(
      'SubscriberPackageVersionUninstallRequest',
      uninstallRequestId
    )) as PackagingSObjects.SubscriberPackageVersionUninstallRequest;
    if (result.Status === 'Error') {
      const errorDetails = await this.options.connection.tooling.query<{ Message: string }>(
        `SELECT Message FROM PackageVersionUninstallRequestError WHERE ParentRequest.Id = '${uninstallRequestId}' ORDER BY Message`
      );
      const errors: string[] = [];
      errorDetails.records.forEach((record) => {
        errors.push(`(${errors.length + 1}) ${record.Message}`);
      });
      const errHeader = errors.length > 0 ? `\n=== Errors\n${errors.join('\n')}` : '';
      const err = messages.getMessage('defaultErrorMessage', [uninstallRequestId, result.Id]);

      throw new SfError(`${err}${errHeader}`, 'UNINSTALL_ERROR', [messages.getMessage('action')]);
    }
    return result;
  }

  public async update(options: PackageUpdateOptions): Promise<PackageSaveResult> {
    options.Id = this.packagingIdResolver.resolve(options.Id, 'PackageId');
    // filter out any undefined values and their keys
    Object.keys(options).forEach((key) => options[key] === undefined && delete options[key]);

    const result = await this.options.connection.tooling.update('Package2', options);
    if (!result.success) {
      throw new SfError(result.errors.join(', '));
    }
    return result;
  }

  /**
   * Given an alias for a 0Ho package ID, or the 0Ho package ID,
   * return the Package2 SObject.
   *
   * @param idOrAlias The alias for, or 0Ho package ID.
   * @returns Package2 SObject
   */
  public async getPackage(idOrAlias: string): Promise<PackagingSObjects.Package2> {
    const packageId = this.packagingIdResolver.resolve(idOrAlias, 'PackageId');
    const package2 = await this.options.connection.tooling.sobject('Package2').retrieve(packageId);
    return package2 as unknown as PackagingSObjects.Package2;
  }

  /**
   * Get a list of external sites used by the provided subscriber package version.
   *
   * @param idOrAlias The alias for, or 04t subscriber package version ID.
   * @param installationKey Installation key for a key-protected subscriber package.
   * @returns an array of external sites used by the subscriber package.
   */
  public async getExternalSites(idOrAlias: string, installationKey?: string): Promise<Optional<string[]>> {
    const subscriberPackageVersionId = this.packagingIdResolver.resolve(idOrAlias, 'SubscriberPackageVersionId');
    return getExternalSites(this.options.connection, subscriberPackageVersionId, installationKey);
  }

  /**
   * Wait until the timeout for the provided package to publish.
   *
   * @param idOrAlias The alias for, or 04t subscriber package version ID.
   * @param timeout Number or Duration object defining the minutes to wait for the provided package to publish.
   * @param installationKey Installation key for a key-protected subscriber package.
   * @returns
   */
  public async waitForPublish(idOrAlias: string, timeout: number | Duration, installationKey?: string): Promise<void> {
    const subscriberPackageVersionId = this.packagingIdResolver.resolve(idOrAlias, 'SubscriberPackageVersionId');
    return waitForPublish(this.options.connection, subscriberPackageVersionId, timeout, installationKey);
  }

  // Must be defined because it extends AsyncCreatable.
  protected init(): Promise<void> {
    return Promise.resolve(undefined);
  }
}
