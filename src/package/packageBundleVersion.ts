/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Lifecycle, Messages, PollingClient, SfError, StatusResult } from '@salesforce/core';
import { SfProject } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { Schema } from '@jsforce/jsforce-node';
import { BundleVersionCreateOptions, BundleSObjects, PackageVersionEvents } from '../interfaces';
import { massageErrorMessage } from '../utils/bundleUtils';
import { applyErrorAction } from '../utils/packageUtils';
import { PackageBundleVersionCreate } from './packageBundleVersionCreate';

Messages.importMessagesDirectory(__dirname);

interface QueryRecord extends Schema {
  Id: string;
  PackageBundle?: {
    Id: string;
    BundleName: string;
    Description?: string;
    IsDeleted: boolean;
    CreatedDate: string;
    CreatedById: string;
    LastModifiedDate: string;
    LastModifiedById: string;
    SystemModstamp: string;
  };
  VersionName: string;
  MajorVersion: string;
  MinorVersion: string;
  IsReleased: boolean;
  Ancestor?: {
    Id: string;
    PackageBundle?: {
      Id: string;
      BundleName: string;
      Description?: string;
      IsDeleted: boolean;
      CreatedDate: string;
      CreatedById: string;
      LastModifiedDate: string;
      LastModifiedById: string;
      SystemModstamp: string;
    };
    VersionName: string;
    MajorVersion: string;
    MinorVersion: string;
  };
}

interface AncestorRecord {
  Id: string;
  PackageBundle?: {
    Id: string;
    BundleName: string;
    Description?: string;
    IsDeleted: boolean;
    CreatedDate: string;
    CreatedById: string;
    LastModifiedDate: string;
    LastModifiedById: string;
    SystemModstamp: string;
  };
  VersionName: string;
  MajorVersion: string;
  MinorVersion: string;
}

export class PackageBundleVersion {
  public static async create(
    options: BundleVersionCreateOptions,
    polling?: { frequency: Duration; timeout: Duration }
  ): Promise<BundleSObjects.PackageBundleVersionCreateRequestResult> {
    const createResult = await PackageBundleVersionCreate.createBundleVersion(
      options.connection,
      options.project,
      options
    );

    if (polling) {
      return PackageBundleVersion.pollCreateStatus(createResult.Id, options.connection, options.project, polling).catch(
        (error: SfError) => {
          if (error.name === 'PollingClientTimeout') {
            const modifiedError = new SfError(error.message);
            modifiedError.setData({ VersionCreateRequestId: createResult.Id });
            modifiedError.message += ` Run 'sf package bundle version create report -i ${createResult.Id}' to check the status.`;
            throw applyErrorAction(massageErrorMessage(modifiedError));
          }
          throw applyErrorAction(massageErrorMessage(error));
        }
      );
    }

    return createResult;
  }

  public static async pollCreateStatus(
    createPackageVersionRequestId: string,
    connection: Connection,
    project: SfProject,
    polling: { frequency: Duration; timeout: Duration }
  ): Promise<BundleSObjects.PackageBundleVersionCreateRequestResult> {
    if (polling.timeout?.milliseconds <= 0) {
      return PackageBundleVersionCreate.getCreateStatus(createPackageVersionRequestId, connection);
    }
    let remainingWaitTime: Duration = polling.timeout;
    const pollingClient = await PollingClient.create({
      poll: async (): Promise<StatusResult> => {
        const report = await PackageBundleVersionCreate.getCreateStatus(createPackageVersionRequestId, connection);
        switch (report.RequestStatus) {
          case BundleSObjects.PkgBundleVersionCreateReqStatus.queued:
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.enqueued, { ...report, remainingWaitTime });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - polling.frequency.seconds);
            return {
              completed: false,
              payload: report,
            };
          case BundleSObjects.PkgBundleVersionCreateReqStatus.success: {
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.success, report);
            return { completed: true, payload: report };
          }
          case BundleSObjects.PkgBundleVersionCreateReqStatus.error:
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.error, report);
            return { completed: true, payload: report };
        }
      },
      frequency: polling.frequency,
      timeout: polling.timeout,
    });

    try {
      return await pollingClient.subscribe<BundleSObjects.PackageBundleVersionCreateRequestResult>();
    } catch (err) {
      const report = await PackageBundleVersionCreate.getCreateStatus(createPackageVersionRequestId, connection);
      await Lifecycle.getInstance().emit(PackageVersionEvents.create['timed-out'], report);
      if (err instanceof Error) {
        throw applyErrorAction(err);
      }
      throw err;
    }
  }

  public static async list(connection: Connection): Promise<BundleSObjects.BundleVersion[]> {
    const query =
      'SELECT Id, PackageBundle.Id, PackageBundle.BundleName, VersionName, MajorVersion, MinorVersion, IsReleased, ' +
      'PackageBundle.Description, PackageBundle.IsDeleted, PackageBundle.CreatedDate, PackageBundle.CreatedById, PackageBundle.LastModifiedDate, PackageBundle.LastModifiedById, PackageBundle.SystemModstamp, ' +
      'Ancestor.Id, Ancestor.PackageBundle.Id, Ancestor.PackageBundle.BundleName, Ancestor.VersionName, Ancestor.MajorVersion, Ancestor.MinorVersion, Ancestor.IsReleased, ' +
      'Ancestor.PackageBundle.Description, Ancestor.PackageBundle.IsDeleted, Ancestor.PackageBundle.CreatedDate, Ancestor.PackageBundle.CreatedById, Ancestor.PackageBundle.LastModifiedDate, Ancestor.PackageBundle.LastModifiedById, Ancestor.PackageBundle.SystemModstamp ' +
      'FROM PackageBundleVersion';
    const queryResult = await connection.autoFetchQuery<QueryRecord>(query, { tooling: true });
    return queryResult.records.map((record) => PackageBundleVersion.mapRecordToBundleVersion(record));
  }

  private static mapRecordToBundleVersion(record: QueryRecord): BundleSObjects.BundleVersion {
    return {
      Id: record.Id,
      PackageBundle: PackageBundleVersion.mapPackageBundle(record.PackageBundle),
      VersionName: record.VersionName ?? '',
      MajorVersion: record.MajorVersion ?? '',
      MinorVersion: record.MinorVersion ?? '',
      CreatedDate: record.PackageBundle?.CreatedDate ?? '',
      CreatedById: record.PackageBundle?.CreatedById ?? '',
      LastModifiedDate: record.PackageBundle?.LastModifiedDate ?? '',
      LastModifiedById: record.PackageBundle?.LastModifiedById ?? '',
      Ancestor: record.Ancestor?.Id ? PackageBundleVersion.mapAncestor(record.Ancestor) : null,
      IsReleased: record.IsReleased ?? false,
    };
  }

  private static mapPackageBundle(packageBundle: QueryRecord['PackageBundle']): BundleSObjects.Bundle {
    return {
      Id: packageBundle?.Id ?? '',
      BundleName: packageBundle?.BundleName ?? '',
      Description: packageBundle?.Description,
      IsDeleted: packageBundle?.IsDeleted ?? false,
      CreatedDate: packageBundle?.CreatedDate ?? '',
      CreatedById: packageBundle?.CreatedById ?? '',
      LastModifiedDate: packageBundle?.LastModifiedDate ?? '',
      LastModifiedById: packageBundle?.LastModifiedById ?? '',
      SystemModstamp: packageBundle?.SystemModstamp ?? '',
    };
  }

  private static mapAncestor(ancestor: AncestorRecord): BundleSObjects.BundleVersion {
    return {
      Id: ancestor.Id,
      PackageBundle: PackageBundleVersion.mapAncestorPackageBundle(ancestor.PackageBundle),
      VersionName: ancestor?.VersionName ?? '',
      MajorVersion: ancestor?.MajorVersion ?? '',
      MinorVersion: ancestor?.MinorVersion ?? '',
      CreatedDate: ancestor.PackageBundle?.CreatedDate ?? '',
      CreatedById: ancestor.PackageBundle?.CreatedById ?? '',
      LastModifiedDate: ancestor.PackageBundle?.LastModifiedDate ?? '',
      LastModifiedById: ancestor.PackageBundle?.LastModifiedById ?? '',
      Ancestor: null,
      IsReleased: false,
    };
  }

  private static mapAncestorPackageBundle(packageBundle: AncestorRecord['PackageBundle']): BundleSObjects.Bundle {
    return {
      Id: packageBundle?.Id ?? '',
      BundleName: packageBundle?.BundleName ?? '',
      Description: packageBundle?.Description,
      IsDeleted: packageBundle?.IsDeleted ?? false,
      CreatedDate: packageBundle?.CreatedDate ?? '',
      CreatedById: packageBundle?.CreatedById ?? '',
      LastModifiedDate: packageBundle?.LastModifiedDate ?? '',
      LastModifiedById: packageBundle?.LastModifiedById ?? '',
      SystemModstamp: packageBundle?.SystemModstamp ?? '',
    };
  }
}
