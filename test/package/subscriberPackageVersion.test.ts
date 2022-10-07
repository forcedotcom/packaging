/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Connection } from '@salesforce/core';
import { expect } from 'chai';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { SubscriberPackageVersion } from '../../src/package/subscriberPackageVersion';
import { PackagingSObjects } from '../../src/interfaces';

const oThreeThree = '033xxxxxxxxxxxxxxx';
const oFourT = '04txxxxxxxxxxxxxxx';
const spvRecord: PackagingSObjects.SubscriberPackageVersion = {
  AppExchangeDescription: '',
  AppExchangeLogoUrl: '',
  AppExchangePackageName: '',
  AppExchangePublisherName: '',
  BuildNumber: 0,
  CspTrustedSites: undefined,
  Dependencies: undefined,
  Description: '',
  Id: oFourT,
  InstallValidationStatus: 'NO_ERRORS_DETECTED',
  IsBeta: false,
  IsDeprecated: false,
  IsManaged: false,
  IsOrgDependent: false,
  IsPasswordProtected: false,
  IsSecurityReviewed: false,
  MajorVersion: 1,
  MinorVersion: 1,
  Name: '',
  Package2ContainerOptions: 'Managed',
  PatchVersion: 0,
  PostInstallUrl: '',
  Profiles: undefined,
  PublisherName: '',
  ReleaseNotesUrl: '',
  ReleaseState: '',
  RemoteSiteSettings: undefined,
  SubscriberPackageId: oThreeThree,
};

describe('subscriberPackageVersion', () => {
  const testOrg = new MockTestOrgData();
  const password = null;
  let connection: Connection;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // @ts-ignore
  let queryStub: sinon.SinonStub;
  const $$ = instantiateContext();

  beforeEach(async () => {
    stubContext($$);
    await $$.stubAuths(testOrg);
    connection = await testOrg.getConnection();
    queryStub = $$.SANDBOX.stub(connection.tooling, 'query');
  });

  afterEach(() => {
    restoreContext($$);
  });

  it('should instantiate SPV using 04t', async () => {
    connection = await testOrg.getConnection();

    const id = oFourT;
    const subscriberPackageVersion = new SubscriberPackageVersion({ connection, id, password });

    expect(subscriberPackageVersion).to.be.an.instanceOf(SubscriberPackageVersion);
  });
  it('should not instantiate SPV using 05i', async () => {
    connection = await testOrg.getConnection();

    const id = '05ixxxxxxxxxxxxxxx';

    expect(() => new SubscriberPackageVersion({ connection, id, password })).to.throw(
      `The provided ID: [${id}] is not a subscriber package version ID (04t).`
    );
  });
  it('should lazily query for the SPV', async () => {
    connection = await testOrg.getConnection();

    const id = oFourT;
    const subscriberPackageVersion = new SubscriberPackageVersion({ connection, id, password });
    queryStub = $$.SANDBOX.stub(connection, 'singleRecordQuery').resolves(spvRecord);
    expect(queryStub.called).to.be.false;
    const pkgType = await subscriberPackageVersion.getPackageType();
    expect(queryStub.called).to.be.true;
    expect(pkgType).to.equal('Managed');
  });
  it('should fail the lazily query an unknown SPV', async () => {
    connection = await testOrg.getConnection();

    const id = '04txxxxxxxxxxxxxxy';
    const subscriberPackageVersion = new SubscriberPackageVersion({ connection, id, password });
    queryStub = $$.SANDBOX.stub(connection, 'singleRecordQuery').throws('No record found');
    expect(queryStub.called).to.be.false;
    try {
      await subscriberPackageVersion.getPackageType();
      expect.fail('should have thrown an error');
    } catch (e) {
      const error = e as Error;
      expect(error.message).to.match(
        /The subscriber package version 04txxxxxxxxxxxxxxy is invalid, no subscriber package version record found/,
        error.message
      );
      expect(queryStub.called).to.be.true;
    }
  });
  describe('getQueryFields', () => {
    let connection: Connection;

    const id = oFourT;
    beforeEach(async () => {
      connection = await testOrg.getConnection();
    });
    it('should only query low cost fields', async () => {
      const subscriberPackageVersion = new SubscriberPackageVersion({ connection, id, password });
      // @ts-ignore
      const queryFields = subscriberPackageVersion.getFieldsForQuery({});
      expect(queryFields).to.ok;
      expect(queryFields.length).to.greaterThan(0);
      expect(queryFields).to.not.include('RemoteSiteSettings');
      expect(queryFields).to.include('Id');
    });
    it('should query all fields', async () => {
      const subscriberPackageVersion = new SubscriberPackageVersion({ connection, id, password });
      // @ts-ignore
      const queryFields = subscriberPackageVersion.getFieldsForQuery({ includeHighCostFields: true });
      expect(queryFields).to.ok;
      expect(queryFields.length).to.greaterThan(0);
      expect(queryFields).to.include('RemoteSiteSettings');
      expect(queryFields).to.include('Id');
    });
    it('should force query of low cost fields', async () => {
      const subscriberPackageVersion = new SubscriberPackageVersion({ connection, id, password });
      // @ts-ignore
      const queryFields = subscriberPackageVersion.getFieldsForQuery({ force: true });
      expect(queryFields).to.ok;
      expect(queryFields.length).to.greaterThan(0);
      expect(queryFields).to.not.include('RemoteSiteSettings');
      expect(queryFields).to.include('Id');
    });
    it('should not query low cost field Id (already read)', async () => {
      const subscriberPackageVersion = new SubscriberPackageVersion({ connection, id, password });
      Reflect.set(subscriberPackageVersion, 'fieldsRead', new Set<string>(['Id']));
      // @ts-ignore
      const queryFields = subscriberPackageVersion.getFieldsForQuery({});
      expect(queryFields).to.ok;
      expect(queryFields.length).to.greaterThan(0);
      expect(queryFields).to.not.include('RemoteSiteSettings');
      expect(queryFields).to.not.include('Id');
    });
    it('should query low cost field Id (already read) w/force', async () => {
      const subscriberPackageVersion = new SubscriberPackageVersion({ connection, id, password });
      Reflect.set(subscriberPackageVersion, 'fieldsRead', new Set<string>(['Id']));
      // @ts-ignore
      const queryFields = subscriberPackageVersion.getFieldsForQuery({ force: true });
      expect(queryFields).to.ok;
      expect(queryFields.length).to.greaterThan(0);
      expect(queryFields).to.not.include('RemoteSiteSettings');
      expect(queryFields).to.include('Id');
    });
  });
});
