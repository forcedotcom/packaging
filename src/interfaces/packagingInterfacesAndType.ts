/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

export interface IPackage {
  create(): Promise<void>;
  convert(): Promise<void>;
  delete(): Promise<void>;
  install(): Promise<void>;
  list(): Promise<void>;
  uninstall(): Promise<void>;
  update(): Promise<void>;
}

export interface IPackageVersion1GP {
  create(): Promise<void>;
  convert(): Promise<void>;
  delete(): Promise<void>;
  install(): Promise<void>;
  list(): Promise<void>;
  uninstall(): Promise<void>;
  update(): Promise<void>;
}

export interface IPackageVersion2GP {
  create(): Promise<void>;
  convert(): Promise<void>;
  delete(): Promise<void>;
  install(): Promise<void>;
  list(): Promise<void>;
  uninstall(): Promise<void>;
  update(): Promise<void>;
}

export type PackageOptions = Record<string, unknown>;

export type PackageVersion2Options = Record<string, unknown>;
export type PackageVersionOptions1GP = Record<string, unknown>;
