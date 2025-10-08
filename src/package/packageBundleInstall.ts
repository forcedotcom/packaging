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
import { Connection, Messages, SfError, SfProject, PollingClient, StatusResult } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { BundleSObjects, BundleInstallOptions } from '../interfaces';
import { massageErrorMessage } from '../utils/bundleUtils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'bundle_install');

export class PackageBundleInstall {
  public static async getInstallStatus(
    installRequestId: string,
    connection: Connection
  ): Promise<BundleSObjects.PkgBundleVersionInstallReqResult> {
    try {
      const query =
        'SELECT Id, InstallStatus, PackageBundleVersionID, DevelopmentOrganization, ValidationError, ' +
        'CreatedDate, CreatedById ' +
        `FROM PkgBundleVersionInstallReq WHERE Id = '${installRequestId}'`;
      
      const queryResult = await connection.autoFetchQuery<BundleSObjects.PkgBundleVersionInstallQueryRecord>(query, {
        tooling: true,
      });
      
      if (!queryResult.records || queryResult.records.length === 0) {
        throw new Error(messages.getMessage('failedToGetPackageBundleInstallStatus'));
      }
      
      const record = queryResult.records[0];
      return {
        Id: record.Id,
        InstallStatus: record.InstallStatus,
        PackageBundleVersionID: record.PackageBundleVersionID ?? '',
        DevelopmentOrganization: record.DevelopmentOrganization ?? '',
        ValidationError: record.ValidationError ?? '',
        CreatedDate: record.CreatedDate ?? '',
        CreatedById: record.CreatedById ?? '',
      };
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error(messages.getMessage('failedToGetPackageBundleInstallStatus'));
      throw SfError.wrap(massageErrorMessage(error));
    }
  }

  public static async getInstallStatuses(
    connection: Connection,
    status?: BundleSObjects.PkgBundleVersionInstallReqStatus,
    createdLastDays?: number
  ): Promise<BundleSObjects.PkgBundleVersionInstallReqResult[]> {
    let query =
      'SELECT Id, InstallStatus, PackageBundleVersionID, DevelopmentOrganization, ValidationError, ' +
      'CreatedDate, CreatedById ' +
      'FROM PkgBundleVersionInstallReq';
    if (status && createdLastDays) {
      query += ` WHERE InstallStatus = '${status}' AND CreatedDate = LAST_N_DAYS: ${createdLastDays}`;
    } else if (status) {
      query += ` WHERE InstallStatus = '${status}'`;
    } else if (createdLastDays) {
      query += ` WHERE CreatedDate = LAST_N_DAYS: ${createdLastDays}`;
    }
    const queryResult = await connection.autoFetchQuery<BundleSObjects.PkgBundleVersionInstallQueryRecord>(query, {
      tooling: true,
    });
    return queryResult.records.map((record) => ({
      Id: record.Id,
      InstallStatus: record.InstallStatus,
      PackageBundleVersionID: record.PackageBundleVersionID ?? '',
      DevelopmentOrganization: record.DevelopmentOrganization ?? '',
      ValidationError: record.ValidationError ?? '',
      CreatedDate: record.CreatedDate ?? '',
      CreatedById: record.CreatedById ?? '',
    }));
  }

  public static async installBundle(
    connection: Connection,
    project: SfProject,
    options: BundleInstallOptions
  ): Promise<BundleSObjects.PkgBundleVersionInstallReqResult> {
    const packageBundleVersionId = PackageBundleInstall.parsePackageBundleVersionId(
      options.PackageBundleVersion,
      project
    );

    const request: BundleSObjects.PkgBundleVersionInstallReq = {
      PackageBundleVersionID: packageBundleVersionId,
      DevelopmentOrganization: options.DevelopmentOrganization,
    };
    let installResult;
    try {
      installResult = await connection.tooling.sobject('PkgBundleVersionInstallReq').create(request);
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error(typeof err === 'string' ? err : messages.getMessage('failedToInstallPackageBundle'));
      throw SfError.wrap(massageErrorMessage(error));
    }

    if (!installResult?.success) {
      throw SfError.wrap(massageErrorMessage(new Error(messages.getMessage('failedToInstallPackageBundle'))));
    }

    if (options.polling) {
      return PackageBundleInstall.pollInstallStatus(installResult.id, connection, options.polling);
    }

    return {
      Id: installResult.id,
      PackageBundleVersionID: packageBundleVersionId,
      DevelopmentOrganization: options.DevelopmentOrganization,
      InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.queued,
      ValidationError: '',
      CreatedDate: new Date().toISOString(),
      CreatedById: connection.getUsername() ?? 'unknown',
    };
  }

  private static parsePackageBundleVersionId(packageBundleVersion: string, project: SfProject): string {
    // Check if it's already an ID (starts with appropriate prefix)
    if (/^1Q8.{15}$/.test(packageBundleVersion)) {
      return packageBundleVersion;
    }

    // Otherwise, treat it as an alias and resolve it from sfdx-project.json
    const packageBundleVersionId = project.getPackageBundleIdFromAlias(packageBundleVersion);
    if (!packageBundleVersionId) {
      throw new SfError(messages.getMessage('noPackageBundleVersionFoundWithAlias', [packageBundleVersion]));
    }
    return packageBundleVersionId;
  }

  private static async pollInstallStatus(
    installRequestId: string,
    connection: Connection,
    polling: { timeout: Duration; frequency: Duration }
  ): Promise<BundleSObjects.PkgBundleVersionInstallReqResult> {
    if (polling.timeout?.milliseconds <= 0) {
      return PackageBundleInstall.getInstallStatus(installRequestId, connection);
    }

    const pollingClient = await PollingClient.create({
      poll: async (): Promise<StatusResult> => {
        const status = await PackageBundleInstall.getInstallStatus(installRequestId, connection);
        if (status.InstallStatus === BundleSObjects.PkgBundleVersionInstallReqStatus.success) {
          return { completed: true, payload: status };
        }
        return { completed: false, payload: status };
      },
      frequency: polling.frequency,
      timeout: polling.timeout,
    });

    try {
      return await pollingClient.subscribe<BundleSObjects.PkgBundleVersionInstallReqResult>();
    } catch (err) {
      if (err instanceof Error) {
        throw new Error('Install request timed out');
      }
      throw err;
    }
  }
}
