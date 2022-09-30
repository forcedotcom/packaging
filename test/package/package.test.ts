/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as path from 'path';
import * as fs from 'fs';
import { expect } from 'chai';
import { instantiateContext, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { Connection, SfProject } from '@salesforce/core';
import { Package } from '../../src/package';

async function setupProject(setup: (project: SfProject) => void = () => {}) {
  // @ts-ignore
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

  beforeEach(() => {
    stubContext($$);
  });

  afterEach(() => {
    restoreContext($$);
  });

  describe('instantiate package', () => {
    it('should fail to create a new package - no package aliases', async () => {
      $$.inProject(true);
      const project = await setupProject();
      try {
        new Package({ connection: undefined, packageAliasOrId: '0hoasdfsdfasd', project });
        expect.fail('Should have thrown an error');
      } catch (e) {
        expect(e.message).to.equal('Package alias 0hoasdfsdfasd not found in project.');
      }
    });
    it('should fail to create a new package - alias not found', async () => {
      $$.inProject(true);
      project = await setupProject((p) => {
        p.getSfProjectJson().set('packageAliases', { MyName: 'somePackage' });
      });
      try {
        new Package({ connection: undefined, packageAliasOrId: 'mypkgalias', project });
        expect.fail('Should have thrown an error');
      } catch (e) {
        expect(e.message).to.equal('Package alias mypkgalias not found in project.');
      }
    });
    it('should create a new package - from alias', async () => {
      $$.inProject(true);
      project = await setupProject((p) => {
        p.getSfProjectJson().set('packageAliases', { mypkgalias: '0Hoasdsadfasdf' });
      });
      const pkg = new Package({ connection: undefined, packageAliasOrId: 'mypkgalias', project });
      // @ts-ignore
      pkg.init();
      expect(pkg.getId()).to.equal('0Hoasdsadfasdf');
    });
    it('should create a new package - from 0Ho', async () => {
      $$.inProject(true);
      project = await setupProject((p) => {
        p.getSfProjectJson().set('packageAliases', { mypkgalias: '0Hoasdsadfasdf' });
      });
      const pkg = new Package({ connection: undefined, packageAliasOrId: '0Hoasdsadfasdf', project });
      expect(pkg.getId()).to.equal('0Hoasdsadfasdf');
    });
    it('should not create a new package - from 04t', async () => {
      $$.inProject(true);
      project = await setupProject((p) => {
        p.getSfProjectJson().set('packageAliases', {
          'mypkgalias@1.0.0': '04tasdsadfasdf',
          mypkgalias: '0Hoasdsadfasdf',
        });
      });

      try {
        new Package({
          connection: undefined,
          packageAliasOrId: '04tasdsadfasdf',
          project,
        });
      } catch (e) {
        expect(e.message).to.equal('Package alias 04tasdsadfasdf not found in project.');
      }
    });
  });
  describe('lazy load package data', () => {
    it('should create a new package - from 0Ho', async () => {
      $$.inProject(true);
      project = await setupProject((p) => {
        p.getSfProjectJson().set('packageAliases', { mypkgalias: '0Hoasdsadfasdf' });
      });
      const conn = {
        tooling: {
          sobject: () => {
            return {
              retrieve: () => {
                return { Id: '0Hoasdsadfasdf', ContainerOptions: 'Unlocked' };
              },
            };
          },
        },
      } as unknown as Connection;

      const pkg = new Package({ connection: conn, packageAliasOrId: '0Hoasdsadfasdf', project });
      // @ts-ignore
      pkg.init();
      expect(pkg['packageData']).to.not.be.ok;
      expect(pkg.getId()).to.equal('0Hoasdsadfasdf');
      expect(await pkg.getType()).to.equal('Unlocked');
      expect(pkg['packageData']).to.be.ok;
    });
  });
});
