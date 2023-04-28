/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection } from '@salesforce/core';
import { PackageVersionCreateRequestResult } from '../interfaces';
import * as pkgUtils from '../utils/packageUtils';
import { applyErrorAction, massageErrorMessage } from '../utils/packageUtils';
import { byId } from './packageVersionCreateRequest';

export async function getCreatePackageVersionCreateRequestReport(options: {
  createPackageVersionRequestId: string;
  connection: Connection;
}): Promise<PackageVersionCreateRequestResult> {
  try {
    pkgUtils.validateId(pkgUtils.BY_LABEL.PACKAGE_VERSION_CREATE_REQUEST_ID, options.createPackageVersionRequestId);
    const results = await byId(options.createPackageVersionRequestId, options.connection);
    return results[0];
  } catch (err) {
    if (err instanceof Error) {
      throw applyErrorAction(massageErrorMessage(err));
    }
    throw err;
  }
}
