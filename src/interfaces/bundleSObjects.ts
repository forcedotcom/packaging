/*
 * Copyright 2025, Salesforce, Inc.
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
import { Nullable } from '@salesforce/ts-types';
import { BundleEntry } from '@salesforce/schemas';
import type { Schema } from '@jsforce/jsforce-node';

export { BundleEntry };

export type QueryRecord = Schema & {
  Id: string;
  PackageBundle?: {
    Id: string;
    BundleName: string;
    Description?: string;
    IsDeleted: boolean;
    CreatedDate: string;
    CreatedById: string;
    LastModifiedDate: string;
    LastModifiedById: string;
    SystemModstamp: string;
  };
  VersionName: string;
  MajorVersion: string;
  MinorVersion: string;
  IsReleased: boolean;
  Ancestor?: {
    Id: string;
    PackageBundle?: {
      Id: string;
      BundleName: string;
      Description?: string;
      IsDeleted: boolean;
      CreatedDate: string;
      CreatedById: string;
      LastModifiedDate: string;
      LastModifiedById: string;
      SystemModstamp: string;
    };
    VersionName: string;
    MajorVersion: string;
    MinorVersion: string;
    IsReleased: boolean;
  };
};

export type AncestorRecord = {
  Id: string;
  PackageBundle?: {
    Id: string;
    BundleName: string;
    Description?: string;
    IsDeleted: boolean;
    CreatedDate: string;
    CreatedById: string;
    LastModifiedDate: string;
    LastModifiedById: string;
    SystemModstamp: string;
  };
  VersionName: string;
  MajorVersion: string;
  MinorVersion: string;
  IsReleased: boolean;
};

export namespace BundleSObjects {
  export type Bundle = {
    BundleName: string;
    Description?: string;
    Id: string;
    IsDeleted: boolean;
    CreatedDate: string;
    CreatedById: string;
    LastModifiedDate: string;
    LastModifiedById: string;
    SystemModstamp: string;
  };

  export type BundleVersion = {
    Id: string;
    PackageBundle: Bundle;
    VersionName: string;
    MajorVersion: string;
    MinorVersion: string;
    Ancestor: Nullable<BundleVersion>;
    IsReleased: boolean;
    CreatedDate: string;
    CreatedById: string;
    LastModifiedDate: string;
    LastModifiedById: string;
  };

  export type PkgBundleVersionCreateReq = {
    PackageBundleId: string;
    VersionName: string;
    MajorVersion: string;
    MinorVersion: string;
    BundleVersionComponents: string;
    Ancestor?: string | null;
    InstallationKey?: string;
  };

  export type PackageBundleVersionCreateRequestResult = PkgBundleVersionCreateReq & {
    Id: string;
    PackageBundleVersionId: string;
    RequestStatus: PkgBundleVersionCreateReqStatus;
    CreatedDate: string;
    CreatedById: string;
    Error?: string[];
    ValidationError?: string;
  };

  export enum PkgBundleVersionCreateReqStatus {
    queued = 'Queued',
    inProgress = 'InProgress',
    success = 'Success',
    error = 'Error',
  }

  export enum PkgBundleVersionInstallReqStatus {
    queued = 'Queued',
    inProgress = 'InProgress',
    success = 'Success',
    error = 'Error',
  }

  export enum PkgBundleVersionUninstallReqStatus {
    queued = 'Queued',
    inProgress = 'InProgress',
    success = 'Success',
    error = 'Error',
  }

  export enum PkgBundleVerCpntUnistlReqStatus {
    queued = 'Queued',
    inProgress = 'InProgress',
    success = 'Success',
    error = 'Error',
  }

  export type PkgBundleVersionQueryRecord = {
    Id: string;
    RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus;
    PackageBundle: Bundle;
    PackageBundleVersion: BundleVersion;
    VersionName: string;
    MajorVersion: string;
    MinorVersion: string;
    Ancestor: BundleVersion;
    BundleVersionComponents: string;
    CreatedDate: string;
    CreatedById: string;
    Error?: string[];
    ValidationError?: string;
  } & Schema;

  export type PkgBundleVersionInstallReq = {
    PackageBundleVersionId: string;
    DevelopmentOrganization: string;
    InstallationKey?: string;
  };

  export type PkgBundleVersionInstallReqResult = PkgBundleVersionInstallReq & {
    Id: string;
    InstallStatus: PkgBundleVersionInstallReqStatus;
    ValidationError: string;
    CreatedDate: string;
    CreatedById: string;
    Error?: string[];
  };
  export type PkgBundleVersionInstallQueryRecord = {
    Id: string;
    InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus;
    PackageBundleVersionId: string;
    DevelopmentOrganization: string;
    ValidationError: string;
    CreatedDate: string;
    CreatedById: string;
    Error?: string[];
  } & Schema;

  export type PkgBundleVerUninstallReq = {
    PackageBundleVersionId: string;
    InstalledPkgBundleVersionId?: string;
    ValidationError?: string;
  };

  export type PkgBundleVerUninstallReqResult = PkgBundleVerUninstallReq & {
    Id: string;
    UninstallStatus: PkgBundleVersionUninstallReqStatus;
    CreatedDate: string;
    CreatedById: string;
    Error?: string[];
  };

  export type PkgBundleVerUninstallReqQueryRecord = {
    Id: string;
    UninstallStatus: PkgBundleVersionUninstallReqStatus;
    PackageBundleVersionId: string;
    InstalledPkgBundleVersionId?: string;
    ValidationError?: string;
    CreatedDate: string;
    CreatedById: string;
    Error?: string[];
  } & Schema;

  export type PkgBundleVerCpntUnistlReqRecord = {
    Id: string;
    SequenceOrder: number;
    UninstallStatus: PkgBundleVerCpntUnistlReqStatus;
    PkgBundleVersionComponent?: {
      Id: string;
    };
    Error?: string;
  } & Schema;

  export type InstalledPackageBundleVersionComponent = {
    ExpectedPackageName: string;
    ExpectedPackageVersionNumber: string;
    ActualPackageName: string;
    ActualPackageVersionNumber: string;
  };

  export type InstalledPackageBundleVersion = {
    Id: string;
    BundleName: string;
    BundleId: string;
    BundleVersionId: string;
    BundleVersionName: string;
    MajorVersion: number;
    MinorVersion: number;
    Description: string;
    InstalledDate: string;
    LastUpgradedDate: string;
    Components: InstalledPackageBundleVersionComponent[];
  };

  export type InstalledPackageBundleVersionQueryRecord = {
    Id: string;
    PackageBundleVersion: {
      Id: string;
      VersionName: string;
      MajorVersion: number;
      MinorVersion: number;
      PackageBundle: {
        Id: string;
        BundleName: string;
        Description: string;
      };
    };
    InstalledDate: string;
    LastUpgradedDate: string;
  } & Schema;

  export type InstalledBundleRecord = {
    Id: string;
    PackageBundleId?: string; // CROSSORGFOREIGNKEY field ID
    PackageBundleVersionId?: string; // CROSSORGFOREIGNKEY field ID
    BundleName: string;
    BundleVersionName: string;
    MajorVersion: number;
    MinorVersion: number;
    CreatedDate?: string;
    LastModifiedDate?: string;
  } & Schema;

  export type InstallRequestRecord = {
    Id: string;
  } & Schema;

  export type BundleComponentInstallRecord = {
    SubscriberPackageVersion: {
      Id: string;
      SubscriberPackageId: string;
      MajorVersion: number;
      MinorVersion: number;
      PatchVersion: number;
      BuildNumber: number;
    };
    InstalledComponent?: {
      SubscriberPackage?: {
        Name: string;
      };
    };
    SequenceOrder: number;
  } & Schema;

  export type InstalledPackageRecord = {
    Id: string;
    SubscriberPackageId: string;
    SubscriberPackage: {
      Name: string;
    };
    SubscriberPackageVersion: {
      Id: string;
      MajorVersion: number;
      MinorVersion: number;
      PatchVersion: number;
      BuildNumber: number;
    };
  } & Schema;
}
