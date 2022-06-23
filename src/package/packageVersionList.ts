/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as _ from 'lodash';
import { Connection, Logger, Messages, SfProject } from '@salesforce/core';
import { QueryResult } from 'jsforce';
import { isNumber } from '@salesforce/ts-types';
import { BY_LABEL, getPackageIdFromAlias, validateId } from '../utils';
import { PackageVersionListResult } from '../interfaces';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

// Stripping CodeCoverage, HasPassedCodeCoverageCheck as they are causing a perf issue in 47.0+ W-6997762
const DEFAULT_SELECT =
  'SELECT Id, Package2Id, SubscriberPackageVersionId, Name, Package2.Name, Package2.NamespacePrefix, ' +
  'Description, Tag, Branch, MajorVersion, MinorVersion, PatchVersion, BuildNumber, IsReleased, ' +
  'CreatedDate, LastModifiedDate, IsPasswordProtected, AncestorId, ValidationSkipped, CreatedById ' +
  'FROM Package2Version';

const VERBOSE_SELECT =
  'SELECT Id, Package2Id, SubscriberPackageVersionId, Name, Package2.Name, Package2.NamespacePrefix, ' +
  'Description, Tag, Branch, MajorVersion, MinorVersion, PatchVersion, BuildNumber, IsReleased, ' +
  'CreatedDate, LastModifiedDate, IsPasswordProtected, CodeCoverage, HasPassedCodeCoverageCheck, AncestorId, ValidationSkipped, ' +
  'ConvertedFromVersionId, Package2.IsOrgDependent, ReleaseVersion, BuildDurationInSeconds, HasMetadataRemoved, CreatedById ' +
  'FROM Package2Version';

export const DEFAULT_ORDER_BY_FIELDS = 'Package2Id, Branch, MajorVersion, MinorVersion, PatchVersion, BuildNumber';

const logger = Logger.childFromRoot('packageVersionList');

export async function listPackageVersions(options: {
  project: SfProject;
  orderBy: string;
  modifiedLastDays: number;
  createdLastDays: number;
  packages: string[];
  connection: Connection;
  verbose: boolean;
  concise: boolean;
  isReleased: boolean;
}): Promise<QueryResult<PackageVersionListResult>> {
  return options.connection.tooling.query<PackageVersionListResult>(_constructQuery(options));
}

export function _constructQuery(options: {
  project: SfProject;
  orderBy: string;
  modifiedLastDays: number;
  createdLastDays: number;
  packages: string[];
  connection: Connection;
  verbose: boolean;
  concise: boolean;
  isReleased: boolean;
}): string {
  // construct custom WHERE clause, if applicable
  const where = _constructWhere(options.packages, options.createdLastDays, options.modifiedLastDays, options.project);
  if (options.isReleased) {
    where.push('IsReleased = true');
  }
  return _assembleQueryParts(options.verbose === true ? VERBOSE_SELECT : DEFAULT_SELECT, where, options.orderBy);
}

export function _assembleQueryParts(select: string, where: string[], orderBy = DEFAULT_ORDER_BY_FIELDS): string {
  // construct ORDER BY clause
  // TODO: validate given fields
  const orderByPart = `ORDER BY ${orderBy ? orderBy : DEFAULT_ORDER_BY_FIELDS}`;
  const wherePart = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const query = `${select} ${wherePart} ${orderByPart}`;
  logger.debug(query);
  return query;
}

// construct custom WHERE clause parts
export function _constructWhere(
  idsOrAliases: string[],
  createdLastDays: number,
  lastModLastDays: number,
  project: SfProject
): string[] {
  const where = [];

  // filter on given package ids
  if (idsOrAliases?.length > 0) {
    // remove dups
    idsOrAliases = _.uniq(idsOrAliases);

    // resolve any aliases
    const packageIds = idsOrAliases.map((idOrAlias) => getPackageIdFromAlias(idOrAlias, project));

    // validate ids
    packageIds.forEach((packageId) => {
      validateId(BY_LABEL.PACKAGE_ID, packageId);
    });

    // stash where part
    where.push(`Package2Id IN ('${packageIds.join("','")}')`);
  }

  // filter on created date, days ago: 0 for today, etc
  if (isNumber(createdLastDays)) {
    createdLastDays = _getLastDays('createdlastdays', createdLastDays);
    where.push(`CreatedDate = LAST_N_DAYS:${createdLastDays}`);
  }

  // filter on last mod date, days ago: 0 for today, etc
  if (isNumber(lastModLastDays)) {
    lastModLastDays = _getLastDays('modifiedlastdays', lastModLastDays);
    where.push(`LastModifiedDate = LAST_N_DAYS:${lastModLastDays}`);
  }

  // exclude deleted
  where.push('IsDeprecated = false');
  return where;
}

export function _getLastDays(paramName: string, lastDays: number) {
  if (isNaN(lastDays)) {
    return 0;
  }

  if (lastDays < 0) {
    throw messages.createError('invalidDaysNumber', [paramName, `${lastDays}`]);
  }

  return lastDays;
}
