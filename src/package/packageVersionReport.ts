/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

// Node
import * as util from 'node:util';

// Local
import { Connection, Logger, SfProject } from '@salesforce/core';
import * as pkgUtils from '../utils/packageUtils';
import { PackageVersionReportResult } from '../interfaces';

const QUERY =
  'SELECT Package2Id, SubscriberPackageVersionId, Name, Description, Tag, Branch, AncestorId, ValidationSkipped, ' +
  'MajorVersion, MinorVersion, PatchVersion, BuildNumber, IsReleased, CodeCoverage, HasPassedCodeCoverageCheck, ' +
  'Package2.IsOrgDependent, ReleaseVersion, BuildDurationInSeconds, HasMetadataRemoved, CreatedById, ConvertedFromVersionId  ' +
  'FROM Package2Version ' +
  "WHERE Id = '%s' AND IsDeprecated != true " +
  'ORDER BY Package2Id, Branch, MajorVersion, MinorVersion, PatchVersion, BuildNumber';

// verbose adds: Id, ConvertedFromVersionId, SubscriberPackageVersion.Dependencies
const QUERY_VERBOSE =
  'SELECT Id, Package2Id, SubscriberPackageVersionId, Name, Description, Tag, Branch, AncestorId, ValidationSkipped, ' +
  'MajorVersion, MinorVersion, PatchVersion, BuildNumber, IsReleased, CodeCoverage, HasPassedCodeCoverageCheck, ConvertedFromVersionId, ' +
  'Package2.IsOrgDependent, ReleaseVersion, BuildDurationInSeconds, HasMetadataRemoved, SubscriberPackageVersion.Dependencies, ' +
  'CreatedById, CodeCoveragePercentages ' +
  'FROM Package2Version ' +
  "WHERE Id = '%s' AND IsDeprecated != true " +
  'ORDER BY Package2Id, Branch, MajorVersion, MinorVersion, PatchVersion, BuildNumber';

let logger: Logger;
const getLogger = (): Logger => {
  if (!logger) {
    logger = Logger.childFromRoot('getPackageVersionReport');
  }
  return logger;
};

export async function getPackageVersionReport(options: {
  packageVersionId: string;
  connection: Connection;
  project: SfProject;
  verbose: boolean;
}): Promise<PackageVersionReportResult[]> {
  getLogger().debug(`entering getPackageVersionReport(${util.inspect(options, { depth: null })})`);
  const queryResult = await options.connection.tooling.query<PackageVersionReportResult>(
    util.format(options.verbose ? QUERY_VERBOSE : QUERY, options.packageVersionId)
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
