/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Lifecycle, Logger, Messages, PollingClient, SfError, StatusResult } from '@salesforce/core';
import { isString } from '@salesforce/ts-types';
import { QueryResult } from 'jsforce';
import { Duration } from '@salesforce/kit';
import { escapeInstallationKey, numberToDuration } from '../utils/packageUtils';
import {
  PackagingSObjects,
  PackageInstallCreateRequest,
  PackageEvents,
  PackageType,
  PackageInstallOptions,
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

  const request = Object.assign({}, defaults, pkgInstallCreateRequest);
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
  return (await connection.tooling.retrieve('PackageInstallRequest', packageInstallRequestId)) as PackageInstallRequest;
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
  installationKey: string,
  connection: Connection
): Promise<QueryResult<PackagingSObjects.SubscriberPackageVersion>> {
  const QUERY_NO_KEY = `SELECT Id, SubscriberPackageId, InstallValidationStatus FROM SubscriberPackageVersion WHERE Id ='${subscriberPackageVersionId}'`;

  const escapedInstallationKey = installationKey ? escapeInstallationKey(installationKey) : null;
  const queryWithKey = `${QUERY_NO_KEY} AND InstallationKey ='${escapedInstallationKey}'`;
  return connection.tooling.query<SubscriberPackageVersion>(queryWithKey);
}

export async function waitForPublish(
  connection: Connection,
  subscriberPackageVersionId: string,
  frequency: number | Duration,
  timeout: number | Duration,
  installationKey?: string
): Promise<void> {
  const pollingTimeout = numberToDuration(timeout || 0);

  if (pollingTimeout.milliseconds <= 0) {
    return;
  }
  let queryResult: QueryResult<SubscriberPackageVersion>;
  let installValidationStatus: SubscriberPackageVersion['InstallValidationStatus'];
  const pollingOptions: Partial<PollingClient.Options> = {
    frequency: numberToDuration(frequency || 0),
    timeout: pollingTimeout,
    poll: async (): Promise<StatusResult> => {
      queryResult = await getInstallationStatus(subscriberPackageVersionId, installationKey, connection);

      // Continue retrying if there is no record
      // or for an InstallValidationStatus of PACKAGE_UNAVAILABLE (replication to the subscriber's instance has not completed)
      // or for an InstallValidationStatus of UNINSTALL_IN_PROGRESS

      if (queryResult?.records?.length) {
        installValidationStatus = queryResult.records[0].InstallValidationStatus;
        await Lifecycle.getInstance().emit(PackageEvents.install['subscriber-status'], installValidationStatus);
        if (!['PACKAGE_UNAVAILABLE', 'UNINSTALL_IN_PROGRESS'].includes(installValidationStatus)) {
          return { completed: true, payload: installValidationStatus };
        }
      }
      const tokens = installValidationStatus ? [` Status = ${installValidationStatus}`] : [];
      getLogger().debug(installMsgs.getMessage('publishWaitProgress', tokens));
      await Lifecycle.getInstance().emit(PackageEvents.install['subscriber-status'], installValidationStatus);
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
    if (error.stack && (e as Error).stack) {
      // append the original stack to this new error
      error.stack += `\nDUE TO:\n${(e as Error).stack}`;
    }
    throw error;
  }
}

export async function pollStatus(
  connection: Connection,
  installRequestId: string,
  options: PackageInstallOptions
): Promise<PackageInstallRequest> {
  let packageInstallRequest: PackageInstallRequest;

  const { pollingFrequency, pollingTimeout } = options;
  const frequency = numberToDuration(pollingFrequency || 5000);

  const timeout = numberToDuration(pollingTimeout || 300000);

  const pollingOptions: Partial<PollingClient.Options> = {
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
    if (error.stack && (e as Error).stack) {
      // add the original stack to this new error
      error.stack += `\nDUE TO:\n${(e as Error).stack}`;
    }
    throw error;
  }
}
