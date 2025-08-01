/*
 * Copyright (c) 2025, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import path from 'node:path';
import fs from 'node:fs';
import { expect } from 'chai';
import { Connection, SfProject, SfError } from '@salesforce/core';
import { instantiateContext, restoreContext, stubContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { AnyJson, ensureJsonMap } from '@salesforce/ts-types';
import { ensureString } from '@salesforce/ts-types';
import { PackageBundleVersion } from '../../src/package/packageBundleVersion';
import { PackagingSObjects } from '../../src/interfaces';

async function setupProject(setup: (project: SfProject) => void = () => {}) {
  const project = await SfProject.resolve();

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

describe('PackageBundleVersion', () => {
  const testContext = instantiateContext();
  const testOrg = new MockTestOrgData();
  let connection: Connection;

  beforeEach(async () => {
    stubContext(testContext);
    connection = await testOrg.getConnection();
  });

  afterEach(() => {
    restoreContext(testContext);
  });

  describe('report', () => {
    it('should report on a package bundle version successfully', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const bundleVersionId = '0Ho0x0000000000000';
      const mockBundleVersion = {
        Id: bundleVersionId,
        PackageBundle: {
          Id: '0Ho0x0000000000001',
          BundleName: 'Test Bundle',
          Description: 'Test bundle description',
          IsDeleted: false,
          CreatedDate: '2025-01-01T00:00:00.000+0000',
          CreatedById: '0050x0000000000001',
          LastModifiedDate: '2025-01-01T00:00:00.000+0000',
          LastModifiedById: '0050x0000000000001',
          SystemModstamp: '2025-01-01T00:00:00.000+0000',
        },
        VersionName: '1.0.0',
        MajorVersion: '1',
        MinorVersion: '0',
        CreatedDate: '2025-01-01T00:00:00.000+0000',
        CreatedById: '0050x0000000000001',
        LastModifiedDate: '2025-01-01T00:00:00.000+0000',
        LastModifiedById: '0050x0000000000001',
        IsReleased: false,
        Ancestor: null,
      };

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (
          request &&
          ensureString(requestMap.url).includes('PackageBundleVersion') &&
          ensureString(requestMap.url).includes(bundleVersionId)
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: [mockBundleVersion],
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const result = await PackageBundleVersion.report(connection, bundleVersionId);
      expect(result).to.deep.equal(mockBundleVersion);
    });

    it('should report on a package bundle version with ancestor successfully', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const bundleVersionId = '0Ho0x0000000000000';
      const mockBundleVersion = {
        Id: bundleVersionId,
        PackageBundle: {
          Id: '0Ho0x0000000000001',
          BundleName: 'Test Bundle',
          Description: 'Test bundle description',
          IsDeleted: false,
          CreatedDate: '2025-01-01T00:00:00.000+0000',
          CreatedById: '0050x0000000000001',
          LastModifiedDate: '2025-01-01T00:00:00.000+0000',
          LastModifiedById: '0050x0000000000001',
          SystemModstamp: '2025-01-01T00:00:00.000+0000',
        },
        VersionName: '2.0.0',
        MajorVersion: '2',
        MinorVersion: '0',
        CreatedDate: '2025-01-01T00:00:00.000+0000',
        CreatedById: '0050x0000000000001',
        LastModifiedDate: '2025-01-01T00:00:00.000+0000',
        LastModifiedById: '0050x0000000000001',
        IsReleased: true,
        Ancestor: {
          Id: '0Ho0x0000000000001',
          PackageBundle: {
            Id: '0Ho0x0000000000002',
            BundleName: 'Test Bundle',
            Description: 'Test bundle description',
            IsDeleted: false,
            CreatedDate: '2025-01-01T00:00:00.000+0000',
            CreatedById: '0050x0000000000001',
            LastModifiedDate: '2025-01-01T00:00:00.000+0000',
            LastModifiedById: '0050x0000000000001',
            SystemModstamp: '2025-01-01T00:00:00.000+0000',
          },
          VersionName: '1.0.0',
          MajorVersion: '1',
          MinorVersion: '0',
          IsReleased: true,
          CreatedDate: '2025-01-01T00:00:00.000+0000',
          CreatedById: '0050x0000000000001',
          LastModifiedDate: '2025-01-01T00:00:00.000+0000',
          LastModifiedById: '0050x0000000000001',
          Ancestor: null,
        },
      };

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (
          request &&
          ensureString(requestMap.url).includes('PackageBundleVersion') &&
          ensureString(requestMap.url).includes(bundleVersionId)
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: [mockBundleVersion],
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const result = await PackageBundleVersion.report(connection, bundleVersionId);
      expect(result).to.deep.equal(mockBundleVersion);
      expect(result?.Ancestor).to.not.be.null;
      expect(result?.Ancestor?.Id).to.equal('0Ho0x0000000000001');
    });

    it('should return null when bundle version is not found', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const bundleVersionId = '0Ho0x0000000000000';

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (
          request &&
          ensureString(requestMap.url).includes('PackageBundleVersion') &&
          ensureString(requestMap.url).includes(bundleVersionId)
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 0,
            records: [],
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const result = await PackageBundleVersion.report(connection, bundleVersionId);
      expect(result).to.be.null;
    });
  });

  describe('componentPackages', () => {
    it('should retrieve component packages successfully', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const bundleVersionId = '0Ho0x0000000000000';
      const mockComponentPackages = [
        {
          Component: {
            Id: '04t0000000000001',
            Name: 'Test Package 1',
            Description: 'Test package 1 description',
            PublisherName: 'Test Publisher',
            MajorVersion: 1,
            MinorVersion: 0,
            PatchVersion: 0,
            BuildNumber: 1,
            ReleaseState: 'Released',
            IsManaged: true,
            IsDeprecated: false,
            IsPasswordProtected: false,
            IsBeta: false,
            Package2ContainerOptions: 'Managed',
            IsSecurityReviewed: true,
            IsOrgDependent: false,
            AppExchangePackageName: 'Test Package 1',
            AppExchangeDescription: 'Test package 1 description',
            AppExchangePublisherName: 'Test Publisher',
            AppExchangeLogoUrl: 'https://test.com/logo1.png',
            ReleaseNotesUrl: 'https://test.com/releasenotes1',
            PostInstallUrl: 'https://test.com/postinstall1',
            RemoteSiteSettings: { settings: [] },
            CspTrustedSites: { settings: [] },
            Profiles: { destinationProfiles: [], sourceProfiles: [] },
            Dependencies: { ids: [] },
            InstallValidationStatus: 'NO_ERRORS_DETECTED',
            SubscriberPackageId: '0330000000000001',
          },
        },
        {
          Component: {
            Id: '04t0000000000002',
            Name: 'Test Package 2',
            Description: 'Test package 2 description',
            PublisherName: 'Test Publisher',
            MajorVersion: 2,
            MinorVersion: 0,
            PatchVersion: 0,
            BuildNumber: 1,
            ReleaseState: 'Released',
            IsManaged: true,
            IsDeprecated: false,
            IsPasswordProtected: false,
            IsBeta: false,
            Package2ContainerOptions: 'Managed',
            IsSecurityReviewed: true,
            IsOrgDependent: false,
            AppExchangePackageName: 'Test Package 2',
            AppExchangeDescription: 'Test package 2 description',
            AppExchangePublisherName: 'Test Publisher',
            AppExchangeLogoUrl: 'https://test.com/logo2.png',
            ReleaseNotesUrl: 'https://test.com/releasenotes2',
            PostInstallUrl: 'https://test.com/postinstall2',
            RemoteSiteSettings: { settings: [] },
            CspTrustedSites: { settings: [] },
            Profiles: { destinationProfiles: [], sourceProfiles: [] },
            Dependencies: { ids: [] },
            InstallValidationStatus: 'NO_ERRORS_DETECTED',
            SubscriberPackageId: '0330000000000002',
          },
        },
      ];

      const expectedComponentPackages: PackagingSObjects.SubscriberPackageVersion[] = [
        {
          Id: '04t0000000000001',
          Name: 'Test Package 1',
          Description: 'Test package 1 description',
          PublisherName: 'Test Publisher',
          MajorVersion: 1,
          MinorVersion: 0,
          PatchVersion: 0,
          BuildNumber: 1,
          ReleaseState: 'Released',
          IsManaged: true,
          IsDeprecated: false,
          IsPasswordProtected: false,
          IsBeta: false,
          Package2ContainerOptions: 'Managed',
          IsSecurityReviewed: true,
          IsOrgDependent: false,
          AppExchangePackageName: 'Test Package 1',
          AppExchangeDescription: 'Test package 1 description',
          AppExchangePublisherName: 'Test Publisher',
          AppExchangeLogoUrl: 'https://test.com/logo1.png',
          ReleaseNotesUrl: 'https://test.com/releasenotes1',
          PostInstallUrl: 'https://test.com/postinstall1',
          RemoteSiteSettings: { settings: [] },
          CspTrustedSites: { settings: [] },
          Profiles: { destinationProfiles: [], sourceProfiles: [] },
          Dependencies: { ids: [] },
          InstallValidationStatus: 'NO_ERRORS_DETECTED',
          SubscriberPackageId: '0330000000000001',
        },
        {
          Id: '04t0000000000002',
          Name: 'Test Package 2',
          Description: 'Test package 2 description',
          PublisherName: 'Test Publisher',
          MajorVersion: 2,
          MinorVersion: 0,
          PatchVersion: 0,
          BuildNumber: 1,
          ReleaseState: 'Released',
          IsManaged: true,
          IsDeprecated: false,
          IsPasswordProtected: false,
          IsBeta: false,
          Package2ContainerOptions: 'Managed',
          IsSecurityReviewed: true,
          IsOrgDependent: false,
          AppExchangePackageName: 'Test Package 2',
          AppExchangeDescription: 'Test package 2 description',
          AppExchangePublisherName: 'Test Publisher',
          AppExchangeLogoUrl: 'https://test.com/logo2.png',
          ReleaseNotesUrl: 'https://test.com/releasenotes2',
          PostInstallUrl: 'https://test.com/postinstall2',
          RemoteSiteSettings: { settings: [] },
          CspTrustedSites: { settings: [] },
          Profiles: { destinationProfiles: [], sourceProfiles: [] },
          Dependencies: { ids: [] },
          InstallValidationStatus: 'NO_ERRORS_DETECTED',
          SubscriberPackageId: '0330000000000002',
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (
          request &&
          ensureString(requestMap.url).includes('PkgBundleVersionComponent') &&
          ensureString(requestMap.url).includes(bundleVersionId)
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 2,
            records: mockComponentPackages,
          });
        } else if (
          request &&
          ensureString(requestMap.url).includes('SubscriberPackage') &&
          ensureString(requestMap.url).includes('0330000000000001')
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: [{ Id: '0330000000000001', Name: 'Test Package 1' }],
          });
        } else if (
          request &&
          ensureString(requestMap.url).includes('SubscriberPackage') &&
          ensureString(requestMap.url).includes('0330000000000002')
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: [{ Id: '0330000000000002', Name: 'Test Package 2' }],
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const result = await PackageBundleVersion.getComponentPackages(connection, bundleVersionId);
      expect(result).to.deep.equal(expectedComponentPackages);
    });

    it('should return empty array when no component packages are found', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const bundleVersionId = '0Ho0x0000000000000';

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (
          request &&
          ensureString(requestMap.url).includes('PkgBundleVersionComponent') &&
          ensureString(requestMap.url).includes(bundleVersionId)
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 0,
            records: [],
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      const result = await PackageBundleVersion.getComponentPackages(connection, bundleVersionId);
      expect(result).to.deep.equal([]);
    });

    it('should throw error when component record is missing', async () => {
      testContext.inProject(true);
      await setupProject((proj) => {
        proj.getSfProjectJson().set('namespace', 'testNamespace');
      });

      const bundleVersionId = '0Ho0x0000000000000';
      const mockComponentPackages = [
        {
          Component: null, // Missing component record
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        if (
          request &&
          ensureString(requestMap.url).includes('PkgBundleVersionComponent') &&
          ensureString(requestMap.url).includes(bundleVersionId)
        ) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockComponentPackages,
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${String(requestMap.url)}`));
        }
      };

      try {
        await PackageBundleVersion.getComponentPackages(connection, bundleVersionId);
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        expect((error as Error).message).to.equal('Component record is missing');
      }
    });
  });
});
