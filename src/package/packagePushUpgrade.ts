/*
 * Copyright (c) 2024, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import util from 'node:util';
import { Connection, SfProject } from '@salesforce/core';
import { Schema } from '@jsforce/jsforce-node';
import {
  PackagePushRequestListQueryOptions,
  PackagePushRequestListResult,
  PackagePushScheduleResult,
} from '../interfaces';
import { applyErrorAction, massageErrorMessage } from '../utils/packageUtils';

export type PackagePushRequestListOptions = {
  connection: Connection;
  packageId: string;
  project?: SfProject;
};

export class PackagePushUpgrade {
  public constructor() {}

  public static async list(
    connection: Connection,
    options?: PackagePushRequestListQueryOptions
  ): Promise<PackagePushRequestListResult[]> {
    try {
      const whereClause = constructWhereList(options);
      return await queryList(util.format(getListQuery(), whereClause), connection);
    } catch (err) {
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      throw err;
    }
  }

  public static async schedule(
    connection: Connection,
    packageVersionId: string,
    scheduleTime: string,
    orgList: string[]
  ): Promise<PackagePushScheduleResult> {
    try {
      const pushRequest = await connection.tooling.create('PackagePushRequest', {
        PackageVersionId: packageVersionId,
        ScheduledStartTime: scheduleTime,
      });

      if (!pushRequest.success) {
        throw new Error('Failed to create PackagePushRequest');
      }

      // Create PackagePushJob for each org
      const pushJobs = await Promise.all(
        orgList.map((orgId) =>
          connection.tooling.create('PackagePushJob', {
            PackagePushRequestId: pushRequest.id,
            SubscriberOrganizationKey: orgId,
          })
        )
      );

      // Check if all jobs were created successfully
      if (pushJobs.some((job) => !job.success)) {
        throw new Error('Failed to create PackagePushJobs for all orgs');
      }

      return {
        PushRequestId: pushRequest.id,
        ScheduledStartTime: scheduleTime,
        Status: 'Pending',
      };
    } catch (err) {
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      throw err;
    }
  }
}

async function queryList(query: string, connection: Connection): Promise<PackagePushRequestListResult[]> {
  const queryResult = await connection.autoFetchQuery<PackagePushRequestListResult & Schema>(query, { tooling: true });

  return (queryResult.records ? queryResult.records : []).map((record) => ({
    PushRequestId: record?.PushRequestId,
    PackageVersionId: record?.PackageVersionId,
    PushRequestStatus: record?.PushRequestStatus,
    PushRequestScheduledDateTime: 'test',
    NumOrgsScheduled: 0,
    NumOrgsUpgradedFail: 0,
    NumOrgsUpgradedSuccess: 0,
  }));
}

function constructWhereList(options?: PackagePushRequestListQueryOptions): string {
  const where: string[] = [];

  if (options?.packageId) {
    where.push(`MetadataPackageVersion.MetadataPackage = '${options.packageId}'`);
  }
  return where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
}

function getListQuery(): string {
  // WHERE, if applicable
  return 'SELECT Id, PackageVersion, Status' + 'FROM PackagePushRequest ' + '%s';
}
