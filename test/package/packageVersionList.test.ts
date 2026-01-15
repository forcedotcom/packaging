/*
 * Copyright 2026, Salesforce, Inc.
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
import { SfProject } from '@salesforce/core';
import { instantiateContext, restoreContext, stubContext } from '@salesforce/core/testSetup';
import {
  assembleQueryParts,
  constructWhere,
  DEFAULT_ORDER_BY_FIELDS,
  validateDays,
  constructQuery,
} from '../../src/package/packageVersionList';

describe('package version list', () => {
  const $$ = instantiateContext();

  beforeEach(() => {
    stubContext($$);
  });

  afterEach(() => {
    restoreContext($$);
  });

  describe('_getLastDays', () => {
    it('should return the last days of 7', () => {
      expect(validateDays('seven', 7)).to.equal(7);
    });
    it('should return the last days of 0', () => {
      expect(validateDays('zero', 0)).to.equal(0);
    });
    it('should throw with negative number as input', () => {
      expect(() => validateDays('negative', -1)).to.throw(/Provide a valid positive number for negative. -1/);
    });
    it('should throw missing lastDays input', () => {
      expect(() => validateDays('negative')).to.throw(/Provide a valid positive number for negative. -1/);
    });
    it('should throw with undefined as input', () => {
      expect(() => validateDays('negative', undefined)).to.throw(/Provide a valid positive number for negative. -1/);
    });
  });
  describe('_constructWhere', () => {
    // the following package dirs and aliases were extracted from the Salesforce Dreamhouse LWC repo
    const packageDirectories = [
      {
        path: 'force-app',
        default: true,
        package: 'DreamhouseLWC',
        versionName: "Summer '21",
        versionNumber: '53.0.0.NEXT',
      },
    ];

    const packageAliases = {
      DreamhouseLWC: '0Ho3h000000xxxxCAG',
    };

    it('should create where clause contain proper values', async () => {
      $$.inProject(true);
      const sfProject = await SfProject.resolve();
      sfProject.getSfProjectJson().set('packageDirectories', packageDirectories);
      sfProject.getSfProjectJson().set('packageAliases', packageAliases);
      const where = constructWhere({
        packages: ['0Ho3h000000xxxxCAG'],
        createdLastDays: 1,
        modifiedLastDays: 2,
        isReleased: true,
      });
      expect(where).to.include("Package2Id IN ('0Ho3h000000xxxxCAG')");
      expect(where).to.include('IsDeprecated = false');
      expect(where).to.include('CreatedDate = LAST_N_DAYS:1');
      expect(where).to.include('LastModifiedDate = LAST_N_DAYS:2');
    });

    it('should create where clause contain proper values and branch', async () => {
      $$.inProject(true);
      const sfProject = await SfProject.resolve();
      sfProject.getSfProjectJson().set('packageDirectories', packageDirectories);
      sfProject.getSfProjectJson().set('packageAliases', packageAliases);
      const where = constructWhere({
        packages: ['0Ho3h000000xxxxCAG'],
        createdLastDays: 1,
        modifiedLastDays: 2,
        isReleased: true,
        branch: 'main',
      });
      expect(where).to.include("Package2Id IN ('0Ho3h000000xxxxCAG')");
      expect(where).to.include('IsDeprecated = false');
      expect(where).to.include('CreatedDate = LAST_N_DAYS:1');
      expect(where).to.include('LastModifiedDate = LAST_N_DAYS:2');
      expect(where).to.include("Branch='main'");
    });
  });

  describe('_constructQuery', () => {
    it('should include verbose fields', async () => {
      const options = {
        packages: ['0Ho3h000000xxxxCAG'],
        createdLastDays: 1,
        modifiedLastDays: 2,
        isReleased: true,
        verbose: true,
      };
      const constQuery = constructQuery(50, options);
      expect(constQuery).to.include('CodeCoverage');
      expect(constQuery).to.include('HasPassedCodeCoverageCheck');
      expect(constQuery).to.not.include('Language');
    });

    it('should include verbose fields with langage', async () => {
      const options = {
        packages: ['0Ho3h000000xxxxCAG'],
        createdLastDays: 1,
        modifiedLastDays: 2,
        isReleased: true,
        verbose: true,
      };
      const constQuery = constructQuery(59, options);
      expect(constQuery).to.include('CodeCoverage');
      expect(constQuery).to.include('HasPassedCodeCoverageCheck');
      expect(constQuery).to.include('Language');
    });

    it('should not include verbose fields', async () => {
      const options = {
        packages: ['0Ho3h000000xxxxCAG'],
        createdLastDays: 1,
        modifiedLastDays: 2,
        isReleased: true,
      };
      const constQuery = constructQuery(59, options);
      expect(constQuery).to.not.include('CodeCoverage');
      expect(constQuery).to.not.include('HasPassedCodeCoverageCheck');
      expect(constQuery).to.not.include('Language');
    });

    it('should include validatedAsync field', async () => {
      const options = {
        packages: ['0Ho3h000000xxxxCAG'],
        createdLastDays: 1,
        modifiedLastDays: 2,
        isReleased: true,
      };
      const constQuery = constructQuery(61, options);
      expect(constQuery).to.include('ValidatedAsync');
    });

    it('should not include validatedAsync field', async () => {
      const options = {
        packages: ['0Ho3h000000xxxxCAG'],
        createdLastDays: 1,
        modifiedLastDays: 2,
        isReleased: true,
      };
      const constQuery = constructQuery(59, options);
      expect(constQuery).to.not.include('ValidatedAsync');
    });
  });

  describe('_assembleQueryParts', () => {
    it('should return the proper query', () => {
      const assembly = assembleQueryParts('select foo,bar,baz from foobarbaz', ['foo=1', "bar='2'"], 'foo,bar,baz');
      expect(assembly).to.include('select foo,bar,baz from foobarbaz');
      expect(assembly).to.include("WHERE foo=1 AND bar='2'");
      expect(assembly).to.include('ORDER BY foo,bar,baz');
    });
    it('should return the proper query when no where parts supplied', () => {
      const assembly = assembleQueryParts('select foo,bar,baz from foobarbaz', [], 'foo,bar,baz');
      expect(assembly).to.include('select foo,bar,baz from foobarbaz');
      expect(assembly).not.include("WHERE foo=1 AND bar='2'");
      expect(assembly).to.include('ORDER BY foo,bar,baz');
    });
    it('should return the proper query when no order by parts supplied', () => {
      const assembly = assembleQueryParts('select foo,bar,baz from foobarbaz', []);
      expect(assembly).to.include('select foo,bar,baz from foobarbaz');
      expect(assembly).not.include("WHERE foo=1 AND bar='2'");
      expect(assembly).to.include(`ORDER BY ${DEFAULT_ORDER_BY_FIELDS}`);
    });
  });
});
