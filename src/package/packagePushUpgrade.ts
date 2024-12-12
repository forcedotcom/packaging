/*
 * Copyright (c) 2024, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import util from 'node:util';
import { Connection, SfProject } from '@salesforce/core';
import { Schema } from '@jsforce/jsforce-node';
import { PackagePushRequestListQueryOptions, PackagePushRequestListResult } from '../interfaces';
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
      const whereClause = constructWhere(options);
      return await query(util.format(getQuery(), whereClause), connection);
    } catch (err) {
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      throw err;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-shadow
async function query(query: string, connection: Connection): Promise<PackagePushRequestListResult[]> {
  type QueryRecord = PackagePushRequestListResult & Schema;
  const queryResult = await connection.autoFetchQuery<QueryRecord>(query, { tooling: true });

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

function constructWhere(options?: PackagePushRequestListQueryOptions): string {
  const where: string[] = [];

  if (options?.packageId) {
    where.push(`MetadataPackageVersion.MetadataPackage = '${options.packageId}'`);
  }
  return where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
}

function getQuery(): string {
  const QUERY = 'SELECT Id, PackageVersion, Status' + 'FROM PackagePushRequest ' + '%s'; // WHERE, if applicable
  return QUERY;
}
