/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Messages, NamedPackageDir, Org, PackageDir, SfError, SfProject } from '@salesforce/core';
import { isString } from '@salesforce/ts-types';
import { SaveError } from 'jsforce';
import * as pkgUtils from '../utils/packageUtils';
import { PackageCreateOptions, PackagingSObjects } from '../interfaces';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

type Package2Request = Pick<
  PackagingSObjects.Package2,
  'Name' | 'Description' | 'NamespacePrefix' | 'ContainerOptions' | 'IsOrgDependent' | 'PackageErrorUsername'
>;

// TODO: consider refactoring this to take as input a Package2Request instance instead of passing in the options - this defers to the caller
export function _createPackage2RequestFromContext(project: SfProject, options: PackageCreateOptions): Package2Request {
  const namespace = options.noNamespace ? '' : project.getSfProjectJson().getContents().namespace || '';
  return {
    Name: options.name,
    Description: options.description,
    NamespacePrefix: namespace,
    ContainerOptions: options.packageType,
    IsOrgDependent: options.orgDependent,
    PackageErrorUsername: options.errorNotificationUsername,
  };
}

/**
 * Generate packageDirectory json entry for this package that can be written to sfdx-project.json
 *
 * @param project
 * @param packageId the 0Ho id of the package to create the entry for
 * @private
 */

export function _generatePackageDirEntry(
  project: SfProject,
  options: PackageCreateOptions
): PackageDir[] | NamedPackageDir[] {
  let packageDirs: NamedPackageDir[] = project.getPackageDirectories();
  if (!packageDirs) {
    packageDirs = [];
  }

  // add an entry if it doesn't exist
  // or update an existing entry if it matches path but has no package or id attribute (W-5092620)
  let packageDir: NamedPackageDir =
    project.getPackage(options.name) ||
    project
      .getPackageDirectories()
      // TODO: I don't understand where id is coming from, because it is not in sfdx-project.json schema
      .find((pd: NamedPackageDir & { id: string }) => pd.path === options.path && !pd.id && !pd.package);

  if (packageDir) {
    // update existing entry
    packageDir.package = options.name;
    packageDir.versionName ??= pkgUtils.DEFAULT_PACKAGE_DIR.versionName;
    packageDir.versionNumber ??= pkgUtils.DEFAULT_PACKAGE_DIR.versionNumber;
    // set as default if this is the only entry or no other entry is the default
    if (!Reflect.getOwnPropertyDescriptor(packageDir, 'default')) {
      packageDir.default = !pkgUtils.getConfigPackageDirectory(packageDirs, 'default', true);
    }
  } else {
    // add new entry
    packageDir = pkgUtils.DEFAULT_PACKAGE_DIR as NamedPackageDir;
    packageDir.package = options.name;
    // set as default if this is the only entry or no other entry is the default
    packageDir.default = !pkgUtils.getConfigPackageDirectory(packageDirs, 'default', true);
    packageDir.path = options.path;

    packageDirs.push(packageDir);
  }

  return packageDirs;
}

/**
 * Generate package alias json entry for this package that can be written to sfdx-project.json
 *
 * @param context
 * @param packageId the 0Ho id of the package to create the alias entry for
 * @private
 */
export function _generatePackageAliasEntry(
  project: SfProject,
  options: PackageCreateOptions,
  packageId: string
): { [key: string]: string } {
  const packageAliases = project.getSfProjectJson().getContents().packageAliases || {};

  const packageName = options.name;
  packageAliases[packageName] = packageId;

  return packageAliases;
}

// TODO: consider refactoring this to take as input a Package2Request instance instead of passing in the options - this defers to the caller
export async function createPackage(
  org: Org,
  connection: Connection,
  project: SfProject,
  options: PackageCreateOptions
): Promise<{ Id: string }> {
  // strip trailing slash from path param
  options.path = options.path.replace(/\/$/, '');

  const request = _createPackage2RequestFromContext(project, options);
  let packageId: string = null;

  const createResult = await connection.tooling
    .sobject('Package2')
    .create(request)
    .catch((err) => {
      const error: string = isString(err) ? err : err.message;
      throw SfError.wrap(error);
    });

  if (!createResult.success) {
    // TODO: should probably handle these errors differently - SaveError has much more info to share
    throw new Error((createResult.errors as SaveError[]).map((err) => err.message).join('\n'));
  }
  packageId = createResult.id;
  const queryResult = await connection.tooling.query(`SELECT Id FROM Package2 WHERE Id='${packageId}'`);
  if (!queryResult?.records[0]) {
    throw messages.createError('unableToFindPackageWithId', [packageId]);
  }

  const record = queryResult.records[0];

  if (!process.env.SFDX_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_CREATE) {
    const packageDirectory = _generatePackageDirEntry(project, options);
    const packageAliases = _generatePackageAliasEntry(project, options, record.Id);
    project.getSfProjectJson().set('packageDirectories', packageDirectory);
    project.getSfProjectJson().set('packageAliases', packageAliases);

    await project.getSfProjectJson().write();
  }

  return { Id: record.Id };
}
