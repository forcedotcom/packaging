/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { Duration } from '@salesforce/kit';
import { expect } from 'chai';
import { Connection, Lifecycle, SfError } from '@salesforce/core';
import { assert } from 'sinon';
import { PackageEvents, PackagingSObjects } from '../../src/interfaces';
import { uninstallPackage } from '../../src/package';

const packageId = '04t4p000002BaHYXXX';

const successResult = {
  Id: '06y23000000002MXXX',
  IsDeleted: false,
  CreatedDate: '2022-08-02T17:13:00.000+0000',
  CreatedById: '00523000003Ehj9XXX',
  LastModifiedDate: '2022-08-02T17:13:00.000+0000',
  LastModifiedById: '00523000003Ehj9XXX',
  SystemModstamp: '2022-08-02T17:13:00.000+0000',
  SubscriberPackageVersionId: '04t4p000002BaHYXXX',
  Status: 'Success',
};

const queuedResult = { ...successResult, Status: 'Queued' };

describe('Package Uninstall', () => {
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
        create: () => ({ id: '04t4p000002BaHYAA0', success: true, errors: [] }),
      });
  });

  afterEach(() => {
    restoreContext($$);
  });

  it('should send the uninstall request, wait for it to finish, and emit events along the way', async () => {
    const millis1 = Duration.milliseconds(1);
    $$.SANDBOX.stub(Duration, 'seconds').callsFake(() => millis1);
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
      PackageEvents.uninstall,
      async (data: PackagingSObjects.SubscriberPackageVersionUninstallRequest) => {
        expect(data.Status).to.equal('Queued');
      }
    );

    const result = await uninstallPackage(packageId, conn, Duration.minutes(3));
    expect(result).deep.equal(successResult);
  });

  it('should send the uninstall request, and handle errors appropriately', async () => {
    sobjectStub.onSecondCall().returns({
      retrieve: async () => ({
        Id: '06y23000000002MXXX',
        Status: 'ERROR',
        Errors: { errors: [new Error('message 1'), new Error('message 2')] },
      }),
    });
    // @ts-ignore
    $$.SANDBOX.stub(conn.tooling, 'query').resolves({
      records: [{ Message: 'this is a server-side error message' }, { Message: 'this is a second error message' }],
    });

    try {
      await uninstallPackage(packageId, conn, Duration.minutes(3));
      assert.fail('the above should throw an error from polling');
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.include(
        "Can't uninstall the package 04t4p000002BaHYAA0 during uninstall request 06y23000000002MXXX."
      );
      expect(error.message).to.include('=== Errors');
      expect(error.message).to.include('(1) this is a server-side error message');
      expect(error.message).to.include('(2) this is a second error message');
      expect(error.actions).to.deep.equal(['Verify installed package ID and resolve errors, then try again.']);
    }
  }).timeout(10000);

  it('should send the uninstall request, and handle errors appropriately (0 error messages)', async () => {
    sobjectStub.onSecondCall().returns({
      retrieve: async () => ({
        Id: '04t4p000002BaHYXXX',
        Status: 'ERROR',
        Errors: [],
      }),
    });
    Lifecycle.getInstance().on(
      PackageEvents.uninstall,
      async (data: { timeout: number; pollingResult: PackagingSObjects.PackageUploadRequest }) => {
        // 3 minute timeout (180 seconds) - 1 second per poll
        expect(data.timeout).to.equal(179);
      }
    );
    try {
      await uninstallPackage(packageId, conn, Duration.minutes(3));
      assert.fail('the above should throw an error from polling');
    } catch (e) {
      expect((e as SfError).message).to.equal(
        "Can't uninstall the package 04t4p000002BaHYAA0 during uninstall request 04t4p000002BaHYXXX."
      );
      expect((e as SfError).actions).to.deep.equal(['Verify installed package ID and resolve errors, then try again.']);
    }
  }).timeout(10000);

  it('should send the uninstall request, retrieve the status and return', async () => {
    sobjectStub.onSecondCall().returns({
      retrieve: async () => queuedResult,
    });

    const result = await uninstallPackage(packageId, conn, Duration.minutes(0));
    expect(result).deep.equal(queuedResult);
  });
});
