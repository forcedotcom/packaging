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
import { Duration } from '@salesforce/kit';
import { PackageBundleVersion } from '../../src/package/packageBundleVersion';
import { PackageBundleVersionCreate } from '../../src/package/packageBundleVersionCreate';
import { BundleVersionCreateOptions, BundleSObjects } from '../../src/interfaces';

const getPackageVersion = (
  ...args: [options: BundleVersionCreateOptions, project: SfProject, connection: Connection]
): Promise<{ MajorVersion: string; MinorVersion: string }> => (PackageBundleVersionCreate as any).getPackageVersion(...args);

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
      expect(result).to.have.property('VersionName', 'testBundle@1.0');
      expect(result).to.have.property('MajorVersion', '1');
      expect(result).to.have.property('MinorVersion', '0');

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
          retrieve: () => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({
                Id: '0Ho000000000000',
                RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.queued,
                PackageBundleId: '0Ho000000000000',
                PackageBundleVersionId: '',
                VersionName: 'testBundle@1.0',
                MajorVersion: '1',
                MinorVersion: '0',
                BundleVersionComponents: JSON.stringify(['04t000000000002', '04t000000000000004']), // Resolved IDs
                CreatedDate: new Date().toISOString(),
                CreatedById: 'testUser',
              });
            } else {
              return Promise.resolve({
                Id: '0Ho000000000000',
                RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
                PackageBundleId: '0Ho000000000000',
                PackageBundleVersionId: '0Ho000000000001',
                VersionName: 'testBundle@1.0',
                MajorVersion: '1',
                MinorVersion: '0',
                BundleVersionComponents: JSON.stringify(['04t000000000002', '04t000000000000004']), // Resolved IDs
                CreatedDate: new Date().toISOString(),
                CreatedById: 'testUser',
              });
            }
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

      const result = await PackageBundleVersion.create(options, polling);

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
          retrieve: () =>
            Promise.resolve({
              Id: '0Ho000000000000',
              RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
              PackageBundleId: '0Ho000000000000',
              PackageBundleVersionId: '0Ho000000000001',
              VersionName: 'testBundle@1.0',
              MajorVersion: '1',
              MinorVersion: '0',
              BundleVersionComponents: JSON.stringify(['04t000000000001', '04t000000000000005']), // Resolved IDs
              CreatedDate: new Date().toISOString(),
              CreatedById: 'testUser',
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

      const result = await PackageBundleVersion.create(options, polling);

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
          retrieve: () =>
            Promise.resolve({
              Id: '0Ho000000000000',
              RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.queued,
              PackageBundleId: '0Ho000000000000',
              PackageBundleVersionId: '',
              VersionName: 'testBundle@1.0',
              MajorVersion: '1',
              MinorVersion: '0',
              BundleVersionComponents: JSON.stringify(['04t000000000002', '04t000000000000006']), // Resolved IDs
              CreatedDate: new Date().toISOString(),
              CreatedById: 'testUser',
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
        await PackageBundleVersion.create(options, polling);
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
          retrieve: () =>
            Promise.resolve({
              Id: '0Ho000000000000',
              RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.error,
              PackageBundleId: '0Ho000000000000',
              PackageBundleVersionId: '',
              VersionName: 'testBundle@1.0',
              MajorVersion: '1',
              MinorVersion: '0',
              BundleVersionComponents: JSON.stringify(['04t000000000001', '04t000000000000007']), // Resolved IDs
              CreatedDate: new Date().toISOString(),
              CreatedById: 'testUser',
              Error: ['Test error message'],
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

      const result = await PackageBundleVersion.create(options, polling);

      expect(result).to.have.property('Id', '0Ho000000000000');
      expect(result).to.have.property('RequestStatus', BundleSObjects.PkgBundleVersionCreateReqStatus.error);
      expect(result).to.have.property('Error').that.includes('Test error message');

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
          retrieve: () =>
            Promise.resolve({
              Id: '0Ho000000000000',
              RequestStatus: BundleSObjects.PkgBundleVersionCreateReqStatus.success,
              PackageBundleId: '0Ho000000000000',
              PackageBundleVersionId: '0Ho000000000001',
              VersionName: 'testBundle@1.0',
              MajorVersion: '1',
              MinorVersion: '0',
              BundleVersionComponents: JSON.stringify(['04t000000000002', '04t000000000000008']), // Resolved IDs
              CreatedDate: new Date().toISOString(),
              CreatedById: 'testUser',
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

      const result = await PackageBundleVersion.create(options, polling);

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
            VersionName: 'testBundle@0.1',
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
      const result = await getPackageVersion(options, project, connection);

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
      const result = await getPackageVersion(options, project, connection);

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
      const result = await getPackageVersion(options, project, connection);

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
  });
});
