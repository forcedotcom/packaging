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
import { PackageBundleUninstall } from '../../src/package/packageBundleUninstall';
import { BundleUninstallOptions, BundleSObjects } from '../../src/interfaces';

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

describe('PackageBundleUninstall.uninstallBundle', () => {
  const testContext = instantiateContext();
  const testOrg = new MockTestOrgData();
  let connection: Connection;
  let project: SfProject;

  beforeEach(async () => {
    stubContext(testContext);
    testContext.inProject(true);
    project = await setupProject();

    // Create the project directory structure
    await fs.promises.mkdir(project.getPath(), { recursive: true });

    connection = await testOrg.getConnection();

    // Stub the parsePackageBundleVersionId method to avoid package bundle validation
    testContext.SANDBOX.stub(
      PackageBundleUninstall,
      'parsePackageBundleVersionId' as keyof typeof PackageBundleUninstall
    ).returns('1Q8000000000001');
  });

  afterEach(async () => {
    restoreContext(testContext);
    try {
      await fs.promises.rm(project.getPath(), { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('uninstalls bundle without polling (immediate status)', async () => {
    Object.assign(connection.tooling, {
      sobject: () => ({
        create: () =>
          Promise.resolve({
            success: true,
            id: '1aF000000000001',
          }),
      }),
    });

    Object.assign(connection, {
      autoFetchQuery: () =>
        Promise.resolve({
          records: [
            {
              Id: '1aF000000000001',
              UninstallStatus: BundleSObjects.PkgBundleVersionUninstallReqStatus.queued,
              PackageBundleVersionId: '1Q8000000000001',
              InstalledPkgBundleVersionId: '08c000000000001',
              ValidationError: '',
              CreatedDate: new Date().toISOString(),
              CreatedById: '005000000000001',
            },
          ],
        }),
    });

    const options: BundleUninstallOptions = {
      connection,
      project,
      PackageBundleVersion: 'MyBundle@1.0',
    };

    const result = await PackageBundleUninstall.uninstallBundle(connection, project, options);

    expect(result).to.have.property('Id', '1aF000000000001');
    expect(result).to.have.property('UninstallStatus', BundleSObjects.PkgBundleVersionUninstallReqStatus.queued);
    expect(result).to.have.property('PackageBundleVersionId', '1Q8000000000001');
  });

  it('uninstalls bundle with polling to success', async () => {
    let callCount = 0;
    Object.assign(connection.tooling, {
      sobject: () => ({
        create: () =>
          Promise.resolve({
            success: true,
            id: '1aF000000000002',
          }),
      }),
    });

    Object.assign(connection, {
      autoFetchQuery: () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            records: [
              {
                Id: '1aF000000000002',
                UninstallStatus: BundleSObjects.PkgBundleVersionUninstallReqStatus.queued,
                PackageBundleVersionId: '1Q8000000000001',
                InstalledPkgBundleVersionId: '08c000000000002',
                ValidationError: '',
                CreatedDate: new Date().toISOString(),
                CreatedById: '005000000000002',
              },
            ],
          });
        }
        return Promise.resolve({
          records: [
            {
              Id: '1aF000000000002',
              UninstallStatus: BundleSObjects.PkgBundleVersionUninstallReqStatus.success,
              PackageBundleVersionId: '1Q8000000000001',
              InstalledPkgBundleVersionId: '08c000000000002',
              ValidationError: '',
              CreatedDate: new Date().toISOString(),
              CreatedById: '005000000000002',
            },
          ],
        });
      },
    });

    const options: BundleUninstallOptions = {
      connection,
      project,
      PackageBundleVersion: 'MyBundle@1.0',
      polling: {
        timeout: Duration.seconds(5),
        frequency: Duration.seconds(1),
      },
    };

    const result = await PackageBundleUninstall.uninstallBundle(connection, project, options);

    expect(result).to.have.property('Id', '1aF000000000002');
    expect(result).to.have.property('UninstallStatus', BundleSObjects.PkgBundleVersionUninstallReqStatus.success);
    expect(callCount).to.be.greaterThan(1);
  });
});

