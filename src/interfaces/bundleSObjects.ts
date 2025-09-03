/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Nullable } from '@salesforce/ts-types';
import { BundleEntry } from '@salesforce/schemas';
import type { Schema } from '@jsforce/jsforce-node';

export { BundleEntry };

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
  };

  export enum PkgBundleVersionCreateReqStatus {
    queued = 'Queued',
    success = 'Success',
    error = 'Error',
  }

  export enum PkgBundleVersionInstallReqStatus {
    queued = 'Queued',
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
  } & Schema;

  export type PkgBundleVersionInstallReq = {
    PackageBundleVersionID: string;
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
    PackageBundleVersionID: string;
    DevelopmentOrganization: string;
    ValidationError: string;
    CreatedDate: string;
    CreatedById: string;
    Error?: string[];
  } & Schema;
}
