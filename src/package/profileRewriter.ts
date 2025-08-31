/*
 * Copyright 2025, Salesforce, Inc.
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
import type { Profile } from '@salesforce/types/metadata';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { PackageXml } from '../interfaces';

// TODO: NEXT MAJOR remove type, just use profile from @salesforce/types
export type CorrectedProfile = Profile;

/**
 *
 * Takes a Profile that's been converted from package.xml to json.
 * Filters out all Profile props that are not
 * 1. used by packaging (ex: ipRanges)
 * 2. present in the package.xml (ex: ClassAccesses for a class not in the package)
 * 3. optionally retains the UserLicense prop only if the param is true
 *
 * @param profileJson json representation of a profile
 * @param packageXml package.xml as json
 * @param retainUserLicense boolean will preserve userLicense if true
 * @returns Profile
 */
export const profileRewriter = (
  profileJson: CorrectedProfile,
  packageXml: PackageMap,
  retainUserLicense = false
): CorrectedProfile =>
  ({
    ...Object.fromEntries(
      Object.entries(profileJson)
        // remove settings that are not used for packaging
        .filter(isRewriteProp)
        // @ts-expect-error the previous filter restricts us to only things that appear in filterFunctions
        .map(([key, value]) => [key, filterFunctions[key]?.(value, packageXml)] ?? [])
        // some profileSettings might now be empty Arrays if the package.xml didn't have those types, so remove the entire property
        .filter(([, value]) => (Array.isArray(value) ? value.length : true))
    ),
    // this one prop is controlled by a param.  Put it back the way it was if the param is true
    ...(retainUserLicense && profileJson.userLicense ? { userLicense: profileJson.userLicense } : {}),
  } as CorrectedProfile);

// it's both a filter and a typeguard to make sure props are represented in filterFunctions
const isRewriteProp = <K extends keyof CorrectedProfile & keyof RewriteProps>(
  prop: [string, unknown]
): prop is [K, RewriteProps[K]] => rewriteProps.includes(prop[0] as keyof RewriteProps);

const rewriteProps = [
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

/** Packaging compares certain Profile properties to the package.xml */
type RewriteProps = Pick<CorrectedProfile, (typeof rewriteProps)[number]>;

type FilterFunction<T> = (props: T, packageXml: PackageMap) => T;

type FilterFunctions = {
  [index in keyof RewriteProps]: FilterFunction<RewriteProps[index]>;
};

const filterFunctions: FilterFunctions = {
  objectPermissions: (props: RewriteProps['objectPermissions'], packageXml: PackageMap) =>
    props.filter((item) => packageXml.get('CustomObject')?.includes(item.object)),

  fieldPermissions: (props: RewriteProps['fieldPermissions'], packageXml: PackageMap) =>
    props.filter((item) => packageXml.get('CustomField')?.includes(fieldCorrections(item.field))),

  layoutAssignments: (props: RewriteProps['layoutAssignments'], packageXml: PackageMap) =>
    props.filter((item) => packageXml.get('Layout')?.includes(item.layout)),

  tabVisibilities: (props: RewriteProps['tabVisibilities'], packageXml: PackageMap) =>
    props.filter((item) => packageXml.get('CustomTab')?.includes(item.tab)),

  applicationVisibilities: (props: RewriteProps['applicationVisibilities'], packageXml: PackageMap) =>
    props.filter((item) => packageXml.get('CustomApplication')?.includes(item.application)),

  classAccesses: (props: RewriteProps['classAccesses'], packageXml: PackageMap) =>
    props.filter((item) => packageXml.get('ApexClass')?.includes(item.apexClass)),

  customPermissions: (props: RewriteProps['customPermissions'], packageXml: PackageMap) =>
    props.filter((item) => packageXml.get('CustomPermission')?.includes(item.name)),

  pageAccesses: (props: RewriteProps['pageAccesses'], packageXml: PackageMap) =>
    props.filter((item) => packageXml.get('ApexPage')?.includes(item.apexPage)),

  externalDataSourceAccesses: (props: RewriteProps['externalDataSourceAccesses'], packageXml: PackageMap) =>
    props.filter((item) => packageXml.get('ExternalDataSource')?.includes(item.externalDataSource)),

  recordTypeVisibilities: (props: RewriteProps['recordTypeVisibilities'], packageXml: PackageMap) =>
    props.filter((item) => packageXml.get('RecordType')?.includes(item.recordType)),

  customSettingAccesses: (props: RewriteProps['customSettingAccesses'], packageXml: PackageMap) =>
    props.filter((item) => allMembers(packageXml).includes(item.name)),

  customMetadataTypeAccesses: (props: RewriteProps['customMetadataTypeAccesses'], packageXml: PackageMap) =>
    props.filter((item) => allMembers(packageXml).includes(item.name)),
};

const allMembers = (packageXml: PackageMap): string[] => Array.from(packageXml.values()).flat();

// github.com/forcedotcom/cli/issues/2278
// Activity Object is polymorphic (Task and Event)
// package.xml will display them as 'Activity'
// profile.fieldPermissions will display them with the more specific 'Task' or 'Event'
export const fieldCorrections = (fieldName: string): string =>
  fieldName.replace(/^Event\./, 'Activity.').replace(/^Task\./, 'Activity.');

/**
 * @param profileString: raw xml read from the file
 * @returns CorrectedProfile (json representation of the profile)
 */
export const profileStringToProfile = (profileString: string): CorrectedProfile => {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    parseAttributeValue: false,
    cdataPropName: '__cdata',
    ignoreDeclaration: true,
    numberParseOptions: { leadingZeros: false, hex: false },
    isArray: (name: string) => rewriteProps.includes(name as keyof RewriteProps),
  });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return (parser.parse(profileString) as { Profile: CorrectedProfile }).Profile;
};

/** pass in an object that has the Profile props at the top level.
 * This function will add the outer wrapper `Profile`  and convert the result to xml
 * */
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

/** it's easier to do lookups by Metadata Type on a Map */
export const manifestTypesToMap = (original: PackageXml['types']): PackageMap =>
  new Map(original.map((item) => [item.name, item.members]));

type PackageMap = Map<string, string[]>;
