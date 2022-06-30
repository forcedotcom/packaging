/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as util from 'util';
import { Connection, Messages } from '@salesforce/core';
import {
  Package2VersionCreateRequestError,
  Package2VersionCreateRequestResult,
  PackagingSObjects,
} from '../interfaces';
import * as packageUtils from '../utils/packageUtils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const STATUS_ERROR = 'Error';
const QUERY =
  'SELECT Id, Status, Package2Id, Package2VersionId, Package2Version.SubscriberPackageVersionId, Tag, Branch, ' +
  'CreatedDate, Package2Version.HasMetadataRemoved, CreatedById ' +
  'FROM Package2VersionCreateRequest ' +
  '%s' + // WHERE, if applicable
  'ORDER BY CreatedDate';
const ERROR_QUERY = "SELECT Message FROM Package2VersionCreateRequestError WHERE ParentRequest.Id = '%s'";
const STATUSES = ['Queued', 'InProgress', 'Success', 'Error'];

type PackageVersionCreateRequestQueryOptions = {
  createdlastdays?: number;
  connection?: Connection;
  status?: string;
};

export async function list(
  options: PackageVersionCreateRequestQueryOptions = {}
): Promise<Package2VersionCreateRequestResult[]> {
  const whereClause = _constructWhere();
  return _query(util.format(QUERY, whereClause), options.connection);
}

export async function byId(
  package2VersionCreateRequestId,
  connection: Connection
): Promise<Package2VersionCreateRequestResult[]> {
  const results = await _query(util.format(QUERY, `WHERE Id = '${package2VersionCreateRequestId}' `), connection);
  if (results && results.length === 1 && results[0].Status === STATUS_ERROR) {
    results[0].Error = await _queryErrors(package2VersionCreateRequestId, connection);
  }

  return results;
}
async function _query(query: string, connection: Connection): Promise<Package2VersionCreateRequestResult[]> {
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
  package2VersionCreateRequestId,
  connection: Connection
): Promise<Package2VersionCreateRequestError[]> {
  const errorResults = [];

  const queryResult = connection.tooling.query(util.format(ERROR_QUERY, package2VersionCreateRequestId));
  if (queryResult.records) {
    queryResult.records.forEach((record) => {
      errorResults.push(record.Message);
    });
  }

  return errorResults;
}

function _constructWhere(options?: PackageVersionCreateRequestQueryOptions): string {
  const where = [];

  // filter on created date, days ago: 0 for today, etc
  if (!util.isNullOrUndefined(this.options.createdlastdays)) {
    if (options.createdlastdays < 0) {
      throw new Error(messages.getMessage('invalidDaysNumber', ['createdlastdays', options.createdlastdays]));
    }
    where.push(`CreatedDate = LAST_N_DAYS:${this.options.createdlastdays}`);
  }

  // filter on errors
  if (options.status) {
    const foundStatus = STATUSES.find((status) => status.toLowerCase() === this.options.status.toLowerCase());
    if (!foundStatus) {
      const args = [options.status];
      STATUSES.forEach((status) => {
        args.push(status);
      });
      throw new Error(messages.getMessage('invalidStatus', args));
    }

    where.push(`Status = '${foundStatus}'`);
  }

  return where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
}
