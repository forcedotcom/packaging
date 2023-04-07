/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Logger, Messages } from '@salesforce/core';
import { QueryResult, Schema } from 'jsforce';
import { isNumber } from '@salesforce/ts-types';
import { BY_LABEL, validateId } from '../utils/packageUtils';
import { ListPackageVersionOptions, PackageVersionListResult } from '../interfaces';

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
];

const verboseFields = [
  'CodeCoverage',
  'HasPassedCodeCoverageCheck',
  'ConvertedFromVersionId',
  'ReleaseVersion',
  'BuildDurationInSeconds',
  'HasMetadataRemoved',
];

const verbose57Fields = ['Language'];

export const DEFAULT_ORDER_BY_FIELDS = 'Package2Id, Branch, MajorVersion, MinorVersion, PatchVersion, BuildNumber';

let logger: Logger;
const getLogger = (): Logger => {
  if (!logger) {
    logger = Logger.childFromRoot('packageVersionList');
  }
  return logger;
};

export async function listPackageVersions(
  options: ListPackageVersionOptions
): Promise<QueryResult<PackageVersionListResult>> {
  return options.connection.autoFetchQuery<PackageVersionListResult & Schema>(constructQuery(options), {
    tooling: true,
  });
}

function constructQuery(options: ListPackageVersionOptions): string {
  // construct custom WHERE clause, if applicable
  const where = constructWhere(options.packages, options.createdLastDays, options.modifiedLastDays, options.isReleased);

  let queryFields = defaultFields;
  if (options.verbose) {
    queryFields = [...queryFields, ...verboseFields];
    if (Number(options.connection.version) >= 57) {
      queryFields = [...queryFields, ...verbose57Fields];
    }
  }
  const query = `SELECT ${queryFields.toString()} FROM Package2Version`;

  return assembleQueryParts(query, where, options.orderBy);
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
export function constructWhere(
  packageIds: string[],
  createdLastDays: number,
  lastModLastDays: number,
  isReleased: boolean
): string[] {
  const where: string[] = [];

  // filter on given package ids
  if (packageIds?.length > 0) {
    // remove dups
    const uniquePackageIds = [...new Set(packageIds)];

    // validate ids
    uniquePackageIds.forEach((packageId) => {
      validateId(BY_LABEL.PACKAGE_ID, packageId);
    });

    // stash where part
    where.push(`Package2Id IN ('${uniquePackageIds.join("','")}')`);
  }

  // filter on created date, days ago: 0 for today, etc
  if (isNumber(createdLastDays)) {
    createdLastDays = validateDays('createdlastdays', createdLastDays);
    where.push(`CreatedDate = LAST_N_DAYS:${createdLastDays}`);
  }

  // filter on last mod date, days ago: 0 for today, etc
  if (isNumber(lastModLastDays)) {
    lastModLastDays = validateDays('modifiedlastdays', lastModLastDays);
    where.push(`LastModifiedDate = LAST_N_DAYS:${lastModLastDays}`);
  }

  if (isReleased) {
    where.push('IsReleased = true');
  }

  // exclude deleted
  where.push('IsDeprecated = false');
  return where;
}

export function validateDays(paramName: string, lastDays: number): number {
  if (lastDays < 0) {
    throw messages.createError('invalidDaysNumber', [paramName, lastDays]);
  }

  return lastDays;
}
