/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as util from 'node:util';
import { Connection, Messages } from '@salesforce/core';
import { Schema } from 'jsforce';
import {
  PackageVersionCreateRequestQueryOptions,
  PackageVersionCreateRequestResult,
  PackagingSObjects,
} from '../interfaces';
import { applyErrorAction, massageErrorMessage } from '../utils/packageUtils';
import Package2VersionCreateRequestError = PackagingSObjects.Package2VersionCreateRequestError;

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_version_create');

const QUERY =
  'SELECT Id, Status, Package2Id, Package2VersionId, Package2Version.SubscriberPackageVersionId, Tag, Branch, ' +
  'CreatedDate, Package2Version.HasMetadataRemoved, CreatedById, IsConversionRequest, Package2Version.ConvertedFromVersionId ' +
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
  connection: Connection,
  options?: PackageVersionCreateRequestQueryOptions
): Promise<PackageVersionCreateRequestResult[]> {
  try {
    const whereClause = constructWhere(options);
    return await query(util.format(QUERY, whereClause), connection);
  } catch (err) {
    if (err instanceof Error) {
      throw applyErrorAction(massageErrorMessage(err));
    }
    throw err;
  }
}

export async function byId(
  packageVersionCreateRequestId: string,
  connection: Connection
): Promise<PackageVersionCreateRequestResult[]> {
  const results = await query(util.format(QUERY, `WHERE Id = '${packageVersionCreateRequestId}' `), connection);
  if (results && results.length === 1 && results[0].Status === PackagingSObjects.Package2VersionStatus.error) {
    results[0].Error = await queryForErrors(packageVersionCreateRequestId, connection);
  }

  return results;
}

// eslint-disable-next-line @typescript-eslint/no-shadow
async function query(query: string, connection: Connection): Promise<PackageVersionCreateRequestResult[]> {
  type QueryRecord = PackagingSObjects.Package2VersionCreateRequest &
    Schema & {
      Package2Version: Pick<
        PackagingSObjects.Package2Version,
        'HasMetadataRemoved' | 'SubscriberPackageVersionId' | 'ConvertedFromVersionId'
      >;
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
    CreatedBy: record.CreatedById,
    ConvertedFromVersionId: convertedFromVersionMessage(record.Status, record.Package2Version?.ConvertedFromVersionId),
  }));
}

function convertedFromVersionMessage(status: string, convertedFromVersionId: string): string {
  switch (status) {
    case 'Success':
      return convertedFromVersionId;
    case 'Queued':
      return messages.getMessage('IdUnavailableWhenQueued');
    case 'InProgress':
      return messages.getMessage('IdUnavailableWhenInProgress');
    case 'Error':
      return messages.getMessage('IdUnavailableWhenError');
    default:
      return messages.getMessage('IdUnavailableWhenInProgress');
  }
}

async function queryForErrors(packageVersionCreateRequestId: string, connection: Connection): Promise<string[]> {
  const queryResult = await connection.tooling.query<Package2VersionCreateRequestError>(
    `SELECT Message FROM Package2VersionCreateRequestError WHERE ParentRequest.Id = '${packageVersionCreateRequestId}'`
  );
  return queryResult.records ? queryResult.records.map((record) => record.Message) : [];
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

  // show only conversions
  if (options?.showConversionsOnly) {
    where.push('IsConversionRequest = true ');
  }

  return where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
}
