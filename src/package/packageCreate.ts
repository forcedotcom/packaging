/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, SfError, SfProject } from '@salesforce/core';
import { env } from '@salesforce/kit';
import { PackagePackageDir, PackageDir } from '@salesforce/schemas';
import * as pkgUtils from '../utils/packageUtils';
import { applyErrorAction, massageErrorMessage } from '../utils/packageUtils';
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

export function createPackageDirEntry(project: SfProject, options: PackageCreateOptions): PackagePackageDir {
  const packageDirs: PackageDir[] = project.getSfProjectJson().getContents().packageDirectories ?? [];
  return {
    package: options.name,
    versionName: 'ver 0.1',
    versionNumber: '0.1.0.NEXT',
    ...(packageDirs.filter((pd: PackageDir) => pd.path === options.path).find((pd) => !('id' in pd)) ?? {
      // no match - create a new one
      path: options.path,
      default: packageDirs.length === 0 ? true : !packageDirs.some((pd) => pd.default === true),
    }),
    versionDescription: options.description,
  };
}

export async function createPackage(
  connection: Connection,
  project: SfProject,
  options: PackageCreateOptions
): Promise<{ Id: string }> {
  const cleanOptions = sanitizePackageCreateOptions(options);
  const request = createPackageRequestFromContext(project, cleanOptions);
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

  if (!env.getBoolean('SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_CREATE')) {
    const packageDirectory = createPackageDirEntry(project, cleanOptions);
    project.getSfProjectJson().addPackageDirectory(packageDirectory);
    project.getSfProjectJson().addPackageAlias(cleanOptions.name, createResult.id);
    await project.getSfProjectJson().write();
  }

  return { Id: createResult.id };
}

/** strip trailing slash from path param */
const sanitizePackageCreateOptions = (options: PackageCreateOptions): PackageCreateOptions => ({
  ...options,
  path: options.path.replace(/\/$/, ''),
});
