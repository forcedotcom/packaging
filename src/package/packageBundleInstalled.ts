/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection } from '@salesforce/core';
import { Schema } from '@jsforce/jsforce-node';
import type { PackagingSObjects } from '../interfaces';
import { SubscriberPackageVersion } from './subscriberPackageVersion';
import { PackageBundleVersion } from './packageBundleVersion';

export type BundleComponentStatus = {
  subscriberPackageId: string;
  packageName: string;
  expectedVersionNumber: string;
  actualVersionNumber: string | null; // null -> Not Installed
  status: 'Match' | 'Mismatch' | 'Missing';
};

export type InstalledBundleStatus = {
  bundleId: string;
  bundleName: string;
  bundleVersionId: string;
  bundleVersionName: string;
  bundleVersionNumber: string; // Major.Minor
  components: BundleComponentStatus[];
  status: 'Synchronized' | 'Out of Sync' | 'Incomplete';
};

/**
 * Compute installed bundle status for a subscriber org by comparing expected components
 * from the Dev Hub (Bundle Version definition) with the actual installed packages in the subscriber org.
 * If bundleVersionIds is not provided, attempts to derive the set from InstalledPackageBundleVersion
 * in the subscriber org, falling back to successful install requests when necessary.
 */
export async function getInstalledBundleStatuses(
  subscriberConn: Connection,
  devHubConn: Connection,
  bundleVersionIds?: string[]
): Promise<InstalledBundleStatus[]> {
  let ids: string[] = bundleVersionIds ?? [];
  if (ids.length === 0) {
    // Preferred: InstalledPackageBundleVersion in subscriber org
    try {
      const query =
        'SELECT Id, PackageBundleVersion.Id FROM InstalledPackageBundleVersion ORDER BY CreatedDate DESC';
      const ipbv = await subscriberConn.tooling.query<{ Id: string; PackageBundleVersion?: { Id: string } }>(query);
      const set = new Set<string>();
      for (const r of ipbv.records) {
        const id = r.PackageBundleVersion?.Id;
        if (id) set.add(id);
      }
      ids = [...set];
    } catch {
      // Fallback: successful install requests
      const irQuery =
        "SELECT PackageBundleVersionID FROM PkgBundleVersionInstallReq WHERE InstallStatus = 'Success'";
      const reqs = await subscriberConn.autoFetchQuery<{ PackageBundleVersionID?: string } & Schema>(
        irQuery,
        { tooling: true }
      );
      const set = new Set<string>();
      for (const r of reqs.records) if (r.PackageBundleVersionID) set.add(r.PackageBundleVersionID);
      ids = [...set];
    }
  }

  if (ids.length === 0) return [];

  const installed = await SubscriberPackageVersion.installedList(subscriberConn);
  const installedByPackageId = new Map(installed.map((r) => [r.SubscriberPackageId, r]));

  const results = await Promise.all(
    ids.map(async (bundleVersionId): Promise<InstalledBundleStatus | null> => {
      const versionMeta = await PackageBundleVersion.report(devHubConn, bundleVersionId);
      if (!versionMeta) return null;

      const components = await PackageBundleVersion.getComponentPackages(devHubConn, bundleVersionId);

      const componentStatuses: BundleComponentStatus[] = components.map(
        (comp: PackagingSObjects.SubscriberPackageVersion) => {
          const expectedVersion = `${comp.MajorVersion}.${comp.MinorVersion}.${comp.PatchVersion}.${comp.BuildNumber}`;
          const installedPkg = comp.SubscriberPackageId
            ? installedByPackageId.get(comp.SubscriberPackageId)
            : undefined;
          if (!installedPkg) {
            return {
              subscriberPackageId: comp.SubscriberPackageId,
              packageName: comp.Name ?? '',
              expectedVersionNumber: expectedVersion,
              actualVersionNumber: null,
              status: 'Missing',
            };
          }
          const actualVersion = installedPkg.SubscriberPackageVersion
            ? `${installedPkg.SubscriberPackageVersion.MajorVersion}.${installedPkg.SubscriberPackageVersion.MinorVersion}.${installedPkg.SubscriberPackageVersion.PatchVersion}.${installedPkg.SubscriberPackageVersion.BuildNumber}`
            : '';
          return {
            subscriberPackageId: comp.SubscriberPackageId,
            packageName: installedPkg.SubscriberPackage?.Name ?? comp.Name ?? '',
            expectedVersionNumber: expectedVersion,
            actualVersionNumber: actualVersion || null,
            status: actualVersion === expectedVersion ? 'Match' : 'Mismatch',
          };
        }
      );

      const hasMissing = componentStatuses.some((c) => c.status === 'Missing');
      const hasMismatch = componentStatuses.some((c) => c.status === 'Mismatch');

      return {
        bundleId: versionMeta.PackageBundle.Id,
        bundleName: versionMeta.PackageBundle.BundleName,
        bundleVersionId,
        bundleVersionName: versionMeta.VersionName,
        bundleVersionNumber: `${versionMeta.MajorVersion}.${versionMeta.MinorVersion}`,
        components: componentStatuses,
        status: hasMissing ? 'Incomplete' : hasMismatch ? 'Out of Sync' : 'Synchronized',
      };
    })
  );

  return results.filter((r): r is InstalledBundleStatus => r !== null);
}


