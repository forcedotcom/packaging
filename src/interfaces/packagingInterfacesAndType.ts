/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Duration } from '@salesforce/kit';
import { Connection } from '@salesforce/core';
import { NamedPackagingDir, SfProject } from '@salesforce/core/project';
import type { SaveResult } from '@jsforce/jsforce-node';
import { Attributes } from 'graphology-types';
import { Optional } from '@salesforce/ts-types';
import { ConvertResult } from '@salesforce/source-deploy-retrieve';
import type { Package } from '@salesforce/types/metadata';
import { PackageProfileApi } from '../package/packageProfileApi';
import { PackageAncestryNode } from '../package/packageAncestry';
import { PackagingSObjects } from './packagingSObjects';
import Package2VersionStatus = PackagingSObjects.Package2VersionStatus;
import PackageInstallRequest = PackagingSObjects.PackageInstallRequest;
import MetadataPackageVersion = PackagingSObjects.MetadataPackageVersion;

export type IPackageVersion1GP = {
  getPackageVersion(id: string): Promise<MetadataPackageVersion[]>;
};

export type IPackageVersion2GP = {
  create(): Promise<void>;

  convert(): Promise<void>;

  delete(): Promise<void>;

  install(): Promise<void>;

  list(): Promise<void>;

  uninstall(): Promise<void>;

  update(): Promise<void>;
};

export type PackageOptions = {
  connection: Connection;
  project: SfProject;
  packageAliasOrId: string;
};

export type PackageUpdateOptions = {
  Id: string;
  Name?: string;
  Description?: string;
  PackageErrorUsername?: string;
  AppAnalyticsEnabled?: boolean;
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
  Package2Name: string | null;
  Package2VersionId: string;
  SubscriberPackageVersionId: string | null;
  Tag: string;
  Branch: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Error: any[];
  CreatedDate: string;
  HasMetadataRemoved: boolean | null;
  HasPassedCodeCoverageCheck: boolean | null;
  CodeCoverage: number | null;
  VersionNumber: string | null;
  CreatedBy: string;
  ConvertedFromVersionId: string | null;
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
    apexCodeCoveragePercentage: number;
  };
  HasPassedCodeCoverageCheck?: boolean;
  ConvertedFromVersionId?: string;
  ReleaseVersion?: string;
  BuildDurationInSeconds?: number;
  HasMetadataRemoved?: boolean;
  Language?: string;
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
    | 'SkipHandlers'
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

export type PackageDescriptorJson = Partial<NamedPackagingDir> &
  Partial<{
    id: string;
    features: string[];
    orgPreferences: string[];
    snapshot: string;
    packageMetadataAccess: { permissionSets: string[] | string; permissionSetLicenses: string[] | string };
    apexTestAccess: { permissionSets: string[] | string; permissionSetLicenses: string[] | string };
    permissionSetNames: string[];
    permissionSetLicenseDeveloperNames: string[];
    packageMetadataPermissionSetNames: string[];
    packageMetadataPermissionSetLicenseNames: string[];
    branch: string;
    subscriberPackageVersionId: string;
    packageId: string;
    versionName: string;
    language?: string;
  }>;

export type PackageVersionCreateRequest = {
  Package2Id: string;
  VersionInfo: string;
  Tag?: string;
  Branch?: string;
  InstallKey?: string;
  Instance?: string;
  SourceOrg?: string;
  Language?: string;
  CalculateCodeCoverage: boolean;
  SkipValidation: boolean;
};

export type PackageVersionListOptions = {
  orderBy?: string;
  modifiedLastDays?: number;
  createdLastDays?: number;
  packages?: string[];
  verbose?: boolean;
  concise?: boolean;
  isReleased?: boolean;
  showConversionsOnly?: boolean;
};

export type PackageVersionUpdateOptions = {
  InstallKey?: string;
  VersionName?: string;
  VersionDescription?: string;
  Branch?: string;
  Tag?: string;
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

export type PackageVersionMetadataDownloadOptions = {
  subscriberPackageVersionId: string;
  destinationFolder?: string;
};

export type PackageVersionMetadataDownloadResult = ConvertResult;

export type PackageInstallOptions = {
  /**
   * The frequency to poll the org for package publish status. If providing a number
   * it is interpreted in milliseconds.
   */

  publishFrequency?: number | Duration;
  /**
   * The amount of time to wait for package publish to complete. If providing a number
   * it is interpreted in minutes.
   */

  publishTimeout?: number | Duration;
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
  sourceApiVersion?: string;
};

export type PackageVersionOptions = {
  connection: Connection;
  /**
   * Can be one of:
   * 1. SubscriberPackageVersionId (04t)
   * 2. PackageVersionId (05i)
   * 3. Alias for a 04t or 05i, defined in sfdx-project.json
   */
  idOrAlias: string;
  project: SfProject;
};

export type SubscriberPackageVersionOptions = {
  connection: Connection;
  aliasOrId: string;
  password: Optional<string>;
};

export type ConvertPackageOptions = {
  installationKey: string;
  definitionfile: string;
  installationKeyBypass: boolean;
  wait: Duration;
  buildInstance: string;
  frequency?: Duration;
  seedMetadata?: string;
};

export type PackageVersionCreateOptions = {
  connection: Connection;
  project: SfProject;
} & Partial<{
  branch: string;
  buildinstance: string;
  codecoverage: boolean;
  definitionfile: string;
  installationkey: string;
  installationkeybypass: boolean;
  language?: string;
  packageId: string;
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
  profileApi: PackageProfileApi;
}>;

export type PackageVersionCreateRequestQueryOptions = {
  createdlastdays?: number;
  status?: 'Queued' | 'InProgress' | 'Success' | 'Error';
  id?: string;
  showConversionsOnly?: boolean;
};

export type ProfileApiOptions = {
  project: SfProject;
  includeUserLicenses: boolean;
};

export type PackageVersionReportResult = Partial<
  Omit<PackagingSObjects.Package2Version, 'AncestorId' | 'HasPassedCodeCoverageCheck' | 'HasMetadataRemoved'>
> & {
  Package2: Partial<Omit<PackagingSObjects.Package2, 'IsOrgDependent'>> & {
    IsOrgDependent: boolean | null | undefined;
  };
  SubscriberPackageVersion?: Pick<PackagingSObjects.SubscriberPackageVersion, 'Dependencies'>;
  Version: string;
  AncestorVersion?: string | null;
  AncestorId?: string | null;
  PackageType?: PackageType | null;
  HasPassedCodeCoverageCheck?: boolean | null;
  HasMetadataRemoved?: boolean | null;
};

export type PackageVersionCreateReportProgress = PackageVersionCreateRequestResult & {
  remainingWaitTime: Duration;
};

export type Package1VersionCreateRequest = Pick<
  PackagingSObjects.PackageUploadRequest,
  'VersionName' | 'MetadataPackageId'
> &
  Partial<
    Pick<
      PackagingSObjects.PackageUploadRequest,
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

export type PackageAncestryNodeOptions = Attributes & {
  AncestorId?: string;
  SubscriberPackageVersionId: string;
  MajorVersion: string | number;
  MinorVersion: string | number;
  PatchVersion: string | number;
  BuildNumber: string | number;
  depthCounter: number;
};

export type PackageAncestryNodeAttributes = PackageAncestryNodeOptions & {
  node: PackageAncestryNode;
};

export type PackageAncestryData = Omit<PackageAncestryNodeAttributes, 'AncestorId'>;

export type PackageAncestryNodeData = {
  data: PackageAncestryNodeOptions;
  children: PackageAncestryNodeData[];
};

export type PackageAncestryOptions = {
  packageId: string;
  project: SfProject;
  connection: Connection;
};

export type AncestryRepresentationProducerOptions = {
  packageNode?: PackageAncestryNode;
  depth: number;
  verbose?: boolean;
  logger?: (text: string) => void;
};

export type AncestryRepresentationProducer = {
  label: string;
  options?: AncestryRepresentationProducerOptions;

  addNode(node: AncestryRepresentationProducer): void;

  produce(): PackageAncestryNodeData | string | void;
};

export const PackageEvents = {
  convert: {
    success: 'Package/convert-success',
    error: 'Package/convert-error',
    progress: 'Package/convert-in-progress',
  },
  install: {
    warning: 'Package/install-warning',
    presend: 'Package/install-presend',
    postsend: 'Package/install-postsend',
    status: 'Package/install-status',
    'subscriber-status': 'Package/install-subscriber-status',
  },
  uninstall: 'Package/uninstall',
};

export const PackageVersionEvents = {
  create: {
    enqueued: 'PackageVersion/create-enqueued',
    progress: 'PackageVersion/create-in-progress',
    success: 'PackageVersion/create-success',
    error: 'PackageVersion/create-error',
    'timed-out': 'PackageVersion/create-timed-out',
    'preserve-files': 'PackageVersion/create-preserve-files',
  },
};

export const Package1VersionEvents = {
  create: {
    progress: 'Package1Version/create-progress',
  },
};

export type PackageXml = Pick<Package, 'types' | 'version'>;
