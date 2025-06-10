/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Nullable } from '@salesforce/ts-types';
import { BundleEntry } from '@salesforce/schemas/src/sfdx-project/bundleEntry';

export { BundleEntry };

export namespace BundleSObjects {
  export type Bundle = {
    BundleName: string;
    Description?: string;
  };

  export type BundleVersion = {
    PackageBundle: Bundle;
    VersionName: string;
    MajorVersion: number;
    MinorVersion: number;
    Ancestor: Nullable<BundleVersion>;
    IsReleased: boolean;
  };
  export type PkgBundleVersionCreateReq = {
    PackageBundle: Bundle;
    VersionName: string;
    MajorVersion: number;
    MinorVersion: number;
    Ancestor: Nullable<BundleVersion>;
    RequestStatus: BundleVersionStatus;
    BundleVersionComponents: string[];
  };
  export enum BundleVersionStatus {
    queued = 'Queued',
    inProgress = 'InProgress',
    success = 'Success',
    error = 'Error',
    initializing = 'Initializing',
    verifyingFeaturesAndSettings = 'VerifyingFeaturesAndSettings',
    verifyingDependencies = 'VerifyingDependencies',
    verifyingMetadata = 'VerifyingMetadata',
    finalizingPackageVersion = 'FinalizingPackageVersion',
    performingValidations = 'PerformingValidations',
  }
}
