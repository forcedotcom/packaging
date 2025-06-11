/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, SfProject } from '@salesforce/core';
import { BundleCreateOptions } from '../interfaces';
import { createBundle } from './packageBundleCreate';

export class PackageBundle {
  /**
   * Create a new package bundle.
   *
   * @param connection - instance of Connection
   * @param project - instance of SfProject
   * @param options - options for creating a package - see PackageCreateOptions
   * @returns Package
   */
  public static async create(
    connection: Connection,
    project: SfProject,
    options: BundleCreateOptions
  ): Promise<{ Id: string }> {
    return createBundle(connection, project, options);
  }
}
