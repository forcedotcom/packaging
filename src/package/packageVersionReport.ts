/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

// Node
import util from 'node:util';

// Local
import { Connection, Logger, SfProject } from '@salesforce/core';
import * as pkgUtils from '../utils/packageUtils';
import { PackageVersionReportResult } from '../interfaces';

const defaultFields = [
  'Id',
  'Package2Id',
  'SubscriberPackageVersionId',
  'Name',
  'Description',
  'Tag',
  'Branch',
  'AncestorId',
  'ValidationSkipped',
  'MajorVersion',
  'MinorVersion',
  'PatchVersion',
  'BuildNumber',
  'IsReleased',
  'CodeCoverage',
  'HasPassedCodeCoverageCheck',
  'Package2.IsOrgDependent',
  'ReleaseVersion',
  'BuildDurationInSeconds',
  'HasMetadataRemoved',
  'CreatedById',
  'ConvertedFromVersionId',
];

let verboseFields = ['SubscriberPackageVersion.Dependencies', 'CodeCoveragePercentages'];

// Ensure we only include the async validation property for api version of v60.0 or higher.
const default61Fields = ['ValidatedAsync'];

// Add fields here that are available only api version of v64.0 or higher.
const default64Fields = ['TotalNumberOfMetadataFiles', 'TotalSizeOfMetadataFiles'];

const verbose61Fields = ['EndToEndBuildDurationInSeconds'];

const DEFAULT_ORDER_BY_FIELDS = 'Package2Id, Branch, MajorVersion, MinorVersion, PatchVersion, BuildNumber';

let logger: Logger;
const getLogger = (): Logger => {
  if (!logger) {
    logger = Logger.childFromRoot('getPackageVersionReport');
  }
  return logger;
};

function constructQuery(connectionVersion: number, verbose: boolean): string {
  // Ensure we only include the async validation property for api version of v60.0 or higher.
  // TotalNumberOfMetadataFiles is included as query field for api version of v64.0 or higher.
  let queryFields =
    connectionVersion > 63
      ? [...defaultFields, ...default61Fields, ...default64Fields]
      : connectionVersion > 60
      ? [...defaultFields, ...default61Fields]
      : defaultFields;
  verboseFields = connectionVersion > 60 ? [...verboseFields, ...verbose61Fields] : verboseFields;
  if (verbose) {
    queryFields = [...queryFields, ...verboseFields];
  }
  const select = `SELECT ${queryFields.toString()} FROM Package2Version`;
  const wherePart = "WHERE Id = '%s' AND IsDeprecated != true";
  const orderByPart = `ORDER BY ${DEFAULT_ORDER_BY_FIELDS}`;

  const query = `${select} ${wherePart} ${orderByPart}`;
  getLogger().debug(query);
  return query;
}

export async function getPackageVersionReport(options: {
  packageVersionId: string;
  connection: Connection;
  project?: SfProject;
  verbose: boolean;
}): Promise<PackageVersionReportResult[]> {
  getLogger().debug(`entering getPackageVersionReport(${util.inspect(options, { depth: null })})`);
  const queryResult = await options.connection.tooling.query<PackageVersionReportResult>(
    util.format(constructQuery(Number(options.connection.version), options.verbose), options.packageVersionId)
  );
  const records = queryResult.records;
  if (records?.length > 0) {
    const record = records[0];
    record.Version = [record.MajorVersion, record.MinorVersion, record.PatchVersion, record.BuildNumber].join('.');

    const containerOptions = await pkgUtils.getContainerOptions(record.Package2Id, options.connection);
    if (containerOptions.size > 0 && record.Package2Id) {
      record.PackageType = containerOptions.get(record.Package2Id);
    }

    record.AncestorVersion = null;

    if (record.AncestorId) {
      // lookup AncestorVersion value
      const ancestorVersionMap = await pkgUtils.getPackageVersionStrings([record.AncestorId], options.connection);
      record.AncestorVersion = ancestorVersionMap.get(record.AncestorId);
    } else if (record.PackageType !== 'Managed') {
      record.AncestorVersion = null;
      record.AncestorId = null;
    }

    record.HasPassedCodeCoverageCheck =
      record.Package2.IsOrgDependent === true || record.ValidationSkipped === true
        ? null
        : record.HasPassedCodeCoverageCheck;

    record.Package2.IsOrgDependent = record.PackageType === 'Managed' ? null : !!record.Package2.IsOrgDependent;

    // set HasMetadataRemoved to null Unlocked, otherwise use existing value
    record.HasMetadataRemoved = record.PackageType !== 'Managed' ? null : !!record.HasMetadataRemoved;

    return records;
  }
  return [];
}
