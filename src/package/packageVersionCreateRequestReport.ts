/*
 * Copyright 2026, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
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
