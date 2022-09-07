/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as util from 'util';
import { Connection, Messages } from '@salesforce/core';
import {
  PackageVersionCreateRequestError,
  PackageVersionCreateRequestResult,
  PackageVersionCreateRequestQueryOptions,
  PackagingSObjects,
} from '../interfaces';
import * as packageUtils from '../utils/packageUtils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

const STATUS_ERROR = 'Error';
const QUERY =
  'SELECT Id, Status, Package2Id, Package2VersionId, Package2Version.SubscriberPackageVersionId, Tag, Branch, ' +
  'CreatedDate, Package2Version.HasMetadataRemoved, CreatedById ' +
  'FROM Package2VersionCreateRequest ' +
  '%s' + // WHERE, if applicable
  'ORDER BY CreatedDate';
const ERROR_QUERY = "SELECT Message FROM Package2VersionCreateRequestError WHERE ParentRequest.Id = '%s'";

export async function list(
  options?: PackageVersionCreateRequestQueryOptions
): Promise<PackageVersionCreateRequestResult[]> {
  const whereClause = _constructWhere(options);
  return _query(util.format(QUERY, whereClause), options.connection);
}

export async function byId(
  packageVersionCreateRequestId: string,
  connection: Connection
): Promise<PackageVersionCreateRequestResult[]> {
  const results = await _query(util.format(QUERY, `WHERE Id = '${packageVersionCreateRequestId}' `), connection);
  if (results && results.length === 1 && results[0].Status === STATUS_ERROR) {
    results[0].Error = await _queryErrors(packageVersionCreateRequestId, connection);
  }

  return results;
}
async function _query(query: string, connection: Connection): Promise<PackageVersionCreateRequestResult[]> {
  type QueryRecord = PackagingSObjects.Package2VersionCreateRequest & {
    Package2Version: Pick<PackagingSObjects.Package2Version, 'HasMetadataRemoved' | 'SubscriberPackageVersionId'>;
  };
  const queryResult = await connection.tooling.query<QueryRecord>(query);
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
    CreatedDate: packageUtils.formatDate(new Date(record.CreatedDate)),
    HasMetadataRemoved: record.Package2Version != null ? record.Package2Version.HasMetadataRemoved : null,
    CreatedBy: record.CreatedById,
  }));
}

async function _queryErrors(
  packageVersionCreateRequestId,
  connection: Connection
): Promise<PackageVersionCreateRequestError[]> {
  const errorResults = [];

  const queryResult = connection.tooling.query(util.format(ERROR_QUERY, packageVersionCreateRequestId));
  if (queryResult.records) {
    queryResult.records.forEach((record) => {
      errorResults.push(record.Message);
    });
  }

  return errorResults;
}

function _constructWhere(options?: PackageVersionCreateRequestQueryOptions): string {
  const where: string[] = [];

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
