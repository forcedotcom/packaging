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
import path from 'node:path';
import fs from 'node:fs';
import { expect } from 'chai';
import { Connection, SfProject, SfError } from '@salesforce/core';
import { instantiateContext, restoreContext, stubContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { AnyJson, ensureJsonMap } from '@salesforce/ts-types';
import { ensureString } from '@salesforce/ts-types';
import { PackageBundleVersion } from '../../src/package/packageBundleVersion';

async function setupProject(setup: (project: SfProject) => void = () => {}) {
  const project = await SfProject.resolve();

  setup(project);
  const projectDir = project.getPath();
  project
    .getSfProjectJson()
    .getContents()
    .packageDirectories?.forEach((dir) => {
      if (dir.path) {
        const packagePath = path.join(projectDir, dir.path);
        fs.mkdirSync(packagePath, { recursive: true });
      }
    });

  return project;
}

describe('bundleVersionList', () => {
  const testContext = instantiateContext();
  const testOrg = new MockTestOrgData();
  let connection: Connection;

  beforeEach(async () => {
    stubContext(testContext);
    connection = await testOrg.getConnection();
  });

  afterEach(() => {
    restoreContext(testContext);
  });

  describe('list bundles', () => {
    it('should list package bundles successfully', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const mockBundleVersion = {
        Id: '0Ho000000000000',
        PackageBundle: {
          Id: '0Ho000000000001',
          BundleName: 'testBundle',
          Description: 'testBundle',
          IsDeleted: false,
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          CreatedById: '005000000000000',
          LastModifiedDate: '2024-01-01T00:00:00.000+0000',
          LastModifiedById: '005000000000000',
          SystemModstamp: '2024-01-01T00:00:00.000+0000',
        },
        VersionName: 'testBundle@1.0',
        MajorVersion: '1',
        MinorVersion: '0',
        CreatedDate: '2024-01-01T00:00:00.000+0000',
        CreatedById: '005000000000000',
        LastModifiedDate: '2024-01-01T00:00:00.000+0000',
        LastModifiedById: '005000000000000',
        IsReleased: false,
        Ancestor: null,
      };

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (request && ensureString(requestMap.url).includes('PackageBundle')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: [mockBundleVersion],
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const bundles = await PackageBundleVersion.list(connection);
      expect(bundles).to.deep.equal([mockBundleVersion]);
    });
  });
});
