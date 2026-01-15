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

import { Connection, Lifecycle, Messages, PollingClient, SfError, StatusResult } from '@salesforce/core';
import { SfProject } from '@salesforce/core';
import { Duration, env } from '@salesforce/kit';
import { Schema } from '@jsforce/jsforce-node';
import {
  BundleVersionCreateOptions,
  BundleSObjects,
  PackageVersionEvents,
  PackagingSObjects,
  PackageType,
  QueryRecord,
  AncestorRecord,
} from '../interfaces';
import { applyErrorAction } from '../utils/packageUtils';
import { massageErrorMessage } from '../utils/bundleUtils';
import { PackageBundleVersionCreate } from './packageBundleVersionCreate';

Messages.importMessagesDirectory(__dirname);
const bundleVersionMessages = Messages.loadMessages('@salesforce/packaging', 'bundle_version');

export class PackageBundleVersion {
  public static async create(
    options: BundleVersionCreateOptions
  ): Promise<BundleSObjects.PackageBundleVersionCreateRequestResult> {
    const createResult = await PackageBundleVersionCreate.createBundleVersion(
      options.connection,
      options.project,
      options
    );

    if (options.polling) {
      const finalResult = await PackageBundleVersion.pollCreateStatus(
        createResult.Id,
        options.connection,
        options.project,
        options.polling
      ).catch((error: SfError) => {
        if (error.name === 'PollingClientTimeout') {
          const modifiedError = new SfError(error.message);
          modifiedError.setData({ VersionCreateRequestId: createResult.Id });
          modifiedError.message += ` Run 'sf package bundle version create report -i ${createResult.Id}' to check the status.`;
          throw applyErrorAction(massageErrorMessage(modifiedError));
        }
        throw applyErrorAction(massageErrorMessage(error));
      });

      // Add bundle version alias to sfdx-project.json after successful creation
      if (
        finalResult.RequestStatus === BundleSObjects.PkgBundleVersionCreateReqStatus.success &&
        finalResult.PackageBundleVersionId
      ) {
        await PackageBundleVersion.addBundleVersionAlias(options.project, finalResult);
      }

      return finalResult;
    }

    // Add bundle version alias to sfdx-project.json after successful creation (non-polling case)
    // Note: In the non-polling case, the bundle version may not be created yet (status is 'Queued' or 'InProgress')
    // So we only add the alias if the status is already 'Success'
    if (
      createResult.RequestStatus === BundleSObjects.PkgBundleVersionCreateReqStatus.success &&
      createResult.PackageBundleVersionId
    ) {
      await PackageBundleVersion.addBundleVersionAlias(options.project, createResult);
    }

    return createResult;
  }

  public static async pollCreateStatus(
    createPackageVersionRequestId: string,
    connection: Connection,
    project: SfProject,
    polling: { frequency: Duration; timeout: Duration }
  ): Promise<BundleSObjects.PackageBundleVersionCreateRequestResult> {
    if (polling.timeout?.milliseconds <= 0) {
      return PackageBundleVersionCreate.getCreateStatus(createPackageVersionRequestId, connection);
    }
    let remainingWaitTime: Duration = polling.timeout;
    const pollingClient = await PollingClient.create({
      poll: async (): Promise<StatusResult> => {
        const report = await PackageBundleVersionCreate.getCreateStatus(createPackageVersionRequestId, connection);
        switch (report.RequestStatus) {
          case BundleSObjects.PkgBundleVersionCreateReqStatus.queued:
          case BundleSObjects.PkgBundleVersionCreateReqStatus.inProgress:
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.progress, { ...report, remainingWaitTime });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - polling.frequency.seconds);
            return {
              completed: false,
              payload: report,
            };
          case BundleSObjects.PkgBundleVersionCreateReqStatus.success: {
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.success, report);
            return { completed: true, payload: report };
          }
          case BundleSObjects.PkgBundleVersionCreateReqStatus.error:
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.error, report);
            return { completed: true, payload: report };
          default:
            // Handle any unexpected status by continuing to poll
            await Lifecycle.getInstance().emit(PackageVersionEvents.create.progress, { ...report, remainingWaitTime });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - polling.frequency.seconds);
            return {
              completed: false,
              payload: report,
            };
        }
      },
      frequency: polling.frequency,
      timeout: polling.timeout,
    });

    try {
      return await pollingClient.subscribe<BundleSObjects.PackageBundleVersionCreateRequestResult>();
    } catch (err) {
      const report = await PackageBundleVersionCreate.getCreateStatus(createPackageVersionRequestId, connection);
      await Lifecycle.getInstance().emit(PackageVersionEvents.create['timed-out'], report);
      if (err instanceof Error) {
        throw applyErrorAction(err);
      }
      throw err;
    }
  }

  public static async report(connection: Connection, id: string): Promise<BundleSObjects.BundleVersion | null> {
    const query = `SELECT Id, PackageBundle.Id, PackageBundle.BundleName, VersionName, MajorVersion, MinorVersion, IsReleased, PackageBundle.Description, PackageBundle.IsDeleted, PackageBundle.CreatedDate, PackageBundle.CreatedById, PackageBundle.LastModifiedDate, PackageBundle.LastModifiedById, PackageBundle.SystemModstamp, Ancestor.Id, Ancestor.PackageBundle.Id, Ancestor.PackageBundle.BundleName, Ancestor.VersionName, Ancestor.MajorVersion, Ancestor.MinorVersion, Ancestor.IsReleased, Ancestor.PackageBundle.Description, Ancestor.PackageBundle.IsDeleted, Ancestor.PackageBundle.CreatedDate, Ancestor.PackageBundle.CreatedById, Ancestor.PackageBundle.LastModifiedDate, Ancestor.PackageBundle.LastModifiedById, Ancestor.PackageBundle.SystemModstamp FROM PackageBundleVersion WHERE Id = '${id}'`;
    const queryResult = await connection.autoFetchQuery<QueryRecord>(query, { tooling: true });
    return queryResult.records.length > 0
      ? PackageBundleVersion.mapRecordToBundleVersion(queryResult.records[0])
      : null;
  }

  public static async list(connection: Connection): Promise<BundleSObjects.BundleVersion[]> {
    const query =
      'SELECT Id, PackageBundle.Id, PackageBundle.BundleName, VersionName, MajorVersion, MinorVersion, IsReleased, PackageBundle.Description, PackageBundle.IsDeleted, PackageBundle.CreatedDate, PackageBundle.CreatedById, PackageBundle.LastModifiedDate, PackageBundle.LastModifiedById, PackageBundle.SystemModstamp, Ancestor.Id, Ancestor.PackageBundle.Id, Ancestor.PackageBundle.BundleName, Ancestor.VersionName, Ancestor.MajorVersion, Ancestor.MinorVersion, Ancestor.IsReleased, Ancestor.PackageBundle.Description, Ancestor.PackageBundle.IsDeleted, Ancestor.PackageBundle.CreatedDate, Ancestor.PackageBundle.CreatedById, Ancestor.PackageBundle.LastModifiedDate, Ancestor.PackageBundle.LastModifiedById, Ancestor.PackageBundle.SystemModstamp FROM PackageBundleVersion';
    const queryResult = await connection.autoFetchQuery<QueryRecord>(query, { tooling: true });
    return queryResult.records.map((record) => PackageBundleVersion.mapRecordToBundleVersion(record));
  }

  public static async getComponentPackages(
    connection: Connection,
    id: string
  ): Promise<PackagingSObjects.SubscriberPackageVersion[]> {
    const query = `SELECT Component.Id, Component.Description, Component.PublisherName, Component.MajorVersion, Component.MinorVersion, Component.PatchVersion, Component.BuildNumber, Component.ReleaseState, Component.IsManaged, Component.IsDeprecated, Component.IsPasswordProtected, Component.IsBeta, Component.Package2ContainerOptions, Component.IsSecurityReviewed, Component.IsOrgDependent, Component.AppExchangePackageName, Component.AppExchangeDescription, Component.AppExchangePublisherName, Component.AppExchangeLogoUrl, Component.ReleaseNotesUrl, Component.PostInstallUrl, Component.RemoteSiteSettings, Component.CspTrustedSites, Component.Profiles, Component.Dependencies, Component.InstallValidationStatus, Component.SubscriberPackageId FROM PkgBundleVersionComponent WHERE PackageBundleVersion.Id = '${id}' ORDER BY CreatedDate`;
    const queryResult = await connection.autoFetchQuery<
      Schema & {
        Component?: {
          Id: string;
          Description: string;
          PublisherName: string;
          MajorVersion: number;
          MinorVersion: number;
          PatchVersion: number;
          BuildNumber: number;
          ReleaseState: string;
          IsManaged: boolean;
          IsDeprecated: boolean;
          IsPasswordProtected: boolean;
          IsBeta: boolean;
          Package2ContainerOptions: string;
          IsSecurityReviewed: boolean;
          IsOrgDependent: boolean;
          AppExchangePackageName: string;
          AppExchangeDescription: string;
          AppExchangePublisherName: string;
          AppExchangeLogoUrl: string;
          ReleaseNotesUrl: string;
          PostInstallUrl: string;
          RemoteSiteSettings: unknown;
          CspTrustedSites: unknown;
          Profiles: unknown;
          Dependencies: unknown;
          InstallValidationStatus: string;
          SubscriberPackageId: string;
        };
      }
    >(query, { tooling: true });

    // Get unique SubscriberPackageIds to query for Names
    const subscriberPackageIds = [
      ...new Set(
        queryResult.records
          .map((record) => record.Component?.SubscriberPackageId)
          .filter((packageId): packageId is string => !!packageId)
      ),
    ];

    // Query SubscriberPackage to get Names (one by one due to implementation restriction)
    const subscriberPackageNames = new Map<string, string>();
    const packageQueries = subscriberPackageIds.map(async (packageId) => {
      try {
        const packageQuery = `SELECT Id, Name FROM SubscriberPackage WHERE Id='${packageId}'`;
        const packageQueryResult = await connection.autoFetchQuery<
          Schema & {
            Id: string;
            Name: string;
          }
        >(packageQuery, { tooling: true });

        return {
          packageId,
          name: packageQueryResult.records.length > 0 ? packageQueryResult.records[0].Name : '',
        };
      } catch (error) {
        // If individual query fails, return empty name for this package
        return {
          packageId,
          name: '',
        };
      }
    });

    const packageResults = await Promise.allSettled(packageQueries);
    packageResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        subscriberPackageNames.set(result.value.packageId, result.value.name);
      }
    });

    return queryResult.records.map((record) => {
      const component = record.Component;
      if (!component) {
        throw new SfError(bundleVersionMessages.getMessage('componentRecordMissing'));
      }
      const packageName = subscriberPackageNames.get(component.SubscriberPackageId) ?? '';
      return {
        Id: component.Id,
        SubscriberPackageId: component.SubscriberPackageId,
        Name: packageName,
        Description: component.Description,
        PublisherName: component.PublisherName,
        MajorVersion: component.MajorVersion,
        MinorVersion: component.MinorVersion,
        PatchVersion: component.PatchVersion,
        BuildNumber: component.BuildNumber,
        ReleaseState: component.ReleaseState,
        IsManaged: component.IsManaged,
        IsDeprecated: component.IsDeprecated,
        IsPasswordProtected: component.IsPasswordProtected,
        IsBeta: component.IsBeta,
        Package2ContainerOptions: component.Package2ContainerOptions as PackageType,
        IsSecurityReviewed: component.IsSecurityReviewed,
        IsOrgDependent: component.IsOrgDependent,
        AppExchangePackageName: component.AppExchangePackageName,
        AppExchangeDescription: component.AppExchangeDescription,
        AppExchangePublisherName: component.AppExchangePublisherName,
        AppExchangeLogoUrl: component.AppExchangeLogoUrl,
        ReleaseNotesUrl: component.ReleaseNotesUrl,
        PostInstallUrl: component.PostInstallUrl,
        RemoteSiteSettings: component.RemoteSiteSettings as PackagingSObjects.SubscriberPackageRemoteSiteSettings,
        CspTrustedSites: component.CspTrustedSites as PackagingSObjects.SubscriberPackageCspTrustedSites,
        Profiles: component.Profiles as PackagingSObjects.SubscriberPackageProfiles,
        Dependencies: component.Dependencies as PackagingSObjects.SubscriberPackageDependencies,
        InstallValidationStatus: component.InstallValidationStatus as PackagingSObjects.InstallValidationStatus,
      };
    });
  }

  private static mapRecordToBundleVersion(record: QueryRecord): BundleSObjects.BundleVersion {
    return {
      Id: record.Id,
      PackageBundle: PackageBundleVersion.mapPackageBundle(record.PackageBundle),
      VersionName: record.VersionName ?? '',
      MajorVersion: record.MajorVersion ?? '',
      MinorVersion: record.MinorVersion ?? '',
      CreatedDate: record.PackageBundle?.CreatedDate ?? '',
      CreatedById: record.PackageBundle?.CreatedById ?? '',
      LastModifiedDate: record.PackageBundle?.LastModifiedDate ?? '',
      LastModifiedById: record.PackageBundle?.LastModifiedById ?? '',
      Ancestor: record.Ancestor?.Id ? PackageBundleVersion.mapAncestor(record.Ancestor as AncestorRecord) : null,
      IsReleased: record.IsReleased ?? false,
    };
  }

  private static mapPackageBundle(packageBundle: QueryRecord['PackageBundle']): BundleSObjects.Bundle {
    return {
      Id: packageBundle?.Id ?? '',
      BundleName: packageBundle?.BundleName ?? '',
      Description: packageBundle?.Description,
      IsDeleted: packageBundle?.IsDeleted ?? false,
      CreatedDate: packageBundle?.CreatedDate ?? '',
      CreatedById: packageBundle?.CreatedById ?? '',
      LastModifiedDate: packageBundle?.LastModifiedDate ?? '',
      LastModifiedById: packageBundle?.LastModifiedById ?? '',
      SystemModstamp: packageBundle?.SystemModstamp ?? '',
    };
  }

  private static mapAncestor(ancestor: AncestorRecord): BundleSObjects.BundleVersion {
    return {
      Id: ancestor.Id,
      PackageBundle: PackageBundleVersion.mapAncestorPackageBundle(ancestor.PackageBundle),
      VersionName: ancestor?.VersionName ?? '',
      MajorVersion: ancestor?.MajorVersion ?? '',
      MinorVersion: ancestor?.MinorVersion ?? '',
      CreatedDate: ancestor.PackageBundle?.CreatedDate ?? '',
      CreatedById: ancestor.PackageBundle?.CreatedById ?? '',
      LastModifiedDate: ancestor.PackageBundle?.LastModifiedDate ?? '',
      LastModifiedById: ancestor.PackageBundle?.LastModifiedById ?? '',
      Ancestor: null,
      IsReleased: ancestor.IsReleased ?? false,
    };
  }

  private static mapAncestorPackageBundle(packageBundle: AncestorRecord['PackageBundle']): BundleSObjects.Bundle {
    return {
      Id: packageBundle?.Id ?? '',
      BundleName: packageBundle?.BundleName ?? '',
      Description: packageBundle?.Description,
      IsDeleted: packageBundle?.IsDeleted ?? false,
      CreatedDate: packageBundle?.CreatedDate ?? '',
      CreatedById: packageBundle?.CreatedById ?? '',
      LastModifiedDate: packageBundle?.LastModifiedDate ?? '',
      LastModifiedById: packageBundle?.LastModifiedById ?? '',
      SystemModstamp: packageBundle?.SystemModstamp ?? '',
    };
  }

  /**
   * Add a bundle version alias to the sfdx-project.json file after successful bundle version creation.
   * Creates an alias in the format: <BundleName>@<MajorVersion>.<MinorVersion>
   *
   * @param project The SfProject instance
   * @param result The bundle version create result containing bundle information
   */
  private static async addBundleVersionAlias(
    project: SfProject,
    result: BundleSObjects.PackageBundleVersionCreateRequestResult
  ): Promise<void> {
    // Skip if auto-update is disabled
    if (env.getBoolean('SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_CREATE')) {
      return;
    }

    // Ensure we have the necessary information to create the alias
    if (!result.PackageBundleVersionId || !result.VersionName || !result.MajorVersion || !result.MinorVersion) {
      return;
    }

    // Create alias in format: BundleName@MajorVersion.MinorVersion
    const alias = `${result.VersionName}@${result.MajorVersion}.${result.MinorVersion}`;

    // Add the alias to the sfdx-project.json file
    project.getSfProjectJson().addPackageBundleAlias(alias, result.PackageBundleVersionId);
    await project.getSfProjectJson().write();
  }
}
