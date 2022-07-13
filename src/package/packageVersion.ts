/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Messages, SfProject } from '@salesforce/core';
import { Package2VersionCreateRequestResult, PackageVersionCreateOptions, PackageVersionOptions } from '../interfaces';
import { PackageVersionCreate } from './packageVersionCreate';

Messages.importMessagesDirectory(__dirname);
// const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

// const logger = Logger.childFromRoot('packageVersionCreate');
export class PackageVersion {
  // @ts-ignore
  private readonly project: SfProject;
  // @ts-ignore
  private readonly connection: Connection;

  public constructor(private options: PackageVersionOptions) {
    this.connection = this.options.connection;
    this.project = this.options.project;
  }

  public async createPackageVersion(
    options: PackageVersionCreateOptions
  ): Promise<Partial<Package2VersionCreateRequestResult>> {
    const pvc = new PackageVersionCreate({ ...options, ...this.options });
    return pvc.createPackageVersion();
  }
}
