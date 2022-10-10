/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Messages } from '@salesforce/core';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'version_number');

export enum BuildNumberToken {
  LATEST_BUILD_NUMBER_TOKEN = 'LATEST',
  NEXT_BUILD_NUMBER_TOKEN = 'NEXT',
  RELEASED_BUILD_NUMBER_TOKEN = 'RELEASED',
  HIGHEST_VERSION_NUMBER_TOKEN = 'HIGHEST',
  NONE_VERSION_NUMBER_TOKEN = 'NONE',
}

export class VersionNumber {
  public constructor(
    public major: string | number,
    public minor: string | number,
    public patch: string | number,
    public build: string | number
  ) {}

  /**
   * Separates at major.minor string into {major: Number, minor: Number} object
   *
   * @param versionString a string in the format of major.minor like '3.2'
   */
  public static parseMajorMinor(versionString: string): { major: number; minor: number } {
    const versions = versionString?.split('.');
    if (!versions) {
      // return nulls so when no version option is provided, the server can infer the correct version
      return { major: null, minor: null };
    }

    if (versions.length === 2) {
      return {
        major: Number(versions[0]),
        minor: Number(versions[1]),
      };
    } else {
      throw messages.createError('invalidMajorMinorFormat', [versionString]);
    }
  }

  public static from(versionString: string): VersionNumber {
    if (!versionString) {
      throw messages.createError('errorMissingVersionNumber');
    }
    const version = versionString.split('.');
    if (version?.length === 4) {
      const [major, minor, patch, build] = version;
      const asNumbers = [major, minor, patch, build].map((v) => parseInt(v, 10));
      if (asNumbers.slice(0, 3).some((v) => isNaN(v))) {
        throw messages.createError('errorInvalidMajorMinorPatchNumber', [versionString]);
      }
      if (isNaN(asNumbers[3]) && !(Object.values(BuildNumberToken) as string[]).includes(build)) {
        throw messages.createError('errorInvalidBuildNumberToken', [
          versionString,
          Object.values(BuildNumberToken).join(', '),
        ]);
      }
      return new VersionNumber(major, minor, patch, build);
    }
    throw messages.createError('errorInvalidVersionNumber', [versionString]);
  }

  public toString(): string {
    {
      return `${this.major || '0'}.${this.minor || '0'}.${this.patch || '0'}.${this.build ? `${this.build}` : '0'}`;
    }
  }

  public isbuildKeyword(): boolean {
    return Object.values(BuildNumberToken)
      .map((v) => v.toString())
      .includes(typeof this.build === 'string' && this.build.toUpperCase());
  }

  public compareTo(other: VersionNumber): number {
    const [aMajor, aMinor, aPatch, aBuild] = [this.major, this.minor, this.patch, this.build].map((v) =>
      typeof v === 'number' ? v : parseInt(v, 10)
    );
    const [oMajor, oMinor, oPatch, oBuild] = [other.major, other.minor, other.patch, other.build].map((v) =>
      typeof v === 'number' ? v : parseInt(v, 10)
    );
    if (aMajor !== oMajor) {
      return aMajor - oMajor;
    }
    if (aMinor !== oMinor) {
      return aMinor - oMinor;
    }
    if (aPatch !== oPatch) {
      return aPatch - oPatch;
    }
    if (isNaN(aBuild) && isNaN(oBuild)) {
      return 0;
    }
    if (isNaN(aBuild)) {
      return 1;
    }
    if (isNaN(oBuild)) {
      return -1;
    }
    if (aBuild !== oBuild) {
      return aBuild - oBuild;
    }
    return 0;
  }
}
