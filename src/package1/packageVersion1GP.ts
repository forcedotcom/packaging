/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { AsyncCreatable } from '@salesforce/kit';
import { IPackageVersion1GP, PackageVersionOptions1GP } from '../interfaces';

/**
 * Package1Version class - Class to be used with 1st generation package versions
 */
export class PackageVersion1GP extends AsyncCreatable<PackageVersionOptions1GP> implements IPackageVersion1GP {
  // @ts-ignore
  public constructor(private options: PackageVersionOptions1GP) {
    super(options);
  }

  // eslint-disable-next-line class-methods-use-this
  public convert(): Promise<void> {
    return Promise.resolve(undefined);
  }

  // eslint-disable-next-line class-methods-use-this
  public create(): Promise<void> {
    return Promise.resolve(undefined);
  }

  // eslint-disable-next-line class-methods-use-this
  public delete(): Promise<void> {
    return Promise.resolve(undefined);
  }

  // eslint-disable-next-line class-methods-use-this
  public install(): Promise<void> {
    return Promise.resolve(undefined);
  }

  // eslint-disable-next-line class-methods-use-this
  public list(): Promise<void> {
    return Promise.resolve(undefined);
  }

  // eslint-disable-next-line class-methods-use-this
  public uninstall(): Promise<void> {
    return Promise.resolve(undefined);
  }

  // eslint-disable-next-line class-methods-use-this
  public update(): Promise<void> {
    return Promise.resolve(undefined);
  }

  // eslint-disable-next-line class-methods-use-this
  protected init(): Promise<void> {
    return Promise.resolve(undefined);
  }
}
