/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import path from 'node:path';
import { expect } from 'chai';
import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { Org, SfProject } from '@salesforce/core';
import { uniqid } from '@salesforce/core/testSetup';
import { BundleEntry } from '@salesforce/schemas';
import { createBundle } from '../../src/package/packageBundleCreate';
import { PackageBundle } from '../../src/package/packageBundle';

let session: TestSession;
let devHubOrg: Org;
let project: SfProject;
let bundleId = '';
let bundleName = '';

describe('Integration tests for package bundle deletion', () => {
  before('setup', async () => {
    process.env.TESTKIT_EXECUTABLE_PATH = 'sfdx';
    execCmd('config:set restDeploy=false', { cli: 'sfdx' });

    session = await TestSession.create({
      project: {
        sourceDir: path.join('test', 'package', 'resources', 'packageProject'),
      },
      devhubAuthStrategy: 'AUTO',
    });

    bundleName = uniqid({ template: 'bundle-test-', length: 16 });
    devHubOrg = await Org.create({ aliasOrUsername: session.hubOrg.username });
    project = await SfProject.resolve();
  });

  after(async () => {
    await session?.zip();
    await session?.clean();
  });

  describe('bundle creation and deletion', () => {
    it('should create a bundle successfully', async () => {
      const createResult = await createBundle(devHubOrg.getConnection(), project, {
        BundleName: bundleName,
        Description: 'Test bundle for deletion',
      });

      expect(createResult.Id).to.be.ok;
      expect(createResult.Id).to.match(/^1Fl/);
      bundleId = createResult.Id;

      // Verify bundle was added to project
      const bundles = (project.getSfProjectJson().getContents().packageBundles as BundleEntry[]) ?? [];
      expect(bundles.length).to.equal(1);
      expect(bundles[0].name).to.equal(bundleName);
    });

    it('should delete the bundle using bundle ID successfully', async () => {
      expect(bundleId).to.not.be.empty;

      const deleteResult = await PackageBundle.delete(devHubOrg.getConnection(), project, bundleId);
      expect(deleteResult.success).to.be.true;
      expect(deleteResult.id).to.equal(bundleId);
      expect(deleteResult.errors).to.be.an('array').that.is.empty;
    });

    it('should create a bundle and delete it using alias', async () => {
      const aliasBundleName = uniqid({ template: 'bundle-alias-', length: 16 });

      // Create the bundle
      const createResult = await createBundle(devHubOrg.getConnection(), project, {
        BundleName: aliasBundleName,
        Description: 'Test bundle for alias deletion',
      });

      expect(createResult.Id).to.be.ok;
      const aliasBundleId = createResult.Id;

      // Verify bundle was added to project with alias
      const bundles = (project.getSfProjectJson().getContents().packageBundles as BundleEntry[]) ?? [];
      expect(bundles.length).to.be.greaterThan(0);
      expect(bundles.some((b) => b.name === aliasBundleName)).to.be.true;

      // Delete the bundle using the alias
      const deleteResult = await PackageBundle.delete(devHubOrg.getConnection(), project, aliasBundleName);
      expect(deleteResult.success).to.be.true;
      expect(deleteResult.id).to.equal(aliasBundleId);
      expect(deleteResult.errors).to.be.an('array').that.is.empty;
    });

    it('should handle deletion without project when using alias', async () => {
      const bundleAlias = 'testBundle';

      // Attempt to delete with null project
      try {
        await PackageBundle.delete(devHubOrg.getConnection(), null as unknown as SfProject, bundleAlias);
        expect.fail('Expected error was not thrown');
      } catch (err) {
        const error = err as Error;
        expect(error.message).to.include('Project instance is required when deleting package bundle by alias');
      }
    });
  });
});
