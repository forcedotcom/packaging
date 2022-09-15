/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as path from 'path';
import * as fs from 'fs';
import { expect } from 'chai';
import { instantiateContext, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { NamedPackageDir, SfProject } from '@salesforce/core';
import { createPackageRequestFromContext, generatePackageDirEntry } from '../../src/package/packageCreate';

async function setupProject(setup: (project: SfProject) => void = () => {}) {
  const project = await SfProject.resolve();
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

describe('packageCreate', () => {
  const $$ = instantiateContext();

  beforeEach(() => {
    stubContext($$);
  });

  afterEach(() => {
    restoreContext($$);
  });

  describe('_createPackage2RequestFromContext', () => {
    it('should return a valid request', async () => {
      $$.inProject(true);
      const project = await setupProject();
      const request = createPackageRequestFromContext(project, {
        name: 'test',
        description: 'test description',
        path: 'test/path',
        packageType: 'Managed',
        orgDependent: false,
        errorNotificationUsername: 'foo@bar.org',
        noNamespace: false,
      });
      expect(request).to.deep.equal({
        ContainerOptions: 'Managed',
        Description: 'test description',
        IsOrgDependent: false,
        Name: 'test',
        NamespacePrefix: '',
        PackageErrorUsername: 'foo@bar.org',
      });
    });
    it('should return a valid request for a namespace', async () => {
      $$.inProject(true);
      const project = await setupProject((project) => {
        project.getSfProjectJson().set('namespace', 'testNamespace');
      });
      const request = createPackageRequestFromContext(project, {
        name: 'test',
        description: 'test description',
        path: 'test/path',
        packageType: 'Managed',
        orgDependent: false,
        errorNotificationUsername: 'foo@bar.org',
        noNamespace: false,
      });
      expect(request).to.deep.equal({
        ContainerOptions: 'Managed',
        Description: 'test description',
        IsOrgDependent: false,
        Name: 'test',
        NamespacePrefix: 'testNamespace',
        PackageErrorUsername: 'foo@bar.org',
      });
    });
    it('should return a valid no namespace request for a namespaced package', async () => {
      $$.inProject(true);
      const project = await setupProject((project) => {
        project.getSfProjectJson().set('namespace', 'testNamespace');
      });
      const request = createPackageRequestFromContext(project, {
        name: 'test',
        description: 'test description',
        path: 'test/path',
        packageType: 'Managed',
        orgDependent: false,
        errorNotificationUsername: 'foo@bar.org',
        noNamespace: true,
      });
      expect(request).to.deep.equal({
        ContainerOptions: 'Managed',
        Description: 'test description',
        IsOrgDependent: false,
        Name: 'test',
        NamespacePrefix: '',
        PackageErrorUsername: 'foo@bar.org',
      });
    });
    describe('_generatePackageDirEntry', () => {
      it('should return a valid new package directory entry', async () => {
        $$.inProject(true);
        const project = await setupProject();
        const entries = generatePackageDirEntry(project, {
          name: 'test',
          description: 'test description',
          path: 'test/path',
          packageType: 'Managed',
          orgDependent: false,
          errorNotificationUsername: 'foo@bar.org',
          noNamespace: true,
        });
        const expectedEntry = entries.map((e) => e as NamedPackageDir).find((e) => e.package === 'test');
        expect(expectedEntry).to.deep.equal({
          default: false,
          package: 'test',
          path: 'test/path',
          versionName: 'ver 0.1',
          versionNumber: '0.1.0.NEXT',
        });
      });
      it('should return a valid modified package directory entry', async () => {
        $$.inProject(true);
        const project = await setupProject((project) => {
          const packageDirectories = project.getSfProjectJson().getContents().packageDirectories;
          packageDirectories.push({
            default: false,
            package: 'test',
            path: 'test/path',
            versionName: 'ver 0.1',
            versionNumber: '0.1.0.NEXT',
          });
          project.getSfProjectJson().set('packageDirectories', packageDirectories);
        });
        const entries = generatePackageDirEntry(project, {
          name: 'test-01',
          description: 'test description',
          path: 'test/path',
          packageType: 'Managed',
          orgDependent: false,
          errorNotificationUsername: 'foo@bar.org',
          noNamespace: true,
        });
        const expectedEntry = entries.map((e) => e as NamedPackageDir).find((e) => e.package === 'test-01');
        expect(expectedEntry).to.to.have.property('package', 'test-01');
      });
    });
  });
});
