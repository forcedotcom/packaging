/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, SfProject } from '@salesforce/core';
import { SaveResult } from 'jsforce';
import * as pkgUtils from '../utils/packageUtils';
import { combineSaveErrors } from '../utils';

export async function deletePackage(
  idOrAlias: string,
  project: SfProject,
  connection: Connection,
  undelete: boolean
): Promise<SaveResult> {
  const packageId = pkgUtils.getPackageIdFromAlias(idOrAlias, project);
  pkgUtils.validateId(pkgUtils.BY_LABEL.PACKAGE_ID, packageId);

  const request = {} as { Id: string; IsDeprecated: boolean };
  request.Id = packageId;
  const isUndelete = undelete;
  request.IsDeprecated = !isUndelete;

  const updateResult = await connection.tooling.update('Package2', request);
  if (!updateResult.success) {
    throw combineSaveErrors('Package2', 'update', updateResult.errors);
  }
  return updateResult;
}
