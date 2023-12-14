/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as globby from 'globby';
import { Logger, Messages, SfProject } from '@salesforce/core';
import { AsyncCreatable } from '@salesforce/kit';
import { PackageXml, ProfileApiOptions } from '../interfaces';
import {
  CorrectedProfile,
  manifestTypesToMap,
  profileObjectToString,
  profileRewriter,
  profileStringToProfile,
} from './profileRewriter';

Messages.importMessagesDirectory(__dirname);
const profileApiMessages = Messages.loadMessages('@salesforce/packaging', 'profile_api');

/*
 * This class provides functions used to re-write .profiles in the project package directories when creating a package2 version.
 * All profiles found in the project package directories are extracted out and then re-written to only include metadata in the
 * profile that is relevant to the source in the package directory being packaged.
 */
export class PackageProfileApi extends AsyncCreatable<ProfileApiOptions> {
  public project: SfProject;
  public includeUserLicenses = false;

  public constructor(options: ProfileApiOptions) {
    super(options);
    this.project = options.project;
    this.includeUserLicenses = options.includeUserLicenses ?? false;
  }

  // eslint-disable-next-line class-methods-use-this,@typescript-eslint/no-empty-function
  public async init(): Promise<void> {}

  /**
   * For any profile present in the project package directories, this function generates a subset of data that only
   * contains references to items in the manifest.
   *
   * return a list of profile file locations that need to be removed from the package because they are empty
   *
   * @param destPath location of new profiles
   * @param manifestTypes: array of objects { name: string, members: string[] } that represent package xml types
   * @param excludedDirectories Directories to not include profiles from
   */
  public generateProfiles(
    destPath: string,
    manifestTypes: PackageXml['types'],
    excludedDirectories: string[] = []
  ): string[] {
    const logger = Logger.childFromRoot('PackageProfileApi');

    return (
      this.getProfilesWithNamesAndPaths(excludedDirectories)
        .map(({ profilePath, name: profileName }) => {
          const originalProfile = profileStringToProfile(fs.readFileSync(profilePath, 'utf-8'));
          const adjustedProfile = profileRewriter(
            originalProfile,
            manifestTypesToMap(manifestTypes),
            this.includeUserLicenses
          );
          return {
            profileName,
            profilePath,
            hasContent: Object.keys(adjustedProfile).length,
            adjustedProfile,
            removedSettings: getRemovedSettings(originalProfile, adjustedProfile),
            xmlFileLocation: getXmlFileLocation(destPath, profilePath),
          };
        })
        // side effect: modify profiles in place
        .filter(({ hasContent, profileName, removedSettings, profilePath, xmlFileLocation, adjustedProfile }) => {
          if (!hasContent) {
            logger.warn(
              `Profile ${profileName} has no content after filtering. It will still be part of the package but you can remove it if it's not needed.`
            );
            return true;
          } else {
            logger.info(profileApiMessages.getMessage('addProfileToPackage', [profileName, profilePath]));
            removedSettings.forEach((setting) => {
              logger.info(profileApiMessages.getMessage('removeProfileSetting', [setting, profileName]));
            });
            fs.writeFileSync(xmlFileLocation, profileObjectToString(adjustedProfile), 'utf-8');
          }
        })
        .map(({ xmlFileLocation }) => xmlFileLocation.replace(/(.*)(\.profile)/, '$1'))
    );
  }

  /**
   * Filter out all profiles in the manifest and if any profiles exist in the project package directories, add them to the manifest.
   *
   * @param typesArr array of objects { name[], members[] } that represent package types JSON.
   * @param excludedDirectories Direcotires not to generate profiles for
   */
  public filterAndGenerateProfilesForManifest(
    typesArr: PackageXml['types'],
    excludedDirectories: string[] = []
  ): PackageXml['types'] {
    const profilePathsWithNames = this.getProfilesWithNamesAndPaths(excludedDirectories);

    // Filter all profiles, and add back the ones we found names for
    return typesArr
      .filter((kvp) => kvp.name !== 'Profile')
      .concat([{ name: 'Profile', members: profilePathsWithNames.map((i) => i.name) }]);
  }

  // Look for profiles in all package directories
  private findAllProfiles(excludedDirectories: string[] = []): string[] {
    const ignore = excludedDirectories.map((dir) => `**/${dir.split(path.sep).join(path.posix.sep)}/**`);
    const patterns = this.project
      .getUniquePackageDirectories()
      .map((pDir) => pDir.fullPath)
      .map((fullDir) =>
        os.type() === 'Windows_NT'
          ? path.posix.join(...fullDir.split(path.sep), '**', '*.profile-meta.xml')
          : path.join(fullDir, '**', '*.profile-meta.xml')
      );
    return globby.sync(patterns, { ignore });
  }

  private getProfilesWithNamesAndPaths(excludedDirectories: string[]): Array<Required<ProfilePathWithName>> {
    return this.findAllProfiles(excludedDirectories)
      .map((profilePath) => ({ profilePath, name: profilePathToName(profilePath) }))
      .filter(isProfilePathWithName);
  }
}

type ProfilePathWithName = { profilePath: string; name?: string };

const isProfilePathWithName = (
  profilePathWithName: ProfilePathWithName
): profilePathWithName is Required<ProfilePathWithName> => typeof profilePathWithName.name === 'string';

const profilePathToName = (profilePath: string): string | undefined =>
  profilePath.match(/([^/]+)\.profile-meta.xml/)?.[1];

const getXmlFileLocation = (destPath: string, profilePath: string): string =>
  path.join(destPath, path.basename(profilePath).replace(/(.*)(-meta.xml)/, '$1'));

const getRemovedSettings = (originalProfile: CorrectedProfile, adjustedProfile: CorrectedProfile): string[] => {
  const originalProfileSettings = Object.keys(originalProfile);
  const adjustedProfileSettings = new Set(Object.keys(adjustedProfile));
  return originalProfileSettings.filter((setting) => !adjustedProfileSettings.has(setting));
};
