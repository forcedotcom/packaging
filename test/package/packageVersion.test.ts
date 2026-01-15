/*
 * Copyright 2026, Salesforce, Inc.
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
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { Connection, SfError, SfProject } from '@salesforce/core';

import { PackageVersion } from '../../src/package';
import { PackageVersionCreate } from '../../src/package/packageVersionCreate';

describe('Package Version', () => {
  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();
  const packageId = '0Ho3i000000Gmj6XXX';
  const uniquePackageId = '0Ho3i000000Gmj7XXX';
  const idOrAlias = '04t4p000001ztuFAAQ';
  const versionCreateRequestId = '08c5d00000blah';
  let connection: Connection;
  let project: SfProject;
  let packageVersion: PackageVersion;

  beforeEach(async () => {
    $$.inProject(true);
    project = SfProject.getInstance();
    project.getSfProjectJson().set('packageDirectories', [
      {
        path: 'pkg',
        package: 'dep',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: false,
      },
      {
        path: 'force-app',
        package: 'TEST',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: true,
        ancestorId: 'TEST2',
        unpackagedMetadata: {
          path: 'unpackaged',
        },
        dependencies: [
          {
            package: 'DEP@0.1.0-1',
          },
        ],
      },
    ]);
    project.getSfProjectJson().set('packageAliases', {
      dupPkg1: packageId,
      dupPkg2: packageId,
      uniquePkg: uniquePackageId,
    });
    await project.getSfProjectJson().write();

    await fs.promises.mkdir(path.join(project.getPath(), 'force-app'));
    stubContext($$);
    await $$.stubAuths(testOrg);
    connection = await testOrg.getConnection();
    $$.SANDBOX.stub(connection.tooling, 'query')
      .onFirstCall() // @ts-ignore
      .resolves({
        records: [
          {
            Branch: null,
            MajorVersion: '1',
            MinorVersion: '2',
            PatchVersion: '3',
          },
        ],
      });
  });

  beforeEach(() => {
    packageVersion = new PackageVersion({ connection, project, idOrAlias });
  });

  afterEach(async () => {
    restoreContext($$);
    await fs.promises.rmdir(path.join(project.getPath(), 'force-app'));
    // @ts-ignore
    project.packageDirectories = undefined;
  });

  describe('updateProjectWithPackageVersion', () => {
    it('should save alias for the first duplicate 0Ho in aliases', async () => {
      // @ts-ignore
      await packageVersion.updateProjectWithPackageVersion({
        Package2Id: uniquePackageId,
        SubscriberPackageVersionId: idOrAlias,
      });
      expect(project.getSfProjectJson().getPackageAliases()?.['uniquePkg@1.2.3']).to.equal(idOrAlias);
    });

    it('should save alias for unique 0Ho in aliases', async () => {
      // @ts-ignore
      await packageVersion.updateProjectWithPackageVersion({
        Package2Id: packageId,
        SubscriberPackageVersionId: idOrAlias,
      });
      expect(project.getSfProjectJson().getPackageAliases()?.['dupPkg1@1.2.3']).to.equal(idOrAlias);
    });
  });

  describe('create', () => {
    it('should include the package version create request ID', async () => {
      // @ts-expect-error partial mock
      $$.SANDBOX.stub(PackageVersionCreate.prototype, 'createPackageVersion').resolves({
        Id: versionCreateRequestId,
      });
      const pollingTimeoutError = new SfError('polling timed out', 'PollingClientTimeout');
      $$.SANDBOX.stub(PackageVersion, 'pollCreateStatus').rejects(pollingTimeoutError);

      try {
        await PackageVersion.create({ connection, project });
        expect(false).to.equal(true, 'Expected a PollingClientTimeout to be thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect(err).to.have.property('name', 'PollingClientTimeout');
        expect(err).to.have.deep.property('data', { VersionCreateRequestId: versionCreateRequestId });
        expect(err)
          .to.have.property('message')
          .and.include(`Run 'sf package version create report -i ${versionCreateRequestId}`);
      }
    });
  });
});
