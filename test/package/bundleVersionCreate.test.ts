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
import { Connection, SfProject } from '@salesforce/core';
import { instantiateContext, restoreContext, stubContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { Duration } from '@salesforce/kit';
import { PackageBundleVersion } from '../../src/package/packageBundleVersion';
import { PackageBundleVersionCreate } from '../../src/package/packageBundleVersionCreate';
import { BundleVersionCreateOptions, BundleSObjects } from '../../src/interfaces';

// Type for accessing private methods in tests
type PackageBundleVersionCreateWithPrivates = {
  getPackageVersion(
    options: BundleVersionCreateOptions,
    project: SfProject,
    connection: Connection
  ): Promise<{ MajorVersion: string; MinorVersion: string }>;
};

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

describe('PackageBundleVersion.create', () => {
  const testContext = instantiateContext();
  const testOrg = new MockTestOrgData();
  let connection: Connection;
  let project: SfProject;

  beforeEach(async () => {
    stubContext(testContext);
    testContext.inProject(true);
    project = await setupProject((proj) => {
      proj.getSfProjectJson().set('namespace', 'testNamespace');
      // Add package aliases for testing
      proj.getSfProjectJson().set('packageAliases', {
        'pkgA@1.1': '04t000000000001',
        'pkgB@2.0': '04t000000000002',
      });
    });

    // Create the project directory structure
    await fs.promises.mkdir(project.getPath(), { recursive: true });

    connection = await testOrg.getConnection();

    // Stub the parsePackageBundleId method to avoid package bundle validation
    testContext.SANDBOX.stub(
      PackageBundleVersionCreate,
      'parsePackageBundleId' as keyof typeof PackageBundleVersionCreate
    ).returns('0Ho000000000000');

    // Stub the getPackageVersion method to return expected version info
    testContext.SANDBOX.stub(
      PackageBundleVersionCreate,
      'getPackageVersion' as keyof typeof PackageBundleVersionCreate
    ).resolves({
      MajorVersion: '1',
      MinorVersion: '0',
    });

    // Stub the getVersionNameFromBundle method to return expected version name
    testContext.SANDBOX.stub(
      PackageBundleVersionCreate,
      'getVersionNameFromBundle' as keyof typeof PackageBundleVersionCreate
    ).resolves('ver 1.0');
  });

  afterEach(async () => {
    restoreContext(testContext);
    // Clean up the project directory
    try {
      await fs.promises.rm(project.getPath(), { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('create bundle version', () => {
    it('should create bundle version without wait flag (immediate success)', async () => {
      const componentsPath = path.join(project.getPath(), 'bundle-components.json');
      const components = [
        { packageVersion: 'pkgA@1.1' }, // Alias format
        { packageVersion: '04t000000000000003' }, // Direct ID format (18 chars)
      ];
      fs.writeFileSync(componentsPath, JSON.stringify(components));

      // Mock the connection for immediate success without polling
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '0Ho000000000000',
            }),
        }),
        query: () =>
          Promise.resolve({
            records: [
              {
                BundleName: 'testBundle',
              },
            ],
          }),
      });

      // Mock autoFetchQuery for getCreateStatus
      Object.assign(connection, {
        autoFetchQuery: () =>
          Promise.resolve({
            records: [
              {
                Id: '0Ho000000000000',
                RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
                PackageBundle: {
                  Id: '0Ho123456789012',
                  BundleName: 'testBundle',
                },
                PackageBundleVersion: {
                  Id: '1Q8000000000001',
                },
                VersionName: 'ver 1.0',
                MajorVersion: '1',
                MinorVersion: '0',
                Ancestor: null,
                BundleVersionComponents: JSON.stringify(components),
                CreatedDate: '2025-01-01T00:00:00.000Z',
                CreatedById: '005000000000000',
                ValidationError: '',
              },
            ],
          }),
      });

      const options: BundleVersionCreateOptions = {
        connection,
        project,
        PackageBundle: 'testBundle',
        MajorVersion: '1',
        MinorVersion: '0',
        Ancestor: null,
        BundleVersionComponentsPath: componentsPath,
      };

      const result = await PackageBundleVersion.create(options);

      expect(result).to.have.property('Id', '0Ho000000000000');
      expect(result).to.have.property('RequestStatus', BundleSObjects.PkgBundleVersionCreateReqStatus.success);
      expect(result).to.have.property('PackageBundleId');
      expect(result).to.have.property('VersionName', 'ver 1.0');
      expect(result).to.have.property('MajorVersion', '1');
      expect(result).to.have.property('MinorVersion', '0');

      // Clean up
      fs.unlinkSync(componentsPath);
    });

    it('should create bundle version with installation key', async () => {
      const componentsPath = path.join(project.getPath(), 'bundle-components.json');
      const components = [
        { packageVersion: 'pkgA@1.1' },
        { packageVersion: '04t000000000000003' },
      ];
      fs.writeFileSync(componentsPath, JSON.stringify(components));

      let capturedRequest: Record<string, unknown> | undefined;

      // Mock the connection and capture the request
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: (request: Record<string, unknown>) => {
            capturedRequest = request;
            return Promise.resolve({
              success: true,
              id: '0Ho000000000000',
            });
          },
        }),
        query: () =>
          Promise.resolve({
            records: [
              {
                BundleName: 'testBundle',
              },
            ],
          }),
      });

      // Mock autoFetchQuery for getCreateStatus
      Object.assign(connection, {
        autoFetchQuery: () =>
          Promise.resolve({
            records: [
              {
                Id: '0Ho000000000000',
                RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
                PackageBundle: {
                  Id: '0Ho123456789012',
                  BundleName: 'testBundle',
                },
                PackageBundleVersion: {
                  Id: '1Q8000000000001',
                },
                VersionName: 'ver 1.0',
                MajorVersion: '1',
                MinorVersion: '0',
                Ancestor: null,
                BundleVersionComponents: JSON.stringify(components),
                CreatedDate: '2025-01-01T00:00:00.000Z',
                CreatedById: '005000000000000',
                ValidationError: '',
              },
            ],
          }),
      });

      const options: BundleVersionCreateOptions = {
        connection,
        project,
        PackageBundle: 'testBundle',
        MajorVersion: '1',
        MinorVersion: '0',
        Ancestor: null,
        BundleVersionComponentsPath: componentsPath,
        InstallationKey: 'mySecretKey123',
      };

      const result = await PackageBundleVersion.create(options);

      expect(result).to.have.property('Id', '0Ho000000000000');
      expect(result).to.have.property('RequestStatus', BundleSObjects.PkgBundleVersionCreateReqStatus.success);
      // Verify that InstallationKey was included in the request
      expect(capturedRequest).to.have.property('InstallationKey', 'mySecretKey123');

      // Clean up
      fs.unlinkSync(componentsPath);
    });

    it('should create bundle version with wait flag and polling success', async () => {
      const componentsPath = path.join(project.getPath(), 'bundle-components.json');
      const components = [
        { packageVersion: 'pkgB@2.0' }, // Alias format
        { packageVersion: '04t000000000000004' }, // Direct ID format (18 chars)
      ];
      fs.writeFileSync(componentsPath, JSON.stringify(components));

      // Mock the connection for polling scenario with wait flag
      let callCount = 0;
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '0Ho000000000000',
            }),
        }),
        query: () =>
          Promise.resolve({
            records: [
              {
                BundleName: 'testBundle',
              },
            ],
          }),
      });

      // Mock autoFetchQuery for getCreateStatus
      Object.assign(connection, {
        autoFetchQuery: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              records: [{
                Id: '0Ho000000000000',
                RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.queued,
                PackageBundle: { Id: '0Ho000000000000' },
                PackageBundleVersion: { Id: '' },
                VersionName: 'ver 1.0',
                MajorVersion: '1',
                MinorVersion: '0',
                BundleVersionComponents: JSON.stringify(['04t000000000002', '04t000000000000004']),
                CreatedDate: new Date().toISOString(),
                CreatedById: 'testUser',
                ValidationError: '',
              }],
            });
          } else {
            return Promise.resolve({
              records: [{
                Id: '0Ho000000000000',
                RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
                PackageBundle: { Id: '0Ho000000000000' },
                PackageBundleVersion: { Id: '0Ho000000000001' },
                VersionName: 'ver 1.0',
                MajorVersion: '1',
                MinorVersion: '0',
                BundleVersionComponents: JSON.stringify(['04t000000000002', '04t000000000000004']),
                CreatedDate: new Date().toISOString(),
                CreatedById: 'testUser',
                ValidationError: '',
              }],
            });
          }
        },
      });

      const options: BundleVersionCreateOptions = {
        connection,
        project,
        PackageBundle: 'testBundle',
        MajorVersion: '1',
        MinorVersion: '0',
        Ancestor: null,
        BundleVersionComponentsPath: componentsPath,
      };

      const polling = {
        frequency: Duration.seconds(1),
        timeout: Duration.seconds(5),
      };

      const result = await PackageBundleVersion.create({ ...options, polling });

      expect(result).to.have.property('Id', '0Ho000000000000');
      expect(result).to.have.property('RequestStatus', BundleSObjects.PkgBundleVersionCreateReqStatus.success);
      expect(result).to.have.property('PackageBundleVersionId', '0Ho000000000001');
      expect(callCount).to.be.greaterThan(1); // Should have polled multiple times

      // Clean up
      fs.unlinkSync(componentsPath);
    });

    it('should create bundle version with wait flag and immediate success (no polling needed)', async () => {
      const componentsPath = path.join(project.getPath(), 'bundle-components.json');
      const components = [
        { packageVersion: 'pkgA@1.1' }, // Alias format
        { packageVersion: '04t000000000000005' }, // Direct ID format (18 chars)
      ];
      fs.writeFileSync(componentsPath, JSON.stringify(components));

      // Mock the connection for immediate success even with polling enabled
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '0Ho000000000000',
            }),
        }),
        query: () =>
          Promise.resolve({
            records: [
              {
                BundleName: 'testBundle',
              },
            ],
          }),
      });

      // Mock autoFetchQuery for immediate success
      Object.assign(connection, {
        autoFetchQuery: () =>
          Promise.resolve({
            records: [{
              Id: '0Ho000000000000',
              RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
              PackageBundle: { Id: '0Ho000000000000' },
              PackageBundleVersion: { Id: '0Ho000000000001' },
              VersionName: 'ver 1.0',
              MajorVersion: '1',
              MinorVersion: '0',
              BundleVersionComponents: JSON.stringify(['04t000000000001', '04t000000000000005']),
              CreatedDate: new Date().toISOString(),
              CreatedById: 'testUser',
              ValidationError: '',
            }],
          }),
      });

      const options: BundleVersionCreateOptions = {
        connection,
        project,
        PackageBundle: 'testBundle',
        MajorVersion: '1',
        MinorVersion: '0',
        Ancestor: null,
        BundleVersionComponentsPath: componentsPath,
      };

      const polling = {
        frequency: Duration.seconds(1),
        timeout: Duration.seconds(5),
      };

      const result = await PackageBundleVersion.create({ ...options, polling });

      expect(result).to.have.property('Id', '0Ho000000000000');
      expect(result).to.have.property('RequestStatus', BundleSObjects.PkgBundleVersionCreateReqStatus.success);
      expect(result).to.have.property('PackageBundleVersionId', '0Ho000000000001');

      // Clean up
      fs.unlinkSync(componentsPath);
    });

    it('should handle polling timeout with wait flag', async () => {
      const componentsPath = path.join(project.getPath(), 'bundle-components.json');
      const components = [
        { packageVersion: 'pkgB@2.0' }, // Alias format
        { packageVersion: '04t000000000000006' }, // Direct ID format (18 chars)
      ];
      fs.writeFileSync(componentsPath, JSON.stringify(components));

      // Mock the connection to always return queued status (causing timeout)
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '0Ho000000000000',
            }),
        }),
        query: () =>
          Promise.resolve({
            records: [
              {
                BundleName: 'testBundle',
              },
            ],
          }),
      });

      // Mock autoFetchQuery to always return queued status (causing timeout)
      Object.assign(connection, {
        autoFetchQuery: () =>
          Promise.resolve({
            records: [
              {
                Id: '0Ho000000000000',
                RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.queued,
                PackageBundle: {
                  Id: '0Ho000000000000',
                  BundleName: 'testBundle',
                },
                PackageBundleVersion: null,
                VersionName: 'ver 1.0',
                MajorVersion: '1',
                MinorVersion: '0',
                Ancestor: null,
                BundleVersionComponents: JSON.stringify(['04t000000000002', '04t000000000000006']),
                CreatedDate: new Date().toISOString(),
                CreatedById: 'testUser',
                ValidationError: '',
              },
            ],
          }),
      });

      const options: BundleVersionCreateOptions = {
        connection,
        project,
        PackageBundle: 'testBundle',
        MajorVersion: '1',
        MinorVersion: '0',
        Ancestor: null,
        BundleVersionComponentsPath: componentsPath,
      };

      const polling = {
        frequency: Duration.seconds(1),
        timeout: Duration.seconds(2), // Short timeout to trigger timeout error
      };

      try {
        await PackageBundleVersion.create({ ...options, polling });
        expect.fail('Expected timeout error was not thrown');
      } catch (err) {
        const error = err as Error;
        expect(error.message).to.include(
          "Run 'sf package bundle version create report -i 0Ho000000000000' to check the status"
        );
      }

      // Clean up
      fs.unlinkSync(componentsPath);
    });

    it('should handle polling error status with wait flag', async () => {
      const componentsPath = path.join(project.getPath(), 'bundle-components.json');
      const components = [
        { packageVersion: 'pkgA@1.1' }, // Alias format
        { packageVersion: '04t000000000000007' }, // Direct ID format (18 chars)
      ];
      fs.writeFileSync(componentsPath, JSON.stringify(components));

      // Mock the connection to return error status during polling
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '0Ho000000000000',
            }),
        }),
        query: () =>
          Promise.resolve({
            records: [
              {
                BundleName: 'testBundle',
              },
            ],
          }),
      });

      // Mock autoFetchQuery for error status
      Object.assign(connection, {
        autoFetchQuery: () =>
          Promise.resolve({
            records: [{
              Id: '0Ho000000000000',
              RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.error,
              PackageBundle: { Id: '0Ho000000000000' },
              PackageBundleVersion: { Id: '' },
              VersionName: 'ver 1.0',
              MajorVersion: '1',
              MinorVersion: '0',
              BundleVersionComponents: JSON.stringify(['04t000000000001', '04t000000000000007']),
              CreatedDate: new Date().toISOString(),
              CreatedById: 'testUser',
              ValidationError: 'Test error message',
            }],
          }),
      });

      const options: BundleVersionCreateOptions = {
        connection,
        project,
        PackageBundle: 'testBundle',
        MajorVersion: '1',
        MinorVersion: '0',
        Ancestor: null,
        BundleVersionComponentsPath: componentsPath,
      };

      const polling = {
        frequency: Duration.seconds(1),
        timeout: Duration.seconds(5),
      };

      const result = await PackageBundleVersion.create({ ...options, polling });

      expect(result).to.have.property('Id', '0Ho000000000000');
      expect(result).to.have.property('RequestStatus', BundleSObjects.PkgBundleVersionCreateReqStatus.error);
      expect(result).to.have.property('ValidationError').that.includes('Test error message');

      // Clean up
      fs.unlinkSync(componentsPath);
    });

    it('should create bundle version with zero timeout (no polling)', async () => {
      const componentsPath = path.join(project.getPath(), 'bundle-components.json');
      const components = [
        { packageVersion: 'pkgB@2.0' }, // Alias format
        { packageVersion: '04t000000000000008' }, // Direct ID format (18 chars)
      ];
      fs.writeFileSync(componentsPath, JSON.stringify(components));

      // Mock the connection for immediate success
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '0Ho000000000000',
            }),
        }),
        query: () =>
          Promise.resolve({
            records: [
              {
                BundleName: 'testBundle',
              },
            ],
          }),
      });

      // Mock autoFetchQuery for immediate success
      Object.assign(connection, {
        autoFetchQuery: () =>
          Promise.resolve({
            records: [{
              Id: '0Ho000000000000',
              RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
              PackageBundle: { Id: '0Ho000000000000' },
              PackageBundleVersion: { Id: '0Ho000000000001' },
              VersionName: 'ver 1.0',
              MajorVersion: '1',
              MinorVersion: '0',
              BundleVersionComponents: JSON.stringify(['04t000000000002', '04t000000000000008']),
              CreatedDate: new Date().toISOString(),
              CreatedById: 'testUser',
              ValidationError: '',
            }],
          }),
      });

      const options: BundleVersionCreateOptions = {
        connection,
        project,
        PackageBundle: 'testBundle',
        MajorVersion: '1',
        MinorVersion: '0',
        Ancestor: null,
        BundleVersionComponentsPath: componentsPath,
      };

      const polling = {
        frequency: Duration.seconds(1),
        timeout: Duration.seconds(0), // Zero timeout means no polling
      };

      const result = await PackageBundleVersion.create({ ...options, polling });

      expect(result).to.have.property('Id', '0Ho000000000000');
      expect(result).to.have.property('RequestStatus', BundleSObjects.PkgBundleVersionCreateReqStatus.success);

      // Clean up
      fs.unlinkSync(componentsPath);
    });

    it('should handle invalid bundle components format', async () => {
      const componentsPath = path.join(project.getPath(), 'bundle-components.json');

      // Test with invalid format (array of strings instead of objects)
      const invalidComponents = ['Component1', 'Component2'];
      fs.writeFileSync(componentsPath, JSON.stringify(invalidComponents));

      const options: BundleVersionCreateOptions = {
        connection,
        project,
        PackageBundle: 'testBundle',
        MajorVersion: '1',
        MinorVersion: '0',
        Ancestor: null,
        BundleVersionComponentsPath: componentsPath,
      };

      try {
        await PackageBundleVersion.create(options);
        expect.fail('Expected error for invalid format was not thrown');
      } catch (err) {
        const error = err as Error;
        expect(error.message).to.include(
          'Each bundle version component must be an object with a packageVersion property'
        );
      }

      // Test with missing packageVersion property
      const invalidComponents2 = [
        { packageVersion: 'pkgA@1.1' },
        { invalidProperty: 'value' }, // Missing packageVersion
      ];
      fs.writeFileSync(componentsPath, JSON.stringify(invalidComponents2));

      try {
        await PackageBundleVersion.create(options);
        expect.fail('Expected error for missing packageVersion was not thrown');
      } catch (err) {
        const error = err as Error;
        expect(error.message).to.include(
          'Each bundle version component must be an object with a packageVersion property'
        );
      }

      // Test with non-existent alias
      const invalidComponents3 = [
        { packageVersion: 'pkgA@1.1' },
        { packageVersion: 'nonExistentAlias' }, // Alias not in packageAliases
      ];
      fs.writeFileSync(componentsPath, JSON.stringify(invalidComponents3));

      try {
        await PackageBundleVersion.create(options);
        expect.fail('Expected error for non-existent alias was not thrown');
      } catch (err) {
        const error = err as Error;
        expect(error.message).to.include('No package version found with alias: nonExistentAlias');
      }

      // Clean up
      fs.unlinkSync(componentsPath);
    });
  });

  describe('getPackageVersion NEXT functionality', () => {
    it('should resolve 0.NEXT to 0.2 when existing version 0.1 exists', async () => {
      const testBundleName = 'testBundle';
      const testBundleId = '0Ho000000000000';

      // Restore the getPackageVersion stub so we can test the real method
      testContext.SANDBOX.restore();

      // Re-stub parsePackageBundleId since we still need it
      testContext.SANDBOX.stub(
        PackageBundleVersionCreate,
        'parsePackageBundleId' as keyof typeof PackageBundleVersionCreate
      ).returns(testBundleId);

      // Mock project's getSfProjectJson().getPackageBundles() to return a bundle with version "0.NEXT"
      testContext.SANDBOX.stub(project.getSfProjectJson(), 'getPackageBundles').returns([
        {
          name: testBundleName,
          versionName: 'ver 0.NEXT',
          versionNumber: '0.NEXT',
        },
      ]);

      // Mock connection tooling queries
      const queryStub = testContext.SANDBOX.stub(connection.tooling, 'query');

      // First query: Get bundle name from bundle ID
      queryStub.onFirstCall().resolves({
        totalSize: 1,
        done: true,
        records: [{ BundleName: testBundleName }],
      });

      // Second query: Get existing bundle versions (returns version 0.1)
      queryStub.onSecondCall().resolves({
        totalSize: 1,
        done: true,
        records: [
          {
            Id: '0Ho000000000001',
            PackageBundle: { Id: testBundleId, BundleName: testBundleName },
            VersionName: 'ver 0.1',
            MajorVersion: '0',
            MinorVersion: '1',
            IsReleased: true,
          },
        ],
      });

      const options: BundleVersionCreateOptions = {
        connection,
        project,
        PackageBundle: testBundleName,
        MajorVersion: '0',
        MinorVersion: 'NEXT',
        Ancestor: null,
        BundleVersionComponentsPath: '',
      };

      // Call the private method through reflection for testing
      const result = await (
        PackageBundleVersionCreate as unknown as PackageBundleVersionCreateWithPrivates
      ).getPackageVersion(options, project, connection);

      expect(result).to.deep.equal({
        MajorVersion: '0',
        MinorVersion: '2',
      });

      // Verify the queries were called correctly
      expect(queryStub.firstCall.args[0]).to.include(
        `SELECT BundleName FROM PackageBundle WHERE Id = '${testBundleId}'`
      );
      expect(queryStub.secondCall.args[0]).to.include(
        `SELECT Id, PackageBundle.Id, PackageBundle.BundleName, VersionName, MajorVersion, MinorVersion, IsReleased FROM PackageBundleVersion WHERE PackageBundle.BundleName = '${testBundleName}' AND MajorVersion = 0 ORDER BY MinorVersion DESC LIMIT 1`
      );
    });

    it('should resolve 0.NEXT to 0.0 when no existing versions exist', async () => {
      const testBundleName = 'newBundle';
      const testBundleId = '0Ho000000000000';

      // Restore the getPackageVersion stub so we can test the real method
      testContext.SANDBOX.restore();

      // Re-stub parsePackageBundleId since we still need it
      testContext.SANDBOX.stub(
        PackageBundleVersionCreate,
        'parsePackageBundleId' as keyof typeof PackageBundleVersionCreate
      ).returns(testBundleId);

      // Mock project's getSfProjectJson().getPackageBundles() to return a bundle with version "0.NEXT"
      testContext.SANDBOX.stub(project.getSfProjectJson(), 'getPackageBundles').returns([
        {
          name: testBundleName,
          versionName: 'ver 0.NEXT',
          versionNumber: '0.NEXT',
        },
      ]);

      // Mock connection tooling queries
      const queryStub = testContext.SANDBOX.stub(connection.tooling, 'query');

      // First query: Get bundle name from bundle ID
      queryStub.onFirstCall().resolves({
        totalSize: 1,
        done: true,
        records: [{ BundleName: testBundleName }],
      });

      // Second query: Get existing bundle versions (returns empty - no existing versions)
      queryStub.onSecondCall().resolves({
        totalSize: 0,
        done: true,
        records: [],
      });

      const options: BundleVersionCreateOptions = {
        connection,
        project,
        PackageBundle: testBundleName,
        MajorVersion: '0',
        MinorVersion: 'NEXT',
        Ancestor: null,
        BundleVersionComponentsPath: '',
      };

      // Call the private method through reflection for testing
      const result = await (
        PackageBundleVersionCreate as unknown as PackageBundleVersionCreateWithPrivates
      ).getPackageVersion(options, project, connection);

      expect(result).to.deep.equal({
        MajorVersion: '0',
        MinorVersion: '0',
      });

      // Verify the queries were called correctly
      expect(queryStub.firstCall.args[0]).to.include(
        `SELECT BundleName FROM PackageBundle WHERE Id = '${testBundleId}'`
      );
      expect(queryStub.secondCall.args[0]).to.include(
        `SELECT Id, PackageBundle.Id, PackageBundle.BundleName, VersionName, MajorVersion, MinorVersion, IsReleased FROM PackageBundleVersion WHERE PackageBundle.BundleName = '${testBundleName}' AND MajorVersion = 0 ORDER BY MinorVersion DESC LIMIT 1`
      );
    });

    it('should handle numeric minor versions without NEXT', async () => {
      const testBundleName = 'simpleBundle';
      const testBundleId = '0Ho000000000000';

      // Restore the getPackageVersion stub so we can test the real method
      testContext.SANDBOX.restore();

      // Re-stub parsePackageBundleId since we still need it
      testContext.SANDBOX.stub(
        PackageBundleVersionCreate,
        'parsePackageBundleId' as keyof typeof PackageBundleVersionCreate
      ).returns(testBundleId);

      // Mock project's getSfProjectJson().getPackageBundles() to return a bundle with version "1.5"
      testContext.SANDBOX.stub(project.getSfProjectJson(), 'getPackageBundles').returns([
        {
          name: testBundleName,
          versionName: 'ver 1.5',
          versionNumber: '1.5',
        },
      ]);

      // Mock connection tooling queries
      const queryStub = testContext.SANDBOX.stub(connection.tooling, 'query');

      // First query: Get bundle name from bundle ID
      queryStub.onFirstCall().resolves({
        totalSize: 1,
        done: true,
        records: [{ BundleName: testBundleName }],
      });

      const options: BundleVersionCreateOptions = {
        connection,
        project,
        PackageBundle: testBundleName,
        MajorVersion: '1',
        MinorVersion: '5',
        Ancestor: null,
        BundleVersionComponentsPath: '',
      };

      // Call the private method through reflection for testing
      const result = await (
        PackageBundleVersionCreate as unknown as PackageBundleVersionCreateWithPrivates
      ).getPackageVersion(options, project, connection);

      expect(result).to.deep.equal({
        MajorVersion: '1',
        MinorVersion: '5',
      });

      // Verify only the first query was called (no need to query existing versions for numeric minor)
      expect(queryStub.calledOnce).to.be.true;
      expect(queryStub.firstCall.args[0]).to.include(
        `SELECT BundleName FROM PackageBundle WHERE Id = '${testBundleId}'`
      );
    });

    it('should add bundle version alias to sfdx-project.json after successful creation with polling', async () => {
      const componentsPath = path.join(project.getPath(), 'bundle-components.json');
      const components = [{ packageVersion: 'pkgA@1.1' }];
      fs.writeFileSync(componentsPath, JSON.stringify(components));

      // Mock the connection for polling scenario
      let callCount = 0;
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '0Ho000000000000',
            }),
        }),
        query: () =>
          Promise.resolve({
            records: [{ BundleName: 'MyTestBundle' }],
          }),
      });

      // Mock autoFetchQuery for getCreateStatus
      Object.assign(connection, {
        autoFetchQuery: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              records: [
                {
                  Id: '0Ho000000000000',
                  RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.queued,
                  PackageBundle: { Id: '1Fl000000000001' },
                  PackageBundleVersion: { Id: '' },
                  VersionName: 'MyTestBundle',
                  MajorVersion: '1',
                  MinorVersion: '0',
                  BundleVersionComponents: JSON.stringify(['04t000000000001']),
                  CreatedDate: new Date().toISOString(),
                  CreatedById: 'testUser',
                  ValidationError: '',
                },
              ],
            });
          } else {
            return Promise.resolve({
              records: [
                {
                  Id: '0Ho000000000000',
                  RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
                  PackageBundle: { Id: '1Fl000000000001' },
                  PackageBundleVersion: { Id: '1Q8000000000001' },
                  VersionName: 'MyTestBundle',
                  MajorVersion: '1',
                  MinorVersion: '0',
                  BundleVersionComponents: JSON.stringify(['04t000000000001']),
                  CreatedDate: new Date().toISOString(),
                  CreatedById: 'testUser',
                  ValidationError: '',
                },
              ],
            });
          }
        },
      });

      const options: BundleVersionCreateOptions = {
        connection,
        project,
        PackageBundle: 'MyTestBundle',
        MajorVersion: '1',
        MinorVersion: '0',
        Ancestor: null,
        BundleVersionComponentsPath: componentsPath,
        polling: {
          timeout: Duration.seconds(10),
          frequency: Duration.seconds(1),
        },
      };

      const result = await PackageBundleVersion.create(options);

      // Verify the result is successful
      expect(result).to.have.property('RequestStatus', BundleSObjects.PkgBundleVersionCreateReqStatus.success);
      expect(result).to.have.property('PackageBundleVersionId', '1Q8000000000001');

      // Verify that the bundle version alias was added to sfdx-project.json
      const packageBundleAliases = project.getSfProjectJson().getPackageBundleAliases();
      expect(packageBundleAliases).to.have.property('MyTestBundle@1.0', '1Q8000000000001');

      // Clean up
      fs.unlinkSync(componentsPath);
    });

    it('should add bundle version alias to sfdx-project.json after successful creation without polling', async () => {
      const componentsPath = path.join(project.getPath(), 'bundle-components.json');
      const components = [{ packageVersion: 'pkgA@1.1' }];
      fs.writeFileSync(componentsPath, JSON.stringify(components));

      // Mock the connection for immediate success
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '0Ho000000000000',
            }),
        }),
        query: () =>
          Promise.resolve({
            records: [{ BundleName: 'AnotherTestBundle' }],
          }),
      });

      // Mock autoFetchQuery for getCreateStatus - immediate success
      Object.assign(connection, {
        autoFetchQuery: () =>
          Promise.resolve({
            records: [
              {
                Id: '0Ho000000000000',
                RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
                PackageBundle: { Id: '1Fl000000000002' },
                PackageBundleVersion: { Id: '1Q8000000000002' },
                VersionName: 'AnotherTestBundle',
                MajorVersion: '2',
                MinorVersion: '3',
                BundleVersionComponents: JSON.stringify(['04t000000000001']),
                CreatedDate: new Date().toISOString(),
                CreatedById: 'testUser',
                ValidationError: '',
              },
            ],
          }),
      });

      const options: BundleVersionCreateOptions = {
        connection,
        project,
        PackageBundle: 'AnotherTestBundle',
        MajorVersion: '2',
        MinorVersion: '3',
        Ancestor: null,
        BundleVersionComponentsPath: componentsPath,
      };

      const result = await PackageBundleVersion.create(options);

      // Verify the result is successful
      expect(result).to.have.property('RequestStatus', BundleSObjects.PkgBundleVersionCreateReqStatus.success);
      expect(result).to.have.property('PackageBundleVersionId', '1Q8000000000002');

      // Verify that the bundle version alias was added to sfdx-project.json
      const packageBundleAliases = project.getSfProjectJson().getPackageBundleAliases();
      expect(packageBundleAliases).to.have.property('AnotherTestBundle@2.3', '1Q8000000000002');

      // Clean up
      fs.unlinkSync(componentsPath);
    });
  });
});
