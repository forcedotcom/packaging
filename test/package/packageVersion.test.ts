/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { expect } from 'chai';
import { Connection, SfProject } from '@salesforce/core';

import { PackageVersion } from '../../src/package';

describe('Package Version', () => {
  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();
  const packageId = '0Ho3i000000Gmj6XXX';
  const uniquePackageId = '0Ho3i000000Gmj7XXX';
  const idOrAlias = '04t4p000001ztuFAAQ';
  let connection: Connection;
  let project: SfProject;

  beforeEach(async () => {
    $$.inProject(true);
    project = SfProject.getInstance();
    await project.getSfProjectJson().write({
      packageDirectories: [
        {
          path: 'pkg',
          package: 'dep',
          versionName: 'ver 0.1',
          versionNumber: '0.1.0.NEXT',
          default: false,
          name: 'pkg',
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
      ],
      packageAliases: {
        dupPkg1: packageId,
        dupPkg2: packageId,
        uniquePkg: uniquePackageId,
      },
    });
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

  afterEach(async () => {
    restoreContext($$);
    await fs.promises.rmdir(path.join(project.getPath(), 'force-app'));
    // @ts-ignore
    project.packageDirectories = undefined;
  });
  let packageVersion: PackageVersion;
  beforeEach(() => {
    packageVersion = new PackageVersion({ connection, project, idOrAlias });
  });
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
