/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as os from 'os';
import { Connection, Lifecycle, Messages, PollingClient, StatusResult } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import {
  IPackageVersion1GP,
  Package1Display,
  Package1VersionCreateRequest,
  Package1VersionEvents,
  PackagingSObjects,
} from '../interfaces';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package1Version');

/**
 * Package1Version class - Class to be used with 1st generation package versions
 */
export class Package1Version implements IPackageVersion1GP {
  public constructor(private connection: Connection) {}

  public async createReport(id: string): Promise<PackagingSObjects.PackageUploadRequest> {
    return (await this.connection.tooling
      .sobject('PackageUploadRequest')
      .retrieve(id)) as unknown as PackagingSObjects.PackageUploadRequest;
  }

  public async create(
    options: Package1VersionCreateRequest,
    pollingOptions = { frequency: Duration.seconds(5), timeout: Duration.seconds(0) }
  ): Promise<PackagingSObjects.PackageUploadRequest> {
    const createRequest = await this.connection.tooling.sobject('PackageUploadRequest').create(options);
    if (pollingOptions.timeout.seconds) {
      const timeout = pollingOptions.timeout.seconds;
      const pollingClient = await PollingClient.create({
        poll: () => this.packageUploadRequestStatus(createRequest.id, timeout, pollingOptions.frequency.seconds),
        ...pollingOptions,
      });
      return pollingClient.subscribe<PackagingSObjects.PackageUploadRequest>();
    } else {
      // jsforce templates weren't working when setting the type to PackageUploadRequest, so we have to cast `as unknown as PackagingSObjects.PackageUploadRequest`
      return (await this.connection.tooling
        .sobject('PackageUploadRequest')
        .retrieve(createRequest.id)) as unknown as PackagingSObjects.PackageUploadRequest;
    }
  }

  /**
   * Executes server-side logic for the package1:display command
   *
   * @param id: id of the MetadataPackageVersion sObject (starts with 04t)
   */
  public async display(id: string): Promise<Package1Display[]> {
    if (!id.startsWith('04t')) {
      throw messages.createError('invalid04tId', [id]);
    }
    const query = `SELECT Id,MetadataPackageId,Name,ReleaseState,MajorVersion,MinorVersion,PatchVersion,BuildNumber FROM MetadataPackageVersion WHERE id = '${id}'`;
    const results = (await this.connection.tooling.query<PackagingSObjects.MetadataPackageVersion>(query)).records;
    return results.map((result) => ({
      MetadataPackageVersionId: result.Id,
      MetadataPackageId: result.MetadataPackageId,
      Name: result.Name,
      ReleaseState: result.ReleaseState,
      Version: `${result.MajorVersion}.${result.MinorVersion}.${result.PatchVersion}`,
      BuildNumber: result.BuildNumber,
    }));
  }

  /**
   * Lists package versions available in dev org. If package ID is supplied, only list versions of that package,
   * otherwise, list all package versions
   *
   * @param id: optional, if present ID of package to list versions for (starts with 033)
   * @returns Array of package version results
   */
  public async list(id?: string): Promise<Package1Display[]> {
    if (id && !id?.startsWith('033')) {
      throw messages.createError('invalid033Id', [id]);
    }
    const query = `SELECT Id,MetadataPackageId,Name,ReleaseState,MajorVersion,MinorVersion,PatchVersion,BuildNumber FROM MetadataPackageVersion ${
      id ? `WHERE MetadataPackageId = '${id}'` : ''
    } ORDER BY MetadataPackageId, MajorVersion, MinorVersion, PatchVersion, BuildNumber`;

    const queryResult = await this.connection.tooling.query<PackagingSObjects.MetadataPackageVersion>(query);
    return queryResult.records?.map((record) => ({
      MetadataPackageVersionId: record.Id,
      MetadataPackageId: record.MetadataPackageId,
      Name: record.Name,
      ReleaseState: record.ReleaseState,
      Version: `${record.MajorVersion}.${record.MinorVersion}.${record.PatchVersion}`,
      BuildNumber: record.BuildNumber,
    }));
  }

  private async packageUploadRequestStatus(id: string, timeout: number, frequency: number): Promise<StatusResult> {
    const pollingResult = await this.connection.tooling.sobject('PackageUploadRequest').retrieve(id);
    switch (pollingResult.Status) {
      case 'SUCCESS':
        return { completed: true, payload: pollingResult };
      case 'IN_PROGRESS':
      case 'QUEUED':
        timeout -= frequency;
        await Lifecycle.getInstance().emit(Package1VersionEvents.create.progress, { timeout, pollingResult });

        return { completed: false, payload: pollingResult };
      default: {
        if (pollingResult?.Errors?.errors?.length > 0) {
          throw messages.createError('package1VersionCreateCommandUploadFailure', [
            (pollingResult.Errors.errors.map((e: Error) => e.message) as string[]).join(os.EOL),
          ]);
        } else {
          throw messages.createError('package1VersionCreateCommandUploadFailureDefault');
        }
      }
    }
  }
}
