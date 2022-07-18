/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection } from '@salesforce/core';
import { Package1Display, PackagingSObjects } from '../interfaces';

/**
 * Executes server-side logic for the package1:display command
 *
 * @param connection
 * @param id: id of the MetadataPackageVersion sObject
 */
export async function package1Display(connection: Connection, id: string): Promise<Package1Display[]> {
  const query = `SELECT Id,MetadataPackageId,Name,ReleaseState,MajorVersion,MinorVersion,PatchVersion,BuildNumber FROM MetadataPackageVersion WHERE id = '${id}'`;
  const results = (await connection.tooling.query<PackagingSObjects.MetadataPackageVersion>(query)).records;
  return results.map((result) => ({
    MetadataPackageVersionId: result.Id,
    MetadataPackageId: result.MetadataPackageId,
    Name: result.Name,
    ReleaseState: result.ReleaseState,
    Version: `${result.MajorVersion}.${result.MinorVersion}.${result.PatchVersion}`,
    BuildNumber: result.BuildNumber,
  }));
}
