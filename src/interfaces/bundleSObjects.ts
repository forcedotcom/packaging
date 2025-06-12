/*
 * Copyright (c) 2025, salesforce.com, inc.
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
    BundleVersionComponents: string[];
  };
}
