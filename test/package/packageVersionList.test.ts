/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';
import { SfProject } from '@salesforce/core';
import { instantiateContext, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import {
  assembleQueryParts,
  constructWhere,
  DEFAULT_ORDER_BY_FIELDS,
  validateDays,
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
      const where = constructWhere(['0Ho3h000000xxxxCAG'], 1, 2, true);
      expect(where).to.include("Package2Id IN ('0Ho3h000000xxxxCAG')");
      expect(where).to.include('IsDeprecated = false');
      expect(where).to.include('CreatedDate = LAST_N_DAYS:1');
      expect(where).to.include('LastModifiedDate = LAST_N_DAYS:2');
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
