/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Nullable } from '@salesforce/ts-types';
import { Connection, SfProject } from '@salesforce/core';
import { Duration } from '@salesforce/kit';

export type BundleCreateOptions = {
  BundleName: string;
  Description: string;
};

export type BundleVersionCreateOptions = {
  connection: Connection;
  project: SfProject;
  PackageBundle: string;
  MajorVersion: string;
  MinorVersion: string;
  Ancestor: Nullable<string>;
  BundleVersionComponentsPath: string;
  polling?: {
    timeout: Duration;
    frequency: Duration;
  };
};
