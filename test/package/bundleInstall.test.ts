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
import { PackageBundleInstall } from '../../src/package/packageBundleInstall';
import { BundleInstallOptions, BundleSObjects } from '../../src/interfaces';

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

describe('PackageBundleInstall.installBundle', () => {
  const testContext = instantiateContext();
  const testOrg = new MockTestOrgData();
  let connection: Connection;
  let project: SfProject;

  beforeEach(async () => {
    stubContext(testContext);
    testContext.inProject(true);
    project = await setupProject((proj) => {
      proj.getSfProjectJson().set('namespace', 'testNamespace');
      // Add package bundle version aliases for testing
      proj.getSfProjectJson().set('packageAliases', {
        'testPackage@1.0': '05i000000000001',
        'testPackage@2.0': '05i000000000002',
      });
    });

    // Create the project directory structure
    await fs.promises.mkdir(project.getPath(), { recursive: true });

    connection = await testOrg.getConnection();

    // Stub the parsePackageBundleVersionId method to avoid package bundle validation
    testContext.SANDBOX.stub(
      PackageBundleInstall,
      'parsePackageBundleVersionId' as keyof typeof PackageBundleInstall
    ).returns('05i000000000001');
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

  describe('install bundle', () => {
    it('should install bundle without wait flag (immediate success)', async () => {
      // Mock the connection for immediate success without polling
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '08c000000000000',
            }),
        }),
      });

      const options: BundleInstallOptions = {
        connection,
        project,
        PackageBundleVersion: 'testPackage@1.0',
        DevelopmentOrganization: '00D000000000000',
      };

      const result = await PackageBundleInstall.installBundle(connection, project, options);

      expect(result).to.have.property('Id', '08c000000000000');
      expect(result).to.have.property('InstallStatus', BundleSObjects.PkgBundleVersionInstallReqStatus.queued);
      expect(result).to.have.property('PackageBundleVersionID', '05i000000000001');
      expect(result).to.have.property('DevelopmentOrganization', '00D000000000000');
    });

    it('should install bundle with wait flag and polling success', async () => {
      // Mock the connection for polling scenario with wait flag
      let callCount = 0;
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '08c000000000000',
            }),
        }),
      });
      Object.assign(connection, {
        autoFetchQuery: () => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve({
              records: [{
                Id: '08c000000000000',
                InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.queued,
                PackageBundleVersionID: '05i000000000001',
                DevelopmentOrganization: '00D000000000000',
                ValidationError: '',
                CreatedDate: new Date().toISOString(),
                CreatedById: 'testUser',
              }],
            });
          } else {
            return Promise.resolve({
              records: [{
                Id: '08c000000000000',
                InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.success,
                PackageBundleVersionID: '05i000000000001',
                DevelopmentOrganization: '00D000000000000',
                ValidationError: '',
                CreatedDate: new Date().toISOString(),
                CreatedById: 'testUser',
              }],
            });
          }
        },
      });

      const options: BundleInstallOptions = {
        connection,
        project,
        PackageBundleVersion: 'testPackage@1.0',
        DevelopmentOrganization: '00D000000000000',
        polling: {
          timeout: Duration.seconds(5),
          frequency: Duration.seconds(1),
        },
      };

      const result = await PackageBundleInstall.installBundle(connection, project, options);

      expect(result).to.have.property('Id', '08c000000000000');
      expect(result).to.have.property('InstallStatus', BundleSObjects.PkgBundleVersionInstallReqStatus.success);
      expect(callCount).to.be.greaterThan(1); // Should have polled multiple times
    });

    it('should install bundle with wait flag and immediate success (no polling needed)', async () => {
      // Mock the connection for immediate success even with polling enabled
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '08c000000000000',
            }),
        }),
      });
      Object.assign(connection, {
        autoFetchQuery: () =>
          Promise.resolve({
            records: [{
              Id: '08c000000000000',
              InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.success,
              PackageBundleVersionID: '05i000000000001',
              DevelopmentOrganization: '00D000000000000',
              ValidationError: '',
              CreatedDate: new Date().toISOString(),
              CreatedById: 'testUser',
            }],
          }),
      });

      const options: BundleInstallOptions = {
        connection,
        project,
        PackageBundleVersion: 'testPackage@2.0',
        DevelopmentOrganization: '00D000000000000',
        polling: {
          timeout: Duration.seconds(5),
          frequency: Duration.seconds(1),
        },
      };

      const result = await PackageBundleInstall.installBundle(connection, project, options);

      expect(result).to.have.property('Id', '08c000000000000');
      expect(result).to.have.property('InstallStatus', BundleSObjects.PkgBundleVersionInstallReqStatus.success);
    });

    it('should handle polling timeout with wait flag', async () => {
      // Mock the connection to always return queued status (causing timeout)
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '08c000000000000',
            }),
        }),
      });
      Object.assign(connection, {
        autoFetchQuery: () =>
          Promise.resolve({
            records: [{
              Id: '08c000000000000',
              InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.queued,
              PackageBundleVersionID: '05i000000000001',
              DevelopmentOrganization: '00D000000000000',
              ValidationError: '',
              CreatedDate: new Date().toISOString(),
              CreatedById: 'testUser',
            }],
          }),
      });

      const options: BundleInstallOptions = {
        connection,
        project,
        PackageBundleVersion: 'testPackage@1.0',
        DevelopmentOrganization: '00D000000000000',
        polling: {
          timeout: Duration.seconds(2), // Short timeout to trigger timeout error
          frequency: Duration.seconds(1),
        },
      };

      try {
        await PackageBundleInstall.installBundle(connection, project, options);
        expect.fail('Expected timeout error was not thrown');
      } catch (err) {
        const error = err as Error;
        expect(error.message).to.include('Install request timed out');
      }
    });

    it('should handle polling error status with wait flag', async () => {
      // Mock the connection to return error status during polling
      // Note: The current implementation will timeout when there's an error status
      // because the polling logic only treats success as completed
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '08c000000000000',
            }),
        }),
      });
      Object.assign(connection, {
        autoFetchQuery: () =>
          Promise.resolve({
            records: [{
              Id: '08c000000000000',
              InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.error,
              PackageBundleVersionID: '05i000000000001',
              DevelopmentOrganization: '00D000000000000',
              ValidationError: 'Test validation error',
              CreatedDate: new Date().toISOString(),
              CreatedById: 'testUser',
            }],
          }),
      });

      const options: BundleInstallOptions = {
        connection,
        project,
        PackageBundleVersion: 'testPackage@1.0',
        DevelopmentOrganization: '00D000000000000',
        polling: {
          timeout: Duration.seconds(2), // Short timeout since error status will cause timeout
          frequency: Duration.seconds(1),
        },
      };

      try {
        await PackageBundleInstall.installBundle(connection, project, options);
        expect.fail('Expected timeout error was not thrown');
      } catch (err) {
        const error = err as Error;
        expect(error.message).to.include('Install request timed out');
      }
    });

    it('should handle create failure', async () => {
      // Mock the connection to fail during creation
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: false,
              errors: ['Installation failed'],
            }),
        }),
      });

      const options: BundleInstallOptions = {
        connection,
        project,
        PackageBundleVersion: 'testPackage@1.0',
        DevelopmentOrganization: '00D000000000000',
      };

      try {
        await PackageBundleInstall.installBundle(connection, project, options);
        expect.fail('Expected error was not thrown');
      } catch (err) {
        const error = err as Error;
        expect(error.message).to.include('Failed to install package bundle');
      }
    });

    it('should handle create exception', async () => {
      // Mock the connection to throw an exception during creation
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () => Promise.reject(new Error('Network error')),
        }),
      });

      const options: BundleInstallOptions = {
        connection,
        project,
        PackageBundleVersion: 'testPackage@1.0',
        DevelopmentOrganization: '00D000000000000',
      };

      try {
        await PackageBundleInstall.installBundle(connection, project, options);
        expect.fail('Expected error was not thrown');
      } catch (err) {
        const error = err as Error;
        expect(error.message).to.include('Network error');
      }
    });

    it('should handle invalid package bundle version alias', async () => {
      // Remove the stub for parsePackageBundleVersionId to test real behavior
      testContext.SANDBOX.restore();

      const options: BundleInstallOptions = {
        connection,
        project,
        PackageBundleVersion: 'nonexistentBundle@1.0',
        DevelopmentOrganization: '00D000000000000',
      };

      try {
        await PackageBundleInstall.installBundle(connection, project, options);
        expect.fail('Expected error was not thrown');
      } catch (err) {
        const error = err as Error;
        expect(error.message).to.include('No package bundle version found with alias');
      }
    });

    it('should handle direct package bundle version ID', async () => {
      // Remove the stub for parsePackageBundleVersionId to test real behavior
      testContext.SANDBOX.restore();

      // Mock the connection for immediate success without polling
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '08c000000000000',
            }),
        }),
      });

      const options: BundleInstallOptions = {
        connection,
        project,
        PackageBundleVersion: '1Q8000000000001234', // Direct 18-character ID
        DevelopmentOrganization: '00D000000000000',
      };

      const result = await PackageBundleInstall.installBundle(connection, project, options);

      expect(result).to.have.property('Id', '08c000000000000');
      expect(result).to.have.property('PackageBundleVersionID', '1Q8000000000001234');
    });
  });
});
