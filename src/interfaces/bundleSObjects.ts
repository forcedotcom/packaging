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
}
