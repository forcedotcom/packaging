/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Lifecycle, Logger, Messages, PollingClient, SfError, StatusResult } from '@salesforce/core';
import { isString, Nullable } from '@salesforce/ts-types';
import { QueryResult } from 'jsforce';
import { Duration } from '@salesforce/kit';
import { escapeInstallationKey, numberToDuration } from '../utils/packageUtils';
import {
  PackageEvents,
  PackageInstallCreateRequest,
  PackageInstallOptions,
  PackageType,
  PackagingSObjects,
} from '../interfaces';
import SubscriberPackageVersion = PackagingSObjects.SubscriberPackageVersion;
import PackageInstallRequest = PackagingSObjects.PackageInstallRequest;

Messages.importMessagesDirectory(__dirname);
const installMsgs = Messages.loadMessages('@salesforce/packaging', 'package_install');

let logger: Logger;
const getLogger = (): Logger => {
  if (!logger) {
    logger = Logger.childFromRoot('installPackage');
  }
  return logger;
};

export async function createPackageInstallRequest(
  connection: Connection,
  pkgInstallCreateRequest: PackageInstallCreateRequest,
  packageType: PackageType
): Promise<PackagingSObjects.PackageInstallRequest> {
  const defaults = {
    ApexCompileType: 'all',
    EnableRss: false,
    NameConflictResolution: 'Block',
    PackageInstallSource: 'U',
    SecurityType: 'None',
    UpgradeType: 'mixed-mode',
  };

  const request: Omit<PackageInstallCreateRequest, 'UpgradeType' | 'ApexCompileType'> &
    Partial<Pick<PackageInstallCreateRequest, 'UpgradeType' | 'ApexCompileType'>> = Object.assign(
    {},
    defaults,
    pkgInstallCreateRequest
  );
  if (request.Password) {
    request.Password = escapeInstallationKey(request.Password);
  }

  // Only unlocked packages can change the UpgradeType and ApexCompile options from the defaults.
  if (packageType !== 'Unlocked') {
    if (request.UpgradeType !== defaults.UpgradeType) {
      const msg = installMsgs.getMessage('upgradeTypeOnlyForUnlockedWarning');
      await Lifecycle.getInstance().emit(PackageEvents.install.warning, msg);
      delete request.UpgradeType;
    }
    if (request.ApexCompileType !== defaults.ApexCompileType) {
      const msg = installMsgs.getMessage('apexCompileOnlyForUnlockedWarning');
      await Lifecycle.getInstance().emit(PackageEvents.install.warning, msg);
      delete request.ApexCompileType;
    }
  }

  await Lifecycle.getInstance().emit(PackageEvents.install.presend, request);

  const result = await connection.tooling.create('PackageInstallRequest', request);

  await Lifecycle.getInstance().emit(PackageEvents.install.postsend, result);

  const packageInstallRequestId = result.id;
  if (!packageInstallRequestId) {
    throw installMsgs.createError('packageInstallRequestError', [
      request.SubscriberPackageVersionKey,
      result.errors.toString(),
    ]);
  }
  return getStatus(connection, packageInstallRequestId);
}

export async function getStatus(
  connection: Connection,
  packageInstallRequestId: string
): Promise<PackageInstallRequest> {
  const results = (await connection.tooling.retrieve(
    'PackageInstallRequest',
    packageInstallRequestId
  )) as PackageInstallRequest;
  return results;
}

// determines if error is from malformed SubscriberPackageVersion query
// this is in place to allow cli to run against app version 214, where SPV queries
// do not require installation key
export function isErrorFromSPVQueryRestriction(err: Error): boolean {
  return (
    err.name === 'MALFORMED_QUERY' &&
    err.message.includes('Implementation restriction: You can only perform queries of the form Id')
  );
}

export function isErrorPackageNotAvailable(err: Error): boolean {
  return err.name === 'UNKNOWN_EXCEPTION' || err.name === 'PACKAGE_UNAVAILABLE';
}

export async function getInstallationStatus(
  subscriberPackageVersionId: string,
  installationKey: Nullable<string>,
  connection: Connection
): Promise<QueryResult<PackagingSObjects.SubscriberPackageVersion> | undefined> {
  let query = `SELECT Id, SubscriberPackageId, InstallValidationStatus FROM SubscriberPackageVersion WHERE Id ='${subscriberPackageVersionId}'`;

  if (installationKey) {
    query += ` AND InstallationKey ='${escapeInstallationKey(installationKey)}'`;
  }

  try {
    return await connection.tooling.query<SubscriberPackageVersion>(query);
  } catch (e) {
    if (e instanceof Error && isErrorPackageNotAvailable(e)) {
      getLogger().debug('getInstallationStatus:', e.name);
    } else {
      throw e;
    }
  }
}

export async function waitForPublish(
  connection: Connection,
  subscriberPackageVersionId: string,
  frequency?: number | Duration,
  timeout?: number | Duration,
  installationKey?: string | Nullable<string>
): Promise<void> {
  const pollingTimeout = numberToDuration(timeout);

  if (pollingTimeout.milliseconds <= 0) {
    return;
  }
  let queryResult: QueryResult<SubscriberPackageVersion> | undefined;
  let installValidationStatus: SubscriberPackageVersion['InstallValidationStatus'] = 'PACKAGE_UNAVAILABLE';
  const pollingOptions: PollingClient.Options = {
    frequency: numberToDuration(frequency),
    timeout: pollingTimeout,
    poll: async (): Promise<StatusResult> => {
      queryResult = await getInstallationStatus(subscriberPackageVersionId, installationKey, connection);

      // Continue retrying if there is no record
      // or for an InstallValidationStatus of PACKAGE_UNAVAILABLE (replication to the subscriber's instance has not completed)
      // or for an InstallValidationStatus of UNINSTALL_IN_PROGRESS

      if (queryResult?.records?.length) {
        installValidationStatus = queryResult.records[0].InstallValidationStatus;
      }
      getLogger().debug(installMsgs.getMessage('publishWaitProgress', [` Status = ${installValidationStatus}`]));
      await Lifecycle.getInstance().emit(PackageEvents.install['subscriber-status'], installValidationStatus);
      if (!['PACKAGE_UNAVAILABLE', 'UNINSTALL_IN_PROGRESS'].includes(installValidationStatus)) {
        return { completed: true, payload: installValidationStatus };
      }

      return { completed: false, payload: installValidationStatus };
    },
  };

  const pollingClient = await PollingClient.create(pollingOptions);

  try {
    getLogger().debug(`Polling for package availability in org. Package ID = ${subscriberPackageVersionId}`);
    getLogger().debug(`Polling frequency (ms): ${pollingOptions.frequency.milliseconds}`);
    getLogger().debug(`Polling timeout (min): ${pollingOptions.timeout.minutes}`);
    await pollingClient.subscribe();
  } catch (e) {
    // if polling timed out
    const error = installMsgs.createError('subscriberPackageVersionNotPublished');
    error.setData(queryResult?.records[0]);
    if (error.stack && e instanceof Error && e.stack) {
      getLogger().debug(`Error during waitForPublish polling:\n${e.stack}`);
      // append the original stack to this new error
      error.stack += `\nDUE TO:\n${e.stack}`;
      if (e.message) {
        error.actions = (error.actions ?? []).concat([e.message]);
      }
    }
    throw error;
  }
}

export async function pollStatus(
  connection: Connection,
  installRequestId: string,
  options: PackageInstallOptions = { pollingFrequency: 5000, pollingTimeout: 300000 }
): Promise<PackageInstallRequest> {
  let packageInstallRequest = await getStatus(connection, installRequestId);

  const { pollingFrequency, pollingTimeout } = options;
  const frequency = numberToDuration(pollingFrequency ?? 5000);
  const timeout = numberToDuration(pollingTimeout ?? 300000);

  const pollingOptions: PollingClient.Options = {
    frequency,
    timeout,
    poll: async (): Promise<StatusResult> => {
      packageInstallRequest = await getStatus(connection, installRequestId);
      getLogger().debug(installMsgs.getMessage('packageInstallPolling', [packageInstallRequest?.Status]));
      await Lifecycle.getInstance().emit(PackageEvents.install.status, packageInstallRequest);
      if (['SUCCESS', 'ERROR'].includes(packageInstallRequest?.Status)) {
        return { completed: true, payload: packageInstallRequest };
      }
      return { completed: false };
    },
  };

  const pollingClient = await PollingClient.create(pollingOptions);

  try {
    getLogger().debug(`Polling for PackageInstallRequest status. Package ID = ${installRequestId}`);
    getLogger().debug(`Polling frequency (ms): ${pollingOptions.frequency.milliseconds}`);
    getLogger().debug(`Polling timeout (min): ${pollingOptions.timeout.minutes}`);
    await pollingClient.subscribe();
    return packageInstallRequest;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : isString(e) ? e : 'polling timed out';
    const error = new SfError(errMsg, 'PackageInstallTimeout');
    error.setData(packageInstallRequest);
    if (error.stack && e instanceof Error && e.stack) {
      // add the original stack to this new error
      error.stack += `\nDUE TO:\n${e.stack}`;
    }
    if (e.message) {
      error.actions = (error.actions ?? []).concat([e.message]);
    }
    throw error;
  }
}
