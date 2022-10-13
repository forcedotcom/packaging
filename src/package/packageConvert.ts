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
  ScratchOrgInfo,
  SfError,
  SfProject,
  StatusResult,
} from '@salesforce/core';
import { camelCaseToTitleCase, Duration } from '@salesforce/kit';
import { Many } from '@salesforce/ts-types';
import SettingsGenerator from '@salesforce/core/lib/org/scratchOrgSettingsGenerator';
import { uniqid } from '../utils/uniqid';
import * as pkgUtils from '../utils/packageUtils';
import {
  PackagingSObjects,
  PackageVersionCreateRequestResult,
  ConvertPackageOptions,
  PackageVersionCreateEventData,
  PackageEvents,
} from '../interfaces';
import { consts } from '../constants';
import * as srcDevUtil from '../utils/srcDevUtils';
import { generatePackageAliasEntry } from '../utils';
import { byId } from './packageVersionCreateRequest';
import * as pvcr from './packageVersionCreateRequest';
import Package2VersionStatus = PackagingSObjects.Package2VersionStatus;

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_version_create');

export async function findOrCreatePackage2(seedPackage: string, connection: Connection): Promise<string> {
  const query = `SELECT Id FROM Package2 WHERE ConvertedFromPackageId = '${seedPackage}'`;
  const queryResult = (await connection.tooling.query<PackagingSObjects.Package2>(query)).records;
  if (queryResult?.length > 1) {
    const ids = queryResult.map((r) => r.Id);
    throw messages.createError('errorMoreThanOnePackage2WithSeed', [ids.join(', ')]);
  }

  if (queryResult?.length === 1) {
    // return the package2 object
    return queryResult[0].Id;
  }

  // Need to create a new Package2
  const subQuery = `SELECT Name, Description, NamespacePrefix FROM SubscriberPackage WHERE Id = '${seedPackage}'`;
  let subscriberResult;
  try {
    subscriberResult = await connection.singleRecordQuery<PackagingSObjects.SubscriberPackage>(subQuery, {
      tooling: true,
    });
  } catch (e) {
    throw messages.createError('errorNoSubscriberPackageRecord', [seedPackage]);
  }

  const request = {
    Name: subscriberResult.Name,
    Description: subscriberResult.Description,
    NamespacePrefix: subscriberResult.NamespacePrefix,
    ContainerOptions: 'Managed',
    ConvertedFromPackageId: seedPackage,
  };

  const createResult = await connection.tooling.create('Package2', request);
  if (!createResult.success) {
    throw pkgUtils.combineSaveErrors('Package2', 'create', createResult.errors);
  }
  return createResult.id;
}

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

  const packageId = await findOrCreatePackage2(pkg, connection);

  const apiVersion = pkgUtils.getSourceApiVersion(project);

  const request = await createPackageVersionCreateRequest(
    {
      installationkey: options.installationKey,
      definitionfile: options.definitionfile,
      buildinstance: options.buildInstance,
    },
    packageId,
    apiVersion
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
  context: { installationkey?: string; definitionfile?: string; buildinstance?: string },
  packageId: string,
  apiVersion: string
): Promise<PackagingSObjects.Package2VersionCreateRequest> {
  const uniqueId = uniqid({ template: `${packageId}-%s` });
  const packageVersTmpRoot = path.join(os.tmpdir(), uniqueId);
  const packageVersMetadataFolder = path.join(packageVersTmpRoot, 'md-files');
  const packageVersBlobDirectory = path.join(packageVersTmpRoot, 'package-version-info');
  const settingsZipFile = path.join(packageVersBlobDirectory, 'settings.zip');
  const metadataZipFile = path.join(packageVersBlobDirectory, 'package.zip');
  const packageVersBlobZipFile = path.join(packageVersTmpRoot, consts.PACKAGE_VERSION_INFO_FILE_ZIP);

  const packageDescriptorJson = {
    id: packageId,
  };

  const settingsGenerator = new SettingsGenerator({ asDirectory: true });
  const definitionFile = context.definitionfile;
  let definitionFileJson: ScratchOrgInfo;
  if (definitionFile) {
    try {
      const definitionFilePayload = await fs.promises.readFile(definitionFile, 'utf8');
      definitionFileJson = JSON.parse(definitionFilePayload) as ScratchOrgInfo;
    } catch (err) {
      throw messages.createError('errorReadingDefintionFile', [err as string]);
    }

    // Load any settings from the definition
    await settingsGenerator.extract(definitionFileJson);
    if (settingsGenerator.hasSettings() && definitionFileJson.orgPreferences) {
      // this is not allowed, exit with an error
      throw messages.createError('signupDuplicateSettingsSpecified');
    }

    ['country', 'edition', 'language', 'features', 'orgPreferences', 'snapshot', 'release', 'sourceOrg'].forEach(
      (prop) => {
        const propValue = definitionFileJson[prop];
        if (propValue) {
          packageDescriptorJson[prop] = propValue;
        }
      }
    );
  }

  await fs.promises.mkdir(packageVersTmpRoot, { recursive: true });
  await fs.promises.mkdir(packageVersBlobDirectory, { recursive: true });
  await fs.promises.mkdir(packageVersMetadataFolder, { recursive: true });

  await settingsGenerator.createDeploy();
  await settingsGenerator.createDeployPackageContents(apiVersion);
  await srcDevUtil.zipDir(
    `${settingsGenerator.getDestinationPath()}${path.sep}${settingsGenerator.getShapeDirName()}`,
    settingsZipFile
  );

  const shapeDirectory = `${settingsGenerator.getDestinationPath()}${path.sep}${settingsGenerator.getShapeDirName()}`;
  const currentPackageXml = await fs.promises.readFile(path.join(shapeDirectory, 'package.xml'), 'utf8');
  await fs.promises.writeFile(path.join(packageVersMetadataFolder, 'package.xml'), currentPackageXml, 'utf-8');
  // Zip the packageVersMetadataFolder folder and put the zip in {packageVersBlobDirectory}/package.zip
  await srcDevUtil.zipDir(packageVersMetadataFolder, metadataZipFile);
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
            // TODO SfProjectJson.addPackageAlias
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
          await Lifecycle.getInstance().emit(PackageEvents.convert.success, {
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
          await Lifecycle.getInstance().emit(PackageEvents.convert.error, { id, status });
          throw new SfError(status);
        }
      } else {
        const remainingTime = Duration.seconds(interval.seconds * remainingRetries);
        await Lifecycle.getInstance().emit(PackageEvents.convert.progress, {
          id,
          packageVersionCreateRequestResult: results[0],
          message: '',
          timeRemaining: remainingTime,
        } as PackageVersionCreateEventData);
        const logger = Logger.childFromRoot('packageConvert');

        logger.info(
          `Request in progress. Sleeping ${interval.seconds} seconds. Will wait a total of ${
            remainingTime.seconds
          } more seconds before timing out. Current Status='${camelCaseToTitleCase(results[0]?.Status)}'`
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
