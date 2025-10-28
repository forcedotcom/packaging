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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert, expect } from 'chai';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/testSetup';
import { SfProject } from '@salesforce/core';
import type { SaveError } from '@jsforce/jsforce-node';
import { Duration } from '@salesforce/kit';
import JSZIP from 'jszip';
import {
  applyErrorAction,
  combineSaveErrors,
  findPackageDirectory,
  resolveBuildUserPermissions,
  getPackageVersionNumber,
  getPackageVersionStrings,
  massageErrorMessage,
  numberToDuration,
  zipDir,
} from '../../src/utils/packageUtils';
import { PackageDescriptorJson } from '../../src/interfaces';
import { PackagingSObjects } from '../../src/interfaces';

describe('packageUtils', () => {
  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();

  beforeEach(() => {
    stubContext($$);
  });

  afterEach(() => {
    restoreContext($$);
  });

  describe('getPackage2VersionNumber', () => {
    it('should return the correct version number', () => {
      const version = {
        Id: 'foo',
        MajorVersion: 1,
        MinorVersion: 2,
        PatchVersion: 3,
      } as PackagingSObjects.Package2Version;
      const result = getPackageVersionNumber(version);
      expect(result).to.be.equal('1.2.3');
    });
  });

  describe('resolveBuildUserPermissions', () => {
    it('should process apexTestAccess and packageMetadataAccess when codecoverage is true, and remove source fields', () => {
      const original: PackageDescriptorJson = {
        id: '0HoXXXXXXXXXXXX',
        versionNumber: '1.0.0.1',
        apexTestAccess: {
          permissionSets: 'PS_A, PS_B',
          permissionSetLicenses: ' LIC_A , LIC_B ',
        },
        packageMetadataAccess: {
          permissionSets: ['PM_PS_1', ' PM_PS_2 '],
          permissionSetLicenses: ['PM_PSL_1', 'PM_PSL_2'],
        },
      } as unknown as PackageDescriptorJson;

      const result = resolveBuildUserPermissions(original, true);

      expect(result.permissionSetNames).to.deep.equal(['PS_A', 'PS_B']);
      expect(result.permissionSetLicenseDeveloperNames).to.deep.equal(['LIC_A', 'LIC_B']);
      expect(result.packageMetadataPermissionSetNames).to.deep.equal(['PM_PS_1', 'PM_PS_2']);
      expect(result.packageMetadataPermissionSetLicenseNames).to.deep.equal(['PM_PSL_1', 'PM_PSL_2']);

      expect(result).to.not.have.property('apexTestAccess');
      expect(result).to.not.have.property('packageMetadataAccess');

      // original should be unchanged
      expect(original).to.have.property('apexTestAccess');
      expect(original).to.have.property('packageMetadataAccess');
    });

    it('should process apexTestAccess (arrays) for codecoverage true', () => {
      const original: PackageDescriptorJson = {
        id: '0HoYYYYYYYYYYYY',
        apexTestAccess: {
          permissionSets: ['PS1', ' PS2 '],
          permissionSetLicenses: ['LIC1', ' LIC2 '],
        },
      } as unknown as PackageDescriptorJson;

      const result = resolveBuildUserPermissions(original, true);
      expect(result.permissionSetNames).to.deep.equal(['PS1', 'PS2']);
      expect(result.permissionSetLicenseDeveloperNames).to.deep.equal(['LIC1', 'LIC2']);
      expect(result).to.not.have.property('apexTestAccess');
    });

    it('should not process apexTestAccess when codecoverage is false but still remove apexTestAccess; should process packageMetadataAccess regardless', () => {
      const original: PackageDescriptorJson = {
        id: '0HoZZZZZZZZZZZZ',
        apexTestAccess: {
          permissionSets: 'PS_X,PS_Y',
          permissionSetLicenses: 'LIC_X,LIC_Y',
        },
        packageMetadataAccess: {
          permissionSets: 'PM1, PM2',
          permissionSetLicenses: 'PML1 , PML2',
        },
      } as unknown as PackageDescriptorJson;

      const result = resolveBuildUserPermissions(original, false);

      expect(result).to.not.have.property('permissionSetNames');
      expect(result).to.not.have.property('permissionSetLicenseDeveloperNames');

      expect(result.packageMetadataPermissionSetNames).to.deep.equal(['PM1', 'PM2']);
      expect(result.packageMetadataPermissionSetLicenseNames).to.deep.equal(['PML1', 'PML2']);

      expect(result).to.not.have.property('apexTestAccess');
      expect(result).to.not.have.property('packageMetadataAccess');

      // original should still retain inputs
      expect(original).to.have.property('apexTestAccess');
      expect(original).to.have.property('packageMetadataAccess');
    });
  });

  describe('findPackageDirectory', () => {
    it('should return undefined when project is undefined', () => {
      const result = findPackageDirectory(undefined, '0HoXXXXXXXXXXXX');
      expect(result).to.be.undefined;
    });

    it('should return undefined when package not found in project', () => {
      const mockProject = {
        findPackage: () => undefined,
        getPackageIdFromAlias: () => undefined,
      } as unknown as SfProject;

      const result = findPackageDirectory(mockProject, '0HoXXXXXXXXXXXX');
      expect(result).to.be.undefined;
    });

    it('should return undefined when package object is not a packaging directory', () => {
      const mockProject = {
        findPackage: (callback: (dir: unknown) => boolean) => {
          const dir = { path: 'some-path' }; // This object doesn't have required packaging directory properties
          return callback(dir) ? dir : undefined;
        },
        getPackageIdFromAlias: () => undefined,
      } as unknown as SfProject;

      const result = findPackageDirectory(mockProject, '0HoXXXXXXXXXXXX');
      expect(result).to.be.undefined;
    });

    it('should return package directory when found by exact package ID match', () => {
      const mockPackageDir = {
        path: 'force-app',
        package: '0HoXXXXXXXXXXXX',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        apexTestAccess: { permissionSets: ['Test'] },
      };

      const mockProject = {
        findPackage: (callback: (dir: unknown) => boolean) => (callback(mockPackageDir) ? mockPackageDir : undefined),
        getPackageIdFromAlias: () => '0HoXXXXXXXXXXXX',
      } as unknown as SfProject;

      const result = findPackageDirectory(mockProject, '0HoXXXXXXXXXXXX');
      expect(result).to.deep.equal(mockPackageDir);
    });

    it('should return package directory when found by alias resolution', () => {
      const mockPackageDir = {
        path: 'force-app',
        package: 'MyPackage',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        apexTestAccess: { permissionSets: ['Test'] },
      };

      const mockProject = {
        findPackage: (callback: (dir: unknown) => boolean) => (callback(mockPackageDir) ? mockPackageDir : undefined),
        getPackageIdFromAlias: () => '0HoXXXXXXXXXXXX',
      } as unknown as SfProject;

      const result = findPackageDirectory(mockProject, '0HoXXXXXXXXXXXX');
      expect(result).to.deep.equal(mockPackageDir);
    });

    it('should return undefined when alias does not match packageId', () => {
      const mockPackageDir = {
        path: 'force-app',
        package: 'MyPackage',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        apexTestAccess: { permissionSets: ['Test'] },
      };

      const mockProject = {
        findPackage: (callback: (dir: unknown) => boolean) => (callback(mockPackageDir) ? mockPackageDir : undefined),
        getPackageIdFromAlias: () => '0HoYYYYYYYYYYYY',
      } as unknown as SfProject;

      const result = findPackageDirectory(mockProject, '0HoXXXXXXXXXXXX');
      expect(result).to.be.undefined;
    });

    it('should return undefined when package name does not match packageId', () => {
      const mockPackageDir = {
        path: 'force-app',
        package: '0HoYYYYYYYYYYYY',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        apexTestAccess: { permissionSets: ['Test'] },
      };

      const mockProject = {
        findPackage: (callback: (dir: unknown) => boolean) => (callback(mockPackageDir) ? mockPackageDir : undefined),
        getPackageIdFromAlias: () => undefined,
      } as unknown as SfProject;

      const result = findPackageDirectory(mockProject, '0HoXXXXXXXXXXXX');
      expect(result).to.be.undefined;
    });

    it('should handle getPackageIdFromAlias returning undefined', () => {
      const mockPackageDir = {
        path: 'force-app',
        package: '0HoXXXXXXXXXXXX',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        apexTestAccess: { permissionSets: ['Test'] },
      };

      const mockProject = {
        findPackage: (callback: (dir: unknown) => boolean) => (callback(mockPackageDir) ? mockPackageDir : undefined),
        getPackageIdFromAlias: () => undefined,
      } as unknown as SfProject;

      const result = findPackageDirectory(mockProject, '0HoXXXXXXXXXXXX');
      expect(result).to.deep.equal(mockPackageDir);
    });
  });

  describe('applyErrorAction', () => {
    describe('INVALID_TYPE', () => {
      it('should modify error message if packaging is not enabled', () => {
        const error = new Error() as Error & { action: string | undefined };
        error.name = 'INVALID_TYPE';
        error.message = "sObject type 'Package2Version' is not supported";
        const result = applyErrorAction(error) as Error & { action: string | undefined };
        expect(result.action).to.be.include('Packaging is not enabled on this org.');
      });
    });
  });
  describe('massageErrorMessage', () => {
    it('should return the correct error message', () => {
      const error = new Error();
      error.name = 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST';
      const result = massageErrorMessage(error);
      expect(result.message).to.be.equal('Invalid package type');
    });
  });
  describe('getPackageVersionStrings', () => {
    it('should chunk a large query', async () => {
      const conn = await testOrg.getConnection();
      const queryStub = $$.SANDBOX.stub(conn.tooling, 'query').resolves({
        records: [{ MajorVersion: 1 }],
        done: true,
        totalSize: 1,
      });

      // generate a large array of fake subscriber package version IDs
      const spvs = Array.from({ length: 201 }, () => $$.uniqid());
      await getPackageVersionStrings(spvs, conn);
      expect(queryStub.callCount).to.equal(2);
    });
  });
  describe('getPackageVersionNumber', () => {
    it('should return build numbers when includeBuild=true', () => {
      const p2VersionObj = {
        MajorVersion: 1,
        MinorVersion: 3,
        PatchVersion: 5,
        BuildNumber: 7,
      } as PackagingSObjects.Package2Version;
      const res = getPackageVersionNumber(p2VersionObj, true);
      expect(res).to.equal('1.3.5.7');
    });
    it('should NOT return build numbers by default', () => {
      const p2VersionObj = {
        MajorVersion: 1,
        MinorVersion: 3,
        PatchVersion: 5,
        BuildNumber: 7,
      } as PackagingSObjects.Package2Version;
      const res = getPackageVersionNumber(p2VersionObj);
      expect(res).to.equal('1.3.5');
    });
  });
  describe('getContainerOptions', () => {
    it.skip('should return the correct value', () => {});
  });
  describe('getSubscriberPackageVersionId', () => {
    it.skip('should return the correct value', () => {});
  });
  describe('getPackage2TypeBy04type', () => {
    it.skip('should return the correct value', () => {});
  });
  describe('getPackage2TypeBy05type', () => {
    it.skip('should return the correct value', () => {});
  });
  describe('getPackageVersionId', () => {
    it.skip('should return the correct value', () => {});
  });
  describe('validatePatchVersion', () => {
    it.skip('should return the correct value', () => {});
  });
  describe('combineSaveErrors', () => {
    it('should combine crud operations errors', () => {
      const errors = [
        { message: 'error 1', errorCode: 'errorCode 1', fields: ['field1', 'field2'] },
        { message: 'error 2', errorCode: 'errorCode 2', fields: [] },
        { message: 'error 3', errorCode: 'errorCode 3' },
      ] as SaveError[];
      const result = combineSaveErrors('fooObject', 'upsert', errors);
      const messageLines = result.message.split('\n');
      expect(messageLines).to.be.length(4);
      expect(messageLines[0]).to.be.include('An error occurred during CRUD operation upsert on entity fooObject.');
      expect(messageLines[1]).to.be.include('Error: errorCode 1 Message: error 1 Fields: [field1, field2]');
      expect(messageLines[2]).to.be.include('Error: errorCode 2 Message: error 2 ');
      expect(messageLines[3]).to.be.include('Error: errorCode 3 Message: error 3 ');
    });
  });
  describe('numberToDuration', () => {
    it('should covert number 1000 to duration in milliseconds', () => {
      const result = numberToDuration(1000);
      expect(result.milliseconds).to.be.equal(Duration.milliseconds(1000).milliseconds);
    });
    it('should covert number 1000 to duration in minutes', () => {
      const result = numberToDuration(1000, Duration.Unit.MINUTES);
      expect(result.minutes).to.be.equal(Duration.minutes(1000).minutes);
    });
    it('should a treat a duration instance as idempotent', () => {
      const result = numberToDuration(Duration.minutes(1000));
      expect(result.minutes).to.be.equal(Duration.minutes(1000).minutes);
    });
    it('should a treat a undefined number param instance as Duration(0)', () => {
      const result = numberToDuration(undefined);
      expect(result.milliseconds).to.be.equal(Duration.milliseconds(0).milliseconds);
    });
  });
  describe('zipDir', () => {
    let tmpZipDir: string;
    let tmpSrcDir: string;
    beforeEach(() => {
      tmpZipDir = fs.mkdtempSync(`${os.tmpdir()}${path.sep}`);
      tmpSrcDir = fs.mkdtempSync(`${os.tmpdir()}${path.sep}`);
      fs.mkdirSync(path.join(tmpSrcDir, 'empty-dir'), { recursive: true });
      fs.mkdirSync(path.join(tmpSrcDir, 'not-empty-dir', 'empty-sub-dir'), { recursive: true });
      fs.mkdirSync(path.join(tmpSrcDir, 'not-empty-dir', 'sub-dir'), { recursive: true });
      fs.writeFileSync(path.join(tmpSrcDir, 'file1.txt'), 'file contents');
      fs.writeFileSync(path.join(tmpSrcDir, 'file2.txt'), 'file contents');
      fs.writeFileSync(path.join(tmpSrcDir, 'not-empty-dir', 'sub-dir', 'file4.txt'), 'file contents');
      fs.writeFileSync(path.join(tmpSrcDir, 'not-empty-dir', 'file3.txt'), 'file contents');
    });
    afterEach(() => {
      fs.rmSync(tmpZipDir, { recursive: true });
      fs.rmSync(tmpSrcDir, { recursive: true });
    });

    it('should be defined', async () => {
      const entries = [
        'file1.txt',
        'file2.txt',
        'not-empty-dir/',
        'not-empty-dir/file3.txt',
        'not-empty-dir/sub-dir/',
        'not-empty-dir/sub-dir/file4.txt',
      ];
      await zipDir(path.resolve(tmpSrcDir), path.join(tmpZipDir, 'test.zip'));
      try {
        const stat = fs.statSync(path.join(tmpZipDir, 'test.zip'));
        expect(stat.size).to.be.greaterThan(0);
      } catch (e) {
        assert.fail((e as Error).message);
      }

      const zip = await JSZIP.loadAsync(await fs.promises.readFile(path.join(tmpZipDir, 'test.zip')));
      expect(Object.keys(zip.files)).to.have.lengthOf(entries.length);
      zip.forEach((file) => {
        expect(entries.includes(file)).to.be.true;
      });
    });
  });
});
