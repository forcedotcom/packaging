/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Lifecycle, Messages, PollingClient, SfProject, StatusResult } from '@salesforce/core';
import { Duration, env } from '@salesforce/kit';
import { Optional } from '@salesforce/ts-types';
import {
  PackageSaveResult,
  PackageType,
  PackageVersionCreateOptions,
  PackageVersionCreateRequestQueryOptions,
  PackageVersionCreateRequestResult,
  PackageVersionEvents,
  PackageVersionOptions,
  PackageVersionReportResult,
  PackageVersionUpdateOptions,
  PackagingSObjects,
} from '../interfaces';
import {
  applyErrorAction,
  BY_LABEL,
  combineSaveErrors,
  massageErrorMessage,
  validateId,
  queryWithInConditionChunking,
} from '../utils/packageUtils';
import { PackageVersionCreate } from './packageVersionCreate';
import { getPackageVersionReport } from './packageVersionReport';
import { getCreatePackageVersionCreateRequestReport } from './packageVersionCreateRequestReport';
import { list } from './packageVersionCreateRequest';
import Package2 = PackagingSObjects.Package2;
import Package2VersionStatus = PackagingSObjects.Package2VersionStatus;

type Package2Version = PackagingSObjects.Package2Version;

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_version');

export const Package2VersionFields: Array<keyof Package2Version> = [
  'Id',
  'IsDeleted',
  'CreatedDate',
  'CreatedById',
  'LastModifiedDate',
  'LastModifiedById',
  'SystemModstamp',
  'Package2Id',
  'SubscriberPackageVersionId',
  'Tag',
  'Branch',
  'AncestorId',
  'ValidationSkipped',
  'Name',
  'Description',
  'MajorVersion',
  'MinorVersion',
  'PatchVersion',
  'BuildNumber',
  'IsDeprecated',
  'IsPasswordProtected',
  'CodeCoverage',
  'CodeCoveragePercentages',
  'HasPassedCodeCoverageCheck',
  'InstallKey',
  'IsReleased',
  'ConvertedFromVersionId',
  'ReleaseVersion',
  'BuildDurationInSeconds',
  'HasMetadataRemoved',
];

export type Package2VersionFieldTypes = Array<(typeof Package2VersionFields)[number]>;

export type Package2VersionQueryOptions = {
  /**
   * The fields to include in the returned data. Defaults to all fields.
   */
  fields?: Package2VersionFieldTypes;
  /**
   * The where clause to filter the query. E.g., "WHERE Id IN ('%IDS%')";
   */
  whereClause?: string;
  /**
   * An array of where clause items to match. The query is chunked,meaning broken into
   * multiple queries when the query length would exceed the maximum char limit.
   * When defining items here, the `whereClause` argument must use this token for the
   * item replacement: `'%IDS%'`.
   */
  whereClauseItems?: string[];
  /**
   * The order-by clause for the query. Defaults to LastModifiedDate descending.
   */
  orderBy?: string;
};

/**
 * Provides the ability to create, update, delete, and promote 2nd
 * generation package versions.
 *
 * **Examples**
 *
 * Create a new instance and get the ID (05i):
 *
 * `const id = new PackageVersion({connection, project, idOrAlias}).getId();`
 *
 * Create a new package version in the org:
 *
 * `const myPkgVersion = await PackageVersion.create(options, pollingOptions);`
 *
 * Promote a package version:
 *
 * `new PackageVersion({connection, project, idOrAlias}).promote();`
 */
export class PackageVersion {
  private readonly project: SfProject;
  private readonly connection: Connection;

  private data?: Package2Version;
  private packageType: Optional<PackageType>;
  private id: string;

  public constructor(private options: PackageVersionOptions) {
    this.connection = this.options.connection;
    this.project = this.options.project;
    this.id = this.resolveId();
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

    if (createResult.Id) {
      return PackageVersion.pollCreateStatus(createResult.Id, options.connection, options.project, polling).catch(
        (err: Error) => {
          // TODO
          // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
          throw applyErrorAction(massageErrorMessage(err));
        }
      );
    } else {
      throw new Error(messages.getMessage('createResultIdCannotBeEmpty'));
    }
  }

  /**
   * Gets current state of a package version create request.
   *
   * @param createPackageRequestId
   * @param connection
   */
  public static async getCreateStatus(
    createPackageRequestId: string,
    connection: Connection
  ): Promise<PackageVersionCreateRequestResult> {
    return getCreatePackageVersionCreateRequestReport({
      createPackageVersionRequestId: createPackageRequestId,
      connection,
    }).catch((err: Error) => {
      // TODO
      // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      throw applyErrorAction(massageErrorMessage(err));
    });
  }

  /**
   * Fetch a list of package version create requests based on the given options.
   *
   * @param connection connection to an org
   * @param options PackageVersionCreateRequestQueryOptions
   * @returns the list of package version create requests.
   */
  public static async getPackageVersionCreateRequests(
    connection: Connection,
    options?: PackageVersionCreateRequestQueryOptions
  ): Promise<PackageVersionCreateRequestResult[]> {
    return list(connection, options);
  }

  /**
   * Convenience function that will wait for a package version to be created.
   *
   * This function emits LifeCycle events, "enqueued", "in-progress", "success", "error" and "timed-out" to
   * progress and current status. Events also carry a payload of type PackageVersionCreateRequestResult.
   *
   * @param createPackageVersionRequestId
   * @param connection Connection to the org
   * @param project SfProject to read/write aliases from
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
    const pollingClient = await PollingClient.create({
      poll: async (): Promise<StatusResult> => {
        const report = await this.getCreateStatus(createPackageVersionRequestId, connection);
        switch (report.Status) {
          case Package2VersionStatus.queued:
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.enqueued, { ...report, remainingWaitTime });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - polling.frequency.seconds);
            return {
              completed: false,
              payload: report,
            };
          case Package2VersionStatus.inProgress:
          case Package2VersionStatus.initializing:
          case Package2VersionStatus.verifyingFeaturesAndSettings:
          case Package2VersionStatus.verifyingDependencies:
          case Package2VersionStatus.verifyingMetadata:
          case Package2VersionStatus.finalizingPackageVersion:
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.progress, {
              ...report,
              remainingWaitTime,
            });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - polling.frequency.seconds);
            return {
              completed: false,
              payload: report,
            };
          case Package2VersionStatus.success: {
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.success, report);
            const packageVersion = new PackageVersion({
              connection,
              project,
              idOrAlias: report.Package2VersionId,
            });
            await packageVersion.updateProjectWithPackageVersion(report);
            return { completed: true, payload: report };
          }
          case Package2VersionStatus.error:
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.error, report);
            return { completed: true, payload: report };
        }
      },

      frequency: polling.frequency,
      timeout: polling.timeout,
    });

    try {
      return await pollingClient.subscribe<PackageVersionCreateRequestResult>();
    } catch (err) {
      const report = await this.getCreateStatus(createPackageVersionRequestId, connection);
      await Lifecycle.getInstance().emit(PackageVersionEvents.create['timed-out'], report);
      if (err instanceof Error) {
        throw applyErrorAction(err);
      }
      throw err;
    }
  }

  /**
   * Gets current state of a package version create request.
   *
   * @param createPackageRequestId
   * @param connection
   */
  public static async getCreateVersionReport(
    createPackageRequestId: string,
    connection: Connection
  ): Promise<PackageVersionCreateRequestResult> {
    return getCreatePackageVersionCreateRequestReport({
      createPackageVersionRequestId: createPackageRequestId,
      connection,
    }).catch((err: Error) => {
      // TODO
      // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      throw applyErrorAction(massageErrorMessage(err));
    });
  }

  /**
   * Convenience function that will wait for a package version to be created.
   *
   * This function emits LifeCycle events, "enqueued", "in-progress", "success", "error" and "timed-out" to
   * progress and current status. Events also carry a payload of type PackageVersionCreateRequestResult.
   *
   * @param createPackageVersionRequestId
   * @param project
   * @param connection
   * @param polling frequency and timeout Durations to be used in polling
   * */
  public static async waitForCreateVersion(
    createPackageVersionRequestId: string,
    project: SfProject,
    connection: Connection,
    polling: { frequency: Duration; timeout: Duration }
  ): Promise<PackageVersionCreateRequestResult> {
    if (polling.timeout?.milliseconds <= 0) {
      return PackageVersion.getCreateVersionReport(createPackageVersionRequestId, connection);
    }
    let remainingWaitTime: Duration = polling.timeout;
    const pollingClient = await PollingClient.create({
      poll: async (): Promise<StatusResult> => {
        const report = await this.getCreateVersionReport(createPackageVersionRequestId, connection);
        switch (report.Status) {
          case Package2VersionStatus.queued:
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.enqueued, { ...report, remainingWaitTime });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - polling.frequency.seconds);
            return {
              completed: false,
              payload: report,
            };
          case Package2VersionStatus.inProgress:
          case Package2VersionStatus.initializing:
          case Package2VersionStatus.verifyingFeaturesAndSettings:
          case Package2VersionStatus.verifyingDependencies:
          case Package2VersionStatus.verifyingMetadata:
          case Package2VersionStatus.finalizingPackageVersion:
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.progress, {
              ...report,
              remainingWaitTime,
            });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - polling.frequency.seconds);
            return {
              completed: false,
              payload: report,
            };
          case Package2VersionStatus.success:
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.success, report);
            await new PackageVersion({
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              idOrAlias: report.SubscriberPackageVersionId!,
              project,
              connection,
            }).updateProjectWithPackageVersion(report);
            return { completed: true, payload: report };
          case Package2VersionStatus.error:
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.error, report);
            return { completed: true, payload: report };
        }
      },
      frequency: polling.frequency,
      timeout: polling.timeout,
    });
    try {
      return await pollingClient.subscribe<PackageVersionCreateRequestResult>();
    } catch (err) {
      const report = await this.getCreateVersionReport(createPackageVersionRequestId, connection);
      await Lifecycle.getInstance().emit(PackageVersionEvents.create['timed-out'], report);
      throw applyErrorAction(err as Error);
    }
  }

  /**
   * Query the Package2Version SObject and return data with the provided type.
   *
   * NOTE: There is a limit of 2000 records that can be returned, otherwise
   * a GACK might be thrown. If more than 2000 records are desired you should
   * filter the query by date and aggregate all results.
   *
   * @param connection jsForce Connection to the org.
   * @param options Package2Version query options
   * @returns Results from querying the Package2Version SObject.
   */
  public static async queryPackage2Version(
    connection: Connection,
    options: Package2VersionQueryOptions = {}
  ): Promise<Partial<Package2Version[]>> {
    const fields = options.fields ?? Package2VersionFields;
    const { whereClause, whereClauseItems } = options;
    const orderBy = options.orderBy ?? 'ORDER BY LastModifiedDate DESC';
    let query = `SELECT ${fields.toString()} FROM Package2Version`;

    if (whereClause) {
      query += ` ${whereClause} ${orderBy}`;
      if (whereClauseItems) {
        query += ' LIMIT 2000';
        return queryWithInConditionChunking<Package2Version>(query, whereClauseItems, '%IDS%', connection);
      }
    }
    query += ' LIMIT 2000';
    const result = await connection.tooling.query<Package2Version>(query);
    if (result?.totalSize === 2000) {
      const warningMsg = messages.getMessage('maxPackage2VersionRecords');
      await Lifecycle.getInstance().emitWarning(warningMsg);
    }
    return result.records ?? [];
  }

  /**
   * Get the package version ID for this PackageVersion.
   *
   * @returns The PackageVersionId (05i).
   */
  public async getId(): Promise<string | undefined> {
    if (!this.data?.Id) {
      await this.getData();
    }
    return this.data?.Id;
  }

  /**
   * Get the subscriber package version ID for this PackageVersion.
   *
   * @returns The SubscriberPackageVersionId (04t).
   */
  public async getSubscriberId(): Promise<string | undefined> {
    if (!this.data?.SubscriberPackageVersionId) {
      await this.getData();
    }
    return this.data?.SubscriberPackageVersionId;
  }

  /**
   * Get the package Id for this PackageVersion.
   *
   * @returns The PackageId (0Ho).
   */
  public async getPackageId(): Promise<string | undefined> {
    if (!this.data?.Package2Id) {
      await this.getData();
    }
    return this.data?.Package2Id;
  }

  /**
   * Get the package type for this PackageVersion.
   *
   * @returns The PackageType (Managed, Unlocked).
   */
  public async getPackageType(): Promise<PackageType> {
    if (!this.packageType) {
      this.packageType = (
        await this.connection.singleRecordQuery<Package2>(
          `select ContainerOptions from Package2 where Id = '${await this.getPackageId()}' limit 1`,
          { tooling: true }
        )
      ).ContainerOptions;
    }

    return this.packageType;
  }

  /**
   * Get the Package2Version SObject data for this PackageVersion.
   *
   * @param force force a refresh of the package version data.
   * @returns Package2Version
   */
  public async getData(force = false): Promise<Package2Version> | never {
    let is05i = false;
    if (!this.data || force) {
      // validate ID
      if (this.id.startsWith('04t')) {
        validateId(BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, this.id);
        is05i = false;
      } else if (this.id.startsWith('05i')) {
        validateId(BY_LABEL.PACKAGE_VERSION_ID, this.id);
        is05i = true;
      } else {
        throw messages.createError('errorInvalidPackageVersionId', [this.options.idOrAlias]);
      }
      let queryConfig: { id: string; clause: string; label1: string; label2: string };
      if (is05i) {
        queryConfig = {
          id: this.id,
          clause: `Id = '${this.id}'`,
          label1: BY_LABEL.PACKAGE_VERSION_ID.label,
          label2: BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.label,
        };
      } else {
        queryConfig = {
          id: this.id,
          clause: `SubscriberPackageVersionId = '${this.id}'`,
          label1: BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.label,
          label2: BY_LABEL.PACKAGE_VERSION_ID.label,
        };
      }
      const allFields = Package2VersionFields.toString();
      const query = `SELECT ${allFields} FROM Package2Version WHERE ${queryConfig.clause} LIMIT 1`;
      try {
        this.data = await this.connection.singleRecordQuery<Package2Version>(query, { tooling: true });
      } catch (err) {
        throw messages.createError(
          'errorInvalidIdNoMatchingVersionId',
          [queryConfig.label1, queryConfig.id, queryConfig.label2],
          undefined,
          err instanceof Error ? err : new Error(err as string)
        );
      }
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
    if (!packageVersionId) {
      throw messages.createError('errorInvalidPackageVersionId', [this.options.idOrAlias]);
    }
    const results = await getPackageVersionReport({
      packageVersionId,
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
   * Promotes this PackageVersion to released state.
   */
  public async promote(): Promise<PackageSaveResult> {
    const id = await this.getId();
    if (!id) {
      throw messages.createError('errorInvalidPackageVersionId', [this.options.idOrAlias]);
    }
    return this.options.connection.tooling.update('Package2Version', { IsReleased: true, Id: id });
  }

  public async update(options: PackageVersionUpdateOptions): Promise<PackageSaveResult> {
    const id = await this.getId();
    if (!id) {
      throw messages.createError('errorInvalidPackageVersionId', [this.options.idOrAlias]);
    }

    const request = Object.fromEntries(
      Object.entries({
        Id: id,
        InstallKey: options.InstallKey,
        Name: options.VersionName,
        Description: options.VersionDescription,
        Branch: options.Branch,
        Tag: options.Tag,
      }).filter(([, value]) => value !== undefined)
    ) as Package2Version & { [name: string]: string | undefined };

    const result = await this.connection.tooling.update('Package2Version', request);
    if (!result.success) {
      throw new Error(result.errors.join(', '));
    }
    // Use the 04t ID for the success message
    const subscriberPackageVersionId = await this.getSubscriberId();
    if (!subscriberPackageVersionId) {
      throw messages.createError('errorNoSubscriberPackageVersionId');
    }
    result.id = subscriberPackageVersionId;
    return result;
  }

  private async updateDeprecation(isDeprecated: boolean): Promise<PackageSaveResult> {
    const id = await this.getId();
    if (!id) {
      throw messages.createError('errorInvalidPackageVersionId', [this.options.idOrAlias]);
    }

    // setup the request
    const request: { Id: string; IsDeprecated: boolean } = {
      Id: id,
      IsDeprecated: isDeprecated,
    };

    const updateResult = await this.connection.tooling.update('Package2Version', request);
    if (!updateResult.success) {
      throw combineSaveErrors('Package2', 'update', updateResult.errors);
    }
    const subscriberPackageVersionId = await this.getSubscriberId();
    if (!subscriberPackageVersionId) {
      throw messages.createError('errorNoSubscriberPackageVersionId');
    }
    updateResult.id = subscriberPackageVersionId;
    return updateResult;
  }

  private async updateProjectWithPackageVersion(results: PackageVersionCreateRequestResult): Promise<void> {
    if (!env.getBoolean('SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_CREATE')) {
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

      const aliases = this.project.getAliasesFromPackageId(results.Package2Id);
      if (aliases.length === 0) {
        throw messages.createError('packageAliasNotFound', [results.Package2Id]);
      }
      const version = `${aliases[0]}@${versionResult.MajorVersion ?? 0}.${versionResult.MinorVersion ?? 0}.${
        versionResult.PatchVersion ?? 0
      }`;
      const build = versionResult.BuildNumber ? `-${versionResult.BuildNumber}` : '';
      const branch = versionResult.Branch ? `-${versionResult.Branch}` : '';
      const originalPackageAliases = this.project.getSfProjectJson().get('packageAliases') ?? {};
      const updatedPackageAliases = {
        ...originalPackageAliases,
        ...(results.SubscriberPackageVersionId
          ? // set packageAliases entry '<package>@<major>.<minor>.<patch>-<build>-<branch>: <result.subscriberPackageVersionId>'
            { [`${version}${build}${branch}`]: results.SubscriberPackageVersionId }
          : {}),
      };

      this.project.getSfProjectJson().set('packageAliases', updatedPackageAliases);
      await this.project.getSfProjectJson().write();
    }
  }

  private resolveId(): string {
    return this.project.getPackageIdFromAlias(this.options.idOrAlias) ?? this.options.idOrAlias;
  }
}
