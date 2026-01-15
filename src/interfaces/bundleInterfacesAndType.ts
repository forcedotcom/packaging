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
import { Connection, SfProject } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { SaveResult } from '@jsforce/jsforce-node';

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
  Description?: string; // Optional description for the bundle version
  polling?: {
    timeout: Duration;
    frequency: Duration;
  };
};

export type BundleInstallOptions = {
  connection: Connection;
  project: SfProject;
  PackageBundleVersion: string;
  DevelopmentOrganization: string;
  polling?: {
    timeout: Duration;
    frequency: Duration;
  };
};

export type BundleSaveResult = SaveResult;
