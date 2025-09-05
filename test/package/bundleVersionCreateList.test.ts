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
import { PackageBundleVersionCreate } from '../../src/package/packageBundleVersionCreate';
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

describe('bundleList', () => {
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

  describe('getCreateStatuses', () => {
    it('should get create statuses without filters', async () => {
      testContext.inProject(true);
      await setupProject();

      const mockCreateStatuses = [
        {
          Id: '0Ho000000000001',
          RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
          PackageBundle: { Id: '0Ho000000000002', BundleName: 'testBundle1' },
          PackageBundleVersion: { Id: '0Ho000000000003' },
          VersionName: 'testBundle1@1.0',
          MajorVersion: '1',
          MinorVersion: '0',
          'Ancestor.Id': '',
          BundleVersionComponents: '[{"packageId": "0Ho000000000002", "versionNumber": "1.0.0"}]',
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          CreatedById: '005000000000000',
        },
        {
          Id: '0Ho000000000004',
          RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.queued,
          PackageBundle: { Id: '0Ho000000000005', BundleName: 'testBundle2' },
          PackageBundleVersion: { Id: '0Ho000000000006' },
          VersionName: 'testBundle2@2.0',
          MajorVersion: '2',
          MinorVersion: '0',
          'Ancestor.Id': '',
          BundleVersionComponents: '[{"packageId": "0Ho000000000005", "versionNumber": "2.0.0"}]',
          CreatedDate: '2024-01-02T00:00:00.000+0000',
          CreatedById: '005000000000001',
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (request && ensureString(requestMap.url).includes('PkgBundleVersionCreateReq')) {
          return Promise.resolve({
            done: true,
            totalSize: 2,
            records: mockCreateStatuses,
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const statuses = await PackageBundleVersionCreate.getCreateStatuses(connection);

      expect(statuses).to.have.length(2);
      expect(statuses[0]).to.deep.equal({
        Id: '0Ho000000000001',
        RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
        PackageBundleId: '0Ho000000000002',
        PackageBundleVersionId: '0Ho000000000003',
        VersionName: 'testBundle1@1.0',
        MajorVersion: '1',
        MinorVersion: '0',
        Ancestor: '',
        BundleVersionComponents: '[{"packageId": "0Ho000000000002", "versionNumber": "1.0.0"}]',
        CreatedDate: '2024-01-01T00:00:00.000+0000',
        CreatedById: '005000000000000',
      });
      expect(statuses[1]).to.deep.equal({
        Id: '0Ho000000000004',
        RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.queued,
        PackageBundleId: '0Ho000000000005',
        PackageBundleVersionId: '0Ho000000000006',
        VersionName: 'testBundle2@2.0',
        MajorVersion: '2',
        MinorVersion: '0',
        Ancestor: '',
        BundleVersionComponents: '[{"packageId": "0Ho000000000005", "versionNumber": "2.0.0"}]',
        CreatedDate: '2024-01-02T00:00:00.000+0000',
        CreatedById: '005000000000001',
      });
    });

    it('should get create statuses with status filter', async () => {
      testContext.inProject(true);
      await setupProject();

      const mockCreateStatuses = [
        {
          Id: '0Ho000000000001',
          RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
          PackageBundle: { Id: '0Ho000000000002', BundleName: 'testBundle1' },
          PackageBundleVersion: { Id: '0Ho000000000003' },
          VersionName: 'testBundle1@1.0',
          MajorVersion: '1',
          MinorVersion: '0',
          'Ancestor.Id': '',
          BundleVersionComponents: '[{"packageId": "0Ho000000000002", "versionNumber": "1.0.0"}]',
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          CreatedById: '005000000000000',
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (
          request &&
          ensureString(requestMap.url).includes('PkgBundleVersionCreateReq') &&
          ensureString(requestMap.url).includes('RequestStatus')
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockCreateStatuses,
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const statuses = await PackageBundleVersionCreate.getCreateStatuses(
        connection,
        BundleSObjects.PkgBundleVersionCreateReqStatus.success
      );

      expect(statuses).to.have.length(1);
      expect(statuses[0].RequestStatus).to.equal(BundleSObjects.PkgBundleVersionCreateReqStatus.success);
    });

    it('should get create statuses with createdLastDays filter', async () => {
      testContext.inProject(true);
      await setupProject();

      const mockCreateStatuses = [
        {
          Id: '0Ho000000000001',
          RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
          PackageBundle: { Id: '0Ho000000000002', BundleName: 'testBundle1' },
          PackageBundleVersion: { Id: '0Ho000000000003' },
          VersionName: 'testBundle1@1.0',
          MajorVersion: '1',
          MinorVersion: '0',
          'Ancestor.Id': '',
          BundleVersionComponents: '[{"packageId": "0Ho000000000002", "versionNumber": "1.0.0"}]',
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          CreatedById: '005000000000000',
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (
          request &&
          ensureString(requestMap.url).includes('PkgBundleVersionCreateReq') &&
          ensureString(requestMap.url).includes('LAST_N_DAYS')
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockCreateStatuses,
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const statuses = await PackageBundleVersionCreate.getCreateStatuses(connection, undefined, 7);

      expect(statuses).to.have.length(1);
    });

    it('should get create statuses with both status and createdLastDays filters', async () => {
      testContext.inProject(true);
      await setupProject();

      const mockCreateStatuses = [
        {
          Id: '0Ho000000000001',
          RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.error,
          PackageBundle: { Id: '0Ho000000000002', BundleName: 'testBundle1' },
          PackageBundleVersion: { Id: '0Ho000000000003' },
          VersionName: 'testBundle1@1.0',
          MajorVersion: '1',
          MinorVersion: '0',
          'Ancestor.Id': '',
          BundleVersionComponents: '[{"packageId": "0Ho000000000002", "versionNumber": "1.0.0"}]',
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          CreatedById: '005000000000000',
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (
          request &&
          ensureString(requestMap.url).includes('PkgBundleVersionCreateReq') &&
          ensureString(requestMap.url).includes('RequestStatus') &&
          ensureString(requestMap.url).includes('LAST_N_DAYS')
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockCreateStatuses,
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const statuses = await PackageBundleVersionCreate.getCreateStatuses(
        connection,
        BundleSObjects.PkgBundleVersionCreateReqStatus.error,
        3
      );

      expect(statuses).to.have.length(1);
      expect(statuses[0].RequestStatus).to.equal(BundleSObjects.PkgBundleVersionCreateReqStatus.error);
    });

    it('should handle empty results', async () => {
      testContext.inProject(true);
      await setupProject();

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (request && ensureString(requestMap.url).includes('PkgBundleVersionCreateReq')) {
          return Promise.resolve({
            done: true,
            totalSize: 0,
            records: [],
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const statuses = await PackageBundleVersionCreate.getCreateStatuses(connection);

      expect(statuses).to.be.an('array');
      expect(statuses).to.have.length(0);
    });
  });
});
