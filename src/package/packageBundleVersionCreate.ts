/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as fs from 'node:fs';
import { Connection, Messages, SfError, SfProject } from '@salesforce/core';
import { BundleSObjects, BundleVersionCreateOptions } from '../interfaces';
import { massageErrorMessage } from '../utils/bundleUtils';
import { PackageBundleVersion } from './packageBundleVersion';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'bundle_version_create');

export class PackageBundleVersionCreate {
  public static async getCreateStatus(
    createPackageVersionRequestId: string,
    connection: Connection
  ): Promise<BundleSObjects.PackageBundleVersionCreateRequestResult> {
    try {
      const result = await connection.tooling
        .sobject('PkgBundleVersionCreateReq')
        .retrieve(createPackageVersionRequestId);
      return result as unknown as BundleSObjects.PackageBundleVersionCreateRequestResult;
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error(messages.getMessage('failedToGetPackageBundleVersionCreateStatus'));
      throw SfError.wrap(massageErrorMessage(error));
    }
  }

  public static async getCreateStatuses(
    connection: Connection,
    status?: BundleSObjects.PkgBundleVersionCreateReqStatus,
    createdLastDays?: number
  ): Promise<BundleSObjects.PackageBundleVersionCreateRequestResult[]> {
    let query =
      'SELECT Id, RequestStatus, PackageBundle.Id, PackageBundle.BundleName, PackageBundleVersion.Id, ' +
      'VersionName, MajorVersion, MinorVersion, Ancestor.Id, BundleVersionComponents, ' +
      'CreatedDate, CreatedById ' +
      'FROM PkgBundleVersionCreateReq';
    if (status && createdLastDays) {
      query += ` WHERE RequestStatus = '${status}' AND CreatedDate = LAST_N_DAYS: ${createdLastDays}`;
    } else if (status) {
      query += ` WHERE RequestStatus = '${status}'`;
    } else if (createdLastDays) {
      query += ` WHERE CreatedDate = LAST_N_DAYS: ${createdLastDays}`;
    }
    const queryResult = await connection.autoFetchQuery<BundleSObjects.PkgBundleVersionQueryRecord>(query, {
      tooling: true,
    });
    return queryResult.records.map((record) => ({
      Id: record.Id,
      RequestStatus: record.RequestStatus,
      PackageBundleId: record.PackageBundle?.Id ?? '',
      PackageBundleVersionId: record.PackageBundleVersion?.Id ?? '',
      VersionName: record.VersionName ?? '',
      MajorVersion: record.MajorVersion ?? '',
      MinorVersion: record.MinorVersion ?? '',
      Ancestor: record.Ancestor?.Id ?? '',
      BundleVersionComponents: record.BundleVersionComponents ?? '',
      CreatedDate: record.CreatedDate ?? '',
      CreatedById: record.CreatedById ?? '',
    }));
  }

  public static async createBundleVersion(
    connection: Connection,
    project: SfProject,
    options: BundleVersionCreateOptions
  ): Promise<BundleSObjects.PackageBundleVersionCreateRequestResult> {
    const bundleVersionComponents = PackageBundleVersionCreate.readBundleVersionComponents(
      options.BundleVersionComponentsPath,
      project
    );
    const packageBundleId = PackageBundleVersionCreate.parsePackageBundleId(options.PackageBundle, project);
    const version = await PackageBundleVersionCreate.getPackageVersion(options, project, connection);

    const request: BundleSObjects.PkgBundleVersionCreateReq = {
      PackageBundleId: packageBundleId,
      VersionName: PackageBundleVersionCreate.getVersionName(
        options.PackageBundle,
        version.MajorVersion,
        version.MinorVersion
      ),
      MajorVersion: version.MajorVersion,
      MinorVersion: version.MinorVersion,
      BundleVersionComponents: JSON.stringify(bundleVersionComponents),
      ...(options.Ancestor ? { Ancestor: options.Ancestor } : {}),
    };
    let createResult;
    try {
      createResult = await connection.tooling.sobject('PkgBundleVersionCreateReq').create(request);
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error(typeof err === 'string' ? err : messages.getMessage('failedToCreatePackageBundleVersion'));
      throw SfError.wrap(massageErrorMessage(error));
    }

    if (!createResult?.success) {
      throw SfError.wrap(massageErrorMessage(new Error(messages.getMessage('failedToCreatePackageBundleVersion'))));
    }

    if (options.polling) {
      return PackageBundleVersion.pollCreateStatus(createResult.id, connection, project, options.polling);
    }

    return {
      Id: createResult.id,
      PackageBundleVersionId: createResult.id,
      PackageBundleId: packageBundleId,
      VersionName: PackageBundleVersionCreate.getVersionName(
        options.PackageBundle,
        version.MajorVersion,
        version.MinorVersion
      ),
      MajorVersion: version.MajorVersion,
      MinorVersion: version.MinorVersion,
      BundleVersionComponents: JSON.stringify(bundleVersionComponents),
      RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
      CreatedDate: new Date().toISOString(),
      CreatedById: connection.getUsername() ?? 'unknown',
    };
  }

  private static readBundleVersionComponents(filePath: string, project: SfProject): string[] {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const bundleVersionComponents = JSON.parse(fileContent) as Array<{ packageVersion: string }>;
      if (!Array.isArray(bundleVersionComponents)) {
        throw new Error(messages.getMessage('bundleVersionComponentsMustBeArray'));
      }

      // Validate that each item has the required packageVersion property
      for (const component of bundleVersionComponents) {
        if (!component || typeof component !== 'object' || !component.packageVersion) {
          throw new Error(messages.getMessage('bundleVersionComponentMustBeObject'));
        }
      }

      // Process each component to get the package version ID
      return bundleVersionComponents.map((component) => {
        const packageVersion = component.packageVersion;

        // Check if it's already an ID (04t followed by 15 characters)
        if (/^04t[a-zA-Z0-9]{15}$/.test(packageVersion)) {
          return packageVersion;
        }

        // Otherwise, treat it as an alias and resolve it from sfdx-project.json
        const packageVersionId = project.getPackageIdFromAlias(packageVersion);
        if (!packageVersionId) {
          throw new Error(messages.getMessage('noPackageVersionFoundWithAlias', [packageVersion]));
        }

        return packageVersionId;
      });
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error(messages.getMessage('failedToReadBundleVersionComponentsFile'));
      throw SfError.wrap(massageErrorMessage(error));
    }
  }

  private static getVersionName(packageBundle: string, majorVersion: string, minorVersion: string): string {
    return `${packageBundle}@${majorVersion}.${minorVersion}`;
  }

  private static parsePackageBundleId(packageBundle: string, project: SfProject): string {
    if (/^1Fl.{15}$/.test(packageBundle)) {
      return packageBundle;
    }
    const bundleId = project.getPackageBundleIdFromAlias(packageBundle);
    if (!bundleId) {
      throw new Error(messages.getMessage('noPackageBundleFoundWithAlias', [packageBundle]));
    }
    return bundleId;
  }

  private static async getPackageVersion(
    options: BundleVersionCreateOptions,
    project: SfProject,
    connection: Connection
  ): Promise<{ MajorVersion: string; MinorVersion: string }> {
    const packageBundleId = PackageBundleVersionCreate.parsePackageBundleId(options.PackageBundle, project);

    const query = `SELECT BundleName FROM PackageBundle WHERE Id = '${packageBundleId}'`;
    const result = await connection.tooling.query<{ BundleName: string }>(query);

    if (!result.records || result.records.length === 0) {
      throw new Error(messages.getMessage('noBundleFoundWithId', [packageBundleId]));
    }

    const bundleName = result.records[0].BundleName;
    const bundles = project.getSfProjectJson().getPackageBundles();
    const bundle = bundles.find((b) => b.name === bundleName);
    if (!bundle) {
      throw new Error(messages.getMessage('noBundleFoundWithName', [bundleName]));
    }
    const [major, minor] = bundle.versionNumber.split('.');
    if (!major || !minor) {
      throw new Error(messages.getMessage('invalidVersionNumberFormat', [bundle.versionNumber]));
    }

    // Check if major is an integer
    const majorInt = parseInt(major, 10);
    if (isNaN(majorInt) || majorInt.toString() !== major) {
      throw new Error(messages.getMessage('invalidVersionNumberFormat', [bundle.versionNumber]));
    }

    // Check if minor is either an integer or "next"
    if (minor === 'NEXT') {
      // Query existing bundle versions to find the highest minor version for this major version
      const bundleVersionQuery =
        'SELECT Id, PackageBundle.Id, PackageBundle.BundleName, VersionName, MajorVersion, MinorVersion, IsReleased ' +
        'FROM PackageBundleVersion ' +
        `WHERE PackageBundle.BundleName = '${bundleName}' AND MajorVersion = ${major} ` +
        'ORDER BY MinorVersion DESC LIMIT 1';

      const queryResult = await connection.tooling.query<{
        Id: string;
        PackageBundle: { Id: string; BundleName: string };
        VersionName: string;
        MajorVersion: string;
        MinorVersion: string;
        IsReleased: boolean;
      }>(bundleVersionQuery);

      if (queryResult.records && queryResult.records.length > 0) {
        const highestRecord = queryResult.records[0];

        // Get the highest minor version and add 1
        const highestMinorVersion = parseInt(highestRecord.MinorVersion, 10);
        if (isNaN(highestMinorVersion)) {
          throw new Error(messages.getMessage('invalidMinorVersionInExisting', [highestRecord.MinorVersion]));
        }

        const nextMinorVersion = (highestMinorVersion + 1).toString();
        return { MajorVersion: major, MinorVersion: nextMinorVersion };
      } else {
        // No existing versions found for this major version, start with .0
        return { MajorVersion: major, MinorVersion: '0' };
      }
    } else {
      const minorInt = parseInt(minor, 10);
      if (isNaN(minorInt) || minorInt.toString() !== minor) {
        throw new Error(messages.getMessage('invalidVersionNumberFormat', [bundle.versionNumber]));
      }
    }

    return { MajorVersion: major, MinorVersion: minor };
  }
}
