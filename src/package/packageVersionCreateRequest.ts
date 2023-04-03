/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as util from 'util';
import { Connection, Messages } from '@salesforce/core';
import { Schema } from 'jsforce';
import {
  PackageVersionCreateRequestQueryOptions,
  PackageVersionCreateRequestResult,
  PackagingSObjects
} from '../interfaces';
import { applyErrorAction, massageErrorMessage } from '../utils/packageUtils';
import Package2VersionCreateRequestError = PackagingSObjects.Package2VersionCreateRequestError;

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_version_create');

const STATUS_ERROR = 'Error';
const QUERY =
  'SELECT Id, Status, Package2Id, Package2VersionId, Package2Version.SubscriberPackageVersionId, Tag, Branch, ' +
  'CreatedDate, Package2Version.HasMetadataRemoved, CreatedById ' +
  'FROM Package2VersionCreateRequest ' +
  '%s' + // WHERE, if applicable
  'ORDER BY CreatedDate desc';

function formatDate(date: Date): string {
  const pad = (num: number): string => (num < 10 ? `0${num}` : `${num}`);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

export async function list(
  options?: PackageVersionCreateRequestQueryOptions
): Promise<PackageVersionCreateRequestResult[]> {
  if (!options?.connection) {
    throw messages.createError('missingConnection');
  }

  try {
    const whereClause = constructWhere(options);
    return await query(util.format(QUERY, whereClause), options.connection);
  } catch (err) {
    throw applyErrorAction(massageErrorMessage(err as Error));
  }
}

export async function byId(
  packageVersionCreateRequestId: string,
  connection: Connection
): Promise<PackageVersionCreateRequestResult[]> {
  const results = await query(util.format(QUERY, `WHERE Id = '${packageVersionCreateRequestId}' `), connection);
  if (results && results.length === 1 && results[0].Status === STATUS_ERROR) {
    results[0].Error = await queryForErrors(packageVersionCreateRequestId, connection);
  }

  return results;
}

// eslint-disable-next-line @typescript-eslint/no-shadow
async function query(query: string, connection: Connection): Promise<PackageVersionCreateRequestResult[]> {
  type QueryRecord = PackagingSObjects.Package2VersionCreateRequest &
    Schema & {
    Package2Version: Pick<PackagingSObjects.Package2Version, 'HasMetadataRemoved' | 'SubscriberPackageVersionId'>;
  };
  const queryResult = await connection.autoFetchQuery<QueryRecord>(query, { tooling: true });
  return (queryResult.records ? queryResult.records : []).map((record) => ({
    Id: record.Id,
    Status: record.Status,
    Package2Id: record.Package2Id,
    Package2VersionId: record.Package2VersionId,
    SubscriberPackageVersionId:
      record.Package2Version != null ? record.Package2Version.SubscriberPackageVersionId : null,
    Tag: record.Tag,
    Branch: record.Branch,
    Error: [],
    CreatedDate: formatDate(new Date(record.CreatedDate)),
    HasMetadataRemoved: record.Package2Version != null ? record.Package2Version.HasMetadataRemoved : null,
    CreatedBy: record.CreatedById
  }));
}

async function queryForErrors(packageVersionCreateRequestId: string, connection: Connection): Promise<string[]> {
  const errorResults: string[] = [];

  const queryResult = await connection.tooling.query<Package2VersionCreateRequestError>(
    util.format(
      'SELECT Message FROM Package2VersionCreateRequestError WHERE ParentRequest.Id = \'%s\'',
      packageVersionCreateRequestId
    )
  );
  if (queryResult.records) {
    queryResult.records.forEach((record: { Message: string }) => {
      errorResults.push(record.Message);
    });
  }

  return errorResults;
}

function constructWhere(options?: PackageVersionCreateRequestQueryOptions): string {
  const where: string[] = [];

  if (options?.id) {
    where.push(`Id = '${options.id}'`);
  }
  // filter on created date, days ago: 0 for today, etc
  if (options?.createdlastdays) {
    if (options.createdlastdays < 0) {
      throw messages.createError('invalidDaysNumber', ['createdlastdays', options.createdlastdays]);
    }
    where.push(`CreatedDate = LAST_N_DAYS:${options.createdlastdays}`);
  }

  // filter on errors
  if (options?.status) {
    where.push(`Status = '${options.status.toLowerCase()}'`);
  }

  return where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
}
