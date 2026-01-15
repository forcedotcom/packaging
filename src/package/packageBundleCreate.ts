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
