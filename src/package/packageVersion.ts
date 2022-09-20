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
  PackagingSObjects,
} from '../interfaces';
import {
  applyErrorAction,
  BY_LABEL,
  combineSaveErrors,
  getPackageAliasesFromId,
  getPackageIdFromAlias,
  getPackageVersionId,
  massageErrorMessage,
  validateId,
} from '../utils';
import { PackageVersionCreate } from './packageVersionCreate';
import { getPackageVersionReport } from './packageVersionReport';
import { getCreatePackageVersionCreateRequestReport } from './packageVersionCreateRequestReport';
import { listPackageVersions } from './packageVersionList';
import { list } from './packageVersionCreateRequest';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_version');
export class PackageVersion {
  private readonly project: SfProject;
  private readonly connection: Connection;

  public constructor(private options: PackageVersionOptions) {
    this.connection = this.options.connection;
    this.project = this.options.project;
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
    const pvc = new PackageVersionCreate({ ...options, ...this.options });
    const createResult = await pvc.createPackageVersion();

    return await this.waitForCreateVersion(createResult.Id, polling).catch((err: Error) => {
      // TODO
      // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      throw applyErrorAction(err);
    });
  }

  /**
   * Deletes a package version.
   *
   * @param idOrAlias
   */
  public async delete(idOrAlias: string): Promise<PackageSaveResult> {
    return this.updateDeprecation(idOrAlias, true);
  }

  /**
   * Undeletes a package version.
   *
   * @param idOrAlias
   */
  public async undelete(idOrAlias: string): Promise<PackageSaveResult> {
    return this.updateDeprecation(idOrAlias, false);
  }

  /**
   * Gets the package version report.
   *
   * @param createPackageRequestId
   * @param verbose
   */
  public async report(createPackageRequestId: string, verbose = false): Promise<PackageVersionReportResult> {
    const results = await getPackageVersionReport({
      idOrAlias: createPackageRequestId,
      connection: this.connection,
      project: this.project,
      verbose,
    }).catch((err: Error) => {
      // TODO
      // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      throw applyErrorAction(massageErrorMessage(err));
    });
    return results[0];
  }

  /**
   * Gets current state of a package version create request.
   *
   * @param createPackageRequestId
   */
  public async getCreateVersionReport(createPackageRequestId: string): Promise<PackageVersionCreateRequestResult> {
    return await getCreatePackageVersionCreateRequestReport({
      createPackageVersionRequestId: createPackageRequestId,
      connection: this.connection,
    }).catch((err: Error) => {
      // TODO
      // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      throw applyErrorAction(massageErrorMessage(err));
    });
  }

  public async createdList(
    options?: Omit<PackageVersionCreateRequestQueryOptions, 'connection'>
  ): Promise<PackageVersionCreateRequestResult[]> {
    return await list({ ...options, connection: this.connection });
  }

  /**
   * Convenience function that will wait for a package version to be created.
   *
   * This function emits LifeCycle events, "enqueued", "in-progress", "success", "error" and "timed-out" to
   * progress and current status. Events also carry a payload of type PackageVersionCreateRequestResult.
   *
   * @param packageId - The package id to wait for
   * @param createPackageVersionRequestId
   * @param polling frequency and timeout Durations to be used in polling
   * */
  public async waitForCreateVersion(
    createPackageVersionRequestId: string,
    polling: { frequency: Duration; timeout: Duration }
  ): Promise<PackageVersionCreateRequestResult> {
    if (polling.timeout?.milliseconds <= 0) {
      return await this.getCreateVersionReport(createPackageVersionRequestId);
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

  public convert(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public install(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public async list(options: PackageVersionListOptions): Promise<PackageVersionListResult[]> {
    try {
      return (await listPackageVersions({ ...options, ...{ connection: this.connection } })).records;
    } catch (err) {
      throw applyErrorAction(massageErrorMessage(err as Error));
    }
  }

  public uninstall(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public async promote(id: string): Promise<PackageSaveResult> {
    try {
      // lookup the 05i ID, if needed
      if (id.startsWith('04t')) {
        id = await getPackageVersionId(id, this.connection);
      }
      return await this.options.connection.tooling.update('Package2Version', { IsReleased: true, Id: id });
    } catch (err) {
      throw applyErrorAction(massageErrorMessage(err as Error));
    }
  }

  public async update(id: string, options: PackageVersionUpdateOptions): Promise<PackageSaveResult> {
    try {
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
      result.id = await this.getSubscriberPackageVersionId(id);
      return result;
    } catch (err) {
      throw applyErrorAction(massageErrorMessage(err as Error));
    }
  }

  private async updateDeprecation(idOrAlias: string, IsDeprecated): Promise<PackageSaveResult> {
    try {
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
      updateResult.id = await this.getSubscriberPackageVersionId(packageVersionId);
      return updateResult;
    } catch (err) {
      throw applyErrorAction(massageErrorMessage(err as Error));
    }
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
  /**
   * Given a package version ID (05i) or subscriber package version ID (04t), return the subscriber package version ID (04t)
   *
   * @param versionId The suscriber package version ID
   * @param connection For tooling query
   */
  private async getSubscriberPackageVersionId(versionId: string): Promise<string> {
    // if it's already a 04t return it, otherwise query for it
    if (!versionId || versionId.startsWith(BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.prefix)) {
      return versionId;
    }
    const query = `SELECT SubscriberPackageVersionId FROM Package2Version WHERE Id = '${versionId}'`;
    const queryResult = await this.connection.tooling.query<
      Pick<PackagingSObjects.Package2Version, 'SubscriberPackageVersionId'>
    >(query);
    if (!queryResult || !queryResult.totalSize) {
      throw messages.createError('errorInvalidIdNoMatchingVersionId', [
        BY_LABEL.PACKAGE_VERSION_ID.label,
        versionId,
        BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.label,
      ]);
    }
    return queryResult.records[0].SubscriberPackageVersionId;
  }
}
