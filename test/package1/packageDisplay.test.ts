/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { MockTestOrgData, testSetup } from '@salesforce/core/lib/testSetup';
import { expect } from 'chai';
import { package1Display } from '../../lib/package1';

describe('Package1 Display', () => {
  const $$ = testSetup();
  const testOrg = new MockTestOrgData();

  it('should query and collate data correctly', async () => {
    await $$.stubAuths(testOrg);
    const conn = await testOrg.getConnection();
    const queryStub = $$.SANDBOX.stub(conn.tooling, 'query');
    queryStub.resolves({
      done: true,
      totalSize: 1,
      records: [
        {
          Id: '04t46000001ZfaXXXX',
          Name: 'Summer 22',
          MetadataPackageId: '03346000000dmo4XXX',
          MajorVersion: 1,
          MinorVersion: 0,
          PatchVersion: 3,
          ReleaseState: 'Beta',
          BuildNumber: 1,
        },
      ],
    });
    const result = await package1Display(conn, '04t46000001ZfaXXXX');
    expect(result).deep.equal([
      {
        BuildNumber: 1,
        MetadataPackageId: '03346000000dmo4XXX',
        MetadataPackageVersionId: '04t46000001ZfaXXXX',
        Name: 'Summer 22',
        ReleaseState: 'Beta',
        Version: '1.0.3',
      },
    ]);
  });

  it('should query and collate data correctly - no results', async () => {
    await $$.stubAuths(testOrg);
    const conn = await testOrg.getConnection();
    const queryStub = $$.SANDBOX.stub(conn.tooling, 'query');
    queryStub.resolves({
      done: true,
      totalSize: 0,
      records: [],
    });
    const result = await package1Display(conn, '04t46000001ZfaXXXX');
    expect(result).deep.equal([]);
  });
});
