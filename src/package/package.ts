/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { AsyncCreatable } from '@salesforce/kit';
import { QueryResult } from 'jsforce';
import { IPackage, PackageOptions, PackagingSObjects } from '../interfaces';
import { listPackages } from './packageList';
import { hasExternalSites, installPackage, PackageInstallOptions } from './packageInstall';
import PackageInstallRequest = PackagingSObjects.PackageInstallRequest;

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

  public install(
    pkgInstallRequest: PackageInstallRequest,
    options: PackageInstallOptions
  ): Promise<PackageInstallRequest> {
    return installPackage(this.options.connection, pkgInstallRequest, options);
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

  public async hasExternalSites(subscriberPackageVersionId: string): Promise<boolean> {
    return hasExternalSites(this.options.connection, subscriberPackageVersionId);
  }

  protected init(): Promise<void> {
    return Promise.resolve(undefined);
  }
}
