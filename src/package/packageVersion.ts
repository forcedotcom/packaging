/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Messages, SfProject } from '@salesforce/core';
import {
  PackageVersionCreateRequestResult,
  PackageSaveResult,
  PackageVersionCreateOptions,
  PackageVersionOptions,
} from '../interfaces';
import * as pkgUtils from '../utils/packageUtils';
import { combineSaveErrors } from '../utils';
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

  /**
   * Creates a new package version.
   *
   * @param options
   */
  public async create(options: PackageVersionCreateOptions): Promise<Partial<PackageVersionCreateRequestResult>> {
    const pvc = new PackageVersionCreate({ ...options, ...this.options });
    return pvc.createPackageVersion();
  }

  /**
   * Deletes a package version.
   *
   * @param idOrAlias
   * @param undelete
   */
  public async delete(idOrAlias: string, undelete = false): Promise<PackageSaveResult> {
    const packageVersionId = pkgUtils.getPackageIdFromAlias(idOrAlias, this.project);

    // ID can be an 04t or 05i
    pkgUtils.validateId(
      [pkgUtils.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, pkgUtils.BY_LABEL.PACKAGE_VERSION_ID],
      packageVersionId
    );

    // lookup the 05i ID, if needed
    const packageId = await pkgUtils.getPackageVersionId(packageVersionId, this.connection);

    // setup the request
    const request: { Id: string; IsDeprecated: boolean } = {
      Id: packageId,
      IsDeprecated: !undelete,
    };

    const updateResult = await this.connection.tooling.update('Package2Version', request);
    if (!updateResult.success) {
      throw combineSaveErrors('Package2', 'update', updateResult.errors);
    }
    updateResult.id = await pkgUtils.getSubscriberPackageVersionId(packageVersionId, this.connection);
    return updateResult;
  }

  public convert(): Promise<void> {
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
}
