/*
 * Copyright (c) 2023, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Profile } from 'jsforce/api/metadata';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

// missing from jsforce, so we need to add it since Profiles code uses it
type ProfileCustomSettingAccess = {
  name: string;
  enabled: boolean;
};

export type CorrectedProfile = Profile & {
  customSettingAccesses: ProfileCustomSettingAccess[];
};

export const profileRewriter = (
  profileJson: CorrectedProfile,
  packageXml: Map<string, string[]>,
  retainUserLicense = false
): CorrectedProfile =>
  // iterate the properties of profile
  Object.fromEntries(
    Object.entries(profileJson)
      // keep userLicenses only if that option is set
      // remove settings that are not used for packaging
      .filter(([key]) => isKeyOfInterest(key) || (key === 'userLicense' && retainUserLicense))
      .map(([key, value]) => [
        key,
        // Array check catches userLicense, everything els eis a key of ProfileAreasOfInterest because of the previous filter
        Array.isArray(value) && filterFunctions[key as keyof ProfileAreasOfInterest]
          ? // @ts-expect-error TS knows they're keyof and that the value is one of the property types
            // but isn't smart enough to know that the filterFunctions[key] will return the same type
            filterFunctions[key as keyof ProfileAreasOfInterest](value, packageXml) ?? []
          : value,
      ])
      // some profileSettings might now be empty if the package.xml didn't have those types, so remove them
      .filter(([, value]) => (Array.isArray(value) ? value.length : true))
  ) as CorrectedProfile;

const isKeyOfInterest = (key: string): key is keyof ProfileAreasOfInterest =>
  profilePropertiesWeCareAbout.includes(key as keyof ProfileAreasOfInterest);

const profilePropertiesWeCareAbout = [
  'objectPermissions',
  'fieldPermissions',
  'layoutAssignments',
  'applicationVisibilities',
  'classAccesses',
  'externalDataSourceAccesses',
  'tabVisibilities',
  'pageAccesses',
  'customPermissions',
  'customMetadataTypeAccesses',
  'customSettingAccesses',
  'recordTypeVisibilities',
] as const;

type ProfileAreasOfInterest = Pick<CorrectedProfile, (typeof profilePropertiesWeCareAbout)[number]>;

type FilterFunctions = {
  [index in keyof ProfileAreasOfInterest]: (
    props: ProfileAreasOfInterest[index],
    packageXml: Map<string, string[]>
  ) => ProfileAreasOfInterest[index];
};

const filterFunctions: FilterFunctions = {
  objectPermissions: (props: ProfileAreasOfInterest['objectPermissions'], packageXml: Map<string, string[]>) =>
    props.filter((item) => packageXml.get('CustomObject')?.includes(item.object)),
  fieldPermissions: (props: ProfileAreasOfInterest['fieldPermissions'], packageXml: Map<string, string[]>) =>
    props.filter((item) => packageXml.get('CustomField')?.includes(fieldCorrections(item.field))),
  layoutAssignments: (props: ProfileAreasOfInterest['layoutAssignments'], packageXml: Map<string, string[]>) =>
    props.filter((item) => packageXml.get('Layout')?.includes(item.layout)),
  tabVisibilities: (props: ProfileAreasOfInterest['tabVisibilities'], packageXml: Map<string, string[]>) =>
    props.filter((item) => packageXml.get('CustomTab')?.includes(item.tab)),
  applicationVisibilities: (
    props: ProfileAreasOfInterest['applicationVisibilities'],
    packageXml: Map<string, string[]>
  ) => props.filter((item) => packageXml.get('Application')?.includes(item.application)),
  classAccesses: (props: ProfileAreasOfInterest['classAccesses'], packageXml: Map<string, string[]>) =>
    props.filter((item) => packageXml.get('ApexClass')?.includes(item.apexClass)),
  customPermissions: (props: ProfileAreasOfInterest['customPermissions'], packageXml: Map<string, string[]>) =>
    props.filter((item) => packageXml.get('CustomPermission')?.includes(item.name)),
  pageAccesses: (props: ProfileAreasOfInterest['pageAccesses'], packageXml: Map<string, string[]>) =>
    props.filter((item) => packageXml.get('ApexPage')?.includes(item.apexPage)),
  externalDataSourceAccesses: (
    props: ProfileAreasOfInterest['externalDataSourceAccesses'],
    packageXml: Map<string, string[]>
  ) => props.filter((item) => packageXml.get('ExternalDataSource')?.includes(item.externalDataSource)),
  recordTypeVisibilities: (
    props: ProfileAreasOfInterest['recordTypeVisibilities'],
    packageXml: Map<string, string[]>
  ) => props.filter((item) => packageXml.get('RecordType')?.includes(item.recordType)),
  customSettingAccesses: (props: ProfileAreasOfInterest['customSettingAccesses'], packageXml: Map<string, string[]>) =>
    props.filter((item) => allMembers(packageXml).includes(item.name)),
  customMetadataTypeAccesses: (
    props: ProfileAreasOfInterest['customMetadataTypeAccesses'],
    packageXml: Map<string, string[]>
  ) => props.filter((item) => allMembers(packageXml).includes(item.name)),
};

const allMembers = (packageXml: Map<string, string[]>): string[] => Array.from(packageXml.values()).flat();

// github.com/forcedotcom/cli/issues/2278
// Activity Object is polymorphic (Task and Event)
// package.xml will display them as 'Activity'
// profile.fieldPermissions will display them with the more specific 'Task' or 'Event'
export const fieldCorrections = (fieldName: string): string =>
  fieldName.replace(/^Event\./, 'Activity.').replace(/^Task\./, 'Activity.');

export const profileStringToProfile = (profileString: string): CorrectedProfile => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    cdataPropName: '__cdata',
    ignoreDeclaration: true,
    numberParseOptions: { leadingZeros: false, hex: false },
  });
  return parser.parse(profileString) as CorrectedProfile;
};

/** pass in an object that has the Profile props at the top level.  This function will add the outer wrapper `Profile` */
export const profileObjectToString = (profileObject: Partial<CorrectedProfile>): string => {
  const builder = new XMLBuilder({
    format: true,
    indentBy: '    ',
    ignoreAttributes: false,
    cdataPropName: '__cdata',
    processEntities: false,
    attributeNamePrefix: '@@@',
  });
  return String(
    builder.build({
      '?xml': {
        '@@@version': '1.0',
        '@@@encoding': 'UTF-8',
      },
      Profile: { ...profileObject, '@@@xmlns': 'http://soap.sforce.com/2006/04/metadata' },
    })
  );
};

/** the `name` prop on the manifest type is an Array.  Temporary function to massage it into a decent Map */
export const manifestFixer = (original: {
  Package: Array<{ name: string[]; members: string[] }>;
}): Map<string, string[]> => new Map(original.Package.map((item) => [item.name[0], item.members]));
