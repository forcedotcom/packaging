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
import { BundleEntry } from '@salesforce/schemas';
import { createBundle, createPackageDirEntry } from '../../src/package/packageBundleCreate';

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

describe('bundleCreate', () => {
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

  describe('createPackageDirEntry', () => {
    it('should add a new bundle entry to sfdx-project.json', async () => {
      testContext.inProject(true);
      const project = await setupProject((proj) => {
        proj.getSfProjectJson().set('packageDirectories', [
          {
            path: 'force-app',
            default: true,
          },
        ]);
      });

      const bundleEntry = createPackageDirEntry(project, {
        BundleName: 'testBundle',
        Description: 'testBundle',
      });
      project.getSfProjectJson().addPackageBundle(bundleEntry);
      const bundles = project.getSfProjectJson().getPackageBundles();
      expect(bundles.length).to.equal(1);
      expect(bundleEntry).to.deep.equal(bundles[0]);
    });

    it('add bundle entry - duplicate entry', async () => {
      testContext.inProject(true);
      const project = await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });
      const bundleEntry1: BundleEntry = {
        name: 'testBundle',
        versionName: 'testBundle',
        versionNumber: '1.0.0',
        versionDescription: 'testBundle',
      };
      const bundleEntry2: BundleEntry = {
        name: 'testBundle',
        versionName: 'testBundle',
        versionNumber: '1.0.0',
        versionDescription: 'testBundle',
      };
      project.getSfProjectJson().addPackageBundle(bundleEntry1);
      project.getSfProjectJson().addPackageBundle(bundleEntry2);
      const bundles = (project.getSfProjectJson().getContents().packageBundles as BundleEntry[]) ?? [];
      expect(bundles.length).to.equal(1);
      expect(bundleEntry1).to.deep.equal(bundles[0]);
    });

    it('add bundle entry - non-duplicate entry', async () => {
      testContext.inProject(true);
      const project = await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });
      const bundleEntry1: BundleEntry = {
        name: 'testBundle',
        versionName: 'testBundle',
        versionNumber: '1.0.0',
        versionDescription: 'testBundle',
      };
      const bundleEntry2: BundleEntry = {
        name: 'testBundle1',
        versionName: 'testBundle1',
        versionNumber: '1.0.0',
        versionDescription: 'testBundle1',
      };
      project.getSfProjectJson().addPackageBundle(bundleEntry1);
      project.getSfProjectJson().addPackageBundle(bundleEntry2);
      const bundles = (project.getSfProjectJson().getContents().packageBundles as BundleEntry[]) ?? [];
      expect(bundles.length).to.equal(2);
      expect(bundleEntry1).to.deep.equal(bundles[0]);
      expect(bundleEntry2).to.deep.equal(bundles[1]);
    });

    it('add bundle entry with createBundle', async () => {
      testContext.inProject(true);
      const project = await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      // Mock the connection to return a successful response
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: true,
              id: '0Ho000000000000',
            }),
        }),
      });

      const bundleEntry1: BundleEntry = {
        name: 'testBundle',
        versionName: 'ver 0.1',
        versionNumber: '0.1',
        versionDescription: 'testBundle',
      };

      await createBundle(connection, project, {
        BundleName: 'testBundle',
        Description: 'testBundle',
      });

      const bundles = (project.getSfProjectJson().getContents().packageBundles as BundleEntry[]) ?? [];
      expect(bundles.length).to.equal(1);
      expect(bundleEntry1).to.deep.equal(bundles[0]);
    });

    it('handles failed bundle creation', async () => {
      testContext.inProject(true);
      const project = await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      // Mock the connection to return a failed response
      Object.assign(connection.tooling, {
        sobject: () => ({
          create: () =>
            Promise.resolve({
              success: false,
              errors: ['Test error'],
            }),
        }),
      });

      try {
        await createBundle(connection, project, {
          BundleName: 'testBundle',
          Description: 'testBundle',
        });
        expect.fail('Expected error was not thrown');
      } catch (err) {
        const error = err as Error;
        expect(error.message).to.include('Failed to create package bundle');
      }
    });
  });
});
