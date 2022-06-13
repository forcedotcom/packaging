/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection } from '@salesforce/core';
import { QueryResult } from 'jsforce';
import { PackagingSObjects } from '../interfaces';
const QUERY =
  'SELECT Id, SubscriberPackageId, Name, Description, NamespacePrefix, ContainerOptions, IsOrgDependent, ConvertedFromPackageId, ' +
  'PackageErrorUsername, CreatedById ' +
  'FROM Package2 ' +
  'WHERE IsDeprecated != true ' +
  'ORDER BY NamespacePrefix, Name';

export async function listPackages(connection: Connection): Promise<QueryResult<PackagingSObjects.Package2>> {
  return await connection.tooling.query<PackagingSObjects.Package2>(QUERY);
}
