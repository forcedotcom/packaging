/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { expect } from 'chai';
import { Connection, Lifecycle, Messages } from '@salesforce/core';
import { SaveResult } from 'jsforce';
import { Duration } from '@salesforce/kit';
import { Package, isErrorPackageNotAvailable, isErrorFromSPVQueryRestriction } from '../../src/package';
import { PackagingSObjects, PackageInstallCreateRequest, PackageInstallOptions } from '../../src/interfaces';
type PackageInstallRequest = PackagingSObjects.PackageInstallRequest;

describe('Package Install', () => {
  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();
  let connection: Connection;
  let toolingCreateStub: sinon.SinonStub;
  let retrieveStub: sinon.SinonStub;
  let lifecycleStub: sinon.SinonStub;
  let queryStub: sinon.SinonStub;

  Messages.importMessagesDirectory(__dirname);
  const installMsgs = Messages.loadMessages('@salesforce/packaging', 'package_install');

  const pkgInstallCreateRequest: PackageInstallCreateRequest = {
    SubscriberPackageVersionKey: '04t6A000002zgKSQAY',
  };
  const pkgInstallCreateRequestDefaults = {
    ApexCompileType: 'all',
    EnableRss: false,
    NameConflictResolution: 'Block',
    PackageInstallSource: 'U',
    SecurityType: 'None',
    UpgradeType: 'mixed-mode',
  };

  const pkgInstallRequestId = '0Hf1h0000006runCAA';
  const pkgCreateRequest: SaveResult = {
    id: pkgInstallRequestId,
    success: true,
    errors: null,
  };

  const pkgInstallRequest: PackageInstallRequest = {
    attributes: {
      type: 'PackageInstallRequest',
      url: `/services/data/v55.0/tooling/sobjects/PackageInstallRequest/${pkgInstallRequestId}`,
    },
    Id: pkgInstallRequestId,
    IsDeleted: false,
    CreatedDate: '2022-08-05T15:25:41.000+0000',
    CreatedById: '0051h000009NugzAAC',
    LastModifiedDate: '2022-08-05T15:25:41.000+0000',
    LastModifiedById: '0051h000009NugzAAC',
    SystemModstamp: '2022-08-05T15:25:41.000+0000',
    SubscriberPackageVersionKey: '04t6A000002zgKSQAY',
    NameConflictResolution: 'Block',
    SecurityType: 'None',
    PackageInstallSource: 'U',
    ProfileMappings: null,
    Password: null,
    EnableRss: false,
    UpgradeType: 'mixed-mode',
    ApexCompileType: 'all',
    Status: 'SUCCESS',
    Errors: null,
  };

  const stubGetPackageTypeBy04tQuery = (type = 'Unlocked'): sinon.SinonStub => $$.SANDBOX.stub(connection.tooling, 'query').resolves({
      done: true,
      totalSize: 1,
      records: [{ Package2ContainerOptions: type }],
    });

  beforeEach(async () => {
    stubContext($$);
    await $$.stubAuths(testOrg);
    connection = await testOrg.getConnection();
    toolingCreateStub = $$.SANDBOX.stub(connection.tooling, 'create').resolves(pkgCreateRequest);
    lifecycleStub = $$.SANDBOX.stub(Lifecycle.prototype, 'emit');

    // This is for the getPackageTypeBy04t query
    queryStub = stubGetPackageTypeBy04tQuery();
  });

  afterEach(() => {
    restoreContext($$);
  });

  it('should send install request and get status (async)', async () => {
    const inProgressPIR = Object.assign({}, pkgInstallRequest, { Status: 'IN_PROGRESS' });
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve').onFirstCall().resolves(inProgressPIR);
    const pkg = new Package({ connection });
    const result = await pkg.install(pkgInstallCreateRequest);

    // verify correct connection.tooling.create() call
    expect(toolingCreateStub.calledOnce).to.be.true;
    const createArgs = toolingCreateStub.args[0];
    expect(createArgs[0]).to.equal('PackageInstallRequest');
    const expectedRequest = Object.assign({}, pkgInstallCreateRequest, pkgInstallCreateRequestDefaults);
    expect(createArgs[1]).to.deep.equal(expectedRequest);

    // verify correct connection.tooling.retrieve() calls
    expect(retrieveStub.calledOnce).to.be.true;
    const retrieveArgs = retrieveStub.args[0];
    expect(retrieveArgs[0]).to.equal('PackageInstallRequest');
    expect(retrieveArgs[1]).to.equal(pkgInstallRequestId);

    // verify expected return json
    expect(result).to.deep.equal(inProgressPIR);

    expect(lifecycleStub.calledTwice).to.be.true;
    expect(lifecycleStub.args[0][1]).to.deep.equal(expectedRequest);
    expect(lifecycleStub.args[1][0]).to.equal('Package/install-postsend');
    expect(queryStub.called).to.be.true;
  });

  it('should send install request and poll status (sync)', async () => {
    const inProgressPIR = Object.assign({}, pkgInstallRequest, { Status: 'IN_PROGRESS' });
    const successPIR = Object.assign({}, pkgInstallRequest);
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve')
      .onFirstCall()
      .resolves(inProgressPIR)
      .onSecondCall()
      .resolves(successPIR);
    const pkg = new Package({ connection });
    const installOptions: PackageInstallOptions = {
      pollingFrequency: Duration.milliseconds(5),
      pollingTimeout: Duration.seconds(2),
    };
    const result = await pkg.install(pkgInstallCreateRequest, installOptions);

    expect(toolingCreateStub.calledOnce).to.be.true;

    // verify we polled
    expect(retrieveStub.calledTwice).to.be.true;
    expect(lifecycleStub.callCount).to.equal(4);
    expect(lifecycleStub.args[0][0]).to.equal('Package/install-presend');
    const expectedRequest = Object.assign({}, pkgInstallCreateRequest, pkgInstallCreateRequestDefaults);
    expect(lifecycleStub.args[0][1]).to.deep.equal(expectedRequest);
    expect(lifecycleStub.args[1][0]).to.equal('Package/install-postsend');
    expect(lifecycleStub.args[1][1]).to.deep.equal(pkgCreateRequest);
    expect(lifecycleStub.args[2][0]).to.equal('Package/install-status');
    expect(lifecycleStub.args[2][1]).to.deep.equal(inProgressPIR);
    expect(lifecycleStub.args[3][0]).to.equal('Package/install-status');
    expect(lifecycleStub.args[3][1]).to.deep.equal(successPIR);

    // verify expected return json
    expect(result).to.deep.equal(successPIR);
  });

  it('should wait for package to publish', async () => {
    queryStub.restore();
    queryStub = $$.SANDBOX.stub(connection.tooling, 'query')
      .onFirstCall()
      .resolves({
        done: true,
        totalSize: 1,
        records: [{ InstallValidationStatus: 'PACKAGE_UNAVAILABLE' }],
      })
      .onSecondCall()
      .resolves({
        done: true,
        totalSize: 1,
        records: [{ InstallValidationStatus: 'NO_ERRORS_DETECTED' }],
      });
    const millis5 = Duration.milliseconds(5);
    const millisStub = $$.SANDBOX.stub(Duration, 'milliseconds').callsFake(() => millis5);

    const pkg = new Package({ connection });
    const SubscriberPackageVersionKey = pkgInstallCreateRequest.SubscriberPackageVersionKey;
    await pkg.waitForPublish(SubscriberPackageVersionKey, Duration.seconds(2));

    expect(millisStub.called).to.be.true;
    expect(queryStub.calledTwice).to.be.true;
    const expectedQuery = `SELECT Id, SubscriberPackageId, InstallValidationStatus FROM SubscriberPackageVersion WHERE Id ='${SubscriberPackageVersionKey}' AND InstallationKey ='null'`;
    expect(queryStub.args[0][0]).to.equal(expectedQuery);
    expect(queryStub.args[1][0]).to.equal(expectedQuery);
  });

  it('should get external sites', async () => {
    const sites = ['foo/bar', 'baz/nib', 'blah/yadda'];
    const RemoteSiteSettings = { settings: [{ url: sites[0] }, { url: sites[1] }] };
    const CspTrustedSites = { settings: [{ endpointUrl: sites[2] }] };
    const queryError = new Error('Implementation restriction: You can only perform queries of the form Id');
    queryError.name = 'MALFORMED_QUERY';
    queryStub.restore();
    queryStub = $$.SANDBOX.stub(connection.tooling, 'query')
      .onFirstCall()
      .throws(queryError)
      .onSecondCall()
      .resolves({
        done: true,
        totalSize: 1,
        records: [{ RemoteSiteSettings, CspTrustedSites }],
      });

    const pkg = new Package({ connection });
    const SubscriberPackageVersionKey = pkgInstallCreateRequest.SubscriberPackageVersionKey;
    const externalSites = await pkg.getExternalSites(SubscriberPackageVersionKey);

    expect(queryStub.calledTwice).to.be.true;
    expect(queryStub.args[0][0]).to.equal(
      `SELECT RemoteSiteSettings, CspTrustedSites FROM SubscriberPackageVersion WHERE Id ='${SubscriberPackageVersionKey}' AND InstallationKey ='null'`
    );
    expect(queryStub.args[1][0]).to.equal(
      `SELECT RemoteSiteSettings, CspTrustedSites FROM SubscriberPackageVersion WHERE Id ='${SubscriberPackageVersionKey}'`
    );
    expect(externalSites).to.deep.equal(sites);
  });

  it('should return undefined for no external sites', async () => {
    const installKey = '123456';
    queryStub.restore();
    queryStub = $$.SANDBOX.stub(connection.tooling, 'query').onFirstCall().resolves({
      done: true,
      totalSize: 0,
      records: null,
    });

    const pkg = new Package({ connection });
    const SubscriberPackageVersionKey = pkgInstallCreateRequest.SubscriberPackageVersionKey;
    const externalSites = await pkg.getExternalSites(SubscriberPackageVersionKey, installKey);

    expect(queryStub.calledOnce).to.be.true;
    expect(queryStub.args[0][0]).to.equal(
      `SELECT RemoteSiteSettings, CspTrustedSites FROM SubscriberPackageVersion WHERE Id ='${SubscriberPackageVersionKey}' AND InstallationKey ='${installKey}'`
    );
    expect(externalSites).to.be.undefined;
  });

  it('should emit warnings for UpgradeType and ApexCompileType of non-unlocked package types', async () => {
    // stub the getPackageTypeBy04t query to return a "Managed" type
    queryStub.restore();
    queryStub = stubGetPackageTypeBy04tQuery('Managed');

    const inProgressPIR = Object.assign({}, pkgInstallRequest, { Status: 'IN_PROGRESS' });
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve').onFirstCall().resolves(inProgressPIR);
    const overrides = { UpgradeType: 'deprecate-only', ApexCompileType: 'package' };
    const picRequest = Object.assign({}, pkgInstallCreateRequest, overrides);
    const pkg = new Package({ connection });
    const result = await pkg.install(picRequest);

    // verify correct connection.tooling.create() call
    expect(toolingCreateStub.calledOnce).to.be.true;
    const createArgs = toolingCreateStub.args[0];
    expect(createArgs[0]).to.equal('PackageInstallRequest');
    const expectedRequest = Object.assign({}, pkgInstallCreateRequest, pkgInstallCreateRequestDefaults);
    delete expectedRequest.UpgradeType;
    delete expectedRequest.ApexCompileType;
    expect(createArgs[1]).to.deep.equal(expectedRequest);

    // verify correct connection.tooling.retrieve() calls
    expect(retrieveStub.calledOnce).to.be.true;
    const retrieveArgs = retrieveStub.args[0];
    expect(retrieveArgs[0]).to.equal('PackageInstallRequest');
    expect(retrieveArgs[1]).to.equal(pkgInstallRequestId);

    // verify expected return json
    expect(result).to.deep.equal(inProgressPIR);

    // verify all lifecycle events fired
    expect(lifecycleStub.callCount).to.equal(4);
    const upgradeTypeWarning = installMsgs.getMessage('upgradeTypeOnlyForUnlockedWarning');
    expect(lifecycleStub.args[0][0]).to.equal('Package/install-warning');
    expect(lifecycleStub.args[0][1]).to.equal(upgradeTypeWarning);
    const apexCompileTypeWarning = installMsgs.getMessage('apexCompileOnlyForUnlockedWarning');
    expect(lifecycleStub.args[1][0]).to.equal('Package/install-warning');
    expect(lifecycleStub.args[1][1]).to.equal(apexCompileTypeWarning);
    expect(lifecycleStub.args[2][0]).to.equal('Package/install-presend');
    expect(lifecycleStub.args[3][0]).to.equal('Package/install-postsend');

    expect(queryStub.called).to.be.true;
  });

  it('should NOT emit warnings for UpgradeType and ApexCompileType of unlocked package types', async () => {
    const overrides = { UpgradeType: 'deprecate-only', ApexCompileType: 'package' };
    const inProgressPIR = Object.assign({}, pkgInstallRequest, { Status: 'IN_PROGRESS' }, overrides);
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve').onFirstCall().resolves(inProgressPIR);
    const picRequest = Object.assign({}, pkgInstallCreateRequest, pkgInstallCreateRequestDefaults, overrides);
    const pkg = new Package({ connection });
    const result = await pkg.install(picRequest);

    // verify correct connection.tooling.create() call
    expect(toolingCreateStub.calledOnce).to.be.true;
    const createArgs = toolingCreateStub.args[0];
    expect(createArgs[0]).to.equal('PackageInstallRequest');
    expect(createArgs[1]).to.deep.equal(picRequest);

    // verify correct connection.tooling.retrieve() calls
    expect(retrieveStub.calledOnce).to.be.true;
    const retrieveArgs = retrieveStub.args[0];
    expect(retrieveArgs[0]).to.equal('PackageInstallRequest');
    expect(retrieveArgs[1]).to.equal(pkgInstallRequestId);

    // verify expected return json
    expect(result).to.deep.equal(inProgressPIR);

    // verify all lifecycle events fired
    expect(lifecycleStub.callCount).to.equal(2);
    expect(lifecycleStub.args[0][0]).to.equal('Package/install-presend');
    expect(lifecycleStub.args[1][0]).to.equal('Package/install-postsend');

    expect(queryStub.called).to.be.true;
  });

  it('should report polling timeout', async () => {
    const inProgressPIR = Object.assign({}, pkgInstallRequest, { Status: 'IN_PROGRESS' });
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve').resolves(inProgressPIR);
    const pkg = new Package({ connection });
    const installOptions: PackageInstallOptions = {
      pollingFrequency: Duration.milliseconds(5),
      pollingTimeout: Duration.milliseconds(50),
    };

    try {
      await pkg.install(pkgInstallCreateRequest, installOptions);
      expect(false, 'Expected timeout error to be thrown').to.be.true;
    } catch (err) {
      expect(err.name).to.equal('PackageInstallTimeout');
      expect(err.data).to.deep.equal(inProgressPIR);
    }

    expect(toolingCreateStub.calledOnce).to.be.true;

    // verify we polled
    expect(retrieveStub.callCount).to.be.greaterThan(2);
  });

  it('should report publish polling timeout', async () => {
    const queryResult = {
      done: true,
      totalSize: 1,
      records: [{ InstallValidationStatus: 'PACKAGE_UNAVAILABLE' }],
    };
    queryStub.restore();
    queryStub = $$.SANDBOX.stub(connection.tooling, 'query').resolves(queryResult);
    const millis5 = Duration.milliseconds(5);
    const millis50 = Duration.milliseconds(50);
    const millisStub = $$.SANDBOX.stub(Duration, 'milliseconds').callsFake(() => millis5);

    const pkg = new Package({ connection });
    const SubscriberPackageVersionKey = pkgInstallCreateRequest.SubscriberPackageVersionKey;
    try {
      await pkg.waitForPublish(SubscriberPackageVersionKey, millis50);
      expect(false, 'Expected timeout error to be thrown').to.be.true;
    } catch (err) {
      expect(err.name).to.equal('SubscriberPackageVersionNotPublishedError');
      expect(err.data).to.deep.equal(queryResult);
    }

    expect(millisStub.called).to.be.true;
    expect(queryStub.callCount).to.be.greaterThan(2);
  });
  describe('isErrorPackageNotAvailable', () => {
    it('should return true if the error name is "UNKNOWN_EXCEPTION"', () => {
      ['UNKNOWN_EXCEPTION', 'PACKAGE_UNAVAILABLE'].forEach((name) => {
        const error = new Error();
        error.name = name;
        const result = isErrorPackageNotAvailable(error);
        expect(result).to.be.equal(true, `Expected Error ${name} to be a "package not available" surrogates`);
      });
    });
    it('should return false if the error name is one of the "package not available" surrogates', () => {
      const error = new Error();
      error.name = 'NOT_A_SURROGATE';
      const result = isErrorPackageNotAvailable(error);
      expect(result).to.be.false;
    });
  });
  describe('isErrorFromSPVQueryRestriction', () => {
    it('should return true if the error message is from "Subscriber Query Restriction"', () => {
      const error = new Error();
      error.name = 'MALFORMED_QUERY';
      error.message = 'Implementation restriction: You can only perform queries of the form Id';
      const result = isErrorFromSPVQueryRestriction(error);
      expect(result).to.be.true;
    });
    it('should return false if the error message is not from "Subscriber Query Restriction"', () => {
      const error = new Error();
      error.name = 'NOT_MALFORMED_QUERY';
      error.message = 'Implementation restriction: You can only perform queries of the form Id';
      const result = isErrorFromSPVQueryRestriction(error);
      expect(result).to.be.false;
    });
  });
});
