/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Nullable } from '@salesforce/ts-types';
import { BundleEntry } from '@salesforce/schemas/src/sfdx-project/bundleEntry';
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
    PackageBundle: string;
    VersionName: string;
    MajorVersion: string;
    MinorVersion: string;
    Ancestor: Nullable<string>;
    IsReleased: boolean;
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
  export type QueryRecord = {
    Id: string;
    RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus;
    PackageBundle: {
      Id: string;
      BundleName: string;
    };
    PackageBundleVersion: {
      Id: string;
    };
    VersionName: string;
    MajorVersion: string;
    MinorVersion: string;
    'Ancestor.Id': string;
    BundleVersionComponents: string;
    CreatedDate: string;
    CreatedById: string;
    Error?: string[];
  } & Schema;
}
