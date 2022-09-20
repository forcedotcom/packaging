/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Messages, sfdc, SfProject } from '@salesforce/core';
import { Optional } from '@salesforce/ts-types';
import { PackageIdType } from '../interfaces';

const packageIdPrefixes = {
  PackageId: '0Ho',
  SubscriberPackageVersionId: '04t',
  PackageInstallRequestId: '0Hf',
  PackageUninstallRequestId: '06y',
  Package1Id: '033', // first-generation package
  PackageVersionCreateRequestId: '08c',
  Package2VersionId: '05i',
};

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package');

/**
 * Singleton that handles resolving and validating packaging aliases and IDs.
 */
export class PackagingIdResolver {
  private static instance: PackagingIdResolver;

  private constructor(private project: SfProject) {}

  public static init(project?: SfProject): PackagingIdResolver {
    if (!PackagingIdResolver.instance) {
      PackagingIdResolver.instance = new this(project ?? SfProject.getInstance());
    }
    return PackagingIdResolver.instance;
  }

  /**
   * Given a packaging ID or alias and expected type, lookup, validate and
   * return the ID.
   *
   * Valid ID types and prefixes for packaging resources:
   * 1. PackageId = 0Ho
   * 2. SubscriberPackageVersionId = 04t
   * 3. PackageInstallRequestId = 0Hf
   * 4. PackageUninstallRequestId = 06y
   * 5. Package1Id = 033
   * 6. PackageVersionCreateRequestId = 08c
   * 7. Package2VersionId = 05i
   *
   * @param idOrAlias The alias within `sfdx-project.json` or the packaging ID.
   * @param type The valid type for the packaging ID or alias.
   * @returns The resolved packaging ID.
   */
  public resolve(idOrAlias: string, type: PackageIdType): string {
    let resolvedId: string;

    const prefix = packageIdPrefixes[type];
    if (!prefix) {
      throw messages.createError('unknownPackagingIdType', [type, Object.keys(packageIdPrefixes).toString()]);
    }

    if (idOrAlias.startsWith(prefix)) {
      resolvedId = idOrAlias;
    } else {
      resolvedId = this.getId(idOrAlias);
      if (!resolvedId) {
        throw messages.createError('packageAliasNotFound', [type, idOrAlias], [prefix]);
      }
    }

    if (!resolvedId.startsWith(prefix)) {
      throw messages.createError('invalidPackageId', [type, resolvedId, prefix]);
    }

    if (!sfdc.validateSalesforceId(resolvedId)) {
      throw messages.createError('invalidIdLength', [type, resolvedId]);
    }

    return resolvedId;
  }

  /**
   * Get a packaging ID from an alias defined in `sfdx-project.json`.
   *
   * @param alias The alias for a packaging ID in `sfdx-project.json`
   * @returns the packaging ID
   */
  public getId(alias: string): Optional<string> {
    const packageAliases = this.getProjectAliases(alias);
    return packageAliases[alias];
  }

  /**
   * Given a packaging ID return the associated aliases defined in `sfdx-project.json`.
   *
   * @param id A packaging ID used in `sfdx-project.json`.
   * @returns an array of aliases.
   */
  public getAliases(id: string): Optional<string[]> {
    const packageAliases = this.getProjectAliases(id);
    // check for a matching alias
    return Object.entries(packageAliases)
      .filter((alias) => alias[1] === id)
      .map((alias) => alias[0]);
  }

  private getProjectAliases(idOrAlias: string): { [k: string]: string } {
    try {
      const projectJson = this.project.getSfProjectJson();
      return projectJson.getContents().packageAliases ?? {};
    } catch (e) {
      throw messages.createError('projectNotFound', [idOrAlias]);
    }
  }
}
