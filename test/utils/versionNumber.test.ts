/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';
import { VersionNumber } from '../../src/utils/versionNumber';

describe('VersionNumber', () => {
  it('should be able to parse a version number', () => {
    const version = VersionNumber.from('1.2.3.4');
    expect(version.major).to.be.equal('1');
    expect(version.minor).to.be.equal('2');
    expect(version.patch).to.be.equal('3');
    expect(version.build).to.be.equal('4');
    expect(version.toString()).to.be.equal('1.2.3.4');
  });
  it('should be able to parse a version number with build token', () => {
    const version = VersionNumber.from('1.2.3.NONE');
    expect(version.major).to.be.equal('1');
    expect(version.minor).to.be.equal('2');
    expect(version.patch).to.be.equal('3');
    expect(version.build).to.be.equal('NONE');
    expect(version.toString()).to.be.equal('1.2.3.NONE');
  });
  it('should throw if version number does not have four nodes', () => {
    expect(() => VersionNumber.from('1.2.3')).to.throw(
      Error,
      'VersionNumber must be in the format major.minor.patch.build but the value found is [1.2.3]'
    );
  });
  it('should throw if version number does not contain numbers', () => {
    expect(() => VersionNumber.from('.a.b.')).to.throw(
      Error,
      'VersionNumber parts major, minor or patch must be a number but the value found is [.a.b.].'
    );
  });
  it('should throw if version number build token is invalid', () => {
    expect(() => VersionNumber.from('1.2.3.none')).to.throw(
      Error,
      "The provided VersionNumber '1.2.3.none' is invalid. Build number token must be a number or one of these tokens 'LATEST, NEXT, RELEASED, HIGHEST, NONE'."
    );
  });
  it('should throw if version number undefined', () => {
    expect(() => VersionNumber.from(undefined)).to.throw(Error, 'The VersionNumber property must be specified.');
  });
  it('should sort version numbers', () => {
    const versions = [
      VersionNumber.from('1.0.0.0'),
      VersionNumber.from('1.1.0.0'),
      VersionNumber.from('2.0.0.0'),
      VersionNumber.from('2.0.2.0'),
      VersionNumber.from('3.0.0.0'),
      VersionNumber.from('3.0.0.3'),
      VersionNumber.from('3.0.0.NONE'),
    ];
    const sorted = [...versions].reverse().sort((a, b) => a.compareTo(b));
    expect(sorted).to.deep.equal(versions);
  });
});
