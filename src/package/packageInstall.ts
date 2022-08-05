/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Lifecycle, Logger, Messages, PollingClient, SfError, StatusResult } from '@salesforce/core';
import { isString, isNumber, Optional } from '@salesforce/ts-types';
import { QueryResult } from 'jsforce';
import { Duration } from '@salesforce/kit';
import { PackagingSObjects } from '../interfaces';
import {
  isErrorFromSPVQueryRestriction,
  isErrorPackageNotAvailable,
  getPackageTypeBy04t,
  escapeInstallationKey,
} from '../utils/packageUtils';
import { consts } from '../constants';
import { PackageInstallOptions, PackageInstallCreateRequest } from '../interfaces/packagingInterfacesAndType';

import SubscriberPackageVersion = PackagingSObjects.SubscriberPackageVersion;
import PackageInstallRequest = PackagingSObjects.PackageInstallRequest;

Messages.importMessagesDirectory(__dirname);
const installMsgs = Messages.loadMessages('@salesforce/packaging', 'package-install');

let logger: Logger;
const getLogger = (): Logger => {
  if (!logger) {
    logger = Logger.childFromRoot('installPackage');
  }
  return logger;
};

export async function installPackage(
  connection: Connection,
  pkgInstallCreateRequest: PackageInstallCreateRequest,
  options?: PackageInstallOptions
): Promise<PackageInstallRequest> {
  const defaults = {
    ApexCompileType: 'all',
    EnableRss: false,
    NameConflictResolution: 'Block',
    PackageInstallSource: 'U',
    SecurityType: 'none',
    UpgradeType: 'mixed-mode',
  };

  const request = Object.assign({}, defaults, pkgInstallCreateRequest);
  if (request.Password) {
    request.Password = escapeInstallationKey(request.Password);
  }

  const pkgType = await getPackageTypeBy04t(request.SubscriberPackageVersionKey, connection, request.Password);

  // Only unlocked packages can change the UpgradeType and ApexCompile options from the defaults.
  if (pkgType !== 'Unlocked') {
    if (request.UpgradeType !== defaults.UpgradeType) {
      const msg = installMsgs.getMessage('upgradeTypeOnlyForUnlockedWarning');
      await Lifecycle.getInstance().emit('PackageInstallRequest:warning', msg);
      delete request.UpgradeType;
    }
    if (request.ApexCompileType !== defaults.ApexCompileType) {
      const msg = installMsgs.getMessage('apexCompileOnlyForUnlockedWarning');
      await Lifecycle.getInstance().emit('PackageInstallRequest:warning', msg);
      delete request.ApexCompileType;
    }
  }

  await Lifecycle.getInstance().emit('PackageInstallRequest:presend', request);

  const result = await connection.tooling.create('PackageInstallRequest', request);

  await Lifecycle.getInstance().emit('PackageInstallRequest:postsend', result);

  const packageInstallRequestId = result.id;
  if (!packageInstallRequestId) {
    throw installMsgs.createError('packageInstallRequestError', [
      request.SubscriberPackageVersionKey,
      result.errors.toString(),
    ]);
  }

  if (options?.pollingTimeout == null) {
    return getStatus(connection, packageInstallRequestId);
  } else {
    return pollStatus(connection, packageInstallRequestId, options);
  }
}

/**
 * Returns an array of RSS and CSP external sites for the package.
 *
 * @param connection The `Connection` object to the org.
 * @param subscriberPackageVersionId The ID of the subscriber package version (begins with "04t")
 * @param installationKey The installation key (if any) for the subscriber package version.
 * @returns an array of RSS and CSP site URLs, or undefined if the package doesn't have any.
 */
export async function getExternalSites(
  connection: Connection,
  subscriberPackageVersionId: string,
  installationKey?: string
): Promise<Optional<string[]>> {
  const installKey = escapeInstallationKey(installationKey);
  const queryNoKey = `SELECT RemoteSiteSettings, CspTrustedSites FROM SubscriberPackageVersion WHERE Id ='${subscriberPackageVersionId}'`;
  const queryWithKey = `SELECT RemoteSiteSettings, CspTrustedSites FROM SubscriberPackageVersion WHERE Id ='${subscriberPackageVersionId}' AND InstallationKey ='${installKey}'`;

  let queryResult: QueryResult<SubscriberPackageVersion>;
  try {
    getLogger().debug(`Checking package: [${subscriberPackageVersionId}] for external sites`);
    queryResult = await connection.tooling.query<SubscriberPackageVersion>(queryWithKey);
  } catch (e) {
    // First check for Implementation Restriction error that is enforced in 214, before it was possible to query
    // against InstallationKey, otherwise surface the error.
    if (e instanceof Error && isErrorFromSPVQueryRestriction(e)) {
      queryResult = await connection.tooling.query<SubscriberPackageVersion>(queryNoKey);
    } else {
      throw e;
    }
  }

  if (queryResult?.records?.length > 0) {
    const record = queryResult.records[0];
    const rssUrls = record.RemoteSiteSettings.settings.map((rss) => rss.url);
    const cspUrls = record.CspTrustedSites.settings.map((csp) => csp.endpointUrl);

    const sites = [...rssUrls, ...cspUrls];
    if (sites.length) {
      return sites;
    }
  }
}

export async function getStatus(connection: Connection, installRequestId: string): Promise<PackageInstallRequest> {
  const result = await connection.tooling.retrieve('PackageInstallRequest', installRequestId);

  return result as unknown as PackageInstallRequest;
}

// internal
async function pollStatus(
  connection: Connection,
  installRequestId: string,
  options: PackageInstallOptions
): Promise<PackageInstallRequest> {
  let packageInstallRequest: PackageInstallRequest;

  const { pollingFrequency, pollingTimeout } = options;
  let frequency: Duration;
  if (pollingFrequency != null) {
    frequency = isNumber(pollingFrequency) ? Duration.milliseconds(pollingFrequency) : pollingFrequency;
  } else {
    frequency = Duration.milliseconds(consts.PACKAGE_INSTALL_POLL_FREQUENCY);
  }

  let timeout: Duration;
  if (pollingTimeout != null) {
    timeout = isNumber(pollingTimeout) ? Duration.minutes(pollingTimeout) : pollingTimeout;
  } else {
    timeout = Duration.minutes(consts.PACKAGE_INSTALL_POLL_TIMEOUT);
  }

  const pollingOptions: Partial<PollingClient.Options> = {
    frequency,
    timeout,
    poll: async (): Promise<StatusResult> => {
      packageInstallRequest = await getStatus(connection, installRequestId);
      getLogger().debug(installMsgs.getMessage('packageInstallPolling', [packageInstallRequest?.Status]));
      await Lifecycle.getInstance().emit('PackageInstallRequest:status', packageInstallRequest);
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
    if (error.stack && e.stack) {
      // add the original stack to this new error
      error.stack += `\nDUE TO:\n${e.stack}`;
    }
    throw error;
  }
}

export async function waitForPublish(
  connection: Connection,
  subscriberPackageVersionId: string,
  timeout: number | Duration,
  installationKey?: string
): Promise<void> {
  let queryResult: QueryResult<SubscriberPackageVersion>;

  const pollingOptions: Partial<PollingClient.Options> = {
    frequency: Duration.milliseconds(consts.PACKAGE_INSTALL_POLL_FREQUENCY),
    timeout: isNumber(timeout) ? Duration.minutes(timeout) : timeout,
    poll: async (): Promise<StatusResult> => {
      const QUERY_NO_KEY = `SELECT Id, SubscriberPackageId, InstallValidationStatus FROM SubscriberPackageVersion WHERE Id ='${subscriberPackageVersionId}'`;

      try {
        const escapedInstallationKey = installationKey ? escapeInstallationKey(installationKey) : null;
        const queryWithKey = `${QUERY_NO_KEY} AND InstallationKey ='${escapedInstallationKey}'`;
        queryResult = await connection.tooling.query<SubscriberPackageVersion>(queryWithKey);
      } catch (e) {
        // Check first for Implementation Restriction error that is enforced in 214, before it was possible to query
        // against InstallationKey, otherwise surface the error.
        if (e instanceof Error && isErrorFromSPVQueryRestriction(e)) {
          queryResult = await connection.tooling.query<SubscriberPackageVersion>(QUERY_NO_KEY);
        } else {
          if (e instanceof Error && !isErrorPackageNotAvailable(e)) {
            throw e;
          }
        }
      }

      // Continue retrying if there is no record
      // or for an InstallValidationStatus of PACKAGE_UNAVAILABLE (replication to the subscriber's instance has not completed)
      // or for an InstallValidationStatus of UNINSTALL_IN_PROGRESS
      let installValidationStatus: SubscriberPackageVersion['InstallValidationStatus'];
      if (queryResult?.records?.length) {
        installValidationStatus = queryResult.records[0].InstallValidationStatus;
        await Lifecycle.getInstance().emit('SubscriberPackageVersion:status', installValidationStatus);
        if (!['PACKAGE_UNAVAILABLE', 'UNINSTALL_IN_PROGRESS'].includes(installValidationStatus)) {
          return { completed: true, payload: queryResult };
        }
      }
      const tokens = installValidationStatus ? [` Status = ${installValidationStatus}`] : [];
      getLogger().debug(installMsgs.getMessage('publishWaitProgress', tokens));
      await Lifecycle.getInstance().emit('SubscriberPackageVersion:status', installValidationStatus);
      return { completed: false, payload: queryResult };
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
    error.setData(queryResult);
    if (error.stack && e.stack) {
      // append the original stack to this new error
      error.stack += `\nDUE TO:\n${e.stack}`;
    }
    throw error;
  }
}
