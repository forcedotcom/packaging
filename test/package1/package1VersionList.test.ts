/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Connection } from '@salesforce/core';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { expect } from 'chai';
import { package1VersionList } from '../../lib/package1';

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
    MetadataPackageId: '03346000000dmo4XXX',
    MetadataPackageVersionId: '04t46000001ZfaXXXX',
    Name: 'Summer 22',
    ReleaseState: 'Beta',
    Version: '1.0.3',
  },
  {
    BuildNumber: 1,
    MetadataPackageId: '03346000000dmo4XXX',
    MetadataPackageVersionId: '04t46000001ZfaXXXY',
    Name: 'Summer 22',
    ReleaseState: 'Beta',
    Version: '1.0.4',
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
    const result = await package1VersionList(conn);
    expect(result).deep.equal(listResult);
    restoreContext($$);
  });

  it('should query and collate data correctly with MetadataPackageId supplied', async () => {
    queryStub.resolves({
      done: true,
      totalSize: 1,
      records: [records[0]],
    });
    const result = await package1VersionList(conn, '03346000000dmo4XXX');
    expect(result).deep.equal([listResult[0]]);
  });

  it('should query and collate data correctly - no results', async () => {
    queryStub.resolves({
      done: true,
      totalSize: 0,
      records: [],
    });
    const result = await package1VersionList(conn, '03346000000dmo4XXX');
    expect(result).deep.equal([]);
  });
});
