/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { Connection, Messages, SfProject } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { Many } from '@salesforce/ts-types';
import { uniqid } from '../utils/uniqid';
import * as pkgUtils from '../utils/packageUtils';
import { PackagingSObjects, PackageVersionCreateRequestResult, ConvertPackageOptions } from '../interfaces';
import { consts } from '../constants';
import * as srcDevUtil from '../utils/srcDevUtils';
import { byId } from './packageVersionCreateRequest';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

export async function convertPackage(
  pkg: string,
  connection: Connection,
  options: ConvertPackageOptions,
  project?: SfProject
): Promise<PackageVersionCreateRequestResult> {
  let maxRetries = 0;
  const branch = 'main';
  if (options.wait) {
    maxRetries = (60 / pkgUtils.POLL_INTERVAL_SECONDS) * options.wait.minutes;
  }

  const packageId = await pkgUtils.findOrCreatePackage(pkg, connection);

  const request = await createPackageVersionCreateRequest(
    { installationkey: options.installationKey, buildinstance: options.buildInstance },
    packageId
  );

  // TODO: a lot of this is duplicated from PC, PVC, and PVCR.

  const createResult = await connection.tooling.create('Package2VersionCreateRequest', request);
  if (!createResult.success) {
    const errStr =
      createResult.errors && createResult.errors.length ? createResult.errors.join(', ') : createResult.errors;
    throw messages.createError('failedToCreatePVCRequest', [
      createResult.id ? ` [${createResult.id}]` : '',
      errStr.toString(),
    ]);
  }

  let results: Many<PackageVersionCreateRequestResult>;
  if (options.wait) {
    results = await pkgUtils.pollForStatusWithInterval(
      createResult.id,
      maxRetries,
      packageId,
      branch,
      project,
      connection,
      new Duration(pkgUtils.POLL_INTERVAL_SECONDS, Duration.Unit.SECONDS)
    );
  } else {
    results = await byId(packageId, connection);
  }

  return Array.isArray(results) ? results[0] : results;
}

/**
 * Convert the list of command line options to a JSON object that can be used to create an Package2VersionCreateRequest entity.
 *
 * @param context: command context
 * @param packageId: package2 id to create a package version for
 * @returns {{Package2Id: string, Package2VersionMetadata: *, Tag: *, Branch: number}}
 * @private
 */
async function createPackageVersionCreateRequest(
  context: { installationkey: string; buildinstance: string },
  packageId: string
): Promise<PackagingSObjects.Package2VersionCreateRequest> {
  const uniqueId = uniqid({ template: `${packageId}-%s` });
  const packageVersTmpRoot = path.join(os.tmpdir(), uniqueId);
  const packageVersBlobDirectory = path.join(packageVersTmpRoot, 'package-version-info');
  const packageVersBlobZipFile = path.join(packageVersTmpRoot, consts.PACKAGE_VERSION_INFO_FILE_ZIP);

  const packageDescriptorJson = {
    id: packageId,
  };

  await fs.promises.mkdir(packageVersTmpRoot, { recursive: true });
  await fs.promises.mkdir(packageVersBlobDirectory, { recursive: true });

  await fs.promises.writeFile(
    path.join(packageVersBlobDirectory, consts.PACKAGE2_DESCRIPTOR_FILE),
    JSON.stringify(packageDescriptorJson, undefined, 2)
  );

  // Zip the Version Info and package.zip files into another zip
  await srcDevUtil.zipDir(packageVersBlobDirectory, packageVersBlobZipFile);

  return createRequestObject(packageId, context, packageVersTmpRoot, packageVersBlobZipFile);
}

async function createRequestObject(
  packageId: string,
  options: { installationkey: string; buildinstance: string },
  packageVersTmpRoot: string,
  packageVersBlobZipFile: string
): Promise<PackagingSObjects.Package2VersionCreateRequest> {
  const zipFileBase64 = (await fs.promises.readFile(packageVersBlobZipFile)).toString('base64');
  const requestObject = {
    Package2Id: packageId,
    VersionInfo: zipFileBase64,
    InstallKey: options.installationkey,
    Instance: options.buildinstance,
    IsConversionRequest: true,
  } as PackagingSObjects.Package2VersionCreateRequest;
  await fs.promises.rm(packageVersTmpRoot, { recursive: true });
  return requestObject;
}
