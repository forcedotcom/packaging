/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import path from 'node:path';
import fs from 'node:fs';
import { expect } from 'chai';
import { Connection, SfProject } from '@salesforce/core';
import { instantiateContext, restoreContext, stubContext, MockTestOrgData } from '@salesforce/core/testSetup';
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

describe('PackageBundleInstall', () => {
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

  describe('getInstallStatus', () => {
    it('should get install status successfully', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const installRequestId = '08c0x0000000000000';
      const mockInstallStatus = {
        Id: installRequestId,
        InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.success,
        PackageBundleVersionID: '05i0x0000000000001',
        DevelopmentOrganization: '00D0x0000000000001',
        ValidationError: '',
        CreatedDate: '2025-01-01T00:00:00.000+0000',
        CreatedById: '0050x0000000000001',
      };

      Object.assign(connection.tooling, {
        sobject: () => ({
          retrieve: () => Promise.resolve(mockInstallStatus),
        }),
      });

      const result = await PackageBundleInstall.getInstallStatus(installRequestId, connection);
      expect(result).to.deep.equal(mockInstallStatus);
    });

    it('should get install status with error status', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const installRequestId = '08c0x0000000000000';
      const mockInstallStatus = {
        Id: installRequestId,
        InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.error,
        PackageBundleVersionID: '05i0x0000000000001',
        DevelopmentOrganization: '00D0x0000000000001',
        ValidationError: 'Installation failed due to validation errors',
        CreatedDate: '2025-01-01T00:00:00.000+0000',
        CreatedById: '0050x0000000000001',
        Error: [
          'PropertyController: Invalid type: Schema.Property__c',
          'SampleDataController: Invalid type: Schema.Property__c',
        ],
      };

      Object.assign(connection.tooling, {
        sobject: () => ({
          retrieve: () => Promise.resolve(mockInstallStatus),
        }),
      });

      const result = await PackageBundleInstall.getInstallStatus(installRequestId, connection);
      expect(result).to.deep.equal(mockInstallStatus);
      expect(result.InstallStatus).to.equal(BundleSObjects.PkgBundleVersionInstallReqStatus.error);
      expect(result.ValidationError).to.equal('Installation failed due to validation errors');
      expect(result.Error).to.include('PropertyController: Invalid type: Schema.Property__c');
    });

    it('should get install status with queued status', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const installRequestId = '08c0x0000000000000';
      const mockInstallStatus = {
        Id: installRequestId,
        InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.queued,
        PackageBundleVersionID: '05i0x0000000000001',
        DevelopmentOrganization: '00D0x0000000000001',
        ValidationError: '',
        CreatedDate: '2025-01-01T00:00:00.000+0000',
        CreatedById: '0050x0000000000001',
      };

      Object.assign(connection.tooling, {
        sobject: () => ({
          retrieve: () => Promise.resolve(mockInstallStatus),
        }),
      });

      const result = await PackageBundleInstall.getInstallStatus(installRequestId, connection);
      expect(result).to.deep.equal(mockInstallStatus);
      expect(result.InstallStatus).to.equal(BundleSObjects.PkgBundleVersionInstallReqStatus.queued);
    });

    it('should handle connection error', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const installRequestId = '08c0x0000000000000';

      Object.assign(connection.tooling, {
        sobject: () => ({
          retrieve: () => Promise.reject(new Error('Connection failed')),
        }),
      });

      try {
        await PackageBundleInstall.getInstallStatus(installRequestId, connection);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include('Connection failed');
      }
    });

    it('should handle invalid install request ID', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const installRequestId = 'invalid_id';

      Object.assign(connection.tooling, {
        sobject: () => ({
          retrieve: () => Promise.reject(new Error('Invalid ID: invalid_id')),
        }),
      });

      try {
        await PackageBundleInstall.getInstallStatus(installRequestId, connection);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include('Invalid ID');
      }
    });

    it('should handle unknown error during retrieve', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const installRequestId = '08c0x0000000000000';

      Object.assign(connection.tooling, {
        sobject: () => ({
          retrieve: () => Promise.reject('Unknown error string'),
        }),
      });

      try {
        await PackageBundleInstall.getInstallStatus(installRequestId, connection);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.include('Failed to get package bundle install status');
      }
    });

    it('should handle successful install with empty validation error', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const installRequestId = '08c0x0000000000000';
      const mockInstallStatus = {
        Id: installRequestId,
        InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.success,
        PackageBundleVersionID: '05i0x0000000000001',
        DevelopmentOrganization: '00D0x0000000000001',
        ValidationError: null, // null validation error
        CreatedDate: '2025-01-01T00:00:00.000+0000',
        CreatedById: '0050x0000000000001',
        Error: [], // empty error array
      };

      Object.assign(connection.tooling, {
        sobject: () => ({
          retrieve: () => Promise.resolve(mockInstallStatus),
        }),
      });

      const result = await PackageBundleInstall.getInstallStatus(installRequestId, connection);
      expect(result).to.deep.equal(mockInstallStatus);
      expect(result.InstallStatus).to.equal(BundleSObjects.PkgBundleVersionInstallReqStatus.success);
      expect(result.ValidationError).to.be.null;
      expect(result.Error).to.be.an('array').that.is.empty;
    });

    it('should handle install status with complex validation error', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const installRequestId = '08c0x0000000000000';
      const mockInstallStatus = {
        Id: installRequestId,
        InstallStatus: BundleSObjects.PkgBundleVersionInstallReqStatus.error,
        PackageBundleVersionID: '05i0x0000000000001',
        DevelopmentOrganization: '00D0x0000000000001',
        ValidationError: 'Multiple validation errors encountered',
        CreatedDate: '2025-01-01T00:00:00.000+0000',
        CreatedById: '0050x0000000000001',
        Error: [
          'FIELD_CUSTOM_VALIDATION_EXCEPTION: Custom validation rule failed',
          'DUPLICATE_VALUE: Duplicate values found',
          'REQUIRED_FIELD_MISSING: Required field is missing',
        ],
      };

      Object.assign(connection.tooling, {
        sobject: () => ({
          retrieve: () => Promise.resolve(mockInstallStatus),
        }),
      });

      const result = await PackageBundleInstall.getInstallStatus(installRequestId, connection);
      expect(result).to.deep.equal(mockInstallStatus);
      expect(result.InstallStatus).to.equal(BundleSObjects.PkgBundleVersionInstallReqStatus.error);
      expect(result.ValidationError).to.equal('Multiple validation errors encountered');
      expect(result.Error).to.have.length(3);
      expect(result.Error).to.include('FIELD_CUSTOM_VALIDATION_EXCEPTION: Custom validation rule failed');
      expect(result.Error).to.include('DUPLICATE_VALUE: Duplicate values found');
      expect(result.Error).to.include('REQUIRED_FIELD_MISSING: Required field is missing');
    });
  });
});
