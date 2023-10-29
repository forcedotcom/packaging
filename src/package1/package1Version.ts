/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as os from 'node:os';
import { Connection, Lifecycle, Messages, PollingClient, StatusResult } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import {
  IPackageVersion1GP,
  Package1VersionCreateRequest,
  Package1VersionEvents,
  PackagingSObjects,
} from '../interfaces';
import MetadataPackageVersion = PackagingSObjects.MetadataPackageVersion;

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package1Version');

/**
 * Provides the ability to get, list, and create 1st generation package versions.
 *
 * **Examples**
 *
 * List all 1GP package versions in the org:
 *
 * `const pkgList = await Package1Version.list(connection);`
 *
 * Create a new 1GP package vesion in the org:
 *
 * `const myPkg = await Package1Version.create(connection, options, pollingOptions);`
 *
 * More implementation examples are in the plugin here: https://github.com/salesforcecli/plugin-packaging/tree/main/src/commands/force/package1/
 */
export class Package1Version implements IPackageVersion1GP {
  /**
   * Package1Version Constructor - Class to be used with 1st generation package versions
   *
   * @param connection: Connection to the org
   * @param id: 04t ID of the package version
   */
  public constructor(private connection: Connection, private id: string) {
    if (!id.startsWith('04t')) {
      throw messages.createError('invalid04tId', [id]);
    }
  }

  /**
   * Will create a PackageUploadRequest object based on the options provided, will poll for completion if pollingOptions are provided
   *
   * @param connection: Connection to the org
   * @param options: Package1VersionCreateRequest options for the new PackageUploadRequest to be created with
   * @param pollingOptions: options to set frequency, and duration of polling. Default to not poll
   */
  public static async create(
    connection: Connection,
    options: Package1VersionCreateRequest,
    pollingOptions = { frequency: Duration.seconds(5), timeout: Duration.seconds(0) }
  ): Promise<PackagingSObjects.PackageUploadRequest> {
    if (!options.MetadataPackageId?.startsWith('033')) {
      throw messages.createError('missingMetadataPackageId');
    }
    if (!options.VersionName) {
      throw messages.createError('missingVersionName');
    }
    const createRequest = await connection.tooling.sobject('PackageUploadRequest').create(options);
    if (createRequest.success) {
      if (pollingOptions.timeout.seconds) {
        const timeout = pollingOptions.timeout.seconds;
        const pollingClient = await PollingClient.create({
          poll: () =>
            Package1Version.packageUploadPolling(
              connection,
              createRequest.id,
              timeout,
              pollingOptions.frequency.seconds
            ),
          ...pollingOptions,
        });
        return pollingClient.subscribe<PackagingSObjects.PackageUploadRequest>();
      } else {
        // jsforce templates weren't working when setting the type to PackageUploadRequest, so we have to cast `as unknown as PackagingSObjects.PackageUploadRequest`
        return (await connection.tooling
          .sobject('PackageUploadRequest')
          .retrieve(createRequest.id)) as unknown as PackagingSObjects.PackageUploadRequest;
      }
    } else {
      throw messages.createError('createFailed', [JSON.stringify(createRequest)]);
    }
  }

  /**
   * Returns the status of a PackageUploadRequest
   *
   * @param connection Connection to the target org
   * @param id 0HD Id of the PackageUploadRequest
   */
  public static async getCreateStatus(
    connection: Connection,
    id: string
  ): Promise<PackagingSObjects.PackageUploadRequest> {
    if (!id.startsWith('0HD')) {
      throw messages.createError('invalid0HDId', [id]);
    }
    return (await connection.tooling
      .sobject('PackageUploadRequest')
      .retrieve(id)) as unknown as PackagingSObjects.PackageUploadRequest;
  }

  /**
   * Lists package versions available in the org. If package ID is supplied, only list versions of that package,
   * otherwise, list all package versions
   *
   * @param connection Connection to the org
   * @param id: optional, if present, ID of package to list versions for (starts with 033)
   * @returns Array of package version results
   */
  public static async list(connection: Connection, id?: string): Promise<MetadataPackageVersion[]> {
    if (id && !id?.startsWith('033')) {
      // we have to check that it is present, and starts with 033
      // otherwise, undefined doesn't start with 033 and will trigger this error, when it shouldn't
      throw messages.createError('invalid033Id', [id]);
    }
    const query = `SELECT Id,MetadataPackageId,Name,ReleaseState,MajorVersion,MinorVersion,PatchVersion,BuildNumber FROM MetadataPackageVersion ${
      id ? `WHERE MetadataPackageId = '${id}'` : ''
    } ORDER BY MetadataPackageId, MajorVersion, MinorVersion, PatchVersion, BuildNumber`;

    return (await connection.tooling.query<PackagingSObjects.MetadataPackageVersion>(query)).records;
  }

  private static async packageUploadPolling(
    connection: Connection,
    id: string,
    timeout: number,
    frequency: number
  ): Promise<StatusResult> {
    const pollingResult = await connection.tooling.sobject('PackageUploadRequest').retrieve(id);
    switch (pollingResult.Status) {
      case 'SUCCESS':
        return { completed: true, payload: pollingResult };
      case 'IN_PROGRESS':
      case 'QUEUED':
        timeout -= frequency;
        await Lifecycle.getInstance().emit(Package1VersionEvents.create.progress, { timeout, pollingResult });

        return { completed: false, payload: pollingResult };
      default: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const errors = pollingResult?.Errors?.errors as Error[];
        if (errors?.length > 0) {
          throw messages.createError('package1VersionCreateCommandUploadFailure', [
            errors.map((e: Error) => e.message).join(os.EOL),
          ]);
        } else {
          throw messages.createError('package1VersionCreateCommandUploadFailureDefault');
        }
      }
    }
  }

  /**
   * Queries the org for the package version with the given ID
   */
  public async getPackageVersion(): Promise<MetadataPackageVersion[]> {
    const query = `SELECT Id, MetadataPackageId, Name, ReleaseState, MajorVersion, MinorVersion, PatchVersion, BuildNumber FROM MetadataPackageVersion WHERE id = '${this.id}'`;
    return (await this.connection.tooling.query<PackagingSObjects.MetadataPackageVersion>(query)).records;
  }
}
