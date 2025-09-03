/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Connection, Messages, SfError, SfProject } from '@salesforce/core';
import { BundleEntry } from '@salesforce/schemas';
import { BundleSObjects, BundleCreateOptions } from '../interfaces';
import { massageErrorMessage } from '../utils/bundleUtils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'bundle_create');

type Bundle2Request = Pick<BundleSObjects.Bundle, 'BundleName' | 'Description'>;

export function createPackageDirEntry(project: SfProject, options: BundleCreateOptions): BundleEntry {
  return {
    versionName: 'ver 0.1',
    versionNumber: '0.1',
    name: options.BundleName,
    versionDescription: options.Description,
  };
}

export async function createBundle(
  connection: Connection,
  project: SfProject,
  options: BundleCreateOptions
): Promise<{ Id: string }> {
  const request: Bundle2Request = { BundleName: options.BundleName, Description: options.Description };
  let createResult;
  try {
    createResult = await connection.tooling.sobject('PackageBundle').create(request);
  } catch (err) {
    const error =
      err instanceof Error
        ? err
        : new Error(typeof err === 'string' ? err : messages.getMessage('failedToCreatePackageBundle'));
    throw SfError.wrap(massageErrorMessage(error));
  }

  if (!createResult?.success) {
    throw SfError.wrap(massageErrorMessage(new Error(messages.getMessage('failedToCreatePackageBundle'))));
  }

  const bundleEntry = createPackageDirEntry(project, options);
  project.getSfProjectJson().addPackageBundle(bundleEntry);
  project.getSfProjectJson().addPackageBundleAlias(bundleEntry.name, createResult.id);
  await project.getSfProjectJson().write();

  return { Id: createResult.id };
}
