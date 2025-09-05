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
import { Connection } from '@salesforce/core';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
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
    const pv1 = new Package1Version(conn, '04t46000001ZfaXXXX');
    const result = await pv1.getPackageVersion();
    expect(result).deep.equal([
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
    ]);
  });

  it('should query and collate data correctly - no results', async () => {
    queryStub.resolves({
      done: true,
      totalSize: 0,
      records: [],
    });
    const pv1 = new Package1Version(conn, '04t46000001ZfaXXXX');
    const result = await pv1.getPackageVersion();
    expect(result).deep.equal([]);
  });
});
