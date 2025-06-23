/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
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
