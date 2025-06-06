/*
 * Copyright (c) 2024, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import util from 'node:util';
import { Connection, SfError, SfProject } from '@salesforce/core';
import { Schema, QueryResult } from '@jsforce/jsforce-node';
import { IngestJobV2, IngestJobV2FailedResults } from '@jsforce/jsforce-node/lib/api/bulk2';
import {
  PackagePushRequestListQueryOptions,
  PackagePushRequestListResult,
  PackagePushScheduleResult,
  PackagePushRequestReportQueryOptions,
  PackagePushRequestReportResult,
  PackagePushRequestJobCountByStatusResult,
  PackagePushRequestReportJobFailuresResult,
  PackagePushRequestAbortQueryOptions,
} from '../interfaces';
import { applyErrorAction, massageErrorMessage } from '../utils/packageUtils';

export type PackagePushRequestListOptions = {
  connection: Connection;
  packageId: string;
  project?: SfProject;
};

type PackagePushRequestResult = {
  id: string;
  success: boolean;
  errors: object[];
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
        ?.expr0;
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
        ?.expr0;
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
        ?.expr0;
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

  public static async schedule(
    connection: Connection,
    packageVersionId: string,
    scheduleTime: string | undefined,
    orgList: string[],
    isMigration: boolean = false
  ): Promise<PackagePushScheduleResult> {
    let job: IngestJobV2<Schema> | undefined;

    try {
      const packagePushRequestBody: { [key: string]: unknown } = {
        PackageVersionId: packageVersionId,
      };

      if (scheduleTime) {
        packagePushRequestBody.ScheduledStartTime = scheduleTime;
      }

      if (isMigration) {
        packagePushRequestBody.IsMigration = true;
      }

      const pushRequestResult: PackagePushRequestResult = await connection.request({
        method: 'POST',
        url: `/services/data/v${connection.getApiVersion()}/sobjects/packagepushrequest/`,
        body: JSON.stringify(packagePushRequestBody),
      });

      const pushJobs = orgList.map((orgId) => ({
        PackagePushRequestId: pushRequestResult.id,
        SubscriberOrganizationKey: orgId,
      }));

      // Create PackagePushJob for each org using Bulk API v2
      job = connection.bulk2.createJob({ operation: 'insert', object: 'PackagePushJob' });

      await job.open();

      await job.uploadData(pushJobs);
      await job.close();
      await job.poll(1000, 600_000);

      // If there are any errors for a job, write all specific job errors to an output file
      const jobErrors = await job.getFailedResults();

      if (jobErrors.length > 0) {
        const filePath = await this.writeJobErrorsToFile(pushRequestResult?.id, jobErrors);
        throw new SfError(`Push upgrade failed, job errors have been written to file: ${filePath}`);
      }

      await connection.request({
        method: 'PATCH',
        url: `/services/data/v${connection.getApiVersion()}/sobjects/packagepushrequest/` + pushRequestResult?.id,
        body: JSON.stringify({ Status: 'Pending' }),
      });

      return {
        PushRequestId: pushRequestResult.id,
        ScheduledStartTime: scheduleTime,
        Status: 'Pending',
      };
    } catch (err) {
      if (job && (err as Error).name !== 'JobPollingTimeoutError') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        job.delete().catch((ignored) => ignored);
      }
      throw applyErrorAction(massageErrorMessage(err as Error));
    }
  }

  public static async abort(connection: Connection, options: PackagePushRequestAbortQueryOptions): Promise<boolean> {
    try {
      // Fetch the current status of the PackagePushRequest
      const abortQuery = util.format(getPushRequestStatusQuery(), getPushRequestStatusWhereClause(options));
      const queryResult = await queryReport(abortQuery, connection);

      if (!queryResult.records || queryResult.records.length === 0) {
        throw new Error(
          'Can’t abort package push upgrade request. The specified push upgrade ID isn’t valid. Check the ID (starts with 0DV) and retry the command.'
        );
      }

      const pushRequest = queryResult.records[0];
      // Validate the current status
      if (!['Created', 'Pending'].includes(pushRequest.Status)) {
        throw new Error(
          `Can’t abort package push upgrade request with status '${pushRequest.Status}'. Only push upgrade requests with a status of 'Created' or 'Pending' can be cancelled.`
        );
      }

      // Abort the push request by setting its status to "Canceled"
      await connection.request({
        method: 'PATCH',
        url:
          `/services/data/v${connection.getApiVersion()}/sobjects/packagepushrequest/` + options.packagePushRequestId,
        body: JSON.stringify({ Status: 'Canceled' }),
      });

      // Return the updated PackagePushRequest details
      return true;
    } catch (err) {
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      return false;
    }
  }

  private static async writeJobErrorsToFile(
    pushRequestId: string,
    jobErrors: IngestJobV2FailedResults<Schema>
  ): Promise<string> {
    const outputDir = path.join(process.cwd(), 'job_errors');
    const outputFile = path.join(outputDir, `push_request_${pushRequestId}_errors.log`);

    try {
      await fs.mkdir(outputDir, { recursive: true });

      const errorContent = jobErrors
        .map((job, index) => `Job ${index + 1} Error:${JSON.stringify(job?.sf__Error, null, 2)}`)
        .join('\n');

      await fs.writeFile(outputFile, errorContent, 'utf-8');

      return outputFile;
    } catch (error) {
      throw new SfError('Error when saving job errors to file. ' + (error as Error).message);
    }
  }
}

async function queryList(query: string, connection: Connection): Promise<PackagePushRequestListResult[]> {
  const queryResult = await connection.autoFetchQuery<PackagePushRequestListResult & Schema>(query, {});
  return queryResult.records;
}

function constructWhereList(options?: PackagePushRequestListQueryOptions): string {
  const where: string[] = [];

  if (options?.packageId) {
    where.push(`PackageVersion.MetadataPackageId = '${options.packageId}'`);
  }

  if (options?.status) {
    where.push(`Status = '${options.status}'`);
  }

  if (options?.scheduledLastDays) {
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - options.scheduledLastDays);
    where.push(`ScheduledStartTime >= ${daysAgo.toISOString()}`);
  }

  if (options?.isMigration) {
    where.push(`IsMigration = ${options.isMigration}`);
  }

  return where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
}

function getListQuery(): string {
  // WHERE, if applicable
  return (
    'SELECT Id, PackageVersionId, PackageVersion.Name, PackageVersion.MajorVersion, PackageVersion.MinorVersion, Status, ScheduledStartTime, StartTime, EndTime, IsMigration FROM PackagePushRequest ' +
    '%s'
  );
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
    'SELECT PackageVersion.MetadataPackage.Name, PackageVersion.MajorVersion, PackageVersion.MinorVersion, PackageVersion.MetadataPackage.NamespacePrefix, PackageVersion.MetadataPackageId, PackageVersionId, PackageVersion.Name, Id, Status, ScheduledStartTime, StartTime, EndTime, DurationSeconds FROM PackagePushRequest ' +
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

function getPushRequestStatusWhereClause(options: PackagePushRequestAbortQueryOptions): string {
  const where: string[] = [];
  where.push(`Id = '${options.packagePushRequestId}'`);
  return `WHERE ${where.join(' AND ')}`;
}

function getPushRequestStatusQuery(): string {
  const QUERY = 'SELECT Id, Status FROM PackagePushRequest ' + '%s';
  return QUERY;
}
