/*
 * Copyright 2025, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { expect } from 'chai';
import { Connection, SfError } from '@salesforce/core';
import { instantiateContext, restoreContext, stubContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { AnyJson, ensureJsonMap } from '@salesforce/ts-types';
import { ensureString } from '@salesforce/ts-types';
import { PackageBundleInstalledList } from '../../src/package/packageBundleInstalledList';

describe('PackageBundleInstalledList', () => {
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

  describe('getInstalledBundles', () => {
    it('should get installed bundles with components', async () => {
      const mockInstalledBundles = [
        {
          Id: '1aE000000000001',
          PackageBundleId: '0Kz000000000001',
          PackageBundleVersionId: '05i000000000001',
          BundleName: 'TestBundle',
          BundleVersionName: 'ver 1.0',
          MajorVersion: 1,
          MinorVersion: 0,
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          LastModifiedDate: '2024-01-01T00:00:00.000+0000',
        },
      ];

      const mockInstallRequest = [
        {
          Id: '08c000000000001',
        },
      ];

      const mockComponents = [
        {
          SubscriberPackageVersion: {
            Id: '04t000000000001',
            SubscriberPackageId: '033000000000001',
            MajorVersion: 1,
            MinorVersion: 0,
            PatchVersion: 0,
            BuildNumber: 1,
          },
          InstalledComponent: {
            SubscriberPackage: {
              Name: 'TestPackage',
            },
          },
          SequenceOrder: 1,
        },
      ];

      const mockInstalledPackages = [
        {
          Id: '0A3000000000001',
          SubscriberPackageId: '033000000000001',
          SubscriberPackage: {
            Name: 'TestPackage',
          },
          SubscriberPackageVersion: {
            Id: '04t000000000001',
            MajorVersion: 1,
            MinorVersion: 0,
            PatchVersion: 0,
            BuildNumber: 1,
          },
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        const url = ensureString(requestMap.url);

        if (url.includes('InstalledPkgBundleVersion')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstalledBundles,
          });
        } else if (url.includes('PkgBundleVersionInstallReq') && url.includes('InstalledPkgBundleVersionId')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstallRequest,
          });
        } else if (url.includes('PkgBundleVerCpntIstlReq')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockComponents,
          });
        } else if (url.includes('InstalledSubscriberPackage')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstalledPackages,
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${url}`));
        }
      };

      const results = await PackageBundleInstalledList.getInstalledBundles(connection);

      expect(results).to.have.length(1);
      expect(results[0]).to.have.property('Id', '1aE000000000001');
      expect(results[0]).to.have.property('BundleName', 'TestBundle');
      expect(results[0]).to.have.property('BundleId', '0Kz000000000001');
      expect(results[0]).to.have.property('BundleVersionId', '05i000000000001');
      expect(results[0]).to.have.property('BundleVersionName', 'ver 1.0');
      expect(results[0]).to.have.property('MajorVersion', 1);
      expect(results[0]).to.have.property('MinorVersion', 0);
      expect(results[0]).to.have.property('InstalledDate', '2024-01-01T00:00:00.000+0000');
      expect(results[0]).to.have.property('LastUpgradedDate', '2024-01-01T00:00:00.000+0000');
      expect(results[0].Components).to.have.length(1);
      expect(results[0].Components[0]).to.deep.equal({
        ExpectedPackageName: 'TestPackage',
        ExpectedPackageVersionNumber: '1.0.0.1',
        ActualPackageName: 'TestPackage',
        ActualPackageVersionNumber: '1.0.0.1',
      });
    });

    it('should handle installed bundles with mismatched package versions', async () => {
      const mockInstalledBundles = [
        {
          Id: '1aE000000000001',
          PackageBundleId: '0Kz000000000001',
          PackageBundleVersionId: '05i000000000001',
          BundleName: 'TestBundle',
          BundleVersionName: 'ver 1.0',
          MajorVersion: 1,
          MinorVersion: 0,
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          LastModifiedDate: '2024-01-02T00:00:00.000+0000',
        },
      ];

      const mockInstallRequest = [
        {
          Id: '08c000000000001',
        },
      ];

      const mockComponents = [
        {
          SubscriberPackageVersion: {
            Id: '04t000000000001',
            SubscriberPackageId: '033000000000001',
            MajorVersion: 1,
            MinorVersion: 0,
            PatchVersion: 0,
            BuildNumber: 1,
          },
          InstalledComponent: {
            SubscriberPackage: {
              Name: 'TestPackage',
            },
          },
          SequenceOrder: 1,
        },
      ];

      const mockInstalledPackages = [
        {
          Id: '0A3000000000001',
          SubscriberPackageId: '033000000000001',
          SubscriberPackage: {
            Name: 'TestPackage',
          },
          SubscriberPackageVersion: {
            Id: '04t000000000002',
            MajorVersion: 2,
            MinorVersion: 0,
            PatchVersion: 0,
            BuildNumber: 1,
          },
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        const url = ensureString(requestMap.url);

        if (url.includes('InstalledPkgBundleVersion')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstalledBundles,
          });
        } else if (url.includes('PkgBundleVersionInstallReq') && url.includes('InstalledPkgBundleVersionId')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstallRequest,
          });
        } else if (url.includes('PkgBundleVerCpntIstlReq')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockComponents,
          });
        } else if (url.includes('InstalledSubscriberPackage')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstalledPackages,
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${url}`));
        }
      };

      const results = await PackageBundleInstalledList.getInstalledBundles(connection);

      expect(results).to.have.length(1);
      expect(results[0].Components).to.have.length(1);
      expect(results[0].Components[0]).to.deep.equal({
        ExpectedPackageName: 'TestPackage',
        ExpectedPackageVersionNumber: '1.0.0.1',
        ActualPackageName: 'TestPackage',
        ActualPackageVersionNumber: '2.0.0.1',
      });
    });

    it('should handle installed bundles with uninstalled packages', async () => {
      const mockInstalledBundles = [
        {
          Id: '1aE000000000001',
          PackageBundleId: '0Kz000000000001',
          PackageBundleVersionId: '05i000000000001',
          BundleName: 'TestBundle',
          BundleVersionName: 'ver 1.0',
          MajorVersion: 1,
          MinorVersion: 0,
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          LastModifiedDate: '2024-01-01T00:00:00.000+0000',
        },
      ];

      const mockInstallRequest = [
        {
          Id: '08c000000000001',
        },
      ];

      const mockComponents = [
        {
          SubscriberPackageVersion: {
            Id: '04t000000000001',
            SubscriberPackageId: '033000000000001',
            MajorVersion: 1,
            MinorVersion: 0,
            PatchVersion: 0,
            BuildNumber: 1,
          },
          InstalledComponent: {
            SubscriberPackage: {
              Name: 'TestPackage',
            },
          },
          SequenceOrder: 1,
        },
      ];

      const mockInstalledPackages: AnyJson[] = [];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        const url = ensureString(requestMap.url);

        if (url.includes('InstalledPkgBundleVersion')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstalledBundles,
          });
        } else if (url.includes('PkgBundleVersionInstallReq') && url.includes('InstalledPkgBundleVersionId')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstallRequest,
          });
        } else if (url.includes('PkgBundleVerCpntIstlReq')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockComponents,
          });
        } else if (url.includes('InstalledSubscriberPackage')) {
          return Promise.resolve({
            done: true,
            totalSize: 0,
            records: mockInstalledPackages,
          });
        } else {
          return Promise.reject(new SfError(`Unexpected request: ${url}`));
        }
      };

      const results = await PackageBundleInstalledList.getInstalledBundles(connection);

      expect(results).to.have.length(1);
      expect(results[0].Components).to.have.length(1);
      expect(results[0].Components[0]).to.deep.equal({
        ExpectedPackageName: 'TestPackage',
        ExpectedPackageVersionNumber: '1.0.0.1',
        ActualPackageName: 'Uninstalled',
        ActualPackageVersionNumber: 'N/A',
      });
    });

    it.skip('should handle multiple installed bundles', async () => {
      const mockInstalledBundles = [
        {
          Id: '1aE000000000001',
          PackageBundleId: '0Kz000000000001',
          PackageBundleVersionId: '05i000000000001',
          BundleName: 'TestBundle1',
          BundleVersionName: 'ver 1.0',
          MajorVersion: 1,
          MinorVersion: 0,
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          LastModifiedDate: '2024-01-01T00:00:00.000+0000',
        },
        {
          Id: '1aE000000000002',
          PackageBundleId: '0Kz000000000002',
          PackageBundleVersionId: '05i000000000002',
          BundleName: 'TestBundle2',
          BundleVersionName: 'ver 2.0',
          MajorVersion: 2,
          MinorVersion: 0,
          CreatedDate: '2024-01-02T00:00:00.000+0000',
          LastModifiedDate: '2024-01-02T00:00:00.000+0000',
        },
      ];

      const mockInstallRequests = new Map([
        ['1aE000000000001', [{ Id: '08c000000000001' }]],
        ['1aE000000000002', [{ Id: '08c000000000002' }]],
      ]);

      const mockComponentsMap = new Map([
        [
          '08c000000000001',
          [
            {
              SubscriberPackageVersion: {
                Id: '04t000000000001',
                SubscriberPackageId: '033000000000001',
                MajorVersion: 1,
                MinorVersion: 0,
                PatchVersion: 0,
                BuildNumber: 1,
              },
              InstalledComponent: {
                SubscriberPackage: {
                  Name: 'Package1',
                },
              },
              SequenceOrder: 1,
            },
          ],
        ],
        [
          '08c000000000002',
          [
            {
              SubscriberPackageVersion: {
                Id: '04t000000000002',
                SubscriberPackageId: '033000000000002',
                MajorVersion: 2,
                MinorVersion: 0,
                PatchVersion: 0,
                BuildNumber: 1,
              },
              InstalledComponent: {
                SubscriberPackage: {
                  Name: 'Package2',
                },
              },
              SequenceOrder: 1,
            },
          ],
        ],
      ]);

      const mockInstalledPackages = [
        {
          Id: '0A3000000000001',
          SubscriberPackageId: '033000000000001',
          SubscriberPackage: {
            Name: 'Package1',
          },
          SubscriberPackageVersion: {
            Id: '04t000000000001',
            MajorVersion: 1,
            MinorVersion: 0,
            PatchVersion: 0,
            BuildNumber: 1,
          },
        },
        {
          Id: '0A3000000000002',
          SubscriberPackageId: '033000000000002',
          SubscriberPackage: {
            Name: 'Package2',
          },
          SubscriberPackageVersion: {
            Id: '04t000000000002',
            MajorVersion: 2,
            MinorVersion: 0,
            PatchVersion: 0,
            BuildNumber: 1,
          },
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        const url = ensureString(requestMap.url);

        if (url.includes('InstalledPkgBundleVersion')) {
          return Promise.resolve({
            done: true,
            totalSize: 2,
            records: mockInstalledBundles,
          });
        } else if (url.includes('PkgBundleVersionInstallReq') && url.includes('InstalledPkgBundleVersionId')) {
          // Extract the bundle ID from the query (handle URL encoding)
          const bundleIdMatch =
            url.match(/InstalledPkgBundleVersionId\s*%3D\s*%27([^%]+)%27/) ??
            url.match(/InstalledPkgBundleVersionId\s*=\s*'([^']+)'/);
          if (bundleIdMatch) {
            const bundleId = bundleIdMatch[1];
            return Promise.resolve({
              done: true,
              totalSize: mockInstallRequests.get(bundleId)?.length ?? 0,
              records: mockInstallRequests.get(bundleId) ?? [],
            });
          }
        } else if (url.includes('PkgBundleVerCpntIstlReq')) {
          // Extract the install request ID from the query (handle URL encoding)
          const requestIdMatch =
            url.match(/PkgBundleVersionInstallReqId\s*%3D\s*%27([^%]+)%27/) ??
            url.match(/PkgBundleVersionInstallReqId\s*=\s*'([^']+)'/);
          if (requestIdMatch) {
            const requestId = requestIdMatch[1];
            return Promise.resolve({
              done: true,
              totalSize: mockComponentsMap.get(requestId)?.length ?? 0,
              records: mockComponentsMap.get(requestId) ?? [],
            });
          }
        } else if (url.includes('InstalledSubscriberPackage')) {
          return Promise.resolve({
            done: true,
            totalSize: 2,
            records: mockInstalledPackages,
          });
        }
        return Promise.reject(new SfError(`Unexpected request: ${url}`));
      };

      const results = await PackageBundleInstalledList.getInstalledBundles(connection);

      expect(results).to.have.length(2);
      expect(results[0]).to.have.property('BundleName', 'TestBundle1');
      expect(results[1]).to.have.property('BundleName', 'TestBundle2');
      expect(results[0].Components).to.have.length(1);
      expect(results[1].Components).to.have.length(1);
    });

    it('should return empty array when no bundles are installed', async () => {
      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        const url = ensureString(requestMap.url);

        if (url.includes('InstalledPkgBundleVersion')) {
          return Promise.resolve({
            done: true,
            totalSize: 0,
            records: [],
          });
        }
        return Promise.reject(new SfError(`Unexpected request: ${url}`));
      };

      const results = await PackageBundleInstalledList.getInstalledBundles(connection);

      expect(results).to.be.an('array');
      expect(results).to.have.length(0);
    });

    it.skip('should return empty components when no install request is found', async () => {
      const mockInstalledBundles = [
        {
          Id: '1aE000000000001',
          PackageBundleId: '0Kz000000000001',
          PackageBundleVersionId: '05i000000000001',
          BundleName: 'TestBundle',
          BundleVersionName: 'ver 1.0',
          MajorVersion: 1,
          MinorVersion: 0,
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          LastModifiedDate: '2024-01-01T00:00:00.000+0000',
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        const url = ensureString(requestMap.url);

        if (url.includes('InstalledPkgBundleVersion')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstalledBundles,
          });
        } else if (url.includes('PkgBundleVersionInstallReq') && url.includes('InstalledPkgBundleVersionId')) {
          return Promise.resolve({
            done: true,
            totalSize: 0,
            records: [],
          });
        } else if (url.includes('PkgBundleVerCpntIstlReq')) {
          // This should not be reached since no install request was found
          return Promise.reject(new SfError('Should not query components when no install request found'));
        }
        return Promise.reject(new SfError(`Unexpected request: ${url}`));
      };

      const results = await PackageBundleInstalledList.getInstalledBundles(connection);

      expect(results).to.have.length(1);
      expect(results[0].Components).to.be.an('array');
      expect(results[0].Components).to.have.length(0);
    });

    it('should return empty components when no component install records are found', async () => {
      const mockInstalledBundles = [
        {
          Id: '1aE000000000001',
          PackageBundleId: '0Kz000000000001',
          PackageBundleVersionId: '05i000000000001',
          BundleName: 'TestBundle',
          BundleVersionName: 'ver 1.0',
          MajorVersion: 1,
          MinorVersion: 0,
          CreatedDate: '2024-01-01T00:00:00.000+0000',
          LastModifiedDate: '2024-01-01T00:00:00.000+0000',
        },
      ];

      const mockInstallRequest = [
        {
          Id: '08c000000000001',
        },
      ];

      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        const url = ensureString(requestMap.url);

        if (url.includes('InstalledPkgBundleVersion')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstalledBundles,
          });
        } else if (url.includes('PkgBundleVersionInstallReq') && url.includes('InstalledPkgBundleVersionId')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: mockInstallRequest,
          });
        } else if (url.includes('PkgBundleVerCpntIstlReq')) {
          return Promise.resolve({
            done: true,
            totalSize: 0,
            records: [],
          });
        }
        return Promise.reject(new SfError(`Unexpected request: ${url}`));
      };

      const results = await PackageBundleInstalledList.getInstalledBundles(connection);

      expect(results).to.have.length(1);
      expect(results[0].Components).to.be.an('array');
      expect(results[0].Components).to.have.length(0);
    });
  });
});
