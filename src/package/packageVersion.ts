/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Lifecycle, Messages, PollingClient, SfProject, StatusResult } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import {
  PackageSaveResult,
  PackageVersionCreateOptions,
  PackageVersionCreateRequestQueryOptions,
  PackageVersionCreateRequestResult,
  PackageVersionEvents,
  PackageVersionListOptions,
  PackageVersionListResult,
  PackageVersionOptions,
  PackageVersionReportResult,
  PackageVersionUpdateOptions,
} from '../interfaces';
import {
  applyErrorAction,
  BY_LABEL,
  combineSaveErrors,
  getPackageAliasesFromId,
  getPackageIdFromAlias,
  getPackageVersionId,
  getSubscriberPackageVersionId,
  validateId,
} from '../utils';
import { PackageVersionCreate } from './packageVersionCreate';
import { getPackageVersionReport } from './packageVersionReport';
import { getCreatePackageVersionCreateRequestReport } from './packageVersionCreateRequestReport';
import { listPackageVersions } from './packageVersionList';
import { list } from './packageVersionCreateRequest';
import { PackagingIdResolver } from './PackagingIdResolver';

Messages.importMessagesDirectory(__dirname);

export class PackageVersion {
  private readonly project: SfProject;
  private readonly connection: Connection;
  private packagingIdResolver: PackagingIdResolver;

  public constructor(private options: PackageVersionOptions) {
    this.connection = options.connection;
    this.project = options.project;
    this.packagingIdResolver = PackagingIdResolver.init(options.project);
  }

  /**
   * Creates a new package version.
   *
   * @param options
   * @param polling frequency and timeout Durations to be used in polling
   */
  public async create(
    options: PackageVersionCreateOptions,
    polling: { frequency: Duration; timeout: Duration } = {
      frequency: Duration.seconds(0),
      timeout: Duration.seconds(0),
    }
  ): Promise<Partial<PackageVersionCreateRequestResult>> {
    options.packageId = this.packagingIdResolver.resolve(options.packageId, 'PackageId');
    const pvc = new PackageVersionCreate({ ...options, ...this.options });
    const createResult = await pvc.createPackageVersion();

    return this.waitForCreateVersion(createResult.Id, polling).catch((err: Error) => {
      // TODO
      // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      throw applyErrorAction(err);
    });
  }

  /**
   * Deletes a package version.
   *
   * @param idOrAlias 04t ID, 05i ID, or alias for one of those IDs.
   */
  public async delete(idOrAlias: string): Promise<PackageSaveResult> {
    return this.updateDeprecation(idOrAlias, true);
  }

  /**
   * Undeletes a package version.
   *
   * @param idOrAlias 04t ID, 05i ID, or alias for one of those IDs.
   */
  public async undelete(idOrAlias: string): Promise<PackageSaveResult> {
    return this.updateDeprecation(idOrAlias, false);
  }

  /**
   * Gets the package version report.
   *
   * @param idOrAlias 04t ID, 05i ID, or alias for one of those IDs.
   * @param verbose
   */
  public async report(idOrAlias: string, verbose = false): Promise<PackageVersionReportResult> {
    const results = await getPackageVersionReport({
      idOrAlias,
      connection: this.connection,
      project: this.project,
      verbose,
    }).catch((err: Error) => {
      // TODO
      // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      throw applyErrorAction(err);
    });
    return results[0];
  }

  /**
   * Gets current state of a package version create request.
   *
   * @param createPackageRequestId The PackageVersionCreateRequestId
   */
  public async getCreateVersionReport(createPackageRequestId: string): Promise<PackageVersionCreateRequestResult> {
    createPackageRequestId = this.packagingIdResolver.resolve(createPackageRequestId, 'PackageVersionCreateRequestId');
    return await getCreatePackageVersionCreateRequestReport({
      createPackageVersionRequestId: createPackageRequestId,
      connection: this.connection,
    }).catch((err: Error) => {
      // TODO
      // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      throw applyErrorAction(err);
    });
  }

  public async createdList(
    options?: Omit<PackageVersionCreateRequestQueryOptions, 'connection'>
  ): Promise<PackageVersionCreateRequestResult[]> {
    return list({ ...options, connection: this.connection });
  }

  /**
   * Convenience function that will wait for a package version to be created.
   *
   * This function emits LifeCycle events, "enqueued", "in-progress", "success", "error" and "timed-out" to
   * progress and current status. Events also carry a payload of type PackageVersionCreateRequestResult.
   *
   * @param createPackageVersionRequestId
   * @param polling frequency and timeout Durations to be used in polling
   * */
  public async waitForCreateVersion(
    createPackageVersionRequestId: string,
    polling: { frequency: Duration; timeout: Duration }
  ): Promise<PackageVersionCreateRequestResult> {
    createPackageVersionRequestId = this.packagingIdResolver.resolve(
      createPackageVersionRequestId,
      'PackageVersionCreateRequestId'
    );
    if (polling.timeout?.milliseconds <= 0) {
      return this.getCreateVersionReport(createPackageVersionRequestId);
    }
    let remainingWaitTime: Duration = polling.timeout;
    let report: PackageVersionCreateRequestResult;
    const pollingClient = await PollingClient.create({
      poll: async (): Promise<StatusResult> => {
        report = await this.getCreateVersionReport(createPackageVersionRequestId);
        switch (report.Status) {
          case 'Queued':
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.enqueued, { ...report, remainingWaitTime });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - polling.frequency.seconds);
            return {
              completed: false,
              payload: report,
            };
          case 'InProgress':
          case 'Initializing':
          case 'VerifyingFeaturesAndSettings':
          case 'VerifyingDependencies':
          case 'VerifyingMetadata':
          case 'FinalizingPackageVersion':
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.progress, {
              ...report,
              remainingWaitTime,
            });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - polling.frequency.seconds);
            return {
              completed: false,
              payload: report,
            };
          case 'Success':
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.success, report);
            await this.updateProjectWithPackageVersion(this.project, report);
            return { completed: true, payload: report };
          case 'Error':
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.error, report);
            return { completed: true, payload: report };
        }
      },

      frequency: polling.frequency,
      timeout: polling.timeout,
    });
    try {
      return pollingClient.subscribe<PackageVersionCreateRequestResult>();
    } catch (err) {
      await Lifecycle.getInstance().emit(PackageVersionEvents.create['timed-out'], report);
      throw applyErrorAction(err as Error);
    }
  }

  public async list(options: PackageVersionListOptions): Promise<PackageVersionListResult[]> {
    return (await listPackageVersions({ ...options, ...{ connection: this.connection } })).records;
  }

  public async promote(id: string): Promise<PackageSaveResult> {
    // lookup the 05i ID, if needed
    if (id.startsWith('04t')) {
      id = await getPackageVersionId(id, this.connection);
    }
    return this.options.connection.tooling.update('Package2Version', { IsReleased: true, Id: id });
  }

  public async update(id: string, options: PackageVersionUpdateOptions): Promise<PackageSaveResult> {
    // ID can be an 04t or 05i
    validateId([BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, BY_LABEL.PACKAGE_VERSION_ID], id);

    // lookup the 05i ID, if needed
    id = await getPackageVersionId(id, this.connection);

    const request = {
      Id: id,
      InstallKey: options.InstallKey,
      Name: options.VersionName,
      Description: options.VersionDescription,
      Branch: options.Branch,
      Tag: options.Tag,
    };

    // filter out any undefined values and their keys
    Object.keys(request).forEach((key) => request[key] === undefined && delete request[key]);

    const result = await this.connection.tooling.update('Package2Version', request);
    if (!result.success) {
      throw new Error(result.errors.join(', '));
    }
    // Use the 04t ID for the success message
    result.id = await getSubscriberPackageVersionId(id, this.connection);
    return result;
  }

  private async updateDeprecation(idOrAlias: string, IsDeprecated): Promise<PackageSaveResult> {
    const packageVersionId = getPackageIdFromAlias(idOrAlias, this.project);

    // ID can be an 04t or 05i
    validateId([BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, BY_LABEL.PACKAGE_VERSION_ID], packageVersionId);

    // lookup the 05i ID, if needed
    const packageId = await getPackageVersionId(packageVersionId, this.connection);

    // setup the request
    const request: { Id: string; IsDeprecated: boolean } = {
      Id: packageId,
      IsDeprecated,
    };

    const updateResult = await this.connection.tooling.update('Package2Version', request);
    if (!updateResult.success) {
      throw combineSaveErrors('Package2', 'update', updateResult.errors);
    }
    updateResult.id = await getSubscriberPackageVersionId(packageVersionId, this.connection);
    return updateResult;
  }

  private async updateProjectWithPackageVersion(
    withProject: SfProject,
    results: PackageVersionCreateRequestResult
  ): Promise<void> {
    if (withProject && !process.env.SFDX_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_CREATE) {
      // get the newly created package version from the server
      const versionResult = (
        await this.connection.tooling.query<{
          Branch: string;
          MajorVersion: string;
          MinorVersion: string;
          PatchVersion: string;
          BuildNumber: string;
        }>(
          `SELECT Branch, MajorVersion, MinorVersion, PatchVersion, BuildNumber FROM Package2Version WHERE SubscriberPackageVersionId='${results.SubscriberPackageVersionId}'`
        )
      ).records[0];
      const version = `${getPackageAliasesFromId(results.Package2Id, this.project).join()}@${
        versionResult.MajorVersion ?? 0
      }.${versionResult.MinorVersion ?? 0}.${versionResult.PatchVersion ?? 0}`;
      const build = versionResult.BuildNumber ? `-${versionResult.BuildNumber}` : '';
      const branch = versionResult.Branch ? `-${versionResult.Branch}` : '';
      // set packageAliases entry '<package>@<major>.<minor>.<patch>-<build>-<branch>: <result.subscriberPackageVersionId>'
      this.project.getSfProjectJson().getContents().packageAliases[`${version}${build}${branch}`] =
        results.SubscriberPackageVersionId;
      await this.project.getSfProjectJson().write();
    }
  }
}
