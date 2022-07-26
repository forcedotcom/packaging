/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

// Node
import * as util from 'util';

// Local
import { Logger, Connection, SfProject } from '@salesforce/core';
import * as pkgUtils from '../utils/packageUtils';
import { PackageVersionReportResult } from '../interfaces';

const QUERY =
  'SELECT Package2Id, SubscriberPackageVersionId, Name, Description, Tag, Branch, AncestorId, ValidationSkipped, ' +
  'MajorVersion, MinorVersion, PatchVersion, BuildNumber, IsReleased, CodeCoverage, HasPassedCodeCoverageCheck, ' +
  'Package2.IsOrgDependent, ReleaseVersion, BuildDurationInSeconds, HasMetadataRemoved, CreatedById ' +
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

const logger = Logger.childFromRoot('getPackageVersionReport');
export async function getPackageVersionReport(options: {
  idOrAlias: string;
  connection: Connection;
  project: SfProject;
  verbose: boolean;
}): Promise<PackageVersionReportResult[]> {
  logger.debug(`entering getPackageVersionReport(${util.inspect(options, { depth: null })})`);
  let packageVersionId = pkgUtils.getPackageIdFromAlias(options.idOrAlias, options.project);

  // ID can be an 04t or 05i
  pkgUtils.validateId(
    [pkgUtils.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, pkgUtils.BY_LABEL.PACKAGE_VERSION_ID],
    packageVersionId
  );

  // lookup the 05i ID, if needed
  packageVersionId = await pkgUtils.getPackageVersionId(packageVersionId, options.connection);
  const queryResult = await options.connection.tooling.query<PackageVersionReportResult>(
    util.format(options.verbose ? QUERY_VERBOSE : QUERY, packageVersionId)
  );
  const records = queryResult.records;
  if (records && records.length > 0) {
    const record = records[0];
    record.Version = [record.MajorVersion, record.MinorVersion, record.PatchVersion, record.BuildNumber].join('.');

    const containerOptions = await pkgUtils.getContainerOptions([record.Package2Id], options.connection);
    const packageType = containerOptions.get(record.Package2Id);

    let ancestorVersion = null;

    if (record.AncestorId) {
      // lookup AncestorVersion value
      const ancestorVersionMap = await pkgUtils.getPackageVersionStrings([record.AncestorId], options.connection);
      ancestorVersion = ancestorVersionMap.get(record.AncestorId);
    } else {
      // otherwise display 'N/A' if package is Unlocked Packages
      if (packageType !== 'Managed') {
        ancestorVersion = null;
        record.AncestorId = null;
      }
    }

    record.HasPassedCodeCoverageCheck =
      record.Package2.IsOrgDependent === true || record.ValidationSkipped === true
        ? null
        : record.HasPassedCodeCoverageCheck;

    record.Package2.IsOrgDependent = packageType === 'Managed' ? null : !!record.Package2.IsOrgDependent;

    // set HasMetadataRemoved to null Unlocked, otherwise use existing value
    record.HasMetadataRemoved = packageType !== 'Managed' ? null : !!record.HasMetadataRemoved;

    record.AncestorVersion = ancestorVersion;
    return records;
  }
  return [];
}
