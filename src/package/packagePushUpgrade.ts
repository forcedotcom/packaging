/*
 * Copyright (c) 2024, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import util from 'node:util';
import { Connection, SfProject } from '@salesforce/core';
import { Schema, QueryResult } from '@jsforce/jsforce-node';
import {
  PackagePushRequestListQueryOptions,
  PackagePushRequestListResult,
  PackagePushRequestReportQueryOptions,
  PackagePushRequestReportResult,
  PackagePushRequestJobCountByStatusResult,
  PackagePushRequestReportJobFailuresResult,
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

  public static async report(
    connection: Connection,
    options: PackagePushRequestReportQueryOptions
  ): Promise<PackagePushRequestReportResult[]> {
    try {
      const whereClause = constructWhereReport(options);
      return (await queryReport(util.format(getReportQuery(), whereClause), connection)).records;
    } catch (err) {
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      throw err;
    }
  }

  public static async getFailedJobs(
    connection: Connection,
    options: PackagePushRequestReportQueryOptions
  ): Promise<number> {
    try {
      const whereClause = constructWhereJobCountByStatus(options, 'Failed');
      return (await queryJobCountByStatus(util.format(getJobCountByStatusQuery(), whereClause), connection)).records[0]
        .expr0;
    } catch (err) {
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      throw err;
    }
  }

  public static async getSucceededJobs(
    connection: Connection,
    options: PackagePushRequestReportQueryOptions
  ): Promise<number> {
    try {
      const whereClause = constructWhereJobCountByStatus(options, 'Succeeded');
      return (await queryJobCountByStatus(util.format(getJobCountByStatusQuery(), whereClause), connection)).records[0]
        .expr0;
    } catch (err) {
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      throw err;
    }
  }

  public static async getTotalJobs(
    connection: Connection,
    options: PackagePushRequestReportQueryOptions
  ): Promise<number> {
    try {
      const whereClause = constructWhereJobCountByStatus(options);
      return (await queryJobCountByStatus(util.format(getJobCountByStatusQuery(), whereClause), connection)).records[0]
        .expr0;
    } catch (err) {
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      throw err;
    }
  }

  public static async getJobFailureReasons(
    connection: Connection,
    options: PackagePushRequestReportQueryOptions
  ): Promise<PackagePushRequestReportJobFailuresResult[]> {
    try {
      const whereClause = constructWhereJobFailureReasons(options);
      return (await queryJobFailureReasons(util.format(getJobFailureReasonsQuery(), whereClause), connection)).records;
    } catch (err) {
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      throw err;
    }
  }
}

async function queryList(query: string, connection: Connection): Promise<PackagePushRequestListResult[]> {
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

async function queryReport(
  query: string,
  connection: Connection
): Promise<QueryResult<PackagePushRequestReportResult>> {
  return connection.autoFetchQuery<PackagePushRequestReportResult & Schema>(query, {});
}

async function queryJobCountByStatus(
  query: string,
  connection: Connection
): Promise<QueryResult<PackagePushRequestJobCountByStatusResult>> {
  return connection.autoFetchQuery<PackagePushRequestJobCountByStatusResult & Schema>(query, {});
}

function constructWhereReport(options: PackagePushRequestReportQueryOptions): string {
  const where: string[] = [];
  where.push(`Id = '${options.packagePushRequestId}'`);
  return `WHERE ${where.join(' AND ')}`;
}

function getReportQuery(): string {
  const QUERY =
    'SELECT PackageVersion.MetadataPackage.Name, PackageVersion.MetadataPackage.NamespacePrefix, PackageVersion.MetadataPackageId, PackageVersionId, PackageVersion.Name, Id, Status, ScheduledStartTime, StartTime, EndTime, DurationSeconds FROM PackagePushRequest ' +
    '%s'; // WHERE, if applicable
  return QUERY;
}

function constructWhereJobCountByStatus(options: PackagePushRequestReportQueryOptions, status?: string): string {
  const where: string[] = [];
  where.push(`PackagePushRequestId = '${options.packagePushRequestId}'`);
  if (status) {
    where.push(`Status = '${status}'`);
  }
  return `WHERE ${where.join(' AND ')}`;
}

function getJobCountByStatusQuery(): string {
  const QUERY = 'SELECT Count(Id) FROM PackagePushJob ' + '%s '; // WHERE, if applicable
  return QUERY;
}

function constructWhereJobFailureReasons(options: PackagePushRequestReportQueryOptions): string {
  const where: string[] = [];
  where.push(`PackagePushJob.PackagePushRequestId = '${options.packagePushRequestId}'`);
  return `WHERE ${where.join(' AND ')}`;
}

function getJobFailureReasonsQuery(): string {
  const QUERY =
    'SELECT ErrorMessage, ErrorDetails, ErrorTitle, ErrorSeverity, ErrorType from PackagePushError ' + '%s '; // WHERE, if applicable
  return QUERY;
}

async function queryJobFailureReasons(
  query: string,
  connection: Connection
): Promise<QueryResult<PackagePushRequestReportJobFailuresResult>> {
  return connection.autoFetchQuery<PackagePushRequestReportJobFailuresResult & Schema>(query, {});
}
