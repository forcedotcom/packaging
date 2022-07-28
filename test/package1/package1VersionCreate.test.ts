/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { MockTestOrgData, restoreContext, testSetup } from '@salesforce/core/lib/testSetup';
import { Duration } from '@salesforce/kit';
import { expect } from 'chai';
import { Connection, Lifecycle } from '@salesforce/core';
import { assert } from 'sinon';
import { package1Display, package1VersionCreate } from '../../src/package1';
import { PackagingSObjects } from '../../src/interfaces';

const options = {
  MetadataPackageId: '0HD4p000000blVyGAI',
  VersionName: 'Test',
  Description: 'Test',
  MajorVersion: 0,
  MinorVersion: 0,
  IsReleaseVersion: false,
  ReleaseNotesUrl: 'Test',
  PostInstallUrl: 'Test',
  Password: 'Test',
};

const successResult = {
  Status: 'SUCCESS',
  Id: '0HD4p000000blVyGAI',
  MetadataPackageVersionId: '04t4p000002Bb4lAAC',
  MetadataPackageId: '03346000000MrC0AAK',
};

const queuedResult = {
  Status: 'QUEUED',
  Id: '0HD4p000000blVyGAI',
  MetadataPackageVersionId: '04t4p000002Bb4lAAC',
  MetadataPackageId: '03346000000MrC0AAK',
};

describe('Package1 Version Create and Display', () => {
  const $$ = testSetup();
  const testOrg = new MockTestOrgData();
  let conn: Connection;
  let sobjectStub: sinon.SinonStub;
  let queryStub: sinon.SinonStub;

  beforeEach(async () => {
    await $$.stubAuths(testOrg);
    conn = await testOrg.getConnection();
    queryStub = $$.SANDBOX.stub(conn.tooling, 'query');
    sobjectStub = $$.SANDBOX.stub(conn.tooling, 'sobject')
      .onFirstCall()
      .returns({
        // @ts-ignore - to avoid stubbing every property of sobject
        create: () => ({ id: '0HD4p000000blUvGXX' }),
      });
  });

  after(() => {
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
    queryStub.resolves({
      done: true,
      totalSize: 0,
      records: [],
    });
    const result = await package1Display(conn, '04t46000001ZfaXXXX');
    expect(result).deep.equal([]);
  });
  it('should send the create request, wait for it to finish, and emit events along the way', async () => {
    sobjectStub
      .onSecondCall()
      .returns({
        // @ts-ignore
        retrieve: async () => queuedResult,
      })
      .onThirdCall()
      .returns({
        // @ts-ignore
        retrieve: async () => successResult,
      });
    Lifecycle.getInstance().on(
      'package1VersionCreate:progress',
      async (data: { timeout: number; pollingResult: PackagingSObjects.PackageUploadRequest }) => {
        // 3 minute timeout (180 seconds) - 1 second per poll
        expect(data.timeout).to.equal(179);
        expect(data.pollingResult.Status).to.equal('QUEUED');
      }
    );

    const result = await package1VersionCreate(conn, options, {
      frequency: Duration.seconds(1),
      timeout: Duration.minutes(3),
    });
    expect(result).deep.equal(successResult);
  });

  it('should send the create request, and handle errors appropriately', async () => {
    sobjectStub.onSecondCall().returns({
      // @ts-ignore
      retrieve: async () => ({
        Status: 'ERROR',
        Errors: { errors: [new Error('message 1'), new Error('message 2')] },
      }),
    });

    try {
      await package1VersionCreate(conn, options, { frequency: Duration.seconds(1), timeout: Duration.minutes(3) });
      assert.fail('the above should throw an error from polling');
    } catch (e) {
      expect((e as Error).message).to.equal('Package upload failed. \nmessage 1\nmessage 2');
    }
  });

  it('should send the create request, and handle errors appropriately (0 error messages)', async () => {
    sobjectStub.onSecondCall().returns({
      // @ts-ignore
      retrieve: async () => ({
        Status: 'ERROR',
        Errors: [],
      }),
    });
    Lifecycle.getInstance().on(
      'package1VersionCreate:progress',
      async (data: { timeout: number; pollingResult: PackagingSObjects.PackageUploadRequest }) => {
        // 3 minute timeout (180 seconds) - 1 second per poll
        expect(data.timeout).to.equal(179);
      }
    );
    try {
      await package1VersionCreate(conn, options, { frequency: Duration.seconds(1), timeout: Duration.minutes(3) });
      assert.fail('the above should throw an error from polling');
    } catch (e) {
      expect((e as Error).message).to.equal('Package version creation failed with unknown error');
    }
  });

  it('should send the create request, retrieve the request and return', async () => {
    sobjectStub.onSecondCall().returns({
      // @ts-ignore
      retrieve: async () => queuedResult,
    });

    const result = await package1VersionCreate(conn, options);
    expect(result).deep.equal(queuedResult);
  });
});
