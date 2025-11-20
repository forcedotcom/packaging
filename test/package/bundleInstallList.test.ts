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
import path from 'node:path';
import fs from 'node:fs';
import { expect } from 'chai';
import { Connection, SfProject, SfError } from '@salesforce/core';
import { instantiateContext, restoreContext, stubContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { AnyJson, ensureJsonMap } from '@salesforce/ts-types';
import { ensureString } from '@salesforce/ts-types';
import { PackageBundleInstall } from '../../src/package/packageBundleInstall';
import { BundleSObjects } from '../../src/interfaces';

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

describe('bundleInstallList', () => {
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

  describe('getInstallStatuses', () => {
    it('should get install statuses without filters', async () => {
      testContext.inProject(true);
      await setupProject();

      const mockInstallStatuses = [
        {
          Id: '08c000000000001',
          InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.success,
          PackageBundleVersionId: '05i000000000001',
          DevelopmentOrganization: '00D000000000001',
          ValidationError: '',
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          CreatedById: '005000000000000',
          Error: [],
        },
        {
          Id: '08c000000000002',
          InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.queued,
          PackageBundleVersionId: '05i000000000002',
          DevelopmentOrganization: '00D000000000002',
          ValidationError: '',
          CreatedDate: '2024-01-02T00:00:00.000+0000',
          CreatedById: '005000000000001',
          Error: [],
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (request && ensureString(requestMap.url).includes('PkgBundleVersionInstallReq')) {
          return Promise.resolve({
            done: true,
            totalSize: 2,
            records: mockInstallStatuses,
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const statuses = await PackageBundleInstall.getInstallStatuses(connection);

      expect(statuses).to.have.length(2);
      expect(statuses[0]).to.deep.equal({
        Id: '08c000000000001',
        InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.success,
        PackageBundleVersionId: '05i000000000001',
        DevelopmentOrganization: '00D000000000001',
        ValidationError: '',
        CreatedDate: '2024-01-01T00:00:00.000+0000',
        CreatedById: '005000000000000',
        Error: [],
      });
      expect(statuses[1]).to.deep.equal({
        Id: '08c000000000002',
        InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.queued,
        PackageBundleVersionId: '05i000000000002',
        DevelopmentOrganization: '00D000000000002',
        ValidationError: '',
        CreatedDate: '2024-01-02T00:00:00.000+0000',
        CreatedById: '005000000000001',
        Error: [],
      });
    });

    it('should get install statuses with status filter', async () => {
      testContext.inProject(true);
      await setupProject();

      const mockInstallStatuses = [
        {
          Id: '08c000000000001',
          InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.success,
          PackageBundleVersionId: '05i000000000001',
          DevelopmentOrganization: '00D000000000001',
          ValidationError: '',
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          CreatedById: '005000000000000',
          Error: [],
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (
          request &&
          ensureString(requestMap.url).includes('PkgBundleVersionInstallReq') &&
          ensureString(requestMap.url).includes('InstallStatus')
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstallStatuses,
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const statuses = await PackageBundleInstall.getInstallStatuses(
        connection,
        BundleSObjects.PkgBundleVersionInstallReqStatus.success
      );

      expect(statuses).to.have.length(1);
      expect(statuses[0].InstallStatus).to.equal(BundleSObjects.PkgBundleVersionInstallReqStatus.success);
    });

    it('should get install statuses with createdLastDays filter', async () => {
      testContext.inProject(true);
      await setupProject();

      const mockInstallStatuses = [
        {
          Id: '08c000000000001',
          InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.success,
          PackageBundleVersionId: '05i000000000001',
          DevelopmentOrganization: '00D000000000001',
          ValidationError: '',
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          CreatedById: '005000000000000',
          Error: [],
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (
          request &&
          ensureString(requestMap.url).includes('PkgBundleVersionInstallReq') &&
          ensureString(requestMap.url).includes('LAST_N_DAYS')
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstallStatuses,
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const statuses = await PackageBundleInstall.getInstallStatuses(connection, undefined, 7);

      expect(statuses).to.have.length(1);
    });

    it('should get install statuses with both status and createdLastDays filters', async () => {
      testContext.inProject(true);
      await setupProject();

      const mockInstallStatuses = [
        {
          Id: '08c000000000001',
          InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.error,
          PackageBundleVersionId: '05i000000000001',
          DevelopmentOrganization: '00D000000000001',
          ValidationError: 'Test validation error',
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          CreatedById: '005000000000000',
          Error: [],
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (
          request &&
          ensureString(requestMap.url).includes('PkgBundleVersionInstallReq') &&
          ensureString(requestMap.url).includes('InstallStatus') &&
          ensureString(requestMap.url).includes('LAST_N_DAYS')
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstallStatuses,
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const statuses = await PackageBundleInstall.getInstallStatuses(
        connection,
        BundleSObjects.PkgBundleVersionInstallReqStatus.error,
        3
      );

      expect(statuses).to.have.length(1);
      expect(statuses[0].InstallStatus).to.equal(BundleSObjects.PkgBundleVersionInstallReqStatus.error);
    });

    it('should handle empty results', async () => {
      testContext.inProject(true);
      await setupProject();

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (request && ensureString(requestMap.url).includes('PkgBundleVersionInstallReq')) {
          return Promise.resolve({
            done: true,
            totalSize: 0,
            records: [],
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const statuses = await PackageBundleInstall.getInstallStatuses(connection);

      expect(statuses).to.be.an('array');
      expect(statuses).to.have.length(0);
    });
  });
});
