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
import { Connection, Messages, SfError } from '@salesforce/core';
import { BundleSObjects } from '../interfaces';
import { massageErrorMessage } from '../utils/bundleUtils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'bundle_installed_list');

export class PackageBundleInstalledList {
  /**
   * Get all installed package bundles in the target org
   *
   * @param connection - Connection to the target org (where bundles are installed)
   * @returns Array of installed bundle versions with their component packages
   */
  public static async getInstalledBundles(
    connection: Connection
  ): Promise<BundleSObjects.InstalledPackageBundleVersion[]> {
    try {
      // Query InstalledPkgBundleVersion directly from the target org
      // Note: PackageBundle and PackageBundleVersion are CROSSORGFOREIGNKEY fields
      // Use CreatedDate and LastModifiedDate as proxies for InstalledDate and LastUpgradedDate
      const query =
        'SELECT Id, BundleName, BundleVersionName, MajorVersion, MinorVersion, ' +
        'PackageBundleId, PackageBundleVersionId, CreatedDate, LastModifiedDate ' +
        'FROM InstalledPkgBundleVersion ' +
        'ORDER BY CreatedDate DESC';

      const queryResult = await connection.autoFetchQuery<BundleSObjects.InstalledBundleRecord>(query, {
        tooling: true,
      });

      if (!queryResult.records || queryResult.records.length === 0) {
        return [];
      }

      // For each installed bundle, get component details
      const installedBundles = await Promise.all(
        queryResult.records.map(async (record) => {
          // Get component details from PkgBundleVersionComponentInstallReq
          // We need to find the install request that corresponds to this installed bundle
          const components = await PackageBundleInstalledList.getBundleComponents(connection, record.Id);

          return {
            Id: record.Id,
            BundleName: record.BundleName,
            BundleId: record.PackageBundleId ?? '',
            BundleVersionId: record.PackageBundleVersionId ?? '',
            BundleVersionName: record.BundleVersionName,
            MajorVersion: record.MajorVersion,
            MinorVersion: record.MinorVersion,
            Description: '',
            InstalledDate: record.CreatedDate ?? '',
            LastUpgradedDate: record.LastModifiedDate ?? record.CreatedDate ?? '',
            Components: components,
          };
        })
      );

      // Filter out any null results
      return installedBundles.filter(
        (bundle): bundle is BundleSObjects.InstalledPackageBundleVersion => bundle !== null
      );
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error(messages.getMessage('failedToGetInstalledBundles'));
      throw SfError.wrap(massageErrorMessage(error));
    }
  }

  /**
   * Get the component packages for a specific installed bundle
   *
   * @param connection - Connection to the target org
   * @param installedBundleVersionId - The InstalledPackageBundleVersion ID
   * @returns Array of components with expected and actual package versions
   */
  private static async getBundleComponents(
    connection: Connection,
    installedBundleVersionId: string
  ): Promise<BundleSObjects.InstalledPackageBundleVersionComponent[]> {
    // First find the install request that created this installed bundle
    const installRequestQuery =
      'SELECT Id ' +
      'FROM PkgBundleVersionInstallReq ' +
      `WHERE InstalledPkgBundleVersionId = '${installedBundleVersionId}' ` +
      'ORDER BY CreatedDate DESC LIMIT 1';

    const installRequestResult = await connection.autoFetchQuery<BundleSObjects.InstallRequestRecord>(
      installRequestQuery,
      {
        tooling: true,
      }
    );

    if (!installRequestResult.records || installRequestResult.records.length === 0) {
      return [];
    }

    const installRequestId = installRequestResult.records[0].Id;

    // Query expected packages from PkgBundleVerCpntIstlReq (abbreviated name)
    // These have SubscriberPackageVersion as a foreign key showing what was expected
    // Use InstalledComponent to get the actual package name from InstalledSubscriberPackage
    const componentQuery =
      'SELECT SubscriberPackageVersion.Id, SubscriberPackageVersion.SubscriberPackageId, ' +
      'SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion, ' +
      'SubscriberPackageVersion.PatchVersion, SubscriberPackageVersion.BuildNumber, ' +
      'InstalledComponent.SubscriberPackage.Name, ' +
      'SequenceOrder ' +
      'FROM PkgBundleVerCpntIstlReq ' +
      `WHERE PkgBundleVersionInstallReqId = '${installRequestId}' ` +
      'ORDER BY SequenceOrder';

    const componentResult = await connection.autoFetchQuery<BundleSObjects.BundleComponentInstallRecord>(
      componentQuery,
      {
        tooling: true,
      }
    );

    if (!componentResult.records || componentResult.records.length === 0) {
      return [];
    }

    // Query actual installed packages from the org
    const installedPackagesQuery =
      'SELECT Id, SubscriberPackageId, SubscriberPackage.Name, SubscriberPackageVersion.Id, ' +
      'SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion, ' +
      'SubscriberPackageVersion.PatchVersion, SubscriberPackageVersion.BuildNumber ' +
      'FROM InstalledSubscriberPackage ' +
      'ORDER BY SubscriberPackageId';

    const installedResult = await connection.autoFetchQuery<BundleSObjects.InstalledPackageRecord>(
      installedPackagesQuery,
      {
        tooling: true,
      }
    );

    // Create a map of actually installed packages by subscriber package ID
    const installedMap = new Map<string, { name: string; version: string }>();
    if (installedResult.records) {
      installedResult.records.forEach((pkg) => {
        const versionNumber = `${pkg.SubscriberPackageVersion.MajorVersion}.${pkg.SubscriberPackageVersion.MinorVersion}.${pkg.SubscriberPackageVersion.PatchVersion}.${pkg.SubscriberPackageVersion.BuildNumber}`;
        installedMap.set(pkg.SubscriberPackageId, {
          name: pkg.SubscriberPackage.Name,
          version: versionNumber,
        });
      });
    }

    // Compare expected vs actual
    return componentResult.records.map((record) => {
      // Expected (what the bundle was supposed to install)
      const expectedVersion = `${record.SubscriberPackageVersion.MajorVersion}.${record.SubscriberPackageVersion.MinorVersion}.${record.SubscriberPackageVersion.PatchVersion}.${record.SubscriberPackageVersion.BuildNumber}`;
      const expectedName = record.InstalledComponent?.SubscriberPackage?.Name ?? 'Unknown';
      const subscriberPackageId = record.SubscriberPackageVersion.SubscriberPackageId;

      // Actual (what's currently installed in the org)
      const installed = installedMap.get(subscriberPackageId);

      return {
        ExpectedPackageName: expectedName,
        ExpectedPackageVersionNumber: expectedVersion,
        ActualPackageName: installed ? installed.name : 'Uninstalled',
        ActualPackageVersionNumber: installed ? installed.version : 'N/A',
      };
    });
  }
}
