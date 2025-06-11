/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, SfProject } from '@salesforce/core';
import { Schema } from '@jsforce/jsforce-node';
import { BundleCreateOptions, BundleSObjects } from '../interfaces';
import { createBundle } from './packageBundleCreate';

const BundleFields = [
  'BundleName',
  'Description',
  'Id',
  'IsDeleted',
  'CreatedDate',
  'CreatedById',
  'LastModifiedDate',
  'LastModifiedById',
  'SystemModstamp',
];

export class PackageBundle {
  /**
   * Create a new package bundle.
   *
   * @param connection - instance of Connection
   * @param project - instance of SfProject
   * @param options - options for creating a bundle - see BundleCreateOptions
   * @returns PackageBundle
   */
  public static async create(
    connection: Connection,
    project: SfProject,
    options: BundleCreateOptions
  ): Promise<{ Id: string }> {
    return createBundle(connection, project, options);
  }

  /**
   * Returns all the package bundles that are available in the org, up to 10,000. If more records are
   * needed use the `SF_ORG_MAX_QUERY_LIMIT` env var.
   *
   * @param connection
   */
  public static async list(connection: Connection): Promise<BundleSObjects.Bundle[]> {
    const query = `select ${BundleFields.join(', ')} from PackageBundle ORDER BY BundleName`;
    return (await connection.autoFetchQuery<BundleSObjects.Bundle & Schema>(query, { tooling: true }))?.records;
  }
}
