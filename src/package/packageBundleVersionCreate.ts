/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as fs from 'node:fs';
import { Connection, SfError, SfProject } from '@salesforce/core';
import { BundleSObjects, BundleVersionCreateOptions } from '../interfaces';
import { massageErrorMessage } from '../utils/bundleUtils';
import { PackageBundleVersion } from './packageBundleVersion';

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
      const error = err instanceof Error ? err : new Error('Failed to get package bundle version create status');
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
    const queryResult = await connection.autoFetchQuery<BundleSObjects.QueryRecord>(query, { tooling: true });
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
      options.BundleVersionComponentsPath
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
          : new Error(typeof err === 'string' ? err : 'Failed to create package bundle version');
      throw SfError.wrap(massageErrorMessage(error));
    }

    if (!createResult?.success) {
      throw SfError.wrap(massageErrorMessage(new Error('Failed to create package bundle version')));
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

  private static readBundleVersionComponents(filePath: string): string[] {
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const bundleVersionComponents = JSON.parse(fileContent) as string[];
      if (!Array.isArray(bundleVersionComponents)) {
        throw new Error('Bundle version components must be an array of strings');
      }
      return bundleVersionComponents;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to read or parse bundle version components file');
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
      throw new Error(`No package bundle found with alias: ${packageBundle}`);
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
      throw new Error(`No bundle found with id: ${packageBundleId}`);
    }

    const bundleName = result.records[0].BundleName;
    const bundles = project.getSfProjectJson().getPackageBundles();
    const bundle = bundles.find((b) => b.name === bundleName);
    if (!bundle) {
      throw new Error(`No bundle found with name: ${bundleName}`);
    }
    const [major, minor] = bundle.versionNumber.split('.');
    if (!major || !minor) {
      throw new Error(`Invalid version number format: ${bundle.versionNumber}`);
    }
    return { MajorVersion: major, MinorVersion: minor };
  }
}
