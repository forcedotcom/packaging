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
  public static parseMajorMinor(versionString: string): { major: number | null; minor: number | null } {
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

  public static from(versionString: string | undefined): VersionNumber {
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
      if (isNaN(asNumbers[3]) && !VersionNumber.isABuildKeyword(build)) {
        throw messages.createError('errorInvalidBuildNumberToken', [
          versionString,
          Object.values(BuildNumberToken).join(', '),
        ]);
      }
      return new VersionNumber(major, minor, patch, build);
    }
    throw messages.createError('errorInvalidVersionNumber', [versionString]);
  }

  public static isABuildKeyword(token: string | number): boolean {
    const buildNumberTokenValues = Object.values(BuildNumberToken);
    const results = buildNumberTokenValues.includes(token as BuildNumberToken);
    return results;
  }

  public toString(): string {
    {
      return `${this.major || '0'}.${this.minor || '0'}.${this.patch || '0'}.${this.build ? `${this.build}` : '0'}`;
    }
  }

  public isBuildKeyword(): boolean {
    return VersionNumber.isABuildKeyword(this.build);
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
