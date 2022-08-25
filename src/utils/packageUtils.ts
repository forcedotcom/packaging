/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as os from 'os';
import {
  Connection,
  Lifecycle,
  Logger,
  Messages,
  NamedPackageDir,
  PackageDir,
  PollingClient,
  SfdcUrl,
  SfError,
  SfProject,
  StatusResult,
} from '@salesforce/core';
import { camelCaseToTitleCase, Duration } from '@salesforce/kit';
import { Tokens } from '@salesforce/core/lib/messages';
import { Many, Nullable, Optional } from '@salesforce/ts-types';
import { SaveError } from 'jsforce';
import {
  PackageType,
  PackageVersionCreateEventData,
  PackageVersionCreateRequestResult,
  PackagingSObjects,
} from '../interfaces';
import * as pvcr from '../package/packageVersionCreateRequest';
import { VersionNumber } from './versionNumber';
import Package2VersionStatus = PackagingSObjects.Package2VersionStatus;

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

export const VERSION_NUMBER_SEP = '.';
const INVALID_TYPE_REGEX = /[\w]*(sObject type '[A-Za-z]*Package[2]?[A-Za-z]*' is not supported)[\w]*/im;
const ID_REGISTRY = [
  {
    prefix: '0Ho',
    label: 'Package Id',
  },
  {
    prefix: '05i',
    label: 'Package Version Id',
  },
  {
    prefix: '08c',
    label: 'Package Version Create Request Id',
  },
  {
    prefix: '04t',
    label: 'Subscriber Package Version Id',
  },
];

export type IdRegistryValue = { prefix: string; label: string };
export type IdRegistry = {
  [key: string]: IdRegistryValue;
};

export const INSTALL_URL_BASE = new SfdcUrl('https://login.salesforce.com/packaging/installPackage.apexp?p0=');

// https://developer.salesforce.com/docs/atlas.en-us.salesforce_app_limits_cheatsheet.meta/salesforce_app_limits_cheatsheet/salesforce_app_limits_platform_soslsoql.htm
export const SOQL_WHERE_CLAUSE_MAX_LENGTH = 4000;

export const POLL_INTERVAL_SECONDS = 30;

export const DEFAULT_PACKAGE_DIR = {
  path: '',
  package: '',
  versionName: 'ver 0.1',
  versionNumber: '0.1.0.NEXT',
  default: true,
};

const logger = Logger.childFromRoot('packageUtils');
export const BY_PREFIX = ((): IdRegistry => {
  return Object.fromEntries(ID_REGISTRY.map((id) => [id.prefix, { prefix: id.prefix, label: id.label }]));
})();

export const BY_LABEL = ((): IdRegistry => {
  return Object.fromEntries(
    ID_REGISTRY.map((id) => [id.label.replace(/ /g, '_').toUpperCase(), { prefix: id.prefix, label: id.label }])
  );
})();

export function validateId(idObj: Many<IdRegistryValue>, value: string): void {
  if (!validateIdNoThrow(idObj, value)) {
    throw messages.createError('invalidIdOrAlias', [
      Array.isArray(idObj) ? idObj.map((e) => e.label).join(' or ') : idObj.label,
      value,
      Array.isArray(idObj) ? idObj.map((e) => e.prefix).join(' or ') : idObj.prefix,
    ]);
  }
}
export function validateIdNoThrow(idObj: Many<IdRegistryValue>, value): IdRegistryValue | false {
  if (!value || (value.length !== 15 && value.length !== 18)) {
    return false;
  }
  return Array.isArray(idObj) ? idObj.some((e) => value.startsWith(e.prefix)) : value.startsWith(idObj.prefix);
}
export function validateVersionNumber(
  versionNumberString: string,
  supportedBuildNumberToken: string,
  supportedBuildNumberToken2?: string
): string {
  const versionNumber = VersionNumber.from(versionNumberString);
  // build number can be a number or valid token
  if (
    Number.isNaN(parseInt(versionNumber.build, 10)) &&
    versionNumber.build !== supportedBuildNumberToken &&
    versionNumber.build !== supportedBuildNumberToken2
  ) {
    if (supportedBuildNumberToken2) {
      throw messages.createError('errorInvalidBuildNumberForKeywords', [
        versionNumberString,
        supportedBuildNumberToken,
        supportedBuildNumberToken2,
      ]);
    } else {
      throw messages.createError('errorInvalidBuildNumber', [versionNumberString, supportedBuildNumberToken]);
    }
  }

  return versionNumberString;
}
export async function validatePatchVersion(
  connection: Connection,
  versionNumberString: string,
  packageId: string
): Promise<void> {
  const query = `SELECT ContainerOptions FROM Package2 WHERE id ='${packageId}'`;
  const queryResult = await connection.tooling.query(query);

  if (queryResult.records === null || queryResult.records.length === 0) {
    throw messages.createError('errorInvalidPackageId', [packageId]);
  }

  // Enforce a patch version of zero (0) for Locked packages only
  if (queryResult.records[0].ContainerOptions === 'Locked') {
    const versionNumber = VersionNumber.from(versionNumberString);
    if (versionNumber.patch !== '0') {
      throw messages.createError('errorInvalidPatchNumber', [versionNumberString]);
    }
  }
}

// TODO: let's get rid of this in favor of SfdcUrl.isValidUrl()

// determines if error is from malformed SubscriberPackageVersion query
// this is in place to allow cli to run against app version 214, where SPV queries
// do not require installation key
export function isErrorFromSPVQueryRestriction(err: Error): boolean {
  return (
    err.name === 'MALFORMED_QUERY' &&
    err.message.includes('Implementation restriction: You can only perform queries of the form Id')
  );
}

export function isErrorPackageNotAvailable(err: Error): boolean {
  return err.name === 'UNKNOWN_EXCEPTION' || err.name === 'PACKAGE_UNAVAILABLE';
}

// overwrites error message under certain conditions
export function massageErrorMessage(err: Error): Error {
  if (err.name === 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST') {
    err['message'] = messages.getMessage('invalidPackageTypeMessage');
  }

  if (
    err.name === 'MALFORMED_ID' &&
    (err.message.includes('Version ID') || err.message.includes('Version Definition ID'))
  ) {
    err['message'] = messages.getMessage('malformedPackageVersionIdMessage');
  }

  if (err.name === 'MALFORMED_ID' && err.message.includes('Package2 ID')) {
    err['message'] = messages.getMessage('malformedPackageIdMessage');
  }

  // remove references to Second Generation
  if (err.message.includes('Second Generation ')) {
    err['message'] = err.message.replace('Second Generation ', '');
  }

  return err;
}

// applies actions to common package errors
// eslint-disable-next-line complexity
export function applyErrorAction(err: Error): Error {
  // append when actions already exist
  const actions = [];

  // include existing actions
  if (err['action']) {
    actions.push(err['action']);
  }

  // TODO: (need to get with packaging team on this)
  // until next generation packaging is GA, wrap perm-based errors w/
  // 'contact sfdc' action (REMOVE once GA'd)
  if (
    (err.name === 'INVALID_TYPE' && INVALID_TYPE_REGEX.test(err.message)) ||
    (err.name === 'NOT_FOUND' && err.message === messages.getMessage('notFoundMessage'))
  ) {
    // contact sfdc customer service
    actions.push(messages.getMessage('packageNotEnabledAction'));
  }

  if (err.name === 'INVALID_FIELD' && err.message.includes('Instance')) {
    actions.push(messages.getMessage('packageInstanceNotEnabled'));
  }

  if (err.name === 'INVALID_FIELD' && err.message.includes('SourceOrg')) {
    actions.push(messages.getMessage('packageSourceOrgNotEnabled'));
  }

  if (err.name === 'INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST') {
    actions.push(messages.getMessage('invalidPackageTypeAction'));
  }

  if (err.name === 'MALFORMED_ID' && err.message === messages.getMessage('malformedPackageIdMessage')) {
    actions.push(messages.getMessage('malformedPackageIdAction'));
  }

  if (err.name === 'MALFORMED_ID' && err.message === messages.getMessage('malformedPackageVersionIdMessage')) {
    actions.push(messages.getMessage('malformedPackageVersionIdAction'));
  }

  if (
    (err.message.includes(BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.label) && err.message.includes('is invalid')) ||
    err.name === 'INVALID_ID_FIELD' ||
    (err.name === 'INVALID_INPUT' && err.message.includes('Verify you entered the correct ID')) ||
    err.name === 'MALFORMED_ID'
  ) {
    actions.push(messages.getMessage('idNotFoundAction'));
  }

  if (actions.length > 0) {
    err['action'] = actions.join('\n');
  }

  return err;
}
/**
 * Given a subscriber package version ID (04t) or package version ID (05i), return the package version ID (05i)
 *
 * @param versionId The subscriber package version ID
 * @param connection For tooling query
 */
export async function getPackageVersionId(versionId: string, connection: Connection): Promise<string> {
  // if it's already a 05i return it, otherwise query for it
  if (versionId?.startsWith(BY_LABEL.PACKAGE_VERSION_ID.prefix)) {
    return versionId;
  }
  const query = `SELECT Id FROM Package2Version WHERE SubscriberPackageVersionId = '${versionId}'`;
  return connection.tooling.query(query).then((queryResult) => {
    if (!queryResult || !queryResult.totalSize) {
      throw messages.createError('errorInvalidIdNoMatchingVersionId', [
        BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.label,
        versionId,
        BY_LABEL.PACKAGE_VERSION_ID.label,
      ]);
    }
    return queryResult.records[0].Id;
  });
}

export function escapeInstallationKey(key?: string): Nullable<string> {
  return key ? key.replace(/\\/g, '\\\\').replace(/'/g, "\\'") : null;
}

/**
 * Given 0Ho the package type type (Managed, Unlocked, Locked(deprecated?))
 *
 * @param packageId the 0Ho
 * @param connection For tooling query
 * @throws Error with message when package2 cannot be found
 */
export async function getPackageType(packageId: string, connection: Connection): Promise<PackageType> {
  const query = `SELECT ContainerOptions FROM Package2 WHERE id ='${packageId}'`;

  const queryResult = await connection.tooling.query<Pick<PackagingSObjects.Package2, 'ContainerOptions'>>(query);
  if (queryResult.records.length === 0) {
    throw messages.createError('errorInvalidPackageId', [packageId]);
  }
  return queryResult.records[0].ContainerOptions;
}
/**
 * Given 04t the package type type (Managed, Unlocked, Locked(deprecated?))
 *
 * @param packageVersionId the 04t
 * @param connection For tooling query
 * @param installKey For tooling query, if an installation key is applicable to the package version it must be passed in the queries
 * @throws Error with message when package2 cannot be found
 */
export async function getPackageTypeBy04t(
  packageVersionId: string,
  connection: Connection,
  installKey?: string
): Promise<string> {
  let query = `SELECT Package2ContainerOptions FROM SubscriberPackageVersion WHERE id ='${packageVersionId}'`;

  if (installKey) {
    const escapedInstallationKey = installKey.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    query += ` AND InstallationKey ='${escapedInstallationKey}'`;
  }

  const queryResult = await connection.tooling.query<
    Pick<PackagingSObjects.SubscriberPackageVersion, 'Package2ContainerOptions'>
  >(query);
  if (!queryResult || queryResult.records === null || queryResult.records.length === 0) {
    throw messages.createError('errorInvalidPackageId', [packageVersionId]);
  }
  return queryResult.records[0].Package2ContainerOptions;
}
/**
 * Given a package version ID (05i) or subscriber package version ID (04t), return the subscriber package version ID (04t)
 *
 * @param versionId The suscriber package version ID
 * @param connection For tooling query
 */
export async function getSubscriberPackageVersionId(versionId: string, connection: Connection): Promise<string> {
  // if it's already a 04t return it, otherwise query for it
  if (!versionId || versionId.startsWith(BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.prefix)) {
    return versionId;
  }
  const query = `SELECT SubscriberPackageVersionId FROM Package2Version WHERE Id = '${versionId}'`;
  const queryResult = await connection.tooling.query<
    Pick<PackagingSObjects.Package2Version, 'SubscriberPackageVersionId'>
  >(query);
  if (!queryResult || !queryResult.totalSize) {
    throw messages.createError('errorInvalidIdNoMatchingVersionId', [
      BY_LABEL.PACKAGE_VERSION_ID.label,
      versionId,
      BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.label,
    ]);
  }
  return queryResult.records[0].SubscriberPackageVersionId;
}
/**
 * Get the ContainerOptions for the specified Package2 (0Ho) IDs.
 *
 * @return Map of 0Ho id to container option api value
 * @param packageIds The list of package IDs
 * @param connection For tooling query
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function getContainerOptions(
  packageIds: string[],
  connection: Connection
): Promise<Map<string, PackageType>> {
  if (!packageIds || packageIds.length === 0) {
    return new Map<string, PackageType>();
  }
  const query = "SELECT Id, ContainerOptions FROM Package2 WHERE Id IN ('%IDS%')";

  const records = await queryWithInConditionChunking<Pick<PackagingSObjects.Package2, 'Id' | 'ContainerOptions'>>(
    query,
    packageIds,
    '%IDS%',
    connection
  );

  if (records && records.length > 0) {
    return new Map(records.map((record) => [record.Id, record.ContainerOptions]));
  }
  return new Map<string, PackageType>();
}
/**
 * Return the Package2Version.HasMetadataRemoved field value for the given Id (05i)
 *
 * @param packageVersionId package version ID (05i)
 * @param connection For tooling query
 */
export async function getHasMetadataRemoved(packageVersionId: string, connection: Connection): Promise<boolean> {
  const query = `SELECT HasMetadataRemoved FROM Package2Version WHERE Id = '${packageVersionId}'`;

  const queryResult = await connection.tooling.query<Pick<PackagingSObjects.Package2Version, 'HasMetadataRemoved'>>(
    query
  );
  if (!queryResult || queryResult.records === null || queryResult.records.length === 0) {
    throw messages.createError('errorInvalidIdNoMatchingVersionId', [
      BY_LABEL.PACKAGE_VERSION_ID.label,
      packageVersionId,
      BY_LABEL.PACKAGE_VERSION_ID.label,
    ]);
  }
  return queryResult.records[0].HasMetadataRemoved;
}
/**
 * Given a list of subscriber package version IDs (04t), return the associated version strings (e.g., Major.Minor.Patch.Build)
 *
 * @return Map of subscriberPackageVersionId to versionString
 * @param subscriberPackageVersionIds
 * @param connection For tooling query
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function getPackageVersionStrings(
  subscriberPackageVersionIds: string[],
  connection: Connection
): Promise<Map<string, string>> {
  type PackageVersionString = Pick<
    PackagingSObjects.Package2Version,
    'SubscriberPackageVersionId' | 'MajorVersion' | 'MinorVersion' | 'PatchVersion' | 'BuildNumber'
  >;
  let results = new Map<string, string>();
  if (!subscriberPackageVersionIds || subscriberPackageVersionIds.length === 0) {
    return results;
  }
  // remove any duplicate Ids
  const ids = [...new Set<string>(subscriberPackageVersionIds)];

  const query =
    'SELECT SubscriberPackageVersionId, MajorVersion, MinorVersion, PatchVersion, BuildNumber FROM Package2Version WHERE SubscriberPackageVersionId IN (%IDS%)';

  const records = await queryWithInConditionChunking<PackageVersionString>(query, ids, '%IDS%', connection);
  if (records && records.length > 0) {
    results = new Map<string, string>(
      records.map((record) => {
        const version = concatVersion(
          record.MajorVersion,
          record.MinorVersion,
          record.PatchVersion,
          record.BuildNumber
        );
        return [record.SubscriberPackageVersionId, version];
      })
    );
  }
  return results;
}
/**
 * For queries with an IN condition, determine if the WHERE clause will exceed
 * SOQL's 4000 character limit.  Perform multiple queries as needed to stay below the limit.
 *
 * @return concatenated array of records returned from the resulting query(ies)
 * @param query The full query to execute containing the replaceToken param in its IN clause
 * @param items The IN clause items.  A length-appropriate single-quoted comma-separated string chunk will be made from the items.
 * @param replaceToken A placeholder in the query's IN condition that will be replaced with the chunked items
 * @param connection For tooling query
 */
export async function queryWithInConditionChunking<T = Record<string, unknown>>(
  query: string,
  items: string[],
  replaceToken: string,
  connection: Connection
): Promise<T[]> {
  let records: T[] = [];
  if (!query || !items || !replaceToken) {
    return records;
  }

  const whereClause = query.substring(query.toLowerCase().indexOf('where'), query.length);
  const inClauseItemsMaxLength = SOQL_WHERE_CLAUSE_MAX_LENGTH - whereClause.length - replaceToken.length;

  let itemsQueried = 0;
  while (itemsQueried < items.length) {
    const chunkCount: number = getInClauseItemsCount(items, itemsQueried, inClauseItemsMaxLength);
    if (chunkCount === 0) {
      throw messages.createError('itemDoesNotFitWithinMaxLength', [
        query,
        items[itemsQueried].slice(0, 20),
        items[itemsQueried].length,
        inClauseItemsMaxLength,
      ]);
    }
    const itemsStr = `${items.slice(itemsQueried, itemsQueried + chunkCount).join("','")}`;
    const queryChunk = query.replace(replaceToken, itemsStr);
    const result = await connection.tooling.query<T>(queryChunk);
    if (result && result.records.length > 0) {
      records = records.concat(result.records);
    }
    itemsQueried += chunkCount;
  }
  return records;
}
/**
 * Returns the number of items that can be included in a quoted comma-separated string (e.g., "'item1','item2'") not exceeding maxLength
 */
// TODO: this function cannot handle a single item that is longer than maxLength - what to do, since this could be the root cause of an infinite loop?
export function getInClauseItemsCount(items: string[], startIndex: number, maxLength: number): number {
  let resultLength = 0;
  let includedCount = 0;

  while (startIndex + includedCount < items.length) {
    let itemLength = 0;
    if (items[startIndex + includedCount]) {
      itemLength = items[startIndex + includedCount].length + 3; // 3 = length of "'',"
      if (resultLength + itemLength > maxLength) {
        // the limit has been exceeded, return the current count
        return includedCount;
      }
      includedCount++;
      resultLength += itemLength;
    }
  }
  return includedCount;
}

export function validateAncestorId(
  ancestorId: string,
  highestReleasedVersion: PackagingSObjects.Package2Version,
  explicitUseNoAncestor: boolean,
  isPatch: boolean,
  skipAncestorCheck: boolean,
  origSpecifiedAncestor: string
): string {
  if (explicitUseNoAncestor) {
    if (!highestReleasedVersion) {
      return '';
    } else {
      // the explicitUseNoAncestor && skipAncestorCheck case is handled above
      throw messages.createError('errorAncestorNoneNotAllowed', [getPackageVersionNumber(highestReleasedVersion)]);
    }
  }
  if (!isPatch && !skipAncestorCheck) {
    if (highestReleasedVersion) {
      if (highestReleasedVersion.Id !== ancestorId) {
        throw messages.createError('errorAncestorNotHighest', [
          origSpecifiedAncestor,
          getPackageVersionNumber(highestReleasedVersion),
        ] as Tokens);
      }
    } else {
      // looks like the initial version:create - allow
      ancestorId = '';
    }
  }
  return ancestorId;
}
export async function getAncestorIdHighestRelease(
  connection: Connection,
  packageId: string,
  versionNumberString: string,
  explicitUseHighestRelease: boolean,
  skipAncestorCheck: boolean
): Promise<{ finalAncestorId: string; highestReleasedVersion: PackagingSObjects.Package2Version }> {
  type Package2VersionResult = Partial<
    Pick<
      PackagingSObjects.Package2Version,
      'Id' | 'SubscriberPackageVersionId' | 'MajorVersion' | 'MinorVersion' | 'PatchVersion'
    >
  >;

  const versionNumber = versionNumberString.split(VERSION_NUMBER_SEP);
  const isPatch = versionNumber[2] !== '0';

  const result = { finalAncestorId: null, highestReleasedVersion: null };

  if (isPatch && explicitUseHighestRelease) {
    // based on server-side validation, whatever ancestor is specified for a patch is
    // tightly controlled; therefore we only need concern ourselves if explicitUseHighestRelease == true;
    // equally applies when skipAncestorCheck == true

    // gather appropriate matching major.minor.0
    const query =
      `SELECT Id FROM Package2Version WHERE Package2Id = '${packageId}' ` +
      'AND IsReleased = True AND IsDeprecated = False AND PatchVersion = 0 ' +
      `AND MajorVersion = ${versionNumber[0]} AND MinorVersion = ${versionNumber[1]} ` +
      'ORDER BY MajorVersion Desc, MinorVersion Desc, PatchVersion Desc, BuildNumber Desc LIMIT 1';
    const majorMinorVersionResult = await connection.tooling.query<Package2VersionResult>(query);
    const majorMinorVersionRecords = majorMinorVersionResult.records;
    if (majorMinorVersionRecords && majorMinorVersionRecords?.length === 1 && majorMinorVersionRecords[0]) {
      result.finalAncestorId = majorMinorVersionRecords[0].Id;
    } else {
      const majorMinorNotFound = `${versionNumber[0]}.${versionNumber[1]}.0`;
      throw messages.createError('errorNoMatchingMajorMinorForPatch', [majorMinorNotFound]);
    }
  } else if (!isPatch && (explicitUseHighestRelease || !skipAncestorCheck)) {
    // ancestor must be set to latest released major.minor version
    const query =
      'SELECT Id, SubscriberPackageVersionId, MajorVersion, MinorVersion, PatchVersion FROM Package2Version ' +
      `WHERE Package2Id = '${packageId}' AND IsReleased = True AND IsDeprecated = False AND PatchVersion = 0 ` +
      'ORDER BY MajorVersion Desc, MinorVersion Desc, PatchVersion Desc, BuildNumber Desc LIMIT 1';
    const highestVersionResult = await connection.tooling.query<Package2VersionResult>(query);
    const highestVersionRecords = highestVersionResult.records;
    if (highestVersionRecords && highestVersionRecords[0]) {
      result.highestReleasedVersion = highestVersionRecords[0];
      if (explicitUseHighestRelease) {
        result.finalAncestorId = result.highestReleasedVersion.Id;
      }
    } else if (explicitUseHighestRelease) {
      // there is no eligible ancestor version
      throw messages.createError('errorNoMatchingAncestor', [versionNumberString, packageId]);
    }
  }
  return result;
}
/**
 * Return a version string in Major.Minor.Patch.Build format, using 0 for any empty part
 */
export function concatVersion(
  major: string | number,
  minor: string | number,
  patch: string | number,
  build: string | number
): string {
  return [major, minor, patch, build].map((part) => (part ? `${part}` : '0')).join('.');
}

export function getPackageVersionNumber(package2VersionObj: PackagingSObjects.Package2Version): string {
  const version = concatVersion(
    package2VersionObj.MajorVersion,
    package2VersionObj.MinorVersion,
    package2VersionObj.PatchVersion,
    undefined
  );
  return version.slice(0, version.lastIndexOf('.'));
}
// TODO: get rid of this function if possible.
export function getConfigPackageDirectories(project: SfProject): PackageDir[] {
  return project.getPackageDirectories();
}
export function getConfigPackageDirectory(
  packageDirs: NamedPackageDir[] | PackageDir[],
  lookupProperty: string,
  lookupValue: unknown
): NamedPackageDir | PackageDir | undefined {
  return packageDirs?.find((pkgDir) => pkgDir[lookupProperty] === lookupValue);
}
/**
 * Given a packageAlias, attempt to return the associated id from the config
 *
 * @param packageAlias string representing a package alias
 * @param project for obtaining the project config
 * @returns the associated id or the arg given.
 */
export function getPackageIdFromAlias(packageAlias: string, project: SfProject): string {
  const packageAliases = project.getSfProjectJson().getContents().packageAliases || {};
  // return alias if it exists, otherwise return what was passed in
  return packageAliases[packageAlias] || packageAlias;
}
/**
 * @param stringIn pascal or camel case string
 * @returns space delimited and lower-cased (except for 1st char) string (e.g. in "AbcdEfghIj" => "Abcd efgh ij")
 */
export function convertCamelCaseStringToSentence(stringIn: string): string {
  return camelCaseToTitleCase(stringIn);
}
/**
 * Given a package id, attempt to return the associated aliases from the config
 *
 * @param packageId string representing a package id
 * @param project for obtaining the project config
 * @returns an array of alias for the given id.
 */
export function getPackageAliasesFromId(packageId: string, project: SfProject): string[] {
  const packageAliases = project?.getSfProjectJson().getContents().packageAliases || {};
  // check for a matching alias
  return Object.entries(packageAliases)
    .filter((alias) => alias[1] === packageId)
    .map((alias) => alias[0]);
}
// probably used by convert.
export async function findOrCreatePackage(seedPackage: string, connection: Connection): Promise<string> {
  const query = `SELECT Id FROM Package2 WHERE ConvertedFromPackageId = '${seedPackage}'`;
  const queryResult = await connection.tooling.query<PackagingSObjects.Package2>(query);
  const records = queryResult.records;
  if (records && records.length > 1) {
    const ids = records.map((r) => r.Id);
    throw messages.createError('errorMoreThanOnePackage2WithSeed', [ids.join(', ')]);
  }

  if (records && records.length === 1) {
    // return the package2 object
    return records[0].Id;
  }

  // Need to create a new Package2
  const subQuery = `SELECT Name, Description, NamespacePrefix FROM SubscriberPackage WHERE Id = '${seedPackage}'`;
  const subscriberResult = await connection.tooling.query<PackagingSObjects.SubscriberPackage>(subQuery);
  const subscriberRecords = subscriberResult.records;
  if (!subscriberRecords || subscriberRecords.length <= 0) {
    throw messages.createError('errorNoSubscriberPackageRecord', [seedPackage]);
  }

  const request = {
    Name: subscriberRecords[0].Name,
    Description: subscriberRecords[0].Description,
    NamespacePrefix: subscriberRecords[0].NamespacePrefix,
    ContainerOptions: 'Managed',
    ConvertedFromPackageId: seedPackage,
  };

  const createResult = await connection.tooling.create('Package2', request);
  if (!createResult.success) {
    throw combineSaveErrors('Package2', 'create', createResult.errors);
  }
  return createResult.id;
}

export async function pollForStatusWithInterval(
  id: string,
  retries: number,
  packageId: string,
  branch: string,
  withProject: SfProject,
  connection: Connection,
  interval: Duration
): Promise<PackageVersionCreateRequestResult> {
  let remainingRetries = retries;
  const pollingClient = await PollingClient.create({
    poll: async (): Promise<StatusResult> => {
      const results: PackageVersionCreateRequestResult[] = await pvcr.byId(id, connection);

      if (_isStatusEqualTo(results, [Package2VersionStatus.success, Package2VersionStatus.error])) {
        // complete
        if (_isStatusEqualTo(results, [Package2VersionStatus.success])) {
          // update sfdx-project.json
          let projectUpdated = false;
          if (withProject && !process.env.SFDX_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_CREATE) {
            projectUpdated = true;
            const query = `SELECT MajorVersion, MinorVersion, PatchVersion, BuildNumber FROM Package2Version WHERE Id = '${results[0].Package2VersionId}'`;
            const packageVersionVersionString: string = await connection.tooling
              .query<PackagingSObjects.Package2Version>(query)
              .then((pkgQueryResult) => {
                const record = pkgQueryResult.records[0];
                return `${record.MajorVersion}.${record.MinorVersion}.${record.PatchVersion}-${record.BuildNumber}`;
              });
            const newConfig = await generatePackageAliasEntry(
              connection,
              withProject,
              results[0].SubscriberPackageVersionId,
              packageVersionVersionString,
              branch,
              packageId
            );
            withProject.getSfProjectJson().set('packageAliases', newConfig);
            await withProject.getSfProjectJson().write();
          }
          await Lifecycle.getInstance().emit(Package2VersionStatus.success, {
            id,
            packageVersionCreateRequestResult: results[0],
            projectUpdated,
          });
          return { completed: true, payload: results[0] };
        } else {
          let status = 'Unknown Error';
          if (results?.length > 0 && results[0].Error.length > 0) {
            const errors = [];
            // for multiple errors, display one per line prefixed with (x)
            if (results[0].Error.length > 1) {
              results[0].Error.forEach((error) => {
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                errors.push(`(${errors.length + 1}) ${error}`);
              });
              errors.unshift(messages.getMessage('versionCreateFailedWithMultipleErrors'));
            }
            status = errors.length !== 0 ? errors.join('\n') : results[0].Error.join('\n');
          }
          await Lifecycle.getInstance().emit(Package2VersionStatus.error, { id, status });
          throw new SfError(status);
        }
      } else {
        const remainingTime = Duration.milliseconds(interval.milliseconds * remainingRetries);
        await Lifecycle.getInstance().emit(Package2VersionStatus.inProgress, {
          id,
          packageVersionCreateRequestResult: results[0],
          message: '',
          remainingTime,
        } as PackageVersionCreateEventData);
        logger.info(
          `Request in progress. Sleeping ${interval.seconds} seconds. Will wait a total of ${
            remainingTime.seconds
          } more seconds before timing out. Current Status='${convertCamelCaseStringToSentence(results[0]?.Status)}'`
        );
        remainingRetries--;
        return { completed: false, payload: results[0] };
      }
    },
    frequency: Duration.milliseconds(interval.milliseconds * 1000),
    timeout: Duration.milliseconds(interval.milliseconds * retries * 1000),
  });

  return pollingClient.subscribe<PackageVersionCreateRequestResult>();
}

/**
 * Generate package alias json entry for this package version that can be written to sfdx-project.json
 *
 * @param connection
 * @param project SfProject instance for the project
 * @param packageVersionId 04t id of the package to create the alias entry for
 * @param packageVersionNumber that will be appended to the package name to form the alias
 * @param branch
 * @param packageId the 0Ho id
 * @private
 */
export async function generatePackageAliasEntry(
  connection: Connection,
  project: SfProject,
  packageVersionId: string,
  packageVersionNumber: string,
  branch: string,
  packageId: string
): Promise<{ [p: string]: string }> {
  const configContent = project.getSfProjectJson().getContents();
  const packageAliases: { [p: string]: string } = configContent.packageAliases || {};

  const aliasForPackageId = getPackageAliasesFromId(packageId, project);
  let packageName: Optional<string>;
  if (!aliasForPackageId || aliasForPackageId.length === 0) {
    const query = `SELECT Name FROM Package2 WHERE Id = '${packageId}'`;
    const package2 = await connection.singleRecordQuery<PackagingSObjects.Package2>(query, { tooling: true });
    packageName = package2.Name;
  } else {
    packageName = aliasForPackageId[0];
  }

  const packageAlias = branch
    ? `${packageName}@${packageVersionNumber}-${branch}`
    : `${packageName}@${packageVersionNumber}`;
  packageAliases[packageAlias] = packageVersionId;

  return packageAliases;
}

/**
 * Return true if the queryResult.records[0].Status is equal to one of the values in statuses.
 *
 * @param results to examine
 * @param statuses array of statuses to look for
 * @returns {boolean} if one of the values in status is found.
 */
function _isStatusEqualTo(results: PackageVersionCreateRequestResult[], statuses?: Package2VersionStatus[]): boolean {
  return results?.length <= 0 ? false : statuses?.some((status) => results[0].Status === status);
}

export function formatDate(date: Date): string {
  const pad = (num: number): string => {
    return num < 10 ? `0${num}` : `${num}`;
  };
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

export function combineSaveErrors(sObject: string, crudOperation: string, errors: SaveError[]): SfError {
  const errorMessages = errors.map((error) => {
    const fieldsString = error.fields?.length > 0 ? `Fields: [${error.fields.join(', ')}]` : '';
    return `Error: ${error.errorCode} Message: ${error.message} ${fieldsString}`;
  });
  return messages.createError('errorDuringSObjectCRUDOperation', [crudOperation, sObject, errorMessages.join(os.EOL)]);
}
