/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import * as path from 'path';
import * as fs from 'fs';
import * as glob from 'glob';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Messages, SfError, SfProject } from '@salesforce/core';
import { AsyncCreatable } from '@salesforce/kit';
import { ProfileApiOptions } from '../interfaces';

Messages.importMessagesDirectory(__dirname);
const profileApiMessages = Messages.loadMessages('@salesforce/packaging', 'profile_api');

// nodeEntities is used to determine which elements in the profile are relevant to the source being packaged.
// name refers to the entity type name in source that the element pertains to.  As an example, a profile may
// have an entry like the example below, which should only be added to the packaged profile if the related
// CustomObject is in the source being packaged:
//   <objectPermissions>
//      <allowCreate>true</allowCreate>
//       ...
//      <object>MyCustomObject__c</object>
//       ...
//   </objectPermissions>
//
// For this example: nodeEntities.parentElement = objectPermissions and nodeEntities.childElement = object
const NODE_ENTITIES = {
  name: [
    'CustomObject',
    'CustomField',
    'Layout',
    'CustomTab',
    'CustomApplication',
    'ApexClass',
    'CustomPermission',
    'ApexPage',
    'ExternalDataSource',
    'RecordType',
  ],
  parentElement: [
    'objectPermissions',
    'fieldPermissions',
    'layoutAssignments',
    'tabVisibilities',
    'applicationVisibilities',
    'classAccesses',
    'customPermissions',
    'pageAccesses',
    'externalDataSourceAccesses',
    'recordTypeVisibilities',
  ],
  childElement: [
    'object',
    'field',
    'layout',
    'tab',
    'application',
    'apexClass',
    'name',
    'apexPage',
    'externalDataSource',
    'recordType',
  ],
};

// There are some profile settings that are allowed to be packaged that may not necessarily map to a specific metadata
// object. We should still handle these accordingly, but a little differently than the above mentioned types.
const OTHER_PROFILE_SETTINGS = {
  name: ['CustomSettings', 'CustomMetadataTypeAccess'],
  parentElement: ['customSettingAccesses', 'customMetadataTypeAccesses'],
  childElement: ['name', 'name'],
};

/*
 * This class provides functions used to re-write .profiles in the workspace when creating a package2 version.
 * All profiles found in the workspaces are extracted out and then re-written to only include metadata in the profile
 * that is relevant to the source in the package directory being packaged.
 */
export class PackageProfileApi extends AsyncCreatable<ProfileApiOptions> {
  public readonly profiles: ProfileInformation[] = [];
  public nodeEntities = NODE_ENTITIES;
  public otherProfileSettings = OTHER_PROFILE_SETTINGS;
  public project: SfProject;
  public includeUserLicenses = false;
  public generateProfileInformation = false;

  public constructor(options: ProfileApiOptions) {
    super(options);
    this.project = options.project;
    this.includeUserLicenses = options.includeUserLicenses ?? false;
    this.generateProfileInformation = options.generateProfileInformation ?? false;
  }

  // eslint-disable-next-line class-methods-use-this,@typescript-eslint/no-empty-function
  public async init(): Promise<void> {}

  /**
   * For any profile present in the workspace, this function generates a subset of data that only contains references
   * to items in the manifest.
   *
   * @param destPath location of new profiles
   * @param manifest
   * @param excludedDirectories Directories to not include profiles from
   */
  public generateProfiles(
    destPath: string,
    manifest: {
      Package: Array<{ name: string[]; members: string[] }>;
    },
    excludedDirectories: string[] = []
  ): string[] {
    const excludedProfiles: string[] = [];

    const profilePaths = this.findAllProfiles(excludedDirectories);

    if (!profilePaths) {
      return excludedProfiles;
    }

    profilePaths.forEach((profilePath) => {
      // profile metadata can present in any directory in the package structure
      const profileNameMatch = profilePath.match(/([^/]+)\.profile-meta.xml/);
      const profileName = profileNameMatch ? profileNameMatch[1] : null;
      if (profileName) {
        const profileDom = new DOMParser().parseFromString(fs.readFileSync(profilePath, 'utf-8'));
        const newDom = new DOMParser().parseFromString(
          '<?xml version="1.0" encoding="UTF-8"?><Profile xmlns="http://soap.sforce.com/2006/04/metadata"></Profile>'
        );
        const profileNode = newDom.getElementsByTagName('Profile')[0];
        let hasNodes = false;

        // We need to keep track of all the members for when we package up the "OtherProfileSettings"
        let allMembers: string[] = [];
        manifest.Package.forEach((element) => {
          const name = element.name;
          const members = element.members;
          allMembers = allMembers.concat(members);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
          const idx = this.nodeEntities.name.indexOf(name[0]);
          if (idx > -1) {
            hasNodes =
              this.copyNodes(
                profileDom,
                this.nodeEntities.parentElement[idx],
                this.nodeEntities.childElement[idx],
                members,
                profileNode,
                profileName
              ) ?? hasNodes;
          }
        });

        // Go through each of the other profile settings we might want to include. We pass in "all" the members since these
        // will reference anything that could be packaged. The "copyNodes" function will only include the type if it
        // exists in the profile itself
        this.otherProfileSettings.name.forEach((element) => {
          const idx = this.otherProfileSettings.name.indexOf(element);
          if (idx > -1) {
            hasNodes =
              this.copyNodes(
                profileDom,
                this.otherProfileSettings.parentElement[idx],
                this.otherProfileSettings.childElement[idx],
                allMembers,
                profileNode,
                profileName
              ) ?? hasNodes;
          }
        });

        // add userLicenses to the profile
        if (this.includeUserLicenses) {
          const userLicenses = profileDom.getElementsByTagName('userLicense');
          if (userLicenses) {
            hasNodes = true;
            for (const userLicense of Array.from(userLicenses)) {
              profileNode.appendChild(userLicense.cloneNode(true));
            }
          }
        }

        const xmlSrcFile = path.basename(profilePath);
        const xmlFile = xmlSrcFile.replace(/(.*)(-meta.xml)/, '$1');
        const destFilePath = path.join(destPath, xmlFile);
        if (hasNodes) {
          const serializer = new XMLSerializer();
          serializer.serializeToString(newDom);
          fs.writeFileSync(destFilePath, serializer.serializeToString(newDom), 'utf-8');
        } else {
          // remove from manifest
          // eslint-disable-next-line @typescript-eslint/no-shadow
          const profileName = xmlFile.replace(/(.*)(\.profile)/, '$1');
          excludedProfiles.push(profileName);
          if (this.generateProfileInformation) {
            const profile = this.profiles.find(({ ProfileName }) => ProfileName === profileName);
            if (profile) {
              profile.setIsPackaged(false);
            }
          }

          try {
            fs.unlinkSync(destFilePath);
          } catch (err) {
            // It is normal for the file to not exist if the profile is in the workspace but not in the directory being packaged.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
              throw err;
            }
          }
        }
      }
    });

    return excludedProfiles;
  }

  /**
   * Filter out all profiles in the manifest and if any profiles exists in the workspace, add them to the manifest.
   *
   * @param typesArr array of objects { name[], members[] } that represent package types JSON.
   * @param excludedDirectories Direcotires not to generate profiles for
   */
  public filterAndGenerateProfilesForManifest(
    typesArr: Array<{ name: string[]; members: string[] }>,
    excludedDirectories: string[] = []
  ): Array<{ name: string[]; members: string[] }> {
    const profilePaths = this.findAllProfiles(excludedDirectories);

    // Filter all profiles
    typesArr = (typesArr ?? []).filter((kvp) => kvp.name[0] !== 'Profile');

    if (profilePaths) {
      const members: string[] = [];

      profilePaths.forEach((profilePath) => {
        // profile metadata can present in any directory in the package structure
        const profileNameMatch = profilePath.match(/([^/]+)\.profile-meta.xml/);
        const profileName = profileNameMatch ? profileNameMatch[1] : null;
        if (profileName) {
          members.push(profileName);
          if (this.generateProfileInformation) {
            this.profiles.push(new ProfileInformation(profileName, profilePath, true, []));
          }
        }
      });
      if (members.length > 0) {
        typesArr.push({ name: ['Profile'], members });
      }
    }

    return typesArr;
  }

  public getProfileInformation(): ProfileInformation[] {
    return this.profiles;
  }

  private copyNodes(
    originalDom: Document,
    parentElement: string,
    childElement: string,
    members: string[],
    appendToNode: Element,
    profileName: string
  ): boolean {
    let nodesAdded = false;

    const nodes = originalDom.getElementsByTagName(parentElement);
    if (!nodes) {
      return nodesAdded;
    }

    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let i = 0; i < nodes.length; i++) {
      const name = nodes[i].getElementsByTagName(childElement)[0].childNodes[0].nodeValue;
      if (name) {
        if (members.includes(name)) {
          // appendChild will take the passed in node (newNode) and find the parent if it exists and then remove
          // the newNode from the parent.  This causes issues with the way this is copying the nodes, so pass in a clone instead.
          const currentNode = nodes[i].cloneNode(true);
          appendToNode.appendChild(currentNode);
          nodesAdded = true;
        } else if (this.generateProfileInformation) {
          // Tell the user which profile setting has been removed from the package
          const profile = this.profiles.find(({ ProfileName }) => ProfileName === profileName);
          if (profile) {
            profile.appendRemovedSetting(name);
          }
        }
      }
    }
    return nodesAdded;
  }

  private findAllProfiles(excludedDirectories: string[] = []): string[] {
    return glob.sync(path.join(this.project.getPath(), '**', '*.profile-meta.xml'), {
      ignore: excludedDirectories.map((dir) => `**/${dir}/**`),
    });
  }
}

class ProfileInformation {
  public constructor(
    public ProfileName: string,
    public ProfilePath: string,
    public IsPackaged: boolean,
    public settingsRemoved: string[]
  ) {}

  public setIsPackaged(IsPackaged: boolean): void {
    this.IsPackaged = IsPackaged;
  }

  public appendRemovedSetting(setting: string): void {
    this.settingsRemoved.push(setting);
  }

  public logDebug(): string {
    let info = profileApiMessages.getMessage('addProfileToPackage', [this.ProfileName, this.ProfilePath]);
    this.settingsRemoved.forEach((setting) => {
      info += '\n\t' + profileApiMessages.getMessage('removeProfileSetting', [setting, this.ProfileName]);
    });
    if (!this.IsPackaged) {
      info += '\n\t' + profileApiMessages.getMessage('removeProfile', [this.ProfileName]);
    }
    info += '\n';
    return info;
  }

  public logInfo(): string {
    if (this.IsPackaged) {
      return profileApiMessages.getMessage('addProfileToPackage', [this.ProfileName, this.ProfilePath]);
    } else {
      return profileApiMessages.getMessage('profileNotIncluded', [this.ProfileName]);
    }
  }
}
