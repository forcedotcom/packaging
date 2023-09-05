/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, NamedPackageDir, PackageDir, SfError, SfProject } from '@salesforce/core';
import * as pkgUtils from '../utils/packageUtils';
import { applyErrorAction, massageErrorMessage, replaceIfEmpty } from '../utils/packageUtils';
import { PackageCreateOptions, PackagingSObjects } from '../interfaces';

type Package2Request = Pick<
  PackagingSObjects.Package2,
  'Name' | 'Description' | 'NamespacePrefix' | 'ContainerOptions' | 'IsOrgDependent' | 'PackageErrorUsername'
>;

export function createPackageRequestFromContext(project: SfProject, options: PackageCreateOptions): Package2Request {
  const namespace = options.noNamespace ? '' : project.getSfProjectJson().getContents().namespace ?? '';
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
 * @param options - package create options
 * @private
 */

export function createPackageDirEntry(project: SfProject, options: PackageCreateOptions): PackageDir | NamedPackageDir {
  const packageDirs: PackageDir[] = project.getSfProjectJson().getContents().packageDirectories ?? [];
  let isNew = false;

  // see if package exists (exists means it has an id or package)
  let packageDir: PackageDir | undefined = packageDirs
    .map((pd: PackageDir) => pd as NamedPackageDir & { id: string })
    .find((pd: NamedPackageDir & { id: string }) => pd.path === options.path && !pd.id && !pd.package);

  if (!packageDir) {
    // no match - create a new one
    isNew = true;
    packageDir = { ...pkgUtils.DEFAULT_PACKAGE_DIR } as NamedPackageDir;
    packageDir.path = replaceIfEmpty(packageDir.path, options.path);
  }

  if (packageDirs.length === 0) {
    packageDir.default = true;
  } else if (isNew) {
    packageDir.default = !packageDirs.find((pd: PackageDir) => pd.default);
  }

  packageDir.package = replaceIfEmpty(packageDir.package, options.name);
  packageDir.versionName = replaceIfEmpty(packageDir.versionName, pkgUtils.DEFAULT_PACKAGE_DIR.versionName);
  packageDir.versionNumber = replaceIfEmpty(packageDir.versionNumber, pkgUtils.DEFAULT_PACKAGE_DIR.versionNumber);
  packageDir.versionDescription = replaceIfEmpty(packageDir.versionDescription, options.description);

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

  const createResult = await connection.tooling
    .sobject('Package2')
    .create(request)
    .catch((err) => {
      const error = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Unknown error');
      throw SfError.wrap(applyErrorAction(massageErrorMessage(error)));
    });

  if (!createResult.success) {
    throw pkgUtils.combineSaveErrors('Package2', 'create', createResult.errors);
  }

  if (!process.env.SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_CREATE) {
    const packageDirectory = createPackageDirEntry(project, options);
    project.getSfProjectJson().addPackageDirectory(packageDirectory as NamedPackageDir);
    project.getSfProjectJson().addPackageAlias(options.name, createResult.id);
    await project.getSfProjectJson().write();
  }

  return { Id: createResult.id };
}
