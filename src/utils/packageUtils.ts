/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as os from 'os';
import * as fs from 'fs';
import { join } from 'path';
import { pipeline as cbPipeline } from 'stream';
import * as util from 'util';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { Connection, Logger, Messages, SfdcUrl, SfError, SfProject } from '@salesforce/core';
import { isNumber, Many, Nullable, Optional } from '@salesforce/ts-types';
import { SaveError } from 'jsforce';
import { Duration, ensureArray } from '@salesforce/kit';
import * as globby from 'globby';
import * as JSZIP from 'jszip';
import { PackageType, PackagingSObjects } from '../interfaces';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'pkg_utils');

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
const SOQL_WHERE_CLAUSE_MAX_LENGTH = 4000;

export const POLL_INTERVAL_SECONDS = 30;

export const DEFAULT_PACKAGE_DIR = {
  path: '',
  package: '',
  versionName: 'ver 0.1',
  versionNumber: '0.1.0.NEXT',
  default: true,
};

export const BY_LABEL = ((): IdRegistry =>
  Object.fromEntries(
    ID_REGISTRY.map((id) => [id.label.replace(/ /g, '_').toUpperCase(), { prefix: id.prefix, label: id.label }])
  ))();

/**
 * A function to generate a unique id and return it in the context of a template, if supplied.
 *
 * A template is a string that can contain `${%s}` to be replaced with a unique id.
 * If the template contains the "%s" placeholder, it will be replaced with the unique id otherwise the id will be appended to the template.
 *
 * @param options an object with the following properties:
 * - template: a template string.
 * - length: the length of the unique id as presented in hexadecimal.
 */
export function uniqid(options?: { template?: string; length?: number }): string {
  const uniqueString = randomBytes(Math.ceil((options?.length ?? 32) / 2.0))
    .toString('hex')
    .slice(0, options?.length ?? 32);
  if (!options?.template) {
    return uniqueString;
  }
  return options.template.includes('%s')
    ? util.format(options.template, uniqueString)
    : `${options.template}${uniqueString}`;
}

export function validateId(idObj: Many<IdRegistryValue>, value: string | undefined): void {
  if (!value || !validateIdNoThrow(idObj, value)) {
    throw messages.createError('invalidIdOrAlias', [
      Array.isArray(idObj) ? idObj.map((e) => e.label).join(' or ') : idObj.label,
      value,
      Array.isArray(idObj) ? idObj.map((e) => e.prefix).join(' or ') : idObj.prefix,
    ]);
  }
}

export function validateIdNoThrow(idObj: Many<IdRegistryValue>, value: string): IdRegistryValue | boolean {
  if (!value || (value.length !== 15 && value.length !== 18)) {
    return false;
  }
  return Array.isArray(idObj) ? idObj.some((e) => value.startsWith(e.prefix)) : value.startsWith(idObj.prefix);
}

// applies actions to common package errors
// eslint-disable-next-line complexity
export function applyErrorAction(err: Error & { action?: string }): Error {
  // append when actions already exist
  const actions = [];

  // include existing actions
  if (err.action) {
    actions.push(err.action);
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

/**
 * Given a subscriber package version ID (04t) or package version ID (05i), return the package version ID (05i)
 *
 * @param versionId The subscriber package version ID
 * @param connection For tooling query
 */
export async function getPackageVersionId(versionId: string, connection: Connection): Promise<string | undefined> {
  // if it's already a 05i return it, otherwise query for it
  if (versionId?.startsWith(BY_LABEL.PACKAGE_VERSION_ID.prefix)) {
    return versionId;
  }
  const query = `SELECT Id FROM Package2Version WHERE SubscriberPackageVersionId = '${versionId}'`;
  return connection.tooling.query(query).then((queryResult) => {
    if (!queryResult?.totalSize) {
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
 * Get the ContainerOptions for the specified Package2 (0Ho) IDs.
 *
 * @return Map of 0Ho id to container option api value
 * @param packageIds The list of package IDs
 * @param connection For tooling query
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function getContainerOptions(
  packageIds: string | undefined | Array<string | undefined>,
  connection: Connection
): Promise<Map<string, PackageType>> {
  const ids = ensureArray(packageIds).filter((id) => id) as string[];
  if (ids.length === 0) {
    return new Map<string, PackageType>();
  }
  const query = "SELECT Id, ContainerOptions FROM Package2 WHERE Id IN ('%IDS%')";

  const records = await queryWithInConditionChunking<Pick<PackagingSObjects.Package2, 'Id' | 'ContainerOptions'>>(
    query,
    ids,
    '%IDS%',
    connection
  );

  if (records && records.length > 0) {
    return new Map(records.map((record) => [record.Id, record.ContainerOptions]));
  }
  return new Map<string, PackageType>();
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

  const query = `SELECT SubscriberPackageVersionId, MajorVersion, MinorVersion, PatchVersion, BuildNumber FROM Package2Version WHERE SubscriberPackageVersionId IN (${ids
    .map((id) => `'${id}'`)
    .join(',')})`;

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
async function queryWithInConditionChunking<T extends Record<string, unknown> = Record<string, unknown>>(
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
    // eslint-disable-next-line no-await-in-loop
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
function getInClauseItemsCount(items: string[], startIndex: number, maxLength: number): number {
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

/**
 * Return a version string in Major.Minor.Patch.Build format, using 0 for any empty part
 */
function concatVersion(
  major: string | number,
  minor: string | number,
  patch: string | number,
  build: string | number | undefined
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
// TODO: move sfProject
export async function generatePackageAliasEntry(
  connection: Connection,
  project: SfProject,
  packageVersionId: string,
  packageVersionNumber: string,
  branch: string,
  packageId: string
): Promise<[string, string]> {
  const aliasForPackageId = project.getAliasesFromPackageId(packageId);
  let packageName: Optional<string>;
  if (aliasForPackageId?.length === 0) {
    const query = `SELECT Name FROM Package2 WHERE Id = '${packageId}'`;
    const package2 = await connection.singleRecordQuery<PackagingSObjects.Package2>(query, { tooling: true });
    packageName = package2.Name;
  } else {
    packageName = aliasForPackageId[0];
  }

  const packageAlias = branch
    ? `${packageName}@${packageVersionNumber}-${branch}`
    : `${packageName}@${packageVersionNumber}`;

  return [packageAlias, packageVersionId];
}

export function combineSaveErrors(sObject: string, crudOperation: string, errors: SaveError[]): SfError {
  const errorMessages = errors.map((error) => {
    const fieldsString = error.fields?.length ? `Fields: [${error.fields?.join(', ')}]` : '';
    return `Error: ${error.errorCode} Message: ${error.message} ${fieldsString}`;
  });
  return messages.createError('errorDuringSObjectCRUDOperation', [crudOperation, sObject, errorMessages.join(os.EOL)]);
}

/**
 * Returns a Duration object from param duration when it is a number, otherwise return itself
 *
 * @param duration = number to be converted to a Duration or Duration object
 * @param unit = (Default Duration.Unit.MILLISECONDS) Duration unit of number - See @link {Duration.Unit} for valid values
 */
export function numberToDuration(
  duration: number | Duration | undefined,
  unit: Duration.Unit = Duration.Unit.MILLISECONDS
): Duration {
  if (duration === undefined) {
    return new Duration(0, unit);
  }
  return isNumber(duration) ? new Duration(duration, unit) : duration;
}

const pipeline = promisify(cbPipeline);

/**
 * Zips directory to given zipfile.
 *
 * https://github.com/archiverjs/node-archiver
 *
 * @param dir to zip
 * @param zipfile
 */
export async function zipDir(dir: string, zipfile: string): Promise<void> {
  const logger = Logger.childFromRoot('srcDevUtils#zipDir');

  const timer = process.hrtime();
  const globbyResult: string[] = await globby('**/*', { expandDirectories: true, cwd: dir });
  const zip = new JSZIP();
  // add files tp zip
  for (const file of globbyResult) {
    zip.file(file, fs.readFileSync(join(dir, file)));
  }
  // write zip to file
  const zipStream = zip.generateNodeStream({
    type: 'nodebuffer',
    streamFiles: true,
    compression: 'DEFLATE',
    compressionOptions: {
      level: 3,
    },
  });
  await pipeline(zipStream, fs.createWriteStream(zipfile));
  const stat = fs.statSync(zipfile);
  logger.debug(`${stat.size} bytes written to ${zipfile} in ${getElapsedTime(timer)}ms`);
  return;
}

function getElapsedTime(timer: [number, number]): string {
  const elapsed = process.hrtime(timer);
  return (elapsed[0] * 1000 + elapsed[1] / 1000000).toFixed(3);
}

export function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  entries.map((entry) => {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    return entry.isDirectory() ? copyDir(srcPath, destPath) : fs.copyFileSync(srcPath, destPath);
  });
}

export function copyDescriptorProperties(
  packageDescriptorJson: Record<string, unknown>,
  definitionFileJson: Record<string, unknown>
): void {
  Object.assign(
    packageDescriptorJson,
    Object.fromEntries(
      ['country', 'edition', 'language', 'features', 'orgPreferences', 'snapshot', 'release', 'sourceOrg'].map(
        (prop) => [[prop], definitionFileJson[prop]]
      )
    )
  );
}
