/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as path from 'path';
import * as fs from 'fs';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { expect } from 'chai';
import { Connection, Lifecycle, Messages, SfProject } from '@salesforce/core';
import { SaveResult } from 'jsforce';
import { Duration } from '@salesforce/kit';
import { PackageVersion, isErrorPackageNotAvailable, isErrorFromSPVQueryRestriction } from '../../src/package';
import { PackagingSObjects, PackageInstallCreateRequest, PackageInstallOptions } from '../../src/interfaces';
import Package2Version = PackagingSObjects.Package2Version;
import PackageInstallRequest = PackagingSObjects.PackageInstallRequest;
import Package2 = PackagingSObjects.Package2;

const myPackageVersion04t = '04t6A0000000X0UQAU';
const myPackageVersion05i = '05i6A0000000X0UQAU';
const myPackage = '0Ho6A0000000X0UQAU';

async function setupProject(setup: (project: SfProject) => void = () => {}) {
  // @ts-ignore
  const project: SfProject = new SfProject('a');
  const packageDirectories = [
    {
      path: 'force-app',
      default: true,
      package: myPackage,
    },
  ];
  const packageAliases = { myPackage, myPackageVersion: myPackageVersion04t };
  project.getSfProjectJson().set('packageDirectories', packageDirectories);
  project.getSfProjectJson().set('packageAliases', packageAliases);
  setup(project);
  const projectDir = project.getPath();
  project
    .getSfProjectJson()
    .getContents()
    .packageDirectories?.forEach((dir) => {
      if (dir.path) {
        const packagePath = path.join(projectDir, dir.path);
        fs.mkdirSync(packagePath, { recursive: true });
      }
    });

  return project;
}

describe('Package Install', () => {
  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();
  let connection: Connection;
  let toolingCreateStub: sinon.SinonStub;
  let retrieveStub: sinon.SinonStub;
  let lifecycleStub: sinon.SinonStub;
  let queryStub: sinon.SinonStub;
  let project: SfProject;

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

  const package2: Package2 = {
    ContainerOptions: 'Managed',
    ConvertedFromPackageId: '',
    CreatedById: '',
    CreatedDate: 0,
    Description: '',
    Id: myPackage,
    IsDeleted: false,
    IsDeprecated: false,
    IsOrgDependent: false,
    LastModifiedById: '',
    LastModifiedDate: 0,
    Name: '',
    NamespacePrefix: '',
    PackageErrorUsername: '',
    SubscriberPackageId: '',
    SystemModstamp: 0,
  };

  const package2Version: Package2Version = {
    AncestorId: '',
    Branch: '',
    BuildDurationInSeconds: 0,
    BuildNumber: 0,
    CodeCoverage: undefined,
    CodeCoveragePercentages: undefined,
    ConvertedFromVersionId: '',
    CreatedById: '',
    CreatedDate: 0,
    Description: '',
    HasMetadataRemoved: false,
    HasPassedCodeCoverageCheck: false,
    Id: myPackageVersion05i,
    InstallKey: null,
    IsDeleted: false,
    IsDeprecated: false,
    IsPasswordProtected: false,
    IsReleased: false,
    LastModifiedById: '',
    LastModifiedDate: 0,
    MajorVersion: 0,
    MinorVersion: 0,
    Name: '',
    Package2Id: myPackage,
    PatchVersion: 0,
    ReleaseVersion: 0,
    SubscriberPackageVersionId: myPackageVersion04t,
    SystemModstamp: 0,
    Tag: '',
    ValidationSkipped: false,
  };

  const stubGetPackageTypeBy04tQuery = (type = 'Unlocked'): sinon.SinonStub => {
    return $$.SANDBOX.stub(connection.tooling, 'query').resolves({
      done: true,
      totalSize: 1,
      records: [{ Package2ContainerOptions: type }],
    });
  };

  beforeEach(async () => {
    stubContext($$);
    await $$.stubAuths(testOrg);
    connection = await testOrg.getConnection();
    toolingCreateStub = $$.SANDBOX.stub(connection.tooling, 'create').resolves(pkgCreateRequest);
    lifecycleStub = $$.SANDBOX.stub(Lifecycle.prototype, 'emit');

    // This is for the getPackageTypeBy04t query
    queryStub = stubGetPackageTypeBy04tQuery();
    $$.inProject(true);
    project = await setupProject();
  });

  afterEach(() => {
    restoreContext($$);
  });

  it('should send install request and get status (async)', async () => {
    const inProgressPIR = Object.assign({}, pkgInstallRequest, { Status: 'IN_PROGRESS' });
    queryStub.restore();
    queryStub = $$.SANDBOX.stub(connection, 'singleRecordQuery')
      .onFirstCall()
      .resolves({
        done: false,
        totalSize: 0,
        records: [package2],
      })
      .onSecondCall()
      .resolves({
        done: false,
        totalSize: 0,
        records: [package2Version],
      })
      .onThirdCall()
      .resolves({
        done: false,
        totalSize: 0,
        records: [{ ContainerOptions: 'Managed' }],
      });
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve')
      .onFirstCall()
      .resolves(inProgressPIR)
      .onSecondCall()
      .resolves(inProgressPIR);
    const pkg = new PackageVersion({ idOrAlias: myPackageVersion04t, project, connection });
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
    expect(queryStub.called).to.be.true;
  });

  it('should send install request and poll status (sync)', async () => {
    const inProgressPIR = Object.assign({}, pkgInstallRequest, { Status: 'IN_PROGRESS' });
    const successPIR = Object.assign({}, pkgInstallRequest);
    queryStub.restore();
    queryStub = $$.SANDBOX.stub(connection, 'singleRecordQuery')
      .onFirstCall()
      .resolves({
        done: false,
        totalSize: 0,
        records: [package2],
      })
      .onSecondCall()
      .resolves({
        done: false,
        totalSize: 0,
        records: [package2Version],
      })
      .onThirdCall()
      .resolves({
        done: false,
        totalSize: 0,
        records: [{ ContainerOptions: 'Managed' }],
      });
    queryStub = $$.SANDBOX.stub(connection.tooling, 'query')
      .onFirstCall()
      .resolves({
        done: false,
        totalSize: 0,
        records: [{ InstallValidationStatus: 'PACKAGE_UNAVAILABLE' }],
      })
      .onSecondCall()
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

    const pkg = new PackageVersion({ idOrAlias: myPackageVersion04t, project, connection });
    const installOptions: PackageInstallOptions = {
      pollingFrequency: Duration.seconds(1),
      pollingTimeout: Duration.seconds(10),
    };
    const result = await pkg.install(pkgInstallCreateRequest, installOptions);

    expect(toolingCreateStub.calledOnce).to.be.true;

    // verify we polled
    expect(retrieveStub.calledThrice).to.be.true;
    expect(lifecycleStub.callCount).to.equal(5);
    expect(lifecycleStub.args[0][0]).to.equal('Package/install-presend');
    const expectedRequest = Object.assign({}, pkgInstallCreateRequest, pkgInstallCreateRequestDefaults);
    expect(lifecycleStub.args[0][1]).to.deep.equal(expectedRequest);
    expect(lifecycleStub.args[1][0]).to.equal('Package/install-postsend');
    expect(lifecycleStub.args[1][1]).to.deep.equal(pkgCreateRequest);
    expect(lifecycleStub.args[2][0]).to.equal('Package/install-subscriber-status');
    expect(lifecycleStub.args[2][1]).to.deep.equal('PACKAGE_UNAVAILABLE');
    expect(lifecycleStub.args[3][0]).to.equal('Package/install-subscriber-status');
    expect(lifecycleStub.args[3][1]).to.deep.equal('PACKAGE_UNAVAILABLE');
    expect(lifecycleStub.args[4][0]).to.equal('Package/install-subscriber-status');
    expect(lifecycleStub.args[4][1]).to.deep.equal('NO_ERRORS_DETECTED');

    // verify expected return json
    expect(result).to.deep.equal(successPIR);
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
      .resolves({
        done: true,
        totalSize: 1,
        records: [package2Version],
      })
      .onSecondCall()
      .throws(queryError)
      .onThirdCall()
      .resolves({
        done: true,
        totalSize: 1,
        records: [{ RemoteSiteSettings, CspTrustedSites }],
      });

    const pkg = new PackageVersion({ idOrAlias: myPackageVersion04t, connection, project });
    const SubscriberPackageVersionKey = pkgInstallCreateRequest.SubscriberPackageVersionKey;
    const externalSites = await pkg.getExternalSites();

    expect(queryStub.calledThrice).to.be.true;
    expect(queryStub.args[1][0]).to.equal(
      `SELECT RemoteSiteSettings, CspTrustedSites FROM SubscriberPackageVersion WHERE Id ='${SubscriberPackageVersionKey}' AND InstallationKey ='null'`
    );
    expect(queryStub.args[2][0]).to.equal(
      `SELECT RemoteSiteSettings, CspTrustedSites FROM SubscriberPackageVersion WHERE Id ='${SubscriberPackageVersionKey}'`
    );
    expect(externalSites).to.deep.equal(sites);
  });

  it('should return undefined for no external sites', async () => {
    const installKey = '123456';
    queryStub.restore();
    queryStub = $$.SANDBOX.stub(connection.tooling, 'query')
      .onFirstCall()
      .resolves({
        done: true,
        totalSize: 1,
        records: [package2Version],
      })
      .onSecondCall()
      .resolves({
        done: true,
        totalSize: 0,
        records: null,
      });

    const pkg = new PackageVersion({ idOrAlias: myPackageVersion04t, connection, project });
    const SubscriberPackageVersionKey = pkgInstallCreateRequest.SubscriberPackageVersionKey;
    const externalSites = await pkg.getExternalSites(installKey);

    expect(queryStub.calledTwice).to.be.true;
    expect(queryStub.args[1][0]).to.equal(
      `SELECT RemoteSiteSettings, CspTrustedSites FROM SubscriberPackageVersion WHERE Id ='${SubscriberPackageVersionKey}' AND InstallationKey ='${installKey}'`
    );
    expect(externalSites).to.be.undefined;
  });

  it('should emit warnings for UpgradeType and ApexCompileType of non-unlocked package types', async () => {
    const inProgressPIR = Object.assign({}, pkgInstallRequest, { Status: 'IN_PROGRESS' });
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve')
      .onFirstCall()
      .resolves(inProgressPIR)
      .onSecondCall()
      .resolves(inProgressPIR);
    $$.SANDBOX.stub(PackageVersion.prototype, 'getPackageType').resolves('Managed');
    const overrides = { UpgradeType: 'deprecate-only', ApexCompileType: 'package' };
    const picRequest = Object.assign({}, pkgInstallCreateRequest, overrides);
    const pkg = new PackageVersion({ idOrAlias: myPackageVersion04t, connection, project });
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
    const overrides = { UpgradeType: 'deprecate-only', ApexCompileType: 'package' };
    const inProgressPIR = Object.assign({}, pkgInstallRequest, { Status: 'IN_PROGRESS' }, overrides);
    retrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve').onFirstCall().resolves(inProgressPIR);
    const picRequest = Object.assign({}, pkgInstallCreateRequest, pkgInstallCreateRequestDefaults, overrides);
    const pkg = new PackageVersion({ idOrAlias: myPackageVersion04t, connection, project });
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
    const pkg = new PackageVersion({ idOrAlias: myPackageVersion04t, connection, project });
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
    const queryResult = { InstallValidationStatus: 'PACKAGE_UNAVAILABLE' };
    queryStub.restore();
    queryStub = $$.SANDBOX.stub(connection.tooling, 'retrieve').resolves(queryResult);
    const millis5 = Duration.milliseconds(5);
    const millis50 = Duration.milliseconds(50);
    const millisStub = $$.SANDBOX.stub(Duration, 'milliseconds').callsFake(() => millis5);

    const pkg = new PackageVersion({ idOrAlias: myPackageVersion04t, connection, project });
    const SubscriberPackageVersionKey = pkgInstallCreateRequest.SubscriberPackageVersionKey;
    try {
      await pkg.getInstallStatus(SubscriberPackageVersionKey, null, { pollingTimeout: millis50 });
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
