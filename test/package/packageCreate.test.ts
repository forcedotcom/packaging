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
import { instantiateContext, restoreContext, stubContext } from '@salesforce/core/testSetup';
import { SfProject } from '@salesforce/core';
import { createPackageRequestFromContext, createPackageDirEntry } from '../../src/package/packageCreate';

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
      const project = await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
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
      const project = await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
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
    describe('createPackageDirEntry', () => {
      it('should return a valid new package directory entry - no existing entries', async () => {
        $$.inProject(true);
        const project = await setupProject((proj) => {
          proj.getSfProjectJson().set('packageDirectories', []);
        });

        const packageDirEntry = createPackageDirEntry(project, {
          name: 'test',
          description: 'test description',
          path: 'test/path',
          packageType: 'Managed',
          orgDependent: false,
          errorNotificationUsername: 'foo@bar.org',
          noNamespace: true,
        });
        expect(packageDirEntry).to.deep.equal({
          default: true,
          package: 'test',
          path: 'test/path',
          versionDescription: 'test description',
          versionName: 'ver 0.1',
          versionNumber: '0.1.0.NEXT',
        });
      });
      it('should return a valid new package directory entry - existing entries', async () => {
        $$.inProject(true);
        const project = await setupProject();

        const packageDirEntry = createPackageDirEntry(project, {
          name: 'test',
          description: 'test description',
          path: 'test/path',
          packageType: 'Managed',
          orgDependent: false,
          errorNotificationUsername: 'foo@bar.org',
          noNamespace: true,
        });
        expect(packageDirEntry).to.deep.equal({
          default: false,
          package: 'test',
          path: 'test/path',
          versionDescription: 'test description',
          versionName: 'ver 0.1',
          versionNumber: '0.1.0.NEXT',
        });
        expect(packageDirEntry).to.not.deep.equal(project.getSfProjectJson().getContents().packageDirectories[0]);
      });
      it('should return a valid modified package directory entry', async () => {
        $$.inProject(true);
        const project = await setupProject((proj) => {
          const packageDirectories = proj.getSfProjectJson().getContents().packageDirectories;
          packageDirectories.push({
            path: 'test/path',
            versionName: 'ver 0.1',
            versionNumber: '0.1.0.NEXT',
          });
          proj.getSfProjectJson().set('packageDirectories', packageDirectories);
        });
        const packageDirEntry = createPackageDirEntry(project, {
          name: 'test-01',
          description: 'test description',
          path: 'test/path',
          packageType: 'Managed',
          orgDependent: false,
          errorNotificationUsername: 'foo@bar.org',
          noNamespace: true,
        });
        expect(packageDirEntry).to.to.have.property('package', 'test-01');
        expect(packageDirEntry.package).to.not.be.true;
      });
    });
  });
});
