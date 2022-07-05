/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Duration } from '@salesforce/kit';
import { Connection, SfProject } from '@salesforce/core';
import { SaveResult } from 'jsforce';
import { ProfileApi } from '../package/profileApi';
import { PackagingSObjects } from './packagingSObjects';
import Package2VersionStatus = PackagingSObjects.Package2VersionStatus;

export interface IPackage {
  create(): Promise<void>;
  convert(): Promise<void>;
  delete(): Promise<void>;
  install(): Promise<void>;
  list(): Promise<void>;
  uninstall(): Promise<void>;
  update(): Promise<void>;
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

export type PackageOptions = Record<string, unknown>;

export type PackageVersion2Options = Record<string, unknown>;
export type PackageVersionOptions1GP = Record<string, unknown>;

export type Package2VersionCreateRequestResult = {
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

export type Package2VersionCreateRequestError = {
  Message: string;
};

export type Package2VersionCreateEventData = {
  id: string;
  packageUpdated?: boolean;
  package2VersionCreateRequestResult: Package2VersionCreateRequestResult;
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

export type PackageVersionQueryOptions = {
  project: SfProject;
  orderBy: string;
  modifiedLastDays: number;
  createdLastDays: number;
  packages: string[];
  connection: Connection;
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

export type PackageVersionCreateOptions = PackageVersionOptions & {
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
  profileApi?: ProfileApi;
};

export type PackageVersionCreateRequestQueryOptions = {
  createdlastdays?: number;
  connection?: Connection;
  status?: string;
};
