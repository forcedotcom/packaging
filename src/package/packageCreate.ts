/*
 * Copyright 2026, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Connection, Messages, SfError, SfProject } from '@salesforce/core';
import { env } from '@salesforce/kit';
import { PackagePackageDir, PackageDir } from '@salesforce/schemas';
import { isPackagingDirectory } from '@salesforce/core/project';
import * as pkgUtils from '../utils/packageUtils';
import { applyErrorAction, massageErrorMessage } from '../utils/packageUtils';
import {
  DISTRIBUTION_TYPE_MIN_API_VERSION,
  PackageCreateOptions,
  PackagingSObjects,
  SETTABLE_DISTRIBUTION_TYPES,
  SettableDistributionType,
} from '../interfaces';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package');

type Package2Request = Pick<
  PackagingSObjects.Package2,
  | 'Name'
  | 'Description'
  | 'NamespacePrefix'
  | 'ContainerOptions'
  | 'IsOrgDependent'
  | 'PackageErrorUsername'
  | 'DistributionType'
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
    // Only send DistributionType when the user provided one; otherwise the backend defaults it
    // based on the package type (Managed -> PublicSecure, Unlocked -> Limited).
    ...(options.distributionType ? { DistributionType: options.distributionType } : {}),
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
    versionName: 'ver 0.1',
    versionNumber: '0.1.0.NEXT',
    ...(packageDirs
      .filter((pd: PackageDir) => pd.path === options.path && !isPackagingDirectory(pd))
      .find((pd) => !('id' in pd)) ?? {
      // no match - create a new one
      path: options.path,
      default: packageDirs.length === 0 ? true : !packageDirs.some((pd) => pd.default === true),
    }),
    package: options.name,
    versionDescription: options.description,
  };
}

/**
 * Validate a user-supplied distribution type: it requires a minimum API version and must be one of
 * the CLI-settable values (`PublicSecure` or `Limited`). `Public` and `Private` are backend-only.
 * A no-op when `distributionType` is undefined (the backend then defaults it by package type).
 *
 * Shared by both create and update so the CLI surfaces the same errors before hitting the API.
 */
export function validateDistributionType(
  connection: Connection,
  distributionType: SettableDistributionType | undefined
): void {
  if (distributionType === undefined) {
    return;
  }
  if (connection.getApiVersion() < DISTRIBUTION_TYPE_MIN_API_VERSION) {
    throw messages.createError('distributionTypeApiPriorTo68Error');
  }
  if (!SETTABLE_DISTRIBUTION_TYPES.includes(distributionType)) {
    throw messages.createError('invalidDistributionTypeError', [distributionType]);
  }
}

export async function createPackage(
  connection: Connection,
  project: SfProject,
  options: PackageCreateOptions
): Promise<{ Id: string }> {
  validateDistributionType(connection, options.distributionType);
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
