/*
 * Copyright 2025, Salesforce, Inc.
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

import { Connection, SfError, SfProject } from '@salesforce/core';
import { SaveResult, Schema } from '@jsforce/jsforce-node';
import { Duration } from '@salesforce/kit';
import { BundleCreateOptions, BundleSObjects, BundleVersionCreateOptions } from '../interfaces';
import { createBundle } from './packageBundleCreate';
import { PackageBundleVersion } from './packageBundleVersion';

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
   * Create a new package bundle version.
   *
   * @param connection - instance of Connection
   * @param project - instance of SfProject
   * @param options - options for creating a bundle version - see BundleVersionCreateOptions
   * @returns PackageBundle
   */
  public static async createVersion(
    options: BundleVersionCreateOptions,
    polling: { frequency: Duration; timeout: Duration } = {
      frequency: Duration.seconds(0),
      timeout: Duration.seconds(0),
    }
  ): Promise<BundleSObjects.PackageBundleVersionCreateRequestResult> {
    return PackageBundleVersion.create(options, polling);
  }

  public static async delete(connection: Connection, project: SfProject, idOrAlias: string): Promise<SaveResult> {
    // Check if it's already an ID (1Fl followed by 15 characters)
    if (/^1Fl.{15}$/.test(idOrAlias)) {
      return connection.tooling.sobject('PackageBundle').delete(idOrAlias);
    }

    // Validate that project is provided when using aliases
    if (!project) {
      throw new SfError('Project instance is required when deleting package bundle by alias');
    }
    // eslint-disable-next-line no-param-reassign
    idOrAlias = project.getPackageBundleIdFromAlias(idOrAlias) ?? idOrAlias;

    return connection.tooling.sobject('PackageBundle').delete(idOrAlias);
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
