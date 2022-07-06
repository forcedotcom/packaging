/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Duration } from '@salesforce/kit';
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

export type Package1Display = {
  MetadataPackageVersionId: string;
  MetadataPackageId: string;
  Name: string;
  Version: string;
  ReleaseState: string;
  BuildNumber: number;
};
