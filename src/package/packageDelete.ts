/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, SfProject } from '@salesforce/core';
import { applyErrorAction, BY_LABEL, combineSaveErrors, massageErrorMessage, validateId } from '../utils/packageUtils';
import { PackageSaveResult } from '../interfaces';

export async function deletePackage(
  idOrAlias: string,
  project: SfProject,
  connection: Connection,
  undelete: boolean
): Promise<PackageSaveResult> {
  const packageId = project.getPackageIdFromAlias(idOrAlias) ?? idOrAlias;
  validateId(BY_LABEL.PACKAGE_ID, packageId);

  const request = { Id: packageId, IsDeprecated: !undelete };

  const updateResult = await connection.tooling.update('Package2', request).catch((err) => {
    if (err instanceof Error) {
      throw applyErrorAction(massageErrorMessage(err));
    }
    throw err;
  });
  if (!updateResult.success) {
    throw combineSaveErrors('Package2', 'update', updateResult.errors);
  }
  return updateResult;
}
