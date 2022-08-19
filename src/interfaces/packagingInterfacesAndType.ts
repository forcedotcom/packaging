/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Duration } from '@salesforce/kit';
import { Connection, SfProject } from '@salesforce/core';
import { QueryResult, SaveResult } from 'jsforce';
import { PackageProfileApi } from '../package/packageProfileApi';
import { PackagingSObjects } from './packagingSObjects';
import Package2VersionStatus = PackagingSObjects.Package2VersionStatus;
import PackageInstallRequest = PackagingSObjects.PackageInstallRequest;
import MetadataPackageVersion = PackagingSObjects.MetadataPackageVersion;

export interface IPackage {
  create(): Promise<void>;
  convert(): Promise<void>;
  delete(): Promise<void>;
  install(
    pkgInstallCreateRequest: PackageInstallCreateRequest,
    options?: PackageInstallOptions
  ): Promise<PackageInstallRequest>;
  getInstallStatus(installRequestId: string): Promise<PackageInstallRequest>;
  list(): Promise<QueryResult<PackagingSObjects.Package2>>;
  uninstall(): Promise<void>;
  update(): Promise<void>;
  waitForPublish(subscriberPackageVersionKey: string, timeout: number | Duration, installationKey?: string);
  getExternalSites(subscriberPackageVersionKey: string, installationKey?: string);
}

export interface IPackageVersion1GP {
  create(): Promise<void>;
  convert(): Promise<void>;
  delete(): Promise<void>;
  install(): Promise<void>;
  list(): Promise<void>;
  uninstall(): Promise<void>;
  update(): Promise<void>;
}

export interface IPackageVersion2GP {
  create(): Promise<void>;
  convert(): Promise<void>;
  delete(): Promise<void>;
  install(): Promise<void>;
  list(): Promise<void>;
  uninstall(): Promise<void>;
  update(): Promise<void>;
}

export type PackageOptions = {
  connection: Connection;
};

export type PackageIdType =
  | 'PackageId'
  | 'SubscriberPackageVersionId'
  | 'PackageInstallRequestId'
  | 'PackageUninstallRequestId';

export type PackageVersionOptions1GP = Record<string, unknown>;

export type PackageVersionCreateRequestResult = {
  Id: string;
  Status: Package2VersionStatus;
  Package2Id: string;
  Package2VersionId: string;
  SubscriberPackageVersionId: string | null;
  Tag: string;
  Branch: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Error: any[];
  CreatedDate: string;
  HasMetadataRemoved: boolean | null;
  CreatedBy: string;
};

export const PackageVersionCreateRequestResultInProgressStatuses = Object.values(Package2VersionStatus).filter(
  (status) => !['Queued', 'Success', 'Error'].includes(status)
);

export type PackageVersionCreateRequestError = {
  Message: string;
};

export type PackageVersionCreateEventData = {
  id: string;
  packageUpdated?: boolean;
  packageVersionCreateRequestResult: PackageVersionCreateRequestResult;
  message?: string;
  timeRemaining?: Duration;
};

export type PackageVersionListResult = {
  Id: string;
  Package2Id: string;
  SubscriberPackageVersionId: string;
  Name: string;
  Package2: {
    [key: string]: unknown;
    Name: string;
    NamespacePrefix: string;
    IsOrgDependent?: boolean;
  };
  Description: string;
  Tag: string;
  Branch: string;
  MajorVersion: string;
  MinorVersion: string;
  PatchVersion: string;
  BuildNumber: string;
  IsReleased: boolean;
  CreatedDate: string;
  LastModifiedDate: string;
  IsPasswordProtected: boolean;
  AncestorId: string;
  ValidationSkipped: boolean;
  CreatedById: string;
  CodeCoverage?: {
    [key: string]: unknown;
    ApexCodeCoveragePercentage: number;
  };
  HasPassedCodeCoverageCheck?: boolean;
  ConvertedFromVersionId?: string;
  ReleaseVersion?: string;
  BuildDurationInSeconds?: number;
  HasMetadataRemoved?: boolean;
};

export type PackageInstallCreateRequest = Partial<
  Pick<
    PackageInstallRequest,
    | 'ApexCompileType'
    | 'EnableRss'
    | 'NameConflictResolution'
    | 'PackageInstallSource'
    | 'Password'
    | 'SecurityType'
    | 'UpgradeType'
  >
> &
  Pick<PackagingSObjects.PackageInstallRequest, 'SubscriberPackageVersionKey'>;

export type Package1Display = {
  MetadataPackageVersionId: string;
  MetadataPackageId: string;
  Name: string;
  Version: string;
  ReleaseState: string;
  BuildNumber: number;
};

export type PackageType = 'Managed' | 'Unlocked';

export type PackageCreateOptions = {
  name: string;
  description: string;
  noNamespace: boolean;
  orgDependent: boolean;
  packageType: PackageType;
  errorNotificationUsername: string;
  path: string;
};

export type PackageVersionQueryOptions = Pick<PackageVersionOptions, 'connection'> & {
  orderBy: string;
  modifiedLastDays: number;
  createdLastDays: number;
  packages: string[];
  verbose: boolean;
  concise: boolean;
  isReleased: boolean;
};

export type PackageSaveResult = SaveResult;

export type PackageVersionCreateRequestOptions = {
  path: string;
  preserve: boolean;
  definitionfile?: string;
  codecoverage?: boolean;
  branch?: string;
  skipancestorcheck?: boolean;
};

export type PackageInstallOptions = {
  /**
   * The frequency to poll the org for package installation status. If providing a number
   * it is interpreted in milliseconds.
   */
  pollingFrequency?: number | Duration;
  /**
   * The amount of time to wait for package installation to complete. If providing a number
   * it is interpreted in minutes.
   */
  pollingTimeout?: number | Duration;
};

export type MDFolderForArtifactOptions = {
  packageName?: string;
  sourceDir?: string;
  outputDir?: string;
  manifest?: string;
  sourcePaths?: string[];
  metadataPaths?: string[];
  deploydir?: string;
};

export type PackageVersionOptions = {
  connection: Connection;
  project: SfProject;
};

export type PackageVersionCreateOptions = Partial<
  PackageVersionOptions & {
    branch: string;
    buildinstance: string;
    codecoverage: boolean;
    definitionfile: string;
    installationkey: string;
    installationkeybypass: boolean;
    package: string;
    path: string;
    postinstallscript: string;
    postinstallurl: string;
    preserve: boolean;
    releasenotesurl: string;
    skipancestorcheck: boolean;
    skipvalidation: boolean;
    sourceorg: string;
    tag: string;
    uninstallscript: string;
    validateschema: boolean;
    versiondescription: string;
    versionname: string;
    versionnumber: string;
    wait: Duration;
    pollInterval: Duration;
    profileApi: PackageProfileApi;
  }
>;

export type PackageVersionCreateRequestQueryOptions = {
  createdlastdays?: number;
  connection?: Connection;
  status?: string;
};

export type ProfileApiOptions = {
  project: SfProject;
  includeUserLicenses: boolean;
  generateProfileInformation: boolean;
};

export type PackageVersionReportResult = Partial<PackagingSObjects.Package2Version> & {
  Package2: Partial<PackagingSObjects.Package2>;
  SubscriberPackageVersion?: Pick<PackagingSObjects.SubscriberPackageVersion, 'Dependencies'>;
  Version: string;
  AncestorVersion?: string;
  PackageType: PackageType;
};

export type PackageVersionCreateReportProgress = PackageVersionCreateRequestResult & {
  remainingWaitTime: Duration;
};

export type Package1VersionCreateRequest = Pick<PackagingSObjects.PackageUploadRequest, 'VersionName'> &
  Partial<
    Pick<
      PackagingSObjects.PackageUploadRequest,
      | 'MetadataPackageId'
      | 'Description'
      | 'MajorVersion'
      | 'MinorVersion'
      | 'IsReleaseVersion'
      | 'ReleaseNotesUrl'
      | 'PostInstallUrl'
      | 'Password'
    >
  >;

export type InstalledPackages = {
  Id: string;
  SubscriberPackageId: string;
  SubscriberPackageVersionId: string;
  MinPackageVersionId: string;
  SubscriberPackage?: PackagingSObjects.SubscriberPackage;
  SubscriberPackageVersion?: Omit<MetadataPackageVersion, 'MetadataPackageId' | 'ReleaseState' | 'IsDeprecated'>;
};

export type CodeCoverage = null | {
  apexCodeCoveragePercentage: number;
};

export type CodeCoveragePercentages = null | {
  codeCovPercentages: [
    {
      className: string;
      codeCoveragePercentage: number;
    }
  ];
};
