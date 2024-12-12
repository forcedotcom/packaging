/*
 * Copyright (c) 2024, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
/* eslint-disable class-methods-use-this */
import util from 'node:util';
import { Connection, SfProject } from '@salesforce/core';
import { Schema } from '@jsforce/jsforce-node';
import { PackagePushUpgradeListQueryOptions, PackagePushUpgradeListResult } from '../interfaces';
import { applyErrorAction, massageErrorMessage } from '../utils/packageUtils';

export type PackagePushUpgradeListOptions = {
  connection: Connection;
  packageId: string;
  project?: SfProject;
};

export class PackagePushUpgrade {
  private readonly project?: SfProject;
  private readonly connection: Connection;

  public constructor(private options: PackagePushUpgradeListOptions) {
    this.connection = this.options.connection;
    this.project = this.options.project;
  }

  public async list(
    connection: Connection,
    options?: PackagePushUpgradeListQueryOptions
  ): Promise<PackagePushUpgradeListResult[]> {
    try {
      const whereClause = this.constructWhere(options);
      return await this.query(util.format(this.getQuery(), whereClause), connection);
    } catch (err) {
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      throw err;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-shadow
  private async query(query: string, connection: Connection): Promise<PackagePushUpgradeListResult[]> {
    type QueryRecord = PackagePushUpgradeListResult & Schema;
    const queryResult = await connection.autoFetchQuery<QueryRecord>(query, { tooling: true });

    return (queryResult.records ? queryResult.records : []).map((record) => ({
      PushRequestId: record.PushRequestId,
      PackageVersionId: record.PackageVersionId,
      PushRequestStatus: record.PushRequestStatus,
      PushRequestScheduledDateTime: 'test',
      NumOrgsScheduled: 0,
      NumOrgsUpgradedFail: 0,
      NumOrgsUpgradedSuccess: 0,
    }));
  }

  private constructWhere(options?: PackagePushUpgradeListQueryOptions): string {
    const where: string[] = [];

    if (options?.packageId) {
      where.push(`Id = '${options.packageId}'`);
    }

    // filter on errors
    if (options?.status) {
      where.push(`Status = '${options.status.toLowerCase()}'`);
    }

    return where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  }

  private getQuery(): string {
    const QUERY = 'SELECT Id, Package2VersionId, Status, IsMigration' + 'FROM PackagePushRequest ' + '%s'; // WHERE, if applicable
    return QUERY;
  }
}
