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
   * @param destPath location of new profiles
   * @param manifestTypes: array of objects { name: string, members: string[] } that represent package xml types
   * @param excludedDirectories Directories to not include profiles from
   */
  public generateProfiles(
    destPath: string,
    manifestTypes: PackageXml['Package']['types'],
    excludedDirectories: string[] = []
  ): string[] {
    const logger = Logger.childFromRoot('PackageProfileApi');
    const profilePathsWithNames = getProfilesWithNamesAndPaths({
      projectPath: this.project.getPath(),
      excludedDirectories,
    });

    const results = profilePathsWithNames.map(({ profilePath, name: profileName }) => {
      const originalProfile = profileStringToProfile(fs.readFileSync(profilePath, 'utf-8'));
      const adjustedProfile = profileRewriter(
        originalProfile,
        manifestTypesToMap(manifestTypes),
        this.includeUserLicenses
      );
      const hasContent = Object.keys(adjustedProfile).length;
      return { profileName, profilePath, hasContent, adjustedProfile, originalProfile };
    });

    // update profiles with content
    results
      .filter((result) => result.hasContent)
      .map(({ profilePath, adjustedProfile, profileName, originalProfile }) => {
        logger.info(profileApiMessages.getMessage('addProfileToPackage', [profileName, profilePath]));
        getRemovedSettings(originalProfile, adjustedProfile).forEach((setting) => {
          logger.info(profileApiMessages.getMessage('removeProfileSetting', [setting, profileName]));
        });
        fs.writeFileSync(getXmlFileLocation(destPath, profilePath), profileObjectToString(adjustedProfile), 'utf-8');
      });

    return results
      .filter((result) => !result.hasContent)
      .map((profile) => {
        const xmlFile = getXmlFileLocation(destPath, profile.profilePath);
        const replacedProfileName = xmlFile.replace(/(.*)(\.profile)/, '$1');
        deleteButAllowEnoent(xmlFile);
        logger.info(profileApiMessages.getMessage('profileNotIncluded', [replacedProfileName]));
        return replacedProfileName;
      });
  }

  /**
   * Filter out all profiles in the manifest and if any profiles exists in the workspace, add them to the manifest.
   *
   * @param typesArr array of objects { name[], members[] } that represent package types JSON.
   * @param excludedDirectories Direcotires not to generate profiles for
   */
  public filterAndGenerateProfilesForManifest(
    typesArr: PackageXml['Package']['types'],
    excludedDirectories: string[] = []
  ): PackageXml['Package']['types'] {
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

const deleteButAllowEnoent = (destFilePath: string): void => {
  try {
    fs.unlinkSync(destFilePath);
  } catch (err) {
    // It is normal for the file to not exist if the profile is in the workspace but not in the directory being packaged.
    if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
      throw err;
    }
  }
};

const getRemovedSettings = (originalProfile: CorrectedProfile, adjustedProfile: CorrectedProfile): string[] => {
  const originalProfileSettings = Object.keys(originalProfile);
  const adjustedProfileSettings = Object.keys(adjustedProfile);
  return originalProfileSettings.filter((setting) => !adjustedProfileSettings.includes(setting));
};
