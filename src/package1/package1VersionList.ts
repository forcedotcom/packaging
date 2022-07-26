/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection } from '@salesforce/core';
import { Package1Display, PackagingSObjects } from '../interfaces';

/**
 * Lists package versions available in dev org. If package ID is supplied, only list versions of that package,
 *  otherwise, list all package versions
 *
 * @param metadataPackageId: optional, if present ID of package to list versions for (starts with 033)
 * @returns Array of package version results
 */
export async function package1VersionList(
  connection: Connection,
  metadataPackageId?: string
): Promise<Package1Display[]> {
  const query = `SELECT Id,MetadataPackageId,Name,ReleaseState,MajorVersion,MinorVersion,PatchVersion,BuildNumber FROM MetadataPackageVersion ${
    metadataPackageId ? `WHERE MetadataPackageId = '${metadataPackageId}'` : ''
  } ORDER BY MetadataPackageId, MajorVersion, MinorVersion, PatchVersion, BuildNumber`;

  const queryResult = await connection.tooling.query<PackagingSObjects.MetadataPackageVersion>(query);
  return queryResult.records?.map((record) => ({
    MetadataPackageVersionId: record.Id,
    MetadataPackageId: record.MetadataPackageId,
    Name: record.Name,
    ReleaseState: record.ReleaseState,
    Version: `${record.MajorVersion}.${record.MinorVersion}.${record.PatchVersion}`,
    BuildNumber: record.BuildNumber,
  }));
}
