/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as os from 'node:os';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { Duration } from '@salesforce/kit';
import { expect } from 'chai';
import { Connection, Lifecycle } from '@salesforce/core';
import { assert } from 'sinon';
import { PackageVersionEvents, PackagingSObjects } from '../../src/interfaces';
import { Package1Version } from '../../src/package1';

const options = {
  MetadataPackageId: '0334p000000blVyGAI',
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

describe('Package1 Version Create', () => {
  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();
  let conn: Connection;
  let sobjectStub: sinon.SinonStub;

  beforeEach(async () => {
    stubContext($$);
    await $$.stubAuths(testOrg);
    conn = await testOrg.getConnection();
    sobjectStub = $$.SANDBOX.stub(conn.tooling, 'sobject')
      .onFirstCall()
      .returns({
        // @ts-ignore - to avoid stubbing every property of sobject
        create: () => ({ id: '0HD4p000000blUvGXX', success: true, errors: [] }),
      });
  });

  afterEach(() => {
    restoreContext($$);
  });

  it('should send the create request, wait for it to finish, and emit events along the way', async () => {
    sobjectStub
      .onSecondCall()
      .returns({
        retrieve: async () => queuedResult,
      })
      .onThirdCall()
      .returns({
        retrieve: async () => successResult,
      });
    Lifecycle.getInstance().on(
      PackageVersionEvents.create.progress,
      async (data: { timeout: number; pollingResult: PackagingSObjects.PackageUploadRequest }) => {
        // 3 minute timeout (180 seconds) - 1 second per poll
        expect(data.timeout).to.equal(179);
        expect(data.pollingResult.Status).to.equal('QUEUED');
      }
    );
    const result = await Package1Version.create(conn, options, {
      frequency: Duration.seconds(1),
      timeout: Duration.minutes(3),
    });
    expect(result).deep.equal(successResult);
  });

  it('should send the create request, and handle errors appropriately', async () => {
    sobjectStub.onSecondCall().returns({
      retrieve: async () => ({
        Status: 'ERROR',
        Errors: { errors: [new Error('message 1'), new Error('message 2')] },
      }),
    });

    try {
      await Package1Version.create(conn, options, { frequency: Duration.seconds(1), timeout: Duration.minutes(3) });
      assert.fail('the above should throw an error from polling');
    } catch (e) {
      expect((e as Error).message).to.equal(`Package upload failed.${os.EOL}message 1${os.EOL}message 2`);
    }
  });

  it('should send the create request, and handle errors appropriately (0 error messages)', async () => {
    sobjectStub.onSecondCall().returns({
      retrieve: async () => ({
        Status: 'ERROR',
        Errors: [],
      }),
    });
    Lifecycle.getInstance().on(
      PackageVersionEvents.create.progress,
      async (data: { timeout: number; pollingResult: PackagingSObjects.PackageUploadRequest }) => {
        // 3 minute timeout (180 seconds) - 1 second per poll
        expect(data.timeout).to.equal(179);
      }
    );
    try {
      await Package1Version.create(conn, options, {
        frequency: Duration.seconds(1),
        timeout: Duration.minutes(3),
      });
      assert.fail('the above should throw an error from polling');
    } catch (e) {
      expect((e as Error).message).to.equal('Package version creation failed with unknown error');
    }
  });

  it('should send the create request, retrieve the request and return', async () => {
    sobjectStub.onSecondCall().returns({
      retrieve: async () => queuedResult,
    });

    const result = await Package1Version.create(conn, options);
    expect(result).deep.equal(queuedResult);
  });
});
