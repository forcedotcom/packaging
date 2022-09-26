/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Messages, NamedPackageDir, PackageDir, SfError, SfProject } from '@salesforce/core';
import { isString } from '@salesforce/ts-types';
import * as pkgUtils from '../utils/packageUtils';
import { PackageCreateOptions, PackagingSObjects } from '../interfaces';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_create');

type Package2Request = Pick<
  PackagingSObjects.Package2,
  'Name' | 'Description' | 'NamespacePrefix' | 'ContainerOptions' | 'IsOrgDependent' | 'PackageErrorUsername'
>;

export function createPackageRequestFromContext(project: SfProject, options: PackageCreateOptions): Package2Request {
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
 * Create packageDirectory json entry for this package that can be written to sfdx-project.json
 *
 * @param project
 * @param packageId the 0Ho id of the package to create the entry for
 * @private
 */

export function createPackageDirEntry(project: SfProject, options: PackageCreateOptions): PackageDir | NamedPackageDir {
  let packageDirs: PackageDir[] = project.getSfProjectJson().getContents().packageDirectories;
  let isNew = false;
  if (!packageDirs) {
    packageDirs = [];
  }

  // see if package exists (exists means it has an id or package)
  let packageDir: PackageDir = packageDirs.find(
    (pd: NamedPackageDir & { id: string }) => pd.path === options.path && !pd.id && !pd.package
  );

  if (!packageDir) {
    // no match - create a new one
    isNew = true;
    packageDir = pkgUtils.DEFAULT_PACKAGE_DIR as NamedPackageDir;
    packageDir.path = packageDir.path || options.path;
  }

  if (packageDirs.length === 0) {
    packageDir.default = true;
  } else if (isNew) {
    packageDir.default = !packageDirs.find((pd: PackageDir) => pd.default);
  }

  packageDir.package = packageDir.package || options.name;
  packageDir.versionName = packageDir.versionName || pkgUtils.DEFAULT_PACKAGE_DIR.versionName;
  packageDir.versionNumber = packageDir.versionNumber || pkgUtils.DEFAULT_PACKAGE_DIR.versionNumber;
  packageDir.versionDescription = packageDir.versionDescription || options.description;

  return packageDir;
}

export async function createPackage(
  connection: Connection,
  project: SfProject,
  options: PackageCreateOptions
): Promise<{ Id: string }> {
  // strip trailing slash from path param
  options.path = options.path.replace(/\/$/, '');

  const request = createPackageRequestFromContext(project, options);
  let packageId: string = null;

  const createResult = await connection.tooling
    .sobject('Package2')
    .create(request)
    .catch((err) => {
      const error: string = isString(err) ? err : err.message;
      throw SfError.wrap(error);
    });

  if (!createResult.success) {
    throw pkgUtils.combineSaveErrors('Package2', 'create', createResult.errors);
  }
  packageId = createResult.id;
  const queryResult = await connection.tooling.query(`SELECT Id FROM Package2 WHERE Id='${packageId}'`);
  if (!queryResult?.records[0]) {
    throw messages.createError('unableToFindPackageWithId', [packageId]);
  }

  const record = queryResult.records[0];

  if (!process.env.SFDX_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_CREATE) {
    const packageDirectory = createPackageDirEntry(project, options);
    project.getSfProjectJson().addPackageDirectory(packageDirectory as NamedPackageDir);
    project.getSfProjectJson().addPackageAlias(options.name, record.Id);
    await project.getSfProjectJson().write();
  }

  return { Id: record.Id };
}
