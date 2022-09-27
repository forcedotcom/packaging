/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Connection } from '@salesforce/core';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { assert, expect } from 'chai';
import { Package1Version } from '../../src/package1';

describe('Package1 Display', () => {
  const testOrg = new MockTestOrgData();
  const $$ = instantiateContext();
  let conn: Connection;
  let queryStub: sinon.SinonStub;

  beforeEach(async () => {
    stubContext($$);
    await $$.stubAuths(testOrg);
    conn = await testOrg.getConnection();
    queryStub = $$.SANDBOX.stub(conn.tooling, 'query');
  });

  afterEach(() => {
    restoreContext($$);
  });

  it('should query and collate data correctly', async () => {
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
    const pkg1 = new Package1Version(conn);
    const result = await pkg1.display('04t46000001ZfaXXXX');
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
    queryStub.resolves({
      done: true,
      totalSize: 0,
      records: [],
    });
    const pkg1 = new Package1Version(conn);
    const result = await pkg1.display('04t46000001ZfaXXXX');
    expect(result).deep.equal([]);
  });

  it('should throw an error when not an 04t id', async () => {
    queryStub.resolves({
      done: true,
      totalSize: 0,
      records: [],
    });
    const pkg1 = new Package1Version(conn);
    try {
      await pkg1.display('03346000001ZfaXXXX');
      assert.fail('the above should throw');
    } catch (e) {
      expect(e.message).to.equal('Specify a valid package version ID (starts with 04t), received 03346000001ZfaXXXX');
    }
  });
});
