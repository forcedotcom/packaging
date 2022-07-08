/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Messages } from '@salesforce/core';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

export enum BuildNumberToken {
  LATEST_BUILD_NUMBER_TOKEN = 'LATEST',
  NEXT_BUILD_NUMBER_TOKEN = 'NEXT',
  RELEASED_BUILD_NUMBER_TOKEN = 'RELEASED',
  HIGHEST_VERSION_NUMBER_TOKEN = 'HIGHEST',
  NONE_VERSION_NUMBER_TOKEN = 'NONE',
}

export class VersionNumber {
  private constructor(public major: string, public minor: string, public patch: string, public build: string) {}

  public static from(versionString: string): VersionNumber {
    if (!versionString) {
      throw new Error(messages.getMessage('errorMissingVersionNumber'));
    }
    const version = versionString.split('.');
    if (version?.length === 4) {
      const [major, minor, patch, build] = version;
      const asNumbers = [major, minor, patch, build].map((v) => parseInt(v, 10));
      if (asNumbers.slice(0, 3).some((v) => isNaN(v))) {
        throw new Error(messages.getMessage('errorInvalidMajorMinorPatchNumber', [versionString]));
      }
      if (isNaN(asNumbers[3]) && !(Object.values(BuildNumberToken) as string[]).includes(build)) {
        throw new Error(
          messages.getMessage('errorInvalidBuildNumberToken', [
            versionString,
            Object.values(BuildNumberToken).join(', '),
          ])
        );
      }
      return new VersionNumber(major, minor, patch, build);
    }
    throw new Error(messages.getMessage('errorInvalidVersionNumber', [versionString]));
  }

  public toString(): string {
    {
      return `${this.major || '0'}.${this.minor || '0'}.${this.patch || '0'}.${this.build ? `${this.build}` : '0'}`;
    }
  }

  public isbuildKeyword(): boolean {
    return Object.values(BuildNumberToken)
      .map((v) => v.toString())
      .includes(this.build.toLowerCase());
  }
}
