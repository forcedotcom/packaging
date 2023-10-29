/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { Connection, SfProject } from '@salesforce/core';
import { expect } from 'chai';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { Optional } from '@salesforce/ts-types';
import { SubscriberPackageVersion } from '../../src/package';
import { PackagingSObjects } from '../../src/interfaces';

const oThreeThree = '033xxxxxxxxxxxxxxx';
const oFourT = '04txxxxxxxxxxxxxxx';
const spvRecord: Partial<PackagingSObjects.SubscriberPackageVersion> = {
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

async function setupProject(setup: (project: SfProject) => void = () => {}) {
  const project = await SfProject.resolve();
  const packageDirectories = [
    {
      path: 'force-app',
      default: true,
    },
  ];
  const packageAliases = {};
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

describe('subscriberPackageVersion', () => {
  const testOrg = new MockTestOrgData();
  const password: Optional<string> = undefined;
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
    const subscriberPackageVersion = new SubscriberPackageVersion({ connection, aliasOrId: id, password });

    expect(subscriberPackageVersion).to.be.an.instanceOf(SubscriberPackageVersion);
  });
  it('should instantiate SPV using 04t alias', async () => {
    $$.inProject(true);
    await setupProject((project) => {
      project.getSfProjectJson().set('packageAliases', { oFourT });
    });
    connection = await testOrg.getConnection();

    const subscriberPackageVersion = new SubscriberPackageVersion({ connection, aliasOrId: 'oFourT', password });

    expect(subscriberPackageVersion).to.be.an.instanceOf(SubscriberPackageVersion);
  });
  it('should not instantiate SPV using 05i', async () => {
    connection = await testOrg.getConnection();

    const id = '05ixxxxxxxxxxxxxxx';

    expect(() => new SubscriberPackageVersion({ connection, aliasOrId: id, password })).to.throw(
      `Invalid alias or ID: ${id}. Either your alias is invalid or undefined, or the ID (04t) provided is invalid.`
    );
  });
  it('should not instantiate SPV using 05i alias', async () => {
    $$.inProject(true);
    await setupProject((project) => {
      project.getSfProjectJson().set('packageAliases', { oFiveI: '05ixxxxxxxxxxxxxxx' });
    });
    connection = await testOrg.getConnection();

    expect(() => new SubscriberPackageVersion({ connection, aliasOrId: 'oFiveI', password })).to.throw(
      'Invalid alias or ID: oFiveI. Either your alias is invalid or undefined, or the ID (04t) provided is invalid.'
    );
  });
  it('should lazily query for the SPV', async () => {
    connection = await testOrg.getConnection();

    const id = oFourT;
    const subscriberPackageVersion = new SubscriberPackageVersion({ connection, aliasOrId: id, password });
    queryStub = $$.SANDBOX.stub(connection, 'singleRecordQuery').resolves(spvRecord);
    expect(queryStub.called).to.be.false;
    const pkgType = await subscriberPackageVersion.getPackageType();
    expect(queryStub.called).to.be.true;
    expect(pkgType).to.equal('Managed');
  });
  it('should fail the lazily query an unknown SPV', async () => {
    connection = await testOrg.getConnection();

    const id = '04txxxxxxxxxxxxxxy';
    const subscriberPackageVersion = new SubscriberPackageVersion({ connection, aliasOrId: id, password });
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
    const id = oFourT;
    beforeEach(async () => {
      connection = await testOrg.getConnection();
    });
    it('should only query low cost fields', async () => {
      const subscriberPackageVersion = new SubscriberPackageVersion({ connection, aliasOrId: id, password });
      // @ts-ignore
      const queryFields = subscriberPackageVersion.getFieldsForQuery({});
      expect(queryFields).to.ok;
      expect(queryFields.length).to.greaterThan(0);
      expect(queryFields).to.not.include('RemoteSiteSettings');
      expect(queryFields).to.include('Id');
    });
    it('should query all fields', async () => {
      const subscriberPackageVersion = new SubscriberPackageVersion({ connection, aliasOrId: id, password });
      // @ts-ignore
      const queryFields = subscriberPackageVersion.getFieldsForQuery({ includeHighCostFields: true });
      expect(queryFields).to.ok;
      expect(queryFields.length).to.greaterThan(0);
      expect(queryFields).to.include('RemoteSiteSettings');
      expect(queryFields).to.include('Id');
    });
    it('should force query of low cost fields', async () => {
      const subscriberPackageVersion = new SubscriberPackageVersion({ connection, aliasOrId: id, password });
      // @ts-ignore
      const queryFields = subscriberPackageVersion.getFieldsForQuery({ force: true });
      expect(queryFields).to.ok;
      expect(queryFields.length).to.greaterThan(0);
      expect(queryFields).to.not.include('RemoteSiteSettings');
      expect(queryFields).to.include('Id');
    });
  });
});
