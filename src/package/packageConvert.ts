/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  Connection,
  Lifecycle,
  Logger,
  Messages,
  PollingClient,
  SfError,
  SfProject,
  StatusResult,
} from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { Many } from '@salesforce/ts-types';
import { uniqid } from '../utils/uniqid';
import * as pkgUtils from '../utils/packageUtils';
import {
  PackagingSObjects,
  PackageVersionCreateRequestResult,
  ConvertPackageOptions,
  PackageVersionCreateEventData,
} from '../interfaces';
import { consts } from '../constants';
import * as srcDevUtil from '../utils/srcDevUtils';
import { convertCamelCaseStringToSentence, generatePackageAliasEntry } from '../utils';
import { byId } from './packageVersionCreateRequest';
import * as pvcr from './packageVersionCreateRequest';
import Package2VersionStatus = PackagingSObjects.Package2VersionStatus;

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'packageVersionCreate');

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

  const packageId = await pkgUtils.findOrCreatePackage2(pkg, connection);

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
    results = await pollForStatusWithInterval(
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
export async function createPackageVersionCreateRequest(
  context: { installationkey?: string; buildinstance?: string },
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
  options: { installationkey?: string; buildinstance?: string },
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

async function pollForStatusWithInterval(
  id: string,
  retries: number,
  packageId: string,
  branch: string,
  withProject: SfProject,
  connection: Connection,
  interval: Duration
): Promise<PackageVersionCreateRequestResult> {
  let remainingRetries = retries;
  const pollingClient = await PollingClient.create({
    poll: async (): Promise<StatusResult> => {
      const results: PackageVersionCreateRequestResult[] = await pvcr.byId(id, connection);

      if (_isStatusEqualTo(results, [Package2VersionStatus.success, Package2VersionStatus.error])) {
        // complete
        if (_isStatusEqualTo(results, [Package2VersionStatus.success])) {
          // update sfdx-project.json
          let projectUpdated = false;
          if (withProject && !process.env.SFDX_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_CREATE) {
            projectUpdated = true;
            const query = `SELECT MajorVersion, MinorVersion, PatchVersion, BuildNumber FROM Package2Version WHERE Id = '${results[0].Package2VersionId}'`;
            const packageVersionVersionString: string = await connection.tooling
              .query<PackagingSObjects.Package2Version>(query)
              .then((pkgQueryResult) => {
                const record = pkgQueryResult.records[0];
                return `${record.MajorVersion}.${record.MinorVersion}.${record.PatchVersion}-${record.BuildNumber}`;
              });
            const newConfig = await generatePackageAliasEntry(
              connection,
              withProject,
              results[0].SubscriberPackageVersionId,
              packageVersionVersionString,
              branch,
              packageId
            );
            withProject.getSfProjectJson().set('packageAliases', newConfig);
            await withProject.getSfProjectJson().write();
          }
          await Lifecycle.getInstance().emit('Package/convert-success', {
            id,
            packageVersionCreateRequestResult: results[0],
            projectUpdated,
          });
          return { completed: true, payload: results[0] };
        } else {
          let status = 'Unknown Error';
          if (results?.length > 0 && results[0].Error.length > 0) {
            const errors = [];
            // for multiple errors, display one per line prefixed with (x)
            if (results[0].Error.length > 1) {
              results[0].Error.forEach((error) => {
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                errors.push(`(${errors.length + 1}) ${error}`);
              });
              errors.unshift(messages.getMessage('versionCreateFailedWithMultipleErrors'));
            }
            status = errors.length !== 0 ? errors.join('\n') : results[0].Error.join('\n');
          }
          await Lifecycle.getInstance().emit('Package/convert-error', { id, status });
          throw new SfError(status);
        }
      } else {
        const remainingTime = Duration.seconds(interval.seconds * remainingRetries);
        await Lifecycle.getInstance().emit('Package/convert-in-progress', {
          id,
          packageVersionCreateRequestResult: results[0],
          message: '',
          timeRemaining: remainingTime,
        } as PackageVersionCreateEventData);
        const logger = Logger.childFromRoot('packageConvert');

        logger.info(
          `Request in progress. Sleeping ${interval.seconds} seconds. Will wait a total of ${
            remainingTime.seconds
          } more seconds before timing out. Current Status='${convertCamelCaseStringToSentence(results[0]?.Status)}'`
        );
        remainingRetries--;
        return { completed: false, payload: results[0] };
      }
    },
    frequency: Duration.seconds(interval.seconds),
    timeout: Duration.seconds(interval.seconds * retries),
  });

  return pollingClient.subscribe<PackageVersionCreateRequestResult>();
}

/**
 * Return true if the queryResult.records[0].Status is equal to one of the values in statuses.
 *
 * @param results to examine
 * @param statuses array of statuses to look for
 * @returns {boolean} if one of the values in status is found.
 */
function _isStatusEqualTo(results: PackageVersionCreateRequestResult[], statuses?: Package2VersionStatus[]): boolean {
  return results?.length <= 0 ? false : statuses?.some((status) => results[0].Status === status);
}
