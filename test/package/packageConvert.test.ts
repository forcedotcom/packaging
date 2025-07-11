/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'chai';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/testSetup';
import { Connection, Lifecycle, Messages } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import {
  convertPackage,
  createPackageVersionCreateRequest,
  findOrCreatePackage2,
} from '../../src/package/packageConvert';
import { PackageEvents } from '../../src/interfaces';
import { MetadataResolver } from '../../src/package/packageVersionCreate';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_version_create');

describe('packageConvert', () => {
  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();

  beforeEach(async () => {
    stubContext($$);
    await $$.stubAuths(testOrg);
  });

  afterEach(() => {
    restoreContext($$);
  });

  describe('createPackageVersionCreateRequest', () => {
    it('should return a valid request with installationkey and buildinstance', async () => {
      $$.inProject(true);
      const definitionFile = {
        orgName: 'test org name',
        edition: 'Developer',
        features: ['EnableSetPasswordInApi', 'PersonAccounts', 'MultiCurrency'],
        settings: {
          lightningExperienceSettings: {
            enableS1DesktopEnabled: true,
          },
          languageSettings: {
            enableTranslationWorkbench: true,
          },
        },
      };
      const packageVersTmpRoot = path.join(os.tmpdir(), 'config');
      await fs.promises.mkdir(packageVersTmpRoot, { recursive: true });
      const scratchDefPath = path.join(packageVersTmpRoot, 'scratch.json');
      await fs.promises.writeFile(scratchDefPath, JSON.stringify(definitionFile, undefined, 2));
      const request = await createPackageVersionCreateRequest(
        { installationkey: '123', definitionfile: scratchDefPath, buildinstance: 'myInstance', codecoverage: true },
        '0Ho3i000000Gmj6CAC',
        '54.0'
      );
      expect(request).to.have.all.keys(
        'CalculateCodeCoverage',
        'InstallKey',
        'Instance',
        'IsConversionRequest',
        'Package2Id',
        'VersionInfo'
      );
      expect(request.InstallKey).to.equal('123');
      expect(request.Instance).to.equal('myInstance');
      expect(request.IsConversionRequest).to.equal(true);
      expect(request.Package2Id).to.equal('0Ho3i000000Gmj6CAC');
      expect(request.CalculateCodeCoverage).to.equal(true);
      // the most we can assert about VersionInfo because it is a zip file string representation, which changes with time
      expect(typeof request.VersionInfo).to.equal('string');
    });

    it('should return a valid request', async () => {
      $$.inProject(true);
      const request = await createPackageVersionCreateRequest({}, '0Ho3i000000Gmj6CAC', '54.0');
      expect(request).to.have.all.keys(
        'CalculateCodeCoverage',
        'InstallKey',
        'Instance',
        'IsConversionRequest',
        'Package2Id',
        'VersionInfo'
      );
      expect(request.InstallKey).to.equal(undefined);
      expect(request.Instance).to.equal(undefined);
      expect(request.IsConversionRequest).to.equal(true);
      expect(request.Package2Id).to.equal('0Ho3i000000Gmj6CAC');
      expect(request.CalculateCodeCoverage).to.equal(false);
      // the most we can assert about VersionInfo because it is a zip file string representation, which changes with time
      expect(typeof request.VersionInfo).to.equal('string');
    });

    it('should return a valid request including seed metadata', async () => {
      $$.inProject(true);
      const hasSeedMdSpy = $$.SANDBOX.spy(MetadataResolver.prototype, 'resolveMetadata');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $$.SANDBOX.stub(MetadataResolver.prototype, 'generateMDFolderForArtifact' as any).resolves();
      $$.SANDBOX.stub(fs, 'existsSync').returns(true);

      const request = await createPackageVersionCreateRequest(
        { installationkey: '123', buildinstance: 'myInstance', seedmetadata: 'seed', codecoverage: false },
        '0Ho3i000000Gmj6CAC',
        '54.0'
      );
      expect(request).to.have.all.keys(
        'CalculateCodeCoverage',
        'InstallKey',
        'Instance',
        'IsConversionRequest',
        'Package2Id',
        'VersionInfo'
      );
      expect(request.InstallKey).to.equal('123');
      expect(request.Instance).to.equal('myInstance');
      expect(request.IsConversionRequest).to.equal(true);
      expect(request.Package2Id).to.equal('0Ho3i000000Gmj6CAC');
      expect(request.CalculateCodeCoverage).to.equal(false);
      // the most we can assert about VersionInfo because it is a zip file string representation, which changes with time
      expect(typeof request.VersionInfo).to.equal('string');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const seedMD = hasSeedMdSpy.firstCall.args[0];
      expect(seedMD).to.equal('seed');
    });

    it('should return error stating seed directory does not exist', async () => {
      $$.inProject(true);
      $$.SANDBOX.stub(fs, 'existsSync').returns(false);

      try {
        await createPackageVersionCreateRequest(
          { installationkey: '123', buildinstance: 'myInstance', seedmetadata: 'non-existent' },
          '0Ho3i000000Gmj6CAC',
          '54.0'
        );
      } catch (e) {
        expect((e as Error).message).to.include(
          'Seed metadata directory non-existent was specified but does not exist'
        );
      }
    });
  });

  describe('findOrCreatePackage2', () => {
    it('will error when more than one Package2 found', async () => {
      const conn = {
        tooling: {
          query: () => ({ records: [{ Id: '0Ho3i000000Gmj6YYY' }, { Id: '0Ho3i000000Gmj6XXX' }] }),
        },
      } as unknown as Connection;
      try {
        await findOrCreatePackage2('0Ho3i000000Gmj6CAC', conn);
      } catch (e) {
        expect((e as Error).message).to.include(
          'Only one package in a Dev Hub is allowed per converted from first-generation package, but the following were found:'
        );
        expect((e as Error).message).to.include('0Ho3i000000Gmj6YYY, 0Ho3i000000Gmj6XXX');
      }
    });

    it('will return the ID when one is found', async () => {
      const conn = {
        tooling: {
          query: () => ({ records: [{ Id: '0Ho3i000000Gmj6YYY' }] }),
        },
      } as unknown as Connection;

      const result = await findOrCreatePackage2('0Ho3i000000Gmj6CAC', conn);
      expect(result).to.equal('0Ho3i000000Gmj6YYY');
    });

    it('will create the Package2', async () => {
      const conn = await testOrg.getConnection();

      $$.SANDBOX.stub(conn.tooling, 'query')
        .onFirstCall()
        // @ts-ignore
        .resolves({ records: [] })
        .onSecondCall()
        // @ts-ignore
        .resolves({ records: [{ Id: '0Ho3i000000Gmj6YYY' }] });

      $$.SANDBOX.stub(conn.tooling, 'create').resolves({ errors: [], success: true, id: '0Ho3i000000Gmj6YYY' });

      const result = await findOrCreatePackage2('0Ho3i000000Gmj6CAC', conn);
      expect(result).to.equal('0Ho3i000000Gmj6YYY');
    });

    it('will fail to create the Package2', async () => {
      const conn = await testOrg.getConnection();

      $$.SANDBOX.stub(conn.tooling, 'query')
        .onFirstCall()
        // @ts-ignore
        .resolves({ records: [] })
        .onSecondCall()
        // @ts-ignore
        .resolves({ records: [{ Id: '0Ho3i000000Gmj6YYY' }] });
      $$.SANDBOX.stub(conn.tooling, 'create').resolves({
        errors: [{ errorCode: 'server error', message: 'server error' }],
        success: false,
        id: undefined,
      });

      try {
        await findOrCreatePackage2('0Ho3i000000Gmj6CAC', conn);
      } catch (e) {
        expect((e as Error).message).to.include('An error occurred during CRUD operation create on entity Package2');
        expect((e as Error).message).to.include('Error: server error Message: server error ');
      }
    });

    it('will error when no Subscriber Package was found', async () => {
      const conn = {
        tooling: {
          query: () => ({ records: [] }),
        },
      } as unknown as Connection;

      try {
        await findOrCreatePackage2('0Ho3i000000Gmj6CAC', conn);
      } catch (e) {
        expect((e as Error).message).to.include('No subscriber package was found for seed id: 0Ho3i000000Gmj6CAC');
      }
    });
  });
  it('will throw correct error when create call fails', async () => {
    const conn = await testOrg.getConnection();
    // @ts-ignore
    $$.SANDBOX.stub(conn.tooling, 'query').resolves({ records: [{ Id: '0Ho3i000000Gmj6YYY' }] });

    // @ts-ignore
    $$.SANDBOX.stub(conn.tooling, 'create').resolves({ success: undefined, errors: [new Error('server error')] });
    try {
      await convertPackage('0334p000000EaIHAA0', conn, {
        buildInstance: '',
        installationKey: '',
        definitionfile: '',
        installationKeyBypass: true,
        wait: Duration.minutes(1),
      });
    } catch (e) {
      expect((e as Error).message).to.include('Failed to create request : Error: server error');
    }
  });

  it('will convert the package', async () => {
    const conn = await testOrg.getConnection();

    const successResponse = {
      Branch: 'main',
      ConvertedFromVersionId: undefined,
      CreatedBy: undefined,
      CreatedDate: '2022-09-01 00:00',
      Error: [],
      HasMetadataRemoved: null,
      Id: '0Ho3i000000Gmj6YYY',
      Package2Id: '0Ho4p0000004DdnCAE',
      Package2Name: null,
      HasPassedCodeCoverageCheck: null,
      CodeCoverage: null,
      VersionNumber: null,
      Package2VersionId: '05i4p0000004H7lAAE',
      Status: 'Success',
      SubscriberPackageVersionId: null,
      Tag: 'tag',
      TotalNumberOfMetadataFiles: null,
      TotalSizeOfMetadataFiles: null,
    };

    Lifecycle.getInstance().on(PackageEvents.convert.progress, async (data) => {
      // eslint-disable-next-line no-console
      // @ts-ignore
      expect(data).to.deep.equal({
        id: '0Ho3i000000Gmj6YYY',
        message: '',
        packageVersionCreateRequestResult: {
          Branch: undefined,
          ConvertedFromVersionId: messages.getMessage('IdUnavailableWhenInProgress'),
          CreatedBy: undefined,
          CreatedDate: 'NaN-NaN-NaN NaN:NaN',
          Error: [],
          HasMetadataRemoved: null,
          HasPassedCodeCoverageCheck: null,
          CodeCoverage: null,
          VersionNumber: null,
          Id: '0Ho3i000000Gmj6YYa',
          Package2Id: undefined,
          Package2Name: null,
          Package2VersionId: undefined,
          Status: 'inProgress',
          SubscriberPackageVersionId: null,
          Tag: undefined,
          TotalNumberOfMetadataFiles: null,
          TotalSizeOfMetadataFiles: null,
        },
        timeRemaining: {
          quantity: 2,
          unit: 2,
        },
      });
    });
    Lifecycle.getInstance().on(PackageEvents.convert.success, async (data) => {
      expect(data).to.deep.equal({
        id: '0Ho3i000000Gmj6YYY',
        packageVersionCreateRequestResult: successResponse,
        projectUpdated: false,
      });
    });
    $$.SANDBOX.stub(conn.tooling, 'query')
      .onFirstCall()
      // @ts-expect-error: argument not assignable to parameter
      .resolves({ records: [{ Id: '0Ho3i000000Gmj6Yaa' }] })
      .onSecondCall()
      // @ts-expect-error: argument not assignable to parameter
      .resolves({ records: [{ Id: '0Ho3i000000Gmj6YYa', Status: 'inProgress' }] })
      .onThirdCall()
      // @ts-expect-error: argument not assignable to parameter
      .resolves({
        records: [successResponse],
      });

    $$.SANDBOX.stub(conn.tooling, 'create').resolves({ success: true, errors: [], id: '0Ho3i000000Gmj6YYY' });

    const result = await convertPackage('0334p000000EaIHAA0', conn, {
      buildInstance: '',
      installationKey: '',
      definitionfile: '',
      installationKeyBypass: true,
      wait: Duration.minutes(1),
      frequency: Duration.seconds(1),
    });

    expect(result).to.deep.equal(successResponse);
  });

  it('will convert the package and handle error on reporting', async () => {
    const conn = await testOrg.getConnection();

    Lifecycle.getInstance().on(PackageEvents.convert.error, async (data: { id: string; status: string }) => {
      expect(data.id).to.equal('0Ho3i000000Gmj6YYY');
      expect(data.status).to.include('Multiple errors occurred:');
      expect(data.status).to.include('(1) Server polling error 1');
      expect(data.status).to.include('(2) server error 2');
    });
    $$.SANDBOX.stub(conn.tooling, 'query')
      .onFirstCall()
      // @ts-ignore
      .resolves({ records: [{ Id: '0Ho3i000000Gmj6Yaa' }] })
      .onSecondCall()
      // @ts-ignore
      .resolves({ records: [{ Id: '0Ho3i000000Gmj6YYa', Status: 'Error' }] })
      .onThirdCall()
      // @ts-ignore
      .resolves({ records: [{ Message: 'Server polling error 1' }, { Message: 'server error 2' }] });

    $$.SANDBOX.stub(conn.tooling, 'create').resolves({ success: true, errors: [], id: '0Ho3i000000Gmj6YYY' });

    try {
      await convertPackage('0334p000000EaIHAA0', conn, {
        buildInstance: '',
        installationKey: '',
        definitionfile: '',
        installationKeyBypass: true,
        wait: Duration.minutes(1),
      });
    } catch (e) {
      const message = (e as Error).message;
      expect(message).to.include('Multiple errors occurred:');
      expect(message).to.include('(1) Server polling error 1');
      expect(message).to.include('(2) server error 2');
    }
  });
});
