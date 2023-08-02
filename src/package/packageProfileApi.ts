/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as path from 'path';
import * as fs from 'fs';
import * as glob from 'glob';
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
 * This class provides functions used to re-write .profiles in the workspace when creating a package2 version.
 * All profiles found in the workspaces are extracted out and then re-written to only include metadata in the profile
 * that is relevant to the source in the package directory being packaged.
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
   * For any profile present in the workspace, this function generates a subset of data that only contains references
   * to items in the manifest.
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
      getProfilesWithNamesAndPaths({
        projectPath: this.project.getPath(),
        excludedDirectories,
      })
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
              `Profile ${profileName} has no content after filtering. It will still be part of the package but you can remove if it it's not needed.`
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
   * Filter out all profiles in the manifest and if any profiles exists in the workspace, add them to the manifest.
   *
   * @param typesArr array of objects { name[], members[] } that represent package types JSON.
   * @param excludedDirectories Direcotires not to generate profiles for
   */
  public filterAndGenerateProfilesForManifest(
    typesArr: PackageXml['types'],
    excludedDirectories: string[] = []
  ): PackageXml['types'] {
    const profilePathsWithNames = getProfilesWithNamesAndPaths({
      projectPath: this.project.getPath(),
      excludedDirectories,
    });

    // Filter all profiles, and add back the ones we found names for
    return typesArr
      .filter((kvp) => kvp.name !== 'Profile')
      .concat([{ name: 'Profile', members: profilePathsWithNames.map((i) => i.name) }]);
  }
}

const findAllProfiles = ({
  projectPath,
  excludedDirectories = [],
}: {
  projectPath: string;
  excludedDirectories?: string[];
}): string[] =>
  glob.sync(path.join(projectPath, '**', '*.profile-meta.xml'), {
    ignore: excludedDirectories.map((dir) => `**/${dir}/**`),
  });

type ProfilePathWithName = { profilePath: string; name?: string };

const isProfilePathWithName = (
  profilePathWithName: ProfilePathWithName
): profilePathWithName is Required<ProfilePathWithName> => typeof profilePathWithName.name === 'string';

const profilePathToName = (profilePath: string): string | undefined =>
  profilePath.match(/([^/]+)\.profile-meta.xml/)?.[1];

const getProfilesWithNamesAndPaths = ({
  projectPath,
  excludedDirectories,
}: {
  projectPath: string;
  excludedDirectories: string[];
}): Array<Required<ProfilePathWithName>> =>
  findAllProfiles({ projectPath, excludedDirectories })
    .map((profilePath) => ({ profilePath, name: profilePathToName(profilePath) }))
    .filter(isProfilePathWithName);

const getXmlFileLocation = (destPath: string, profilePath: string): string =>
  path.join(destPath, path.basename(profilePath).replace(/(.*)(-meta.xml)/, '$1'));

const getRemovedSettings = (originalProfile: CorrectedProfile, adjustedProfile: CorrectedProfile): string[] => {
  const originalProfileSettings = Object.keys(originalProfile);
  const adjustedProfileSettings = new Set(Object.keys(adjustedProfile));
  return originalProfileSettings.filter((setting) => !adjustedProfileSettings.has(setting));
};
