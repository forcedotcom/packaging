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
  validateId,
} from '../utils';
import { PackageVersionCreate } from './packageVersionCreate';
import { getPackageVersionReport } from './packageVersionReport';
import { getCreatePackageVersionCreateRequestReport } from './packageVersionCreateRequestReport';
import { listPackageVersions } from './packageVersionList';
import { list } from './packageVersionCreateRequest';

type Package2Version = PackagingSObjects.Package2Version;

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_version');

export class PackageVersion {
  private readonly project: SfProject;
  private readonly connection: Connection;

  private data: Package2Version;

  public constructor(private options: PackageVersionOptions) {
    this.connection = this.options.connection;
    this.project = this.options.project;
    this.data = {} as Package2Version;
    const id = getPackageIdFromAlias(this.options.idOrAlias, this.project);

    // validate ID
    if (id.startsWith('04t')) {
      validateId(BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, id);
      this.data.SubscriberPackageVersionId = id;
    } else if (id.startsWith('05i')) {
      validateId(BY_LABEL.PACKAGE_VERSION_ID, id);
      this.data.Package2Id = id;
    } else {
      throw messages.createError('errorInvalidPackageVersionId', [this.options.idOrAlias]);
    }
  }

  /**
   * Sends a request to create a new package version and optionally polls for
   * the status of the request until the package version is created or the
   * polling timeout is reached.
   *
   * @param options PackageVersionCreateOptions
   * @param polling frequency and timeout Durations to be used in polling
   * @returns PackageVersionCreateRequestResult
   */
  public static async create(
    options: PackageVersionCreateOptions,
    polling: { frequency: Duration; timeout: Duration } = {
      frequency: Duration.seconds(0),
      timeout: Duration.seconds(0),
    }
  ): Promise<Partial<PackageVersionCreateRequestResult>> {
    const pvc = new PackageVersionCreate({ ...options });
    const createResult = await pvc.createPackageVersion();

    return await PackageVersion.pollCreateStatus(createResult.Id, options.connection, options.project, polling).catch(
      (err: Error) => {
        // TODO
        // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
        throw applyErrorAction(err);
      }
    );
  }

  /**
   * Gets current state of a package version create request.
   *
   * @param createPackageRequestId
   */
  public static async getCreateStatus(
    createPackageRequestId: string,
    connection: Connection
  ): Promise<PackageVersionCreateRequestResult> {
    return await getCreatePackageVersionCreateRequestReport({
      createPackageVersionRequestId: createPackageRequestId,
      connection,
    }).catch((err: Error) => {
      // TODO
      // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      throw applyErrorAction(err);
    });
  }

  /**
   * Fetch a list of created package versions based on the options passed in.
   *
   * @param connection connection to an org
   * @param options PackageVersionCreateRequestQueryOptions
   * @returns the list of package version create requests.
   */
  public static async createdList(
    connection: Connection,
    options?: PackageVersionCreateRequestQueryOptions
  ): Promise<PackageVersionCreateRequestResult[]> {
    return list({ ...options, connection });
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
  public static async pollCreateStatus(
    createPackageVersionRequestId: string,
    connection: Connection,
    project: SfProject,
    polling: { frequency: Duration; timeout: Duration }
  ): Promise<PackageVersionCreateRequestResult> {
    if (polling.timeout?.milliseconds <= 0) {
      return this.getCreateStatus(createPackageVersionRequestId, connection);
    }
    let remainingWaitTime: Duration = polling.timeout;
    let report: PackageVersionCreateRequestResult;
    const pollingClient = await PollingClient.create({
      poll: async (): Promise<StatusResult> => {
        report = await this.getCreateStatus(createPackageVersionRequestId, connection);
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
          case 'Success': {
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.success, report);
            const packageVersion = new PackageVersion({
              connection,
              project,
              idOrAlias: report.Package2VersionId,
            });
            await packageVersion.updateProjectWithPackageVersion(report);
            return { completed: true, payload: report };
          }
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

  /**
   * Get the package version ID for this PackageVersion.
   *
   * @returns The PackageVersionId (05i).
   */
  public async getId(): Promise<string> {
    if (!this.data.Package2Id) {
      await this.getPackageVersionData();
    }
    return this.data.Package2Id;
  }

  /**
   * Get the subscriber package version ID for this PackageVersion.
   *
   * @returns The SubscriberPackageVersionId (04t).
   */
  public async getSubscriberId(): Promise<string> {
    if (!this.data.SubscriberPackageVersionId) {
      await this.getPackageVersionData();
    }
    return this.data.SubscriberPackageVersionId;
  }

  /**
   * Get the Package2Version SObject data for this PackageVersion.
   *
   * @param force force a refresh of the package version data.
   * @returns Package2Version
   */
  public async getPackageVersionData(force = false): Promise<Package2Version> {
    if (!this.data.Name || force) {
      let queryConfig: { id: string; clause: string; label1: string; label2: string };
      if (this.data.Package2Id) {
        queryConfig.id = this.data.Package2Id;
        queryConfig.clause = `Id = '${this.data.Package2Id}'`;
        queryConfig.label1 = BY_LABEL.PACKAGE_VERSION_ID.label;
        queryConfig.label2 = BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.label;
      } else {
        queryConfig.id = this.data.SubscriberPackageVersionId;
        queryConfig.clause = `SubscriberPackageVersionId = '${this.data.SubscriberPackageVersionId}'`;
        queryConfig.label1 = BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.label;
        queryConfig.label2 = BY_LABEL.PACKAGE_VERSION_ID.label;
      }
      const query = `SELECT FIELDS(ALL) FROM Package2Version WHERE ${queryConfig.clause}`;
      const queryResult = await this.connection.tooling.query<Package2Version>(query);
      if (!queryResult || !queryResult.totalSize) {
        throw messages.createError('errorInvalidIdNoMatchingVersionId', [
          queryConfig.label1,
          queryConfig.id,
          queryConfig.label2,
        ]);
      }
      this.data = queryResult.records[0];
    }
    return this.data;
  }

  /**
   * Deletes this PackageVersion.
   */
  public async delete(): Promise<PackageSaveResult> {
    return this.updateDeprecation(true);
  }

  /**
   * Undeletes this PackageVersion.
   */
  public async undelete(): Promise<PackageSaveResult> {
    return this.updateDeprecation(false);
  }

  /**
   * Reports details about this PackageVersion.
   *
   * @param verbose Whether to get a detailed version of the report, at the expense of performance.
   */
  public async report(verbose = false): Promise<PackageVersionReportResult> {
    const packageVersionId = await this.getId();
    const results = await getPackageVersionReport({
      idOrAlias: packageVersionId,
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

  public install(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public async list(options: PackageVersionListOptions): Promise<PackageVersionListResult[]> {
    return (await listPackageVersions({ ...options, ...{ connection: this.connection } })).records;
  }

  public uninstall(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public async promote(): Promise<PackageSaveResult> {
    const id = await this.getId();
    return this.options.connection.tooling.update('Package2Version', { IsReleased: true, Id: id });
  }

  public async update(options: PackageVersionUpdateOptions): Promise<PackageSaveResult> {
    const id = await this.getId();

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
    result.id = await this.getSubscriberId();
    return result;
  }

  private async updateDeprecation(isDeprecated: boolean): Promise<PackageSaveResult> {
    const id = await this.getId();

    // setup the request
    const request: { Id: string; IsDeprecated: boolean } = {
      Id: id,
      IsDeprecated: isDeprecated,
    };

    const updateResult = await this.connection.tooling.update('Package2Version', request);
    if (!updateResult.success) {
      throw combineSaveErrors('Package2', 'update', updateResult.errors);
    }
    updateResult.id = await this.getSubscriberId();
    return updateResult;
  }

  private async updateProjectWithPackageVersion(results: PackageVersionCreateRequestResult): Promise<void> {
    if (!process.env.SFDX_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_CREATE) {
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
