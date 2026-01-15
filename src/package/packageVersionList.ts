/*
 * Copyright 2026, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Connection, Logger, Messages } from '@salesforce/core';
import { QueryResult, Schema } from '@jsforce/jsforce-node';
import { isNumber } from '@salesforce/ts-types';
import { BY_LABEL, validateId } from '../utils/packageUtils';
import { PackageVersionListOptions, PackageVersionListResult } from '../interfaces';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_version_create');

const defaultFields = [
  'Id',
  'Package2Id',
  'SubscriberPackageVersionId',
  'Name',
  'Package2.Name',
  'Package2.NamespacePrefix',
  'Package2.IsOrgDependent',
  'Description',
  'Tag',
  'Branch',
  'MajorVersion',
  'MinorVersion',
  'PatchVersion',
  'BuildNumber',
  'IsReleased',
  'CreatedDate',
  'LastModifiedDate',
  'IsPasswordProtected',
  'AncestorId',
  'ValidationSkipped',
  'CreatedById',
  'ConvertedFromVersionId',
  'ReleaseVersion',
  'BuildDurationInSeconds',
  'HasMetadataRemoved',
];

const verboseFields = ['CodeCoverage', 'HasPassedCodeCoverageCheck'];

const verbose57Fields = ['Language'];

// Ensure we only include the async validation property for api version of v60.0 or higher.
const default61Fields = ['ValidatedAsync'];

export const DEFAULT_ORDER_BY_FIELDS = 'Package2Id, Branch, MajorVersion, MinorVersion, PatchVersion, BuildNumber';

let logger: Logger;
const getLogger = (): Logger => {
  if (!logger) {
    logger = Logger.childFromRoot('packageVersionList');
  }
  return logger;
};

/**
 * Returns all the package versions that are available in the org, up to 10,000.
 * If more records are needed use the `SF_ORG_MAX_QUERY_LIMIT` env var.
 *
 * @param connection
 * @param options (optional) PackageVersionListOptions
 */
export async function listPackageVersions(
  connection: Connection,
  options?: PackageVersionListOptions
): Promise<QueryResult<PackageVersionListResult>> {
  const query = constructQuery(Number(connection.version), options);
  return connection.autoFetchQuery<PackageVersionListResult & Schema>(query, { tooling: true });
}

export function constructQuery(connectionVersion: number, options?: PackageVersionListOptions): string {
  // construct custom WHERE clause, if applicable
  const where = constructWhere(options);
  let queryFields = connectionVersion > 60 ? [...defaultFields, ...default61Fields] : defaultFields;
  if (options?.verbose) {
    queryFields = [...queryFields, ...verboseFields];
    if (connectionVersion >= 57) {
      queryFields = [...queryFields, ...verbose57Fields];
    }
  }
  const query = `SELECT ${queryFields.toString()} FROM Package2Version`;

  return assembleQueryParts(query, where, options?.orderBy);
}

export function assembleQueryParts(select: string, where: string[], orderBy?: string): string {
  // construct ORDER BY clause
  const orderByPart = `ORDER BY ${orderBy ? orderBy : DEFAULT_ORDER_BY_FIELDS}`;
  const wherePart = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const query = `${select} ${wherePart} ${orderByPart}`;
  getLogger().debug(query);
  return query;
}

// construct custom WHERE clause parts
export function constructWhere(options?: PackageVersionListOptions): string[] {
  const where: string[] = [];

  // filter on given package ids
  if (options?.packages?.length) {
    // remove dups
    const uniquePackageIds = [...new Set(options?.packages)];

    // validate ids
    uniquePackageIds.forEach((packageId) => {
      validateId(BY_LABEL.PACKAGE_ID, packageId);
    });

    // stash where part
    where.push(`Package2Id IN ('${uniquePackageIds.join("','")}')`);
  }

  // filter on created date, days ago: 0 for today, etc
  if (isNumber(options?.createdLastDays)) {
    const createdLastDays = validateDays('createdlastdays', options?.createdLastDays);
    where.push(`CreatedDate = LAST_N_DAYS:${createdLastDays}`);
  }

  // filter on last mod date, days ago: 0 for today, etc
  if (isNumber(options?.modifiedLastDays)) {
    const modifiedLastDays = validateDays('modifiedlastdays', options?.modifiedLastDays);
    where.push(`LastModifiedDate = LAST_N_DAYS:${modifiedLastDays}`);
  }

  if (options?.isReleased) {
    where.push('IsReleased = true');
  }

  if (options?.showConversionsOnly) {
    where.push('ConvertedFromVersionId != null');
  }

  if (options?.branch) {
    where.push(`Branch='${options.branch}'`);
  }

  // exclude deleted
  where.push('IsDeprecated = false');
  return where;
}

export function validateDays(paramName: string, lastDays = -1): number {
  if (lastDays < 0) {
    throw messages.createError('invalidDaysNumber', [paramName, lastDays]);
  }

  return lastDays;
}
