/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { AsyncCreatable } from '@salesforce/kit';
import { IPackage, PackageOptions } from '../interfaces';

/**
 * Package class.
 *
 * This class provides the base implementation for a package.
 */
export class Package extends AsyncCreatable<PackageOptions> implements IPackage {
  // @ts-ignore
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

  public install(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public list(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public uninstall(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public update(): Promise<void> {
    return Promise.resolve(undefined);
  }

  protected init(): Promise<void> {
    return Promise.resolve(undefined);
  }
}
