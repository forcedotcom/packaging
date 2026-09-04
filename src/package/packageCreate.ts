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
import { PackageCreateOptions, PackagingSObjects } from '../interfaces';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_create');

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
      if (isPackagingNotEnabledError(err)) {
        throw messages.createError('createPackagingNotEnabledOnOrg');
      }
      const error = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Unknown error');
      throw SfError.wrap(applyErrorAction(massageErrorMessage(error)));
    });

  if (!createResult.success) {
    if (createResult.errors?.some((error) => isPackagingNotEnabledError(error))) {
      throw messages.createError('createPackagingNotEnabledOnOrg');
    }
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

/**
 * Detects the tooling-API error thrown when a Dev Hub does not have second-generation
 * packaging enabled and the Package2 entity is therefore not accessible. The Package2
 * create REST endpoint (connection.tooling.sobject('Package2').create) 404s with a
 * NOT_FOUND / "The requested resource does not exist" error. (This differs from the SOQL
 * path used by package convert, which instead reports "sObject type 'Package2' is not
 * supported" -- but package create never issues a SOQL query, so that form cannot occur
 * here.)
 *
 * @param err the error (or jsforce SaveError) thrown by a Package2 tooling call
 * @returns true if the error indicates Package2 is not supported on the org
 */
const isPackagingNotEnabledError = (err: unknown): boolean => {
  let name = '';
  let msg: string;
  if (err instanceof Error) {
    name = err.name;
    msg = err.message;
  } else if (typeof err === 'object' && err !== null) {
    // jsforce SaveError objects are plain objects that carry `errorCode`/`statusCode` and `message`.
    const e = err as { errorCode?: string; statusCode?: string; message?: string };
    name = String(e.errorCode ?? e.statusCode ?? '');
    msg = typeof e.message === 'string' ? e.message : '';
  } else {
    msg = String(err);
  }
  return name === 'NOT_FOUND' && msg.includes('The requested resource does not exist');
};
