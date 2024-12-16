/*
 * Copyright (c) 2024, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import path from 'node:path';
import fs from 'node:fs';
import { Connection, SfProject } from '@salesforce/core';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { PackagePushRequestListQueryOptions, PackagingSObjects } from '../../src/interfaces';
import { PackagePushUpgrade } from '../../src/package';

describe('Package Push Upgrade', async () => {
  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();
  const packageId = '0Ho3i000000Gmj6XXX';
  let connection: Connection;
  let project: SfProject;
  let queryStub: sinon.SinonStub;

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

  beforeEach(async () => {
    $$.inProject(true);
    project = SfProject.getInstance();
    project.getSfProjectJson().set('packageDirectories', [
      {
        path: 'pkg',
        package: 'DEP',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: false,
      },
      {
        path: 'force-app',
        package: 'TEST',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: true,
        ancestorId: 'TEST2',
        unpackagedMetadata: {
          path: 'unpackaged',
        },
        seedMetadata: {
          path: 'seed',
        },
        dependencies: [
          {
            package: 'DEP@0.1.0-1',
          },
        ],
      },
    ]);
    project.getSfProjectJson().set(
      'packageAliases',

      {
        TEST: packageId,
        TEST2: '05i3i000000Gmj6XXX',
        DEP: '0Ho4J000000TNmPXXX',
        'DEP@0.1.0-1': '04t3i000002eyYXXXX',
      }
    );
    await project.getSfProjectJson().write();
    await fs.promises.mkdir(path.join(project.getPath(), 'force-app'));
    stubContext($$);
    await $$.stubAuths(testOrg);
    connection = await testOrg.getConnection();
    $$.SANDBOX.stub(connection.tooling, 'query')
      .onFirstCall() // @ts-ignore
      .resolves({ records: [{ Id: '05i3i000000Gmj6XXX' }] }) // @ts-ignore
      .resolves({ records: [{}] });
    $$.SANDBOX.stub(connection.tooling, 'create').resolves({
      id: '123',
      success: true,
      errors: [],
    });
  });

  afterEach(async () => {
    restoreContext($$);
    await fs.promises.rm(path.join(project.getPath(), 'force-app'), { recursive: true, force: true });
    // @ts-ignore
    project.packageDirectories = undefined;
  });

  it('should package push request list command fail with invalid packageId', async () => {
    const listQueryOptions: PackagePushRequestListQueryOptions = {
      packageId: '033xxx',
      status: 'Failed',
    };
    const result = await PackagePushUpgrade.list(connection, listQueryOptions);
    expect(result).to.eql([
      {
        PushRequestId: undefined,
        PackageVersionId: undefined,
        PushRequestStatus: undefined,
        PushRequestScheduledDateTime: 'test',
        NumOrgsScheduled: 0,
        NumOrgsUpgradedFail: 0,
        NumOrgsUpgradedSuccess: 0,
      },
    ]);
  });

  it('should package push request list command success with valid packageId', async () => {
    queryStub = $$.SANDBOX.stub(connection, 'singleRecordQuery').resolves(spvRecord);
    expect(queryStub.called).to.be.false;
    const listQueryOptions: PackagePushRequestListQueryOptions = {
      packageId: oThreeThree,
    };
    const result = await PackagePushUpgrade.list(connection, listQueryOptions);

    // This is currently undefined since push upgrade set up hasn't been written yet
    expect(result).to.eql([
      {
        PushRequestId: undefined,
        PackageVersionId: undefined,
        PushRequestStatus: undefined,
        PushRequestScheduledDateTime: 'test',
        NumOrgsScheduled: 0,
        NumOrgsUpgradedFail: 0,
        NumOrgsUpgradedSuccess: 0,
      },
    ]);
  });
});
