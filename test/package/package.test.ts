/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { assert, expect } from 'chai';
import { instantiateContext, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { Connection, SfProject } from '@salesforce/core';
import { Package } from '../../src/package';
import { PackageUpdateOptions } from '../../src/interfaces';

async function setupProject(setup: (project: SfProject) => void = () => {}) {
  // @ts-ignore
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const project: SfProject = new SfProject('a');
  const packageDirectories = [
    {
      path: 'force-app',
      default: true,
    },
  ];
  const packageAliases = {};
  project.getSfProjectJson().set('packageDirectories', packageDirectories);
  project.getSfProjectJson().set('packageAliases', packageAliases);
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

describe('Package', () => {
  const $$ = instantiateContext();
  let project: SfProject;
  const pkgId = '0Hoasdsadfasdfa';

  beforeEach(() => {
    stubContext($$);
  });

  afterEach(() => {
    restoreContext($$);
  });

  describe('instantiate package', () => {
    it('should fail to create a new package - no package aliases', async () => {
      $$.inProject(true);
      // eslint-disable-next-line @typescript-eslint/no-shadow
      const project = await setupProject();
      try {
        // @ts-expect-error: Type 'undefined' is not assignable to type 'Connection<Schema>'.
        new Package({ connection: undefined, packageAliasOrId: '0hoasdfsdfasd', project });
        expect.fail('Should have thrown an error');
      } catch (e) {
        assert(e instanceof Error);
        expect(e.message).to.equal('Package alias 0hoasdfsdfasd not found in project.');
      }
    });
    it('should fail to create a new package - alias not found', async () => {
      $$.inProject(true);
      project = await setupProject((p) => {
        p.getSfProjectJson().set('packageAliases', { MyName: 'somePackage' });
      });
      try {
        // @ts-expect-error: Type 'undefined' is not assignable to type 'Connection<Schema>'.
        new Package({ connection: undefined, packageAliasOrId: 'mypkgalias', project });
        expect.fail('Should have thrown an error');
      } catch (e) {
        assert(e instanceof Error);
        expect(e.message).to.equal('Package alias mypkgalias not found in project.');
      }
    });
    it('should create a new package - from alias', async () => {
      $$.inProject(true);
      project = await setupProject((p) => {
        p.getSfProjectJson().set('packageAliases', { mypkgalias: pkgId });
      });
      // @ts-expect-error: Type 'undefined' is not assignable to type 'Connection<Schema>'.
      const pkg = new Package({ connection: undefined, packageAliasOrId: 'mypkgalias', project });
      expect(pkg.getId()).to.equal(pkgId);
    });
    it('should create a new package - from 0Ho', async () => {
      $$.inProject(true);
      project = await setupProject((p) => {
        p.getSfProjectJson().set('packageAliases', { mypkgalias: pkgId });
      });
      // @ts-expect-error: Type 'undefined' is not assignable to type 'Connection<Schema>'.
      const pkg = new Package({ connection: undefined, packageAliasOrId: pkgId, project });
      expect(pkg.getId()).to.equal(pkgId);
    });
    it('should not create a new package - from 04t', async () => {
      $$.inProject(true);
      project = await setupProject((p) => {
        p.getSfProjectJson().set('packageAliases', {
          'mypkgalias@1.0.0': '04tasdsadfasdf',
          mypkgalias: pkgId,
        });
      });

      try {
        new Package({
          // @ts-expect-error: Type 'undefined' is not assignable to type 'Connection<Schema>'.
          connection: undefined,
          packageAliasOrId: '04tasdsadfasdf',
          project,
        });
      } catch (e) {
        assert(e instanceof Error);
        expect(e.message).to.equal('Package alias 04tasdsadfasdf not found in project.');
      }
    });

    it('should update package AppAnalyticsEnabled bit', async () => {
      $$.inProject(true);
      project = await setupProject((p) => {
        p.getSfProjectJson().set('packageAliases', { mypkgalias: pkgId });
      });

      let objProvided = '';
      let optsProvided: PackageUpdateOptions = { Id: '' };
      const conn = {
        tooling: {
          update: (obj: string, opts: PackageUpdateOptions) => {
            objProvided = obj;
            optsProvided = opts;
            return { success: true };
          },
        },
        getApiVersion: () => '59.0',
      } as unknown as Connection;

      const pkg = new Package({ connection: conn, packageAliasOrId: pkgId, project });
      const result = await pkg.update({
        Id: pkgId,
        AppAnalyticsEnabled: true,
      });
      assert(result.success);
      expect(objProvided).to.equal('Package2');
      expect(optsProvided.Id).to.equal(pkgId);
      expect(optsProvided.AppAnalyticsEnabled).to.equal(true);
    });

    it('should error if AppAnalyticsEnabled is defined for api version < 59.0', async () => {
      $$.inProject(true);
      project = await setupProject((p) => {
        p.getSfProjectJson().set('packageAliases', { mypkgalias: pkgId });
      });
      const conn = {
        tooling: {
          update: () => {},
        },
        getApiVersion: () => '58.0',
      } as unknown as Connection;
      const pkg = new Package({ connection: conn, packageAliasOrId: pkgId, project });
      try {
        await pkg.update({
          Id: pkgId,
          AppAnalyticsEnabled: true,
        });
        expect.fail('The update did not throw an error when it should have');
      } catch (e) {
        assert(e instanceof Error);
        expect(e.message).to.include('App Analytics').and.to.include('59.0');
      }
    });
  });

  describe('lazy load package data', () => {
    it('should create a new package - from 0Ho', async () => {
      $$.inProject(true);
      project = await setupProject((p) => {
        p.getSfProjectJson().set('packageAliases', { mypkgalias: pkgId });
      });
      const conn = {
        tooling: {
          sobject: () => ({
            retrieve: () => ({ Id: pkgId, ContainerOptions: 'Unlocked' }),
          }),
        },
      } as unknown as Connection;

      const pkg = new Package({ connection: conn, packageAliasOrId: pkgId, project });
      expect(pkg['packageData']).to.not.be.ok;
      expect(pkg.getId()).to.equal(pkgId);
      expect(await pkg.getType()).to.equal('Unlocked');
      expect(pkg['packageData']).to.be.ok;
    });
  });
});
