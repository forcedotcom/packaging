/*
 * Copyright 2025, Salesforce, Inc.
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
import { Connection, Lifecycle, Messages, PollingClient, SfError, SfProject, StatusResult } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { BundleSObjects, BundleUninstallOptions } from '../interfaces';
import { massageErrorMessage } from '../utils/bundleUtils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'bundle_uninstall');
const installMessages = Messages.loadMessages('@salesforce/packaging', 'bundle_install');

export class PackageBundleUninstall {
  public static async getUninstallStatus(
    uninstallRequestId: string,
    connection: Connection
  ): Promise<BundleSObjects.PkgBundleVerUninstallReqResult> {
    try {
      const query =
        'SELECT Id, UninstallStatus, PackageBundleVersionId, InstalledPkgBundleVersionId, ValidationError, ' +
        'CreatedDate, CreatedById ' +
        `FROM PkgBundleVerUninstallReq WHERE Id = '${uninstallRequestId}'`;

      const queryResult = await connection.autoFetchQuery<BundleSObjects.PkgBundleVerUninstallReqQueryRecord>(query, {
        tooling: true,
      });

      if (!queryResult.records || queryResult.records.length === 0) {
        throw new Error(messages.getMessage('failedToGetPackageBundleUninstallStatus'));
      }

      const record = queryResult.records[0];

      return {
        Id: record.Id,
        UninstallStatus: record.UninstallStatus,
        PackageBundleVersionId: record.PackageBundleVersionId ?? '',
        InstalledPkgBundleVersionId: record.InstalledPkgBundleVersionId ?? '',
        ValidationError: record.ValidationError ?? '',
        CreatedDate: record.CreatedDate ?? '',
        CreatedById: record.CreatedById ?? '',
        Error: record.Error,
      };
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error(messages.getMessage('failedToGetPackageBundleUninstallStatus'));
      throw SfError.wrap(massageErrorMessage(error));
    }
  }

  public static async getUninstallStatuses(
    connection: Connection,
    status?: BundleSObjects.PkgBundleVersionUninstallReqStatus,
    createdLastDays?: number
  ): Promise<BundleSObjects.PkgBundleVerUninstallReqResult[]> {
    let query =
      'SELECT Id, UninstallStatus, PackageBundleVersionId, InstalledPkgBundleVersionId, ValidationError, ' +
      'CreatedDate, CreatedById ' +
      'FROM PkgBundleVerUninstallReq';

    if (status && createdLastDays) {
      query += ` WHERE UninstallStatus = '${status}' AND CreatedDate = LAST_N_DAYS: ${createdLastDays}`;
    } else if (status) {
      query += ` WHERE UninstallStatus = '${status}'`;
    } else if (createdLastDays) {
      query += ` WHERE CreatedDate = LAST_N_DAYS: ${createdLastDays}`;
    }

    const queryResult = await connection.autoFetchQuery<BundleSObjects.PkgBundleVerUninstallReqQueryRecord>(query, {
      tooling: true,
    });

    return queryResult.records.map((record) => ({
      Id: record.Id,
      UninstallStatus: record.UninstallStatus,
      PackageBundleVersionId: record.PackageBundleVersionId ?? '',
      InstalledPkgBundleVersionId: record.InstalledPkgBundleVersionId ?? '',
      ValidationError: record.ValidationError ?? '',
      CreatedDate: record.CreatedDate ?? '',
      CreatedById: record.CreatedById ?? '',
      Error: record.Error,
    }));
  }

  public static async uninstallBundle(
    connection: Connection,
    project: SfProject,
    options: BundleUninstallOptions
  ): Promise<BundleSObjects.PkgBundleVerUninstallReqResult> {
    const packageBundleVersionId = PackageBundleUninstall.parsePackageBundleVersionId(
      options.PackageBundleVersion,
      project
    );

    const request: BundleSObjects.PkgBundleVerUninstallReq = {
      PackageBundleVersionId: packageBundleVersionId,
    };

    let uninstallResult;
    try {
      uninstallResult = await connection.tooling.sobject('PkgBundleVerUninstallReq').create(request);
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error(typeof err === 'string' ? err : messages.getMessage('failedToUninstallPackageBundle'));
      throw SfError.wrap(massageErrorMessage(error));
    }

    if (!uninstallResult?.success) {
      throw SfError.wrap(massageErrorMessage(new Error(messages.getMessage('failedToUninstallPackageBundle'))));
    }

    if (options.polling) {
      return PackageBundleUninstall.pollUninstallStatus(uninstallResult.id, connection, options.polling);
    }

    // When not polling, query the actual status from the server to get accurate information
    return PackageBundleUninstall.getUninstallStatus(uninstallResult.id, connection);
  }

  private static parsePackageBundleVersionId(packageBundleVersion: string, project: SfProject): string {
    // Check if it's already an ID (starts with appropriate prefix)
    if (/^1Q8.{15}$/.test(packageBundleVersion)) {
      return packageBundleVersion;
    }

    // Otherwise, treat it as an alias and resolve it from sfdx-project.json
    const packageBundleVersionId = project.getPackageBundleIdFromAlias(packageBundleVersion);
    if (!packageBundleVersionId) {
      throw new SfError(installMessages.getMessage('noPackageBundleVersionFoundWithAlias', [packageBundleVersion]));
    }
    return packageBundleVersionId;
  }

  private static async pollUninstallStatus(
    uninstallRequestId: string,
    connection: Connection,
    polling: { timeout: Duration; frequency: Duration }
  ): Promise<BundleSObjects.PkgBundleVerUninstallReqResult> {
    if (polling.timeout?.milliseconds <= 0) {
      return PackageBundleUninstall.getUninstallStatus(uninstallRequestId, connection);
    }

    let remainingWaitTime: Duration = polling.timeout;
    const pollingClient = await PollingClient.create({
      poll: async (): Promise<StatusResult> => {
        const report = await PackageBundleUninstall.getUninstallStatus(uninstallRequestId, connection);
        switch (report.UninstallStatus) {
          case BundleSObjects.PkgBundleVersionUninstallReqStatus.queued:
          case BundleSObjects.PkgBundleVersionUninstallReqStatus.inProgress:
            // Emit progress event for UI updates
            await Lifecycle.getInstance().emit('bundle-uninstall-progress', { ...report, remainingWaitTime });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - polling.frequency.seconds);
            return {
              completed: false,
              payload: report,
            };
          case BundleSObjects.PkgBundleVersionUninstallReqStatus.success:
            return { completed: true, payload: report };
          case BundleSObjects.PkgBundleVersionUninstallReqStatus.error:
            return { completed: true, payload: report };
          default:
            await Lifecycle.getInstance().emit('bundle-uninstall-progress', { ...report, remainingWaitTime });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - polling.frequency.seconds);
            return {
              completed: false,
              payload: report,
            };
        }
      },
      frequency: polling.frequency,
      timeout: polling.timeout,
    });

    try {
      return await pollingClient.subscribe<BundleSObjects.PkgBundleVerUninstallReqResult>();
    } catch (err) {
      const report = await PackageBundleUninstall.getUninstallStatus(uninstallRequestId, connection);
      if (err instanceof Error) {
        const timeoutError = new SfError(
          messages.getMessage('uninstallTimedOut', [uninstallRequestId]),
          'BundleUninstallTimeout'
        );
        timeoutError.setData({ UninstallRequestId: uninstallRequestId, ...report });
        throw timeoutError;
      }
      throw err;
    }
  }
}

