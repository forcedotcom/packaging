/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Logger, Messages, PollingClient, SfError, StatusResult } from '@salesforce/core';
import { isString, Nullable, Optional } from '@salesforce/ts-types';
import { QueryResult } from 'jsforce';
import { Duration } from '@salesforce/kit';
import { PackagingSObjects } from '../interfaces';
import { isErrorFromSPVQueryRestriction, getPackageTypeBy04t } from '../utils/packageUtils';
import { consts } from '../constants';

import PackageVersion = PackagingSObjects.SubscriberPackageVersion;
import PackageInstallRequest = PackagingSObjects.PackageInstallRequest;
import PackageInstallCreateRequest = PackagingSObjects.PackageInstallCreateRequest;

// const QUERY_NO_KEY = `SELECT Id, SubscriberPackageId, InstallValidationStatus FROM SubscriberPackageVersion WHERE Id ='${this.allPackageVersionId}'`;
// const QUERY_WITH_KEY = `SELECT Id, SubscriberPackageId, InstallValidationStatus FROM SubscriberPackageVersion WHERE Id ='${this.allPackageVersionId}' AND InstallationKey ='${escapedInstallationKey}'`;

Messages.importMessagesDirectory(__dirname);
const installMsgs = Messages.loadMessages('@salesforce/packaging', 'package-install');

// apvId = context.flags.id ?? getPackageIdFromAlias(context.flags.package)
// this.allPackageVersionId = apvId;

// installKey (password) comes from a command flag; else it's null

export type PackageInstallOptions = {
  /**
   * The frequency to poll the org for package installation status. If providing a number
   * it is interpreted in milliseconds.
   */
  pollingFrequency: number | Duration;
  /**
   * The timeout in minutes to wait for package installation to complete. If providing a number
   * it is interpreted in minutes.
   */
  pollingTimeout: number | Duration;
};

let logger: Logger;

export async function installPackage(
  connection: Connection,
  pkgInstallRequest: PackageInstallCreateRequest,
  options: PackageInstallOptions
): Promise<PackageInstallRequest> {
  logger = Logger.childFromRoot('installPackage');
  const defaults = {
    ApexCompile: 'all',
    EnableRss: false,
    NameConflictResolution: 'Block',
    PackageInstallSource: 'U',
    SecurityType: 'AdminsOnly',
    UpgradeType: 'Mixed',
  };

  const request = Object.assign({}, defaults, pkgInstallRequest);
  if (request.Password) {
    request.Password = getEscapedInstallationKey(request.Password);
  }

  const pkgType = await getPackageTypeBy04t(request.SubscriberPackageVersionKey, connection, request.Password);

  // Only unlocked packages can change the UpgradeType and ApexCompile options from the defaults.
  if (pkgType !== 'Unlocked') {
    if (request.UpgradeType !== defaults.UpgradeType) {
      process.emitWarning(installMsgs.getMessage('upgradeTypeOnlyForUnlockedWarning'));
      delete request.UpgradeType;
    }
    if (request.ApexCompile !== defaults.ApexCompile) {
      process.emitWarning(installMsgs.getMessage('apexCompileOnlyForUnlockedWarning'));
      delete request.ApexCompile;
    }
  }

  const result = await connection.tooling.create('PackageInstallRequest', request);

  const packageInstallRequestId = result.id;
  if (!packageInstallRequestId) {
    throw installMsgs.createError('packageInstallRequestError', [
      request.SubscriberPackageVersionKey,
      result.errors.toString(),
    ]);
  }

  if (options.pollingTimeout === 0 && consts.PACKAGE_INSTALL_POLL_TIMEOUT === 0) {
    return getStatus(connection, packageInstallRequestId);
  } else {
    return pollStatus(connection, packageInstallRequestId, options);
  }
}

function getEscapedInstallationKey(key?: string): Nullable<string> {
  return key ? key.replace(/\\/g, '\\\\').replace(/'/g, "\\'") : null;
}

/**
 * Returns true/false depending on whether the package contains external sites (RSS/CSP).
 *
 * @param connection The `Connection` object to the org.
 * @param versionId The ID of the subscriber package version (begins with "04t")
 * @returns `true` if the package has external sites.
 */
export async function hasExternalSites(
  connection: Connection,
  subscriberPackageVersionId: string,
  installationKey?: string
): Promise<boolean> {
  // If the user is installing an unlocked package with external sites (RSS/CSP) then
  // inform and prompt the user of these sites for acknowledgement.
  // @TODO: move the prompt logic to the command
  const sites = await getExternalSites(connection, subscriberPackageVersionId, installationKey);
  return sites?.length > 0;

  // if (trustedSites?.length > 0) {
  //   const accepted = await this._prompt(
  //     context.flags.noprompt,
  //     messages.getMessage('promptRss', trustedSites.join('\n'), 'package_install')
  //   );
  //   if (accepted) {
  //     enableExternalSites = true;
  //   }
  // }
}

// internal
async function getExternalSites(
  connection: Connection,
  subscriberPackageVersionId: string,
  installationKey?: string
): Promise<Optional<string[]>> {
  const installKey = getEscapedInstallationKey(installationKey);
  const queryNoKey = `SELECT RemoteSiteSettings, CspTrustedSites FROM SubscriberPackageVersion WHERE Id ='${subscriberPackageVersionId}'`;
  const queryWithKey = `SELECT RemoteSiteSettings, CspTrustedSites FROM SubscriberPackageVersion WHERE Id ='${subscriberPackageVersionId}' AND InstallationKey ='${installKey}'`;

  let queryResult: QueryResult<PackageVersion>;
  try {
    logger.debug(`Checking package ${subscriberPackageVersionId} for external sites`);
    queryResult = await connection.tooling.query<PackageVersion>(queryWithKey);
  } catch (e) {
    // First check for Implementation Restriction error that is enforced in 214, before it was possible to query
    // against InstallationKey, otherwise surface the error.
    if (e instanceof Error && isErrorFromSPVQueryRestriction(e)) {
      queryResult = await connection.tooling.query<PackageVersion>(queryNoKey);
    } else {
      throw e;
    }
  }

  if (queryResult?.records?.length > 0) {
    const record = queryResult.records[0];
    const rssUrls = record.RemoteSiteSettings.settings.map((rss) => rss.url);
    const cspUrls = record.CspTrustedSites.settings.map((csp) => csp.endpointUrl);

    return [...rssUrls, ...cspUrls];
  }
}

async function getStatus(connection: Connection, installRequestId: string): Promise<PackageInstallRequest> {
  const result = (await connection.tooling.retrieve(
    'PackageInstallRequest',
    installRequestId
  )) as unknown as PackageInstallRequest;

  // @todo: what type is result???
  console.dir(result);

  return result;
}

// internal
async function pollStatus(
  connection: Connection,
  installRequestId: string,
  options: PackageInstallOptions
): Promise<PackageInstallRequest> {
  let packageInstallRequest: PackageInstallRequest;

  const { pollingFrequency, pollingTimeout } = options;
  const pollingOptions: Partial<PollingClient.Options> = {
    frequency: Duration.milliseconds(consts.PACKAGE_INSTALL_POLL_FREQUENCY),
    timeout: Duration.minutes(consts.PACKAGE_INSTALL_POLL_TIMEOUT),
    poll: async (): Promise<StatusResult> => {
      packageInstallRequest = await getStatus(connection, installRequestId);
      logger.debug(installMsgs.getMessage('packageInstallPolling', [packageInstallRequest.Status]));
      if (packageInstallRequest.Status === 'InProgress') {
        return { completed: false, payload: packageInstallRequest };
      }
      return { completed: true, payload: packageInstallRequest };
    },
  };
  if (pollingFrequency) {
    pollingOptions.frequency =
      pollingFrequency instanceof Duration ? pollingFrequency : Duration.milliseconds(pollingFrequency);
  }
  if (pollingTimeout) {
    pollingOptions.timeout = pollingTimeout instanceof Duration ? pollingTimeout : Duration.minutes(pollingTimeout);
  }

  const pollingClient = await PollingClient.create(pollingOptions);

  try {
    logger.debug(`Polling for PackageInstallRequest status. Package ID = ${installRequestId}`);
    logger.debug(`Polling frequency (ms): ${pollingOptions.frequency.milliseconds}`);
    logger.debug(`Polling timeout (min): ${pollingOptions.timeout.minutes}`);
    await pollingClient.subscribe();
    return packageInstallRequest;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : isString(e) ? e : 'polling timed out';
    const error = new SfError(errMsg, 'PackageInstallTimeout');
    error.setData(packageInstallRequest);
    if (error.stack && e.stack) {
      // append the original stack to this new error
      error.stack += `\nDUE TO:\n${e.stack}`;
    }
    throw error;
  }
}
