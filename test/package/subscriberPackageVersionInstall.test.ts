/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { expect } from 'chai';
import { Connection, Lifecycle, Messages } from '@salesforce/core';
import { QueryResult, SaveResult } from 'jsforce';
import { Duration } from '@salesforce/kit';
import { isErrorPackageNotAvailable, isErrorFromSPVQueryRestriction } from '../../src/package';
import { PackagingSObjects, PackageInstallCreateRequest, PackageInstallOptions } from '../../src/interfaces';
import { SubscriberPackageVersion } from '../../src/package/subscriberPackageVersion';
import PackageInstallRequest = PackagingSObjects.PackageInstallRequest;

const myPackageVersion04t = '04t6A0000000X0UQAU';

describe('Package Install', () => {
  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();
  let connection: Connection;
  let toolingCreateStub: sinon.SinonStub;
  let retrieveStub: sinon.SinonStub;
  let lifecycleStub: sinon.SinonStub;
  let queryStub: sinon.SinonStub;
  let otherQueryStub: sinon.SinonStub;

  Messages.importMessagesDirectory(__dirname);
  const installMsgs = Messages.loadMessages('@salesforce/packaging', 'package_install');

  const pkgInstallCreateRequest: PackageInstallCreateRequest = {
    SubscriberPackageVersionKey: myPackageVersion04t,
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
  const pkgInstallRequest: SaveResult = {
    id: pkgInstallRequestId,
    success: true,
    errors: null,
  };

  const pkgInstallResult: PackageInstallRequest = {
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

  const subscriberPackageVersion = {
    done: true,
    totalSize: 1,
    records: [
      {
        AppExchangeDescription: '',
        AppExchangeLogoUrl: '',
        AppExchangePackageName: '',
        AppExchangePublisherName: '',
        BuildNumber: 0,
        CspTrustedSites: undefined,
        Dependencies: undefined,
        Description: '',
        Id: myPackageVersion04t,
        InstallValidationStatus: 'NO_ERRORS_DETECTED',
        IsBeta: false,
        IsDeprecated: false,
        IsManaged: false,
        IsOrgDependent: false,
        IsPasswordProtected: false,
        IsSecurityReviewed: false,
        MajorVersion: 0,
        MinorVersion: 0,
        Name: '',
        Package2ContainerOptions: '',
        PatchVersion: 0,
        PostInstallUrl: '',
        Profiles: undefined,
        PublisherName: '',
        ReleaseNotesUrl: '',
        ReleaseState: '',
        RemoteSiteSettings: undefined,
        SubscriberPackageId: '',
      },
    ],
  };

  const stubGetPackageTypeBy04tQuery = (type = 'Unlocked'): sinon.SinonStub =>
    $$.SANDBOX.stub(connection.tooling, 'query').resolves({
      done: true,
      totalSize: 1,
      records: [{ Package2ContainerOptions: type }],
    });

  beforeEach(async () => {
    stubContext($$);
    await $$.stubAuths(testOrg);
    connection = await testOrg.getConnection();
    toolingCreateStub = $$.SANDBOX.stub(connection.tooling, 'create').resolves(pkgInstallRequest);
    lifecycleStub = $$.SANDBOX.stub(Lifecycle.prototype, 'emit');

    // This is for the getPackageTypeBy04t query
    queryStub = stubGetPackageTypeBy04tQuery();
  });

  afterEach(() => {
    restoreContext($$);
  });

  it('should send install request and get status (async)', async () => {
    const inProgressPIR = Object.assign({}, pkgInstallResult, { Status: 'IN_PROGRESS' });
    queryStub?.restore();
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve')
      .onFirstCall()
      .resolves(inProgressPIR)
      .onSecondCall()
      .resolves(inProgressPIR);
    otherQueryStub = $$.SANDBOX.stub(connection.tooling, 'query').resolves(
      subscriberPackageVersion as QueryResult<PackagingSObjects.SubscriberPackageVersion>
    );
    const pkg = new SubscriberPackageVersion({ aliasOrId: myPackageVersion04t, connection, password: null });
    const result = await pkg.install(pkgInstallCreateRequest);

    // verify correct connection.tooling.create() call
    expect(toolingCreateStub.calledOnce).to.be.true;
    const createArgs = toolingCreateStub.args[0];
    expect(createArgs[0]).to.equal('PackageInstallRequest');
    const expectedRequest = Object.assign({}, pkgInstallCreateRequest, pkgInstallCreateRequestDefaults);
    expect(createArgs[1]).to.deep.equal(expectedRequest);

    // verify correct connection.tooling.retrieve() calls
    expect(retrieveStub.calledTwice).to.be.true;
    const retrieveArgs = retrieveStub.args[0];
    expect(retrieveArgs[0]).to.equal('PackageInstallRequest');
    expect(retrieveArgs[1]).to.equal('0Hf1h0000006runCAA');

    // verify expected return json
    expect(result).to.deep.equal(inProgressPIR);

    expect(lifecycleStub.calledTwice).to.be.true;
    expect(lifecycleStub.args[0][1]).to.deep.equal(expectedRequest);
    expect(lifecycleStub.args[1][0]).to.equal('Package/install-postsend');
    expect(otherQueryStub.called).to.be.true;
  });

  it('should send install request and poll status (sync)', async () => {
    const inProgressPIR = Object.assign({}, pkgInstallResult, { Status: 'IN_PROGRESS' });
    const successPIR = Object.assign({}, pkgInstallResult);
    otherQueryStub?.restore();
    queryStub.restore();
    otherQueryStub = $$.SANDBOX.stub(connection.tooling, 'query')
      .onFirstCall()
      .resolves(subscriberPackageVersion as QueryResult<PackagingSObjects.SubscriberPackageVersion>)
      .onSecondCall()
      .resolves({
        done: false,
        totalSize: 0,
        records: [{ InstallValidationStatus: 'PACKAGE_UNAVAILABLE' }],
      })
      .onThirdCall()
      .resolves({
        done: false,
        totalSize: 0,
        records: [{ InstallValidationStatus: 'NO_ERRORS_DETECTED' }],
      });
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve')
      .onFirstCall()
      .resolves(inProgressPIR)
      .onSecondCall()
      .resolves(inProgressPIR)
      .onThirdCall()
      .resolves(successPIR);

    const pkg = new SubscriberPackageVersion({ aliasOrId: myPackageVersion04t, connection, password: null });
    const installOptions: PackageInstallOptions = {
      pollingFrequency: Duration.seconds(1),
      pollingTimeout: Duration.seconds(10),
    };
    const result = await pkg.install(pkgInstallCreateRequest, installOptions);

    expect(toolingCreateStub.calledOnce).to.be.true;

    // verify we polled
    expect(retrieveStub.calledThrice).to.be.true;
    expect(lifecycleStub.callCount).to.equal(3);
    expect(lifecycleStub.args[0][0]).to.equal('Package/install-presend');
    const expectedRequest = Object.assign({}, pkgInstallCreateRequest, pkgInstallCreateRequestDefaults);
    expect(lifecycleStub.args[0][1]).to.deep.equal(expectedRequest);
    expect(lifecycleStub.args[1][0]).to.equal('Package/install-postsend');
    expect(lifecycleStub.args[1][1]).to.deep.equal(pkgInstallRequest);
    expect(lifecycleStub.args[2][0]).to.equal('Package/install-status');
    expect(lifecycleStub.args[2][1]).to.deep.equal(pkgInstallResult);

    // verify expected return json
    expect(result).to.deep.equal(successPIR);
  });
  it('should send install request, wait for publish and poll status (sync)', async () => {
    const inProgressPIR = Object.assign({}, pkgInstallResult, { Status: 'IN_PROGRESS' });
    const successPIR = Object.assign({}, pkgInstallResult);
    otherQueryStub?.restore();
    queryStub.restore();
    queryStub = $$.SANDBOX.stub(connection.tooling, 'query').resolves(subscriberPackageVersion);
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve')
      .onFirstCall()
      .resolves(inProgressPIR)
      .onSecondCall()
      .resolves(inProgressPIR)
      .onThirdCall()
      .resolves(successPIR);

    otherQueryStub = $$.SANDBOX.stub(connection, 'singleRecordQuery')
      .onFirstCall()
      .resolves(subscriberPackageVersion.records[0]);

    const pkg = new SubscriberPackageVersion({ aliasOrId: myPackageVersion04t, connection, password: null });
    const installOptions: PackageInstallOptions = {
      publishFrequency: Duration.milliseconds(5000),
      publishTimeout: Duration.seconds(10),
      pollingFrequency: Duration.seconds(1),
      pollingTimeout: Duration.seconds(10),
    };
    const result = await pkg.install(pkgInstallCreateRequest, installOptions);

    expect(toolingCreateStub.calledOnce).to.be.true;

    const expectedRequest = Object.assign({}, pkgInstallCreateRequest, pkgInstallCreateRequestDefaults);

    // verify we polled
    expect(retrieveStub.calledThrice).to.be.true;
    expect(lifecycleStub.callCount).to.equal(5);
    expect(lifecycleStub.args[0][0]).to.equal('Package/install-subscriber-status');
    expect(lifecycleStub.args[0][1]).to.deep.equal('NO_ERRORS_DETECTED');
    expect(lifecycleStub.args[1][0]).to.equal('Package/install-presend');
    expect(lifecycleStub.args[1][1]).to.deep.equal(expectedRequest);
    expect(lifecycleStub.args[2][0]).to.equal('Package/install-postsend');
    expect(lifecycleStub.args[2][1]).to.deep.equal(pkgInstallRequest);
    expect(lifecycleStub.args[3][0]).to.equal('Package/install-subscriber-status');
    expect(lifecycleStub.args[3][1]).to.deep.equal('NO_ERRORS_DETECTED');
    expect(lifecycleStub.args[4][0]).to.equal('Package/install-status');
    expect(lifecycleStub.args[4][1]).to.deep.equal(pkgInstallResult);

    // verify expected return json
    expect(result).to.deep.equal(successPIR);
  });

  it('should get install request', async () => {
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve').onFirstCall().resolves(pkgInstallResult);

    const result = await SubscriberPackageVersion.getInstallRequest('0Hf1h0000006runCAA', connection);
    expect(result).to.deep.equal(pkgInstallResult);
  });
  it('should throw package install request not found error', async () => {
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve').onFirstCall().resolves(undefined);

    try {
      await SubscriberPackageVersion.getInstallRequest('0Hf1h0000006runCAA', connection);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e.message).to.include('The provided package install request ID: [0Hf1h0000006runCAA] could not be found');
    }
  });
  it('should throw invalid id error', async () => {
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve').onFirstCall().resolves(undefined);

    try {
      await SubscriberPackageVersion.getInstallRequest('04t1h0000006runCAA', connection);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e.message).to.include('The provided package install request ID: [04t1h0000006runCAA] is invalid');
    }
  });
  it('should get external sites', async () => {
    const sites = ['foo/bar', 'baz/nib', 'blah/yadda'];
    const RemoteSiteSettings = { settings: [{ url: sites[0] }, { url: sites[1] }] };
    const CspTrustedSites = { settings: [{ endpointUrl: sites[2] }] };
    const queryError = new Error('Implementation restriction: You can only perform queries of the form Id');
    queryError.name = 'MALFORMED_QUERY';
    queryStub.restore();
    queryStub = $$.SANDBOX.stub(connection, 'singleRecordQuery')
      .onFirstCall()
      .resolves({ ...subscriberPackageVersion.records[0], ...{ RemoteSiteSettings, CspTrustedSites } });

    const pkg = new SubscriberPackageVersion({ aliasOrId: myPackageVersion04t, connection, password: null });
    const externalSites = await pkg.getExternalSites();

    expect(queryStub.calledOnce).to.be.true;
    expect(externalSites).to.deep.equal(sites);
  });

  it('should return undefined for no external sites', async () => {
    const installKey = '123456';
    queryStub.restore();
    queryStub = $$.SANDBOX.stub(connection, 'singleRecordQuery')
      .onFirstCall()
      .resolves(subscriberPackageVersion.records[0]);

    const pkg = new SubscriberPackageVersion({ aliasOrId: myPackageVersion04t, connection, password: installKey });
    const externalSites = await pkg.getExternalSites();

    expect(queryStub.calledOnce).to.be.true;
    expect(externalSites).to.be.undefined;
  });

  it('should emit warnings for UpgradeType and ApexCompileType of non-unlocked package types', async () => {
    const inProgressPIR = Object.assign({}, pkgInstallResult, { Status: 'IN_PROGRESS' });
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve')
      .onFirstCall()
      .resolves(inProgressPIR)
      .onSecondCall()
      .resolves(inProgressPIR);
    $$.SANDBOX.stub(SubscriberPackageVersion.prototype, 'getPackageType').resolves('Managed');
    const overrides = { UpgradeType: 'deprecate-only', ApexCompileType: 'package' };
    const picRequest = Object.assign({}, pkgInstallCreateRequest, overrides);
    const pkg = new SubscriberPackageVersion({ aliasOrId: myPackageVersion04t, connection, password: null });
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
    expect(retrieveStub.calledTwice).to.be.true;
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
  });

  it('should NOT emit warnings for UpgradeType and ApexCompileType of unlocked package types', async () => {
    $$.SANDBOX.stub(SubscriberPackageVersion.prototype, 'getPackageType').resolves('Unlocked');
    const overrides = { UpgradeType: 'deprecate-only', ApexCompileType: 'package' };
    const inProgressPIR = Object.assign({}, pkgInstallResult, { Status: 'IN_PROGRESS' }, overrides);
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve')
      .onFirstCall()
      .resolves(inProgressPIR)
      .onSecondCall()
      .resolves(inProgressPIR);
    const picRequest = Object.assign({}, pkgInstallCreateRequest, pkgInstallCreateRequestDefaults, overrides);
    const pkg = new SubscriberPackageVersion({ aliasOrId: myPackageVersion04t, connection, password: null });
    const result = await pkg.install(picRequest);

    // verify correct connection.tooling.create() call
    expect(toolingCreateStub.calledOnce).to.be.true;
    const createArgs = toolingCreateStub.args[0];
    expect(createArgs[0]).to.equal('PackageInstallRequest');
    expect(createArgs[1]).to.deep.equal(picRequest);

    // verify correct connection.tooling.retrieve() calls
    expect(retrieveStub.calledTwice).to.be.true;
    const retrieveArgs = retrieveStub.args[0];
    expect(retrieveArgs[0]).to.equal('PackageInstallRequest');
    expect(retrieveArgs[1]).to.equal(pkgInstallRequestId);

    // verify expected return json
    expect(result).to.deep.equal(inProgressPIR);

    // verify all lifecycle events fired
    expect(lifecycleStub.callCount).to.equal(2);
    expect(lifecycleStub.args[0][0]).to.equal('Package/install-presend');
    expect(lifecycleStub.args[1][0]).to.equal('Package/install-postsend');
  });

  it('should report polling timeout', async () => {
    const queryResult = { InstallValidationStatus: 'PACKAGE_UNAVAILABLE' };
    queryStub.restore();
    queryStub = $$.SANDBOX.stub(connection.tooling, 'query').resolves({
      done: true,
      totalSize: 1,
      records: [{ InstallValidationStatus: 'PACKAGE_UNAVAILABLE' }],
    });
    const millis5 = Duration.milliseconds(5);
    const millis50 = Duration.milliseconds(50);

    const subscriberPackageVersionKey = pkgInstallCreateRequest.SubscriberPackageVersionKey;
    try {
      await SubscriberPackageVersion.installStatus(
        connection,
        subscriberPackageVersionKey,
        pkgInstallCreateRequest.Password,
        {
          publishFrequency: millis5,
          publishTimeout: millis50,
          pollingFrequency: millis5,
          pollingTimeout: millis50,
        }
      );
      expect(false, 'Expected timeout error to be thrown').to.be.true;
    } catch (err) {
      expect(err.name).to.equal('SubscriberPackageVersionNotPublishedError');
      expect(err.data).to.deep.equal(queryResult);
    }

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
