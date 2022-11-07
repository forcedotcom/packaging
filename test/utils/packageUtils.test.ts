/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assert, expect } from 'chai';
import { Connection, SfProject } from '@salesforce/core';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { SaveError } from 'jsforce';
import { Duration } from '@salesforce/kit';
import * as JSZIP from 'jszip';
import {
  applyErrorAction,
  getPackageVersionNumber,
  getInClauseItemsCount,
  massageErrorMessage,
  queryWithInConditionChunking,
  combineSaveErrors,
  getConfigPackageDirectory,
  zipDir,
  numberToDuration,
} from '../../src/utils/packageUtils';
import { PackagingSObjects } from '../../src/interfaces';

describe('packageUtils', () => {
  const $$ = instantiateContext();

  beforeEach(() => {
    stubContext($$);
  });

  afterEach(() => {
    restoreContext($$);
  });

  describe('getConfigPackageDirectory', () => {
    it('should through if "packageDirectories" is not present or empty', async () => {
      $$.inProject(true);
      const project = await SfProject.resolve();
      expect(() => getConfigPackageDirectory(project.getPackageDirectories(), 'default', true)).to.throw;
    });
    it('should return default package directory', async () => {
      const result = getConfigPackageDirectory(
        [
          { name: 'foo', default: true, path: 'default', fullPath: 'fullPath' },
          { name: 'bar', path: 'default', fullPath: 'fullPath' },
        ],
        'default',
        true
      );
      expect(result).to.have.property('path', 'default');
      expect(result).to.have.property('fullPath', 'fullPath');
    });
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
  describe('getInClauseItemsCount', () => {
    it("should return count 1 when each formatted element's length is equal to max length", () => {
      const items = ['foo', 'bar', 'baz'];
      while (items.length !== 0) {
        const result = getInClauseItemsCount(items, 0, 6);
        expect(result).to.be.equal(1);
        items.pop();
      }
    });
    it("should return count 0 when each formatted element's length is greater than max length", () => {
      const items = ['foox', 'barx', 'bazx'];
      while (items.length !== 0) {
        const result = getInClauseItemsCount(items, 0, 6);
        expect(result).to.be.equal(0);
        items.pop();
      }
    });
  });
  describe('applyErrorAction', () => {
    describe('INVALID_TYPE', () => {
      it('should modify error message if packaging is not enabled', () => {
        const error = new Error();
        error.name = 'INVALID_TYPE';
        error.message = "sObject type 'Package2Version' is not supported";
        error['action'] = [];
        const result = applyErrorAction(error);
        expect(result['action']).to.be.include('Packaging is not enabled on this org.');
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
  describe('queryWithInConditionChunking', () => {
    it('should run the correct query', async () => {
      const testOrg = new MockTestOrgData();
      await $$.stubAuths(testOrg);
      const connection = await testOrg.getConnection();
      const result = await queryWithInConditionChunking(
        'select id from Package2Version where id %ID%',
        ['foox', 'barx', 'bazx'],
        '%ID%',
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        connection as Connection
      );
      expect(result).to.be.ok;
    });
    it('should fail for item being too large', async () => {
      const testOrg = new MockTestOrgData();
      await $$.stubAuths(testOrg);
      const connection = await testOrg.getConnection();
      try {
        await queryWithInConditionChunking(
          'select id from Package2Version where id %ID%',
          ['f'.repeat(4000), 'barx', 'bazx'],
          '%ID%',
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          connection as Connection
        );
        assert.fail('should have thrown');
      } catch (e) {
        expect(e.message).to.be.include('When calculating the number of items to be included in query');
      }
    });
  });
  describe('getPackageVersionStrings', () => {
    it.skip('should return the correct version strings', () => {});
  });
  describe('getHasMetadataRemoved', () => {
    it.skip('should return the correct value', () => {});
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
    it('should a treat a undefined number param instance as idempotent', () => {
      const result = numberToDuration(undefined);
      expect(result).to.be.not.ok;
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
