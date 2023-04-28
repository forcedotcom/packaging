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

const records = [
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
  {
    Id: '04t46000001ZfaXXXY',
    Name: 'Summer 22',
    MetadataPackageId: '03346000000dmo4XXX',
    MajorVersion: 1,
    MinorVersion: 0,
    PatchVersion: 4,
    ReleaseState: 'Beta',
    BuildNumber: 1,
  },
];

const listResult = [
  {
    BuildNumber: 1,
    Id: '04t46000001ZfaXXXX',
    MajorVersion: 1,
    MetadataPackageId: '03346000000dmo4XXX',
    MinorVersion: 0,
    Name: 'Summer 22',
    PatchVersion: 3,
    ReleaseState: 'Beta',
  },
  {
    BuildNumber: 1,
    Id: '04t46000001ZfaXXXY',
    MajorVersion: 1,
    MetadataPackageId: '03346000000dmo4XXX',
    MinorVersion: 0,
    Name: 'Summer 22',
    PatchVersion: 4,
    ReleaseState: 'Beta',
  },
];

describe('Package1 Version List', () => {
  const testOrg = new MockTestOrgData();
  let conn: Connection;
  let queryStub: sinon.SinonStub;
  const $$ = instantiateContext();

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
      records,
    });
    const result = await Package1Version.list(conn);
    expect(result).deep.equal(listResult);
    restoreContext($$);
  });

  it('should query and collate data correctly with MetadataPackageId supplied', async () => {
    queryStub.resolves({
      done: true,
      totalSize: 1,
      records: [records[0]],
    });
    const result = await Package1Version.list(conn, '03346000000dmo4XXX');
    expect(result).deep.equal([listResult[0]]);
  });

  it('should query and collate data correctly - no results', async () => {
    queryStub.resolves({
      done: true,
      totalSize: 0,
      records: [],
    });
    const result = await Package1Version.list(conn, '03346000000dmo4XXX');
    expect(result).deep.equal([]);
  });

  it('should throw an error when invalid ID is provided', async () => {
    queryStub.resolves({
      done: true,
      totalSize: 0,
      records: [],
    });
    try {
      await Package1Version.list(conn, '04t46000001ZfaXXXX');
      assert.fail('the above should throw an invalid id error');
    } catch (e) {
      assert(e instanceof Error);
      expect(e.message).to.equal(
        'Specify a valid package metadata package ID (starts with 033), received 04t46000001ZfaXXXX'
      );
    }
  });
});
