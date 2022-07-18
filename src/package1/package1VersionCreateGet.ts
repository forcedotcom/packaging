/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection } from '@salesforce/core';
import { PackagingSObjects } from '../interfaces';

export async function package1VersionCreateGet(
  connection: Connection,
  id: string
): Promise<PackagingSObjects.PackageUploadRequest> {
  return (await connection.tooling
    .sobject('PackageUploadRequest')
    .retrieve(id)) as unknown as PackagingSObjects.PackageUploadRequest;
}
