/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { AsyncCreatable, Duration } from '@salesforce/kit';
import { QueryResult } from 'jsforce';
import { Optional } from '@salesforce/ts-types';
import { IPackage, PackageOptions, PackagingSObjects } from '../interfaces';
import { PackageInstallOptions, PackageInstallCreateRequest } from '../interfaces/packagingInterfacesAndType';
import { listPackages } from './packageList';
import { getExternalSites, installPackage, waitForPublish } from './packageInstall';

type PackageInstallRequest = PackagingSObjects.PackageInstallRequest;

/**
 * Package class.
 *
 * This class provides the base implementation for a package.
 */
export class Package extends AsyncCreatable<PackageOptions> implements IPackage {
  public constructor(private options: PackageOptions) {
    super(options);
  }

  public convert(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public create(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public delete(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public async install(
    pkgInstallCreateRequest: PackageInstallCreateRequest,
    options: PackageInstallOptions
  ): Promise<PackageInstallRequest> {
    return installPackage(this.options.connection, pkgInstallCreateRequest, options);
  }

  public list(): Promise<QueryResult<PackagingSObjects.Package2>> {
    return listPackages(this.options.connection);
  }

  public uninstall(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public update(): Promise<void> {
    return Promise.resolve(undefined);
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
