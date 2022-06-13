/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
// TODO: as follows
// resolve variable context type in this file
// resolve use of 'force' from toolbelt
// revisit all uses of connection in this file
// do I need so many TS asserts, like 'as Tokens'

import * as urlLib from 'url';

import {
  Connection,
  Logger,
  Messages,
  Org,
  PackageDir,
  PollingClient,
  SfProject,
  StatusResult,
} from '@salesforce/core';
import { camelCaseToTitleCase, Duration } from '@salesforce/kit';
import { Tokens } from '@salesforce/core/lib/messages';
import { IPackageVersion2GP } from '../interfaces';
import { PackagingSObjects } from '../interfaces/packagingSObjects';
import PackageVersionCreateRequestApi = require('../package/packageVersionCreateRequestApi');
import { BuildNumberToken, VersionNumber } from './versionNumber';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

const VERSION_NUMBER_SEP = '.';
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

type IdRegistry = {
  [key: string]: { prefix: string; label: string };
};

const INSTALL_URL_BASE = 'https://login.salesforce.com/packaging/installPackage.apexp?p0=';

// https://developer.salesforce.com/docs/atlas.en-us.salesforce_app_limits_cheatsheet.meta/salesforce_app_limits_cheatsheet/salesforce_app_limits_platform_soslsoql.htm
const SOQL_WHERE_CLAUSE_MAX_LENGTH = 4000;

const POLL_INTERVAL_SECONDS = 30;

const DEFAULT_PACKAGE_DIR = {
  path: '',
  package: '',
  versionName: 'ver 0.1',
  versionNumber: '0.1.0.NEXT',
  default: true,
};

const logger = Logger.childFromRoot('packageUtils');
export const packagingUtils = {
  BY_PREFIX: ((): IdRegistry => {
    return Object.fromEntries(ID_REGISTRY.map((id) => [id.prefix, { prefix: id.prefix, label: id.label }]));
  })(),

  BY_LABEL: ((): IdRegistry => {
    return Object.fromEntries(
      ID_REGISTRY.map((id) => [id.label.replace(/ /g, '_').toUpperCase(), { prefix: id.prefix, label: id.label }])
    );
  })(),

  validateId(idObj, value: string): void {
    if (!this.validateIdNoThrow(idObj, value)) {
      const msg = messages.getMessage('invalidIdOrAlias', [
        (Array.isArray(idObj) ? idObj.map((e) => e.label).join(' or ') : idObj.label) as string,
        value,
        (Array.isArray(idObj) ? idObj.map((e) => e.prefix).join(' or ') : idObj.prefix) as string,
      ]);
      throw new Error(msg);
    }
  },

  validateIdNoThrow(idObj, value) {
    if (!value || (value.length !== 15 && value.length !== 18)) {
      return false;
    }
    return Array.isArray(idObj) ? idObj.some((e) => value.startsWith(e.prefix)) : value.startsWith(idObj.prefix);
  },

  validateVersionNumber(
    versionNumberString: string,
    supportedBuildNumberToken: string,
    supportedBuildNumberToken2: string
  ): string {
    const versionNumber = VersionNumber.from(versionNumberString);
    // build number can be a number or valid token
    if (
      Number.isNaN(parseInt(versionNumber.build, 10)) &&
      versionNumber.build !== supportedBuildNumberToken &&
      versionNumber.build !== supportedBuildNumberToken2
    ) {
      if (supportedBuildNumberToken2) {
        throw new Error(
          messages.getMessage('errorInvalidBuildNumberForKeywords', [
            versionNumberString,
            supportedBuildNumberToken,
            supportedBuildNumberToken2,
          ])
        );
      } else {
        throw new Error(
          messages.getMessage('errorInvalidBuildNumber', [versionNumberString, supportedBuildNumberToken])
        );
      }
    }

    return versionNumberString;
  },

  async validatePatchVersion(connection: Connection, org: Org, versionNumberString: string, packageId: string) {
    const query = `SELECT ContainerOptions FROM Package2 WHERE id ='${packageId}'`;
    const queryResult = await connection.tooling.query(query);

    if (queryResult.records === null || queryResult.records.length === 0) {
      throw messages.createError('errorInvalidPackageId', [packageId]);
    }

    // Enforce a patch version of zero (0) for Locked packages only
    if (queryResult.records[0].ContainerOptions === 'Locked') {
      const versionNumber = VersionNumber.from(versionNumberString);
      if (versionNumber.patch !== '0') {
        throw new Error(messages.getMessage('errorInvalidPatchNumber', [versionNumberString]));
      }
    }
  },

  // check that the provided url has a valid format
  validUrl(url: string): boolean {
    try {
      // eslint-disable-next-line no-new
      new urlLib.URL(url);
      return true;
    } catch (err) {
      return false;
    }
  },

  // determines if error is from malformed SubscriberPackageVersion query
  // this is in place to allow cli to run against app version 214, where SPV queries
  // do not require installation key
  isErrorFromSPVQueryRestriction(err: Error): boolean {
    return (
      err.name === 'MALFORMED_QUERY' &&
      err.message.includes('Implementation restriction: You can only perform queries of the form Id')
    );
  },

  isErrorPackageNotAvailable(err: Error): boolean {
    return err.name === 'UNKNOWN_EXCEPTION' || err.name === 'PACKAGE_UNAVAILABLE';
  },

  // overwrites error message under certain conditions
  massageErrorMessage(err: Error): Error {
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
  },

  // applies actions to common package errors
  // eslint-disable-next-line complexity
  applyErrorAction(err: Error) {
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
      (err.message.includes(this.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.label as string) &&
        err.message.includes('is invalid')) ||
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
  },

  /**
   * Given a subscriber package version ID (04t) or package version ID (05i), return the package version ID (05i)
   *
   * @param versionId The suscriber package version ID
   * @param connection For tooling query
   * @param org For tooling query
   */
  async getPackageVersionId(versionId: string, connection: Connection, org: Org): Promise<string> {
    // if it's already a 05i return it, otherwise query for it
    if (!versionId || versionId.startsWith(this.BY_LABEL.PACKAGE_VERSION_ID.prefix as string)) {
      return versionId;
    }
    const query = `SELECT Id FROM Package2Version WHERE SubscriberPackageVersionId = '${versionId}'`;
    return connection.tooling.query(query).then((queryResult) => {
      if (!queryResult || !queryResult.totalSize) {
        throw new Error(
          messages.getMessage('errorInvalidIdNoMatchingVersionId', [
            this.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.label as string,
            versionId,
            this.BY_LABEL.PACKAGE_VERSION_ID.label as string,
          ])
        );
      }
      return queryResult.records[0].Id;
    });
  },

  /**
   * Given 0Ho the package type type (Managed, Unlocked, Locked(deprecated?))
   *
   * @param package2Id the 0Ho
   * @param connection For tooling query
   * @param org For tooling query
   * @throws Error with message when package2 cannot be found
   */
  async getPackage2Type(package2Id: string, connection: Connection, org: Org): Promise<string> {
    const query = `SELECT ContainerOptions FROM Package2 WHERE id ='${package2Id}'`;

    const queryResult = await connection.tooling.query(query);
    if (!queryResult || queryResult.records === null || queryResult.records.length === 0) {
      throw messages.createError('errorInvalidPackageId', [package2Id]);
    }
    return queryResult.records[0].ContainerOptions;
  },

  /**
   * Given 04t the package type type (Managed, Unlocked, Locked(deprecated?))
   *
   * @param package2VersionId the 04t
   * @param connection For tooling query
   * @param org For tooling query
   * @param installKey For tooling query, if an installation key is applicable to the package version it must be passed in the queries
   * @throws Error with message when package2 cannot be found
   */
  async getPackage2TypeBy04t(
    package2VersionId: string,
    connection: Connection,
    org: Org,
    installKey: string
  ): Promise<string> {
    let query = `SELECT Package2ContainerOptions FROM SubscriberPackageVersion WHERE id ='${package2VersionId}'`;

    if (installKey) {
      const escapedInstallationKey = installKey.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      query += ` AND InstallationKey ='${escapedInstallationKey}'`;
    }

    const queryResult = await connection.tooling.query(query);
    if (!queryResult || queryResult.records === null || queryResult.records.length === 0) {
      throw messages.createError('errorInvalidPackageId', [package2VersionId]);
    }
    return queryResult.records[0].Package2ContainerOptions;
  },

  /**
   * Given a package version ID (05i) or subscriber package version ID (04t), return the subscriber package version ID (04t)
   *
   * @param versionId The suscriber package version ID
   * @param connection For tooling query
   * @param org For tooling query
   */
  async getSubscriberPackageVersionId(versionId: string, connection: Connection, org: Org): Promise<string> {
    // if it's already a 04t return it, otherwise query for it
    if (!versionId || versionId.startsWith(this.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.prefix as string)) {
      return versionId;
    }
    const query = `SELECT SubscriberPackageVersionId FROM Package2Version WHERE Id = '${versionId}'`;
    const queryResult = await connection.tooling.query(query);
    if (!queryResult || !queryResult.totalSize) {
      throw new Error(
        messages.getMessage('errorInvalidIdNoMatchingVersionId', [
          this.BY_LABEL.PACKAGE_VERSION_ID.label as string,
          versionId,
          this.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID.label as string,
        ])
      );
    }
    return queryResult.records[0].SubscriberPackageVersionId;
  },

  /**
   * Get the ContainerOptions for the specified Package2 (0Ho) IDs.
   *
   * @return Map of 0Ho id to container option api value
   * @param poackage2Ids The list of package IDs
   * @param connection For tooling query
   * @param org For tooling query
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async getContainerOptions(package2Ids: string[], connection: Connection, org: Org): Promise<Map<string, string>> {
    if (!package2Ids || package2Ids.length === 0) {
      return new Map<string, string>();
    }
    const query = 'SELECT Id, ContainerOptions FROM Package2 WHERE Id IN (%IDS%)';

    const records = await this.queryWithInConditionChunking(query, package2Ids, '%IDS%', connection, org);

    if (records && records.length > 0) {
      return records
        .map((record) => [record.Id, record.ContainerOptions])
        .reduce((map, [id, containerOptions]) => {
          map.set(id, containerOptions);
          return map;
        }, new Map<string, string>());
    }
    return new Map<string, string>();
  },

  /**
   * Return the Package2Version.HasMetadataRemoved field value for the given Id (05i)
   *
   * @param packageVersionId package version ID (05i)
   * @param connection For tooling query
   * @param org For tooling query
   */
  async getHasMetadataRemoved(packageVersionId, connection, org) {
    const query = `SELECT HasMetadataRemoved FROM Package2Version WHERE Id = '${packageVersionId}'`;

    const queryResult = await connection.toolingQuery(org, query);
    if (!queryResult || queryResult.records === null || queryResult.records.length === 0) {
      throw new Error(
        messages.getMessage('errorInvalidIdNoMatchingVersionId', [
          this.BY_LABEL.PACKAGE_VERSION_ID.label as string,
          packageVersionId as string,
          this.BY_LABEL.PACKAGE_VERSION_ID.label as string,
        ])
      );
    }
    return queryResult.records[0].HasMetadataRemoved;
  },

  /**
   * Given a list of subscriber package version IDs (04t), return the associated version strings (e.g., Major.Minor.Patch.Build)
   *
   * @return Map of subscriberPackageVersionId to versionString
   * @param versionIds The list of suscriber package version IDs
   * @param connection For tooling query
   * @param org For tooling query
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async getPackageVersionStrings(subscriberPackageVersionIds: string[], connection, org) {
    const results = new Map();
    if (!subscriberPackageVersionIds || subscriberPackageVersionIds.length === 0) {
      return results;
    }
    // remove any duplicate Ids
    subscriberPackageVersionIds = [...new Set<string>(subscriberPackageVersionIds)];

    const query =
      'SELECT SubscriberPackageVersionId, MajorVersion, MinorVersion, PatchVersion, BuildNumber FROM Package2Version WHERE SubscriberPackageVersionId IN (%IDS%)';

    return this.queryWithInConditionChunking(query, subscriberPackageVersionIds, '%IDS%', connection, org).then(
      (records) => {
        if (records && records.length > 0) {
          records.forEach((record) => {
            const version = this.concatVersion(
              record.MajorVersion,
              record.MinorVersion,
              record.PatchVersion,
              record.BuildNumber
            );
            results.set(record.SubscriberPackageVersionId, version);
          });
        }
        return results;
      }
    );
  },

  /**
   * For queries with an IN condition, determine if the WHERE clause will exceed
   * SOQL's 4000 character limit.  Perform multiple queries as needed to stay below the limit.
   *
   * @return concatenated array of records returned from the resulting query(ies)
   * @param query The full query to execute containing the replaceToken param in its IN clause
   * @param items The IN clause items.  A length-appropriate single-quoted comma-separated string chunk will be made from the items.
   * @param replaceToken A placeholder in the query's IN condition that will be replaced with the chunked items
   * @param connection For tooling query
   * @param org For tooling query
   */
  async queryWithInConditionChunking(
    query: string,
    items: string[],
    replaceToken: string,
    connection: Connection,
    org: Org
  ) {
    // eslint-disable-next-line @typescript-eslint/no-shadow
    const SOQL_WHERE_CLAUSE_MAX_LENGTH = this.getSoqlWhereClauseMaxLength();
    let records = [];
    if (!query || !items || !replaceToken) {
      return records;
    }

    const whereClause = query.substring(query.toLowerCase().indexOf('where'), query.length);
    const inClauseItemsMaxLength = SOQL_WHERE_CLAUSE_MAX_LENGTH - whereClause.length - replaceToken.length;

    let itemsQueried = 0;
    while (itemsQueried < items.length) {
      const chunkCount: number = this.getInClauseItemsCount(items, itemsQueried, inClauseItemsMaxLength);
      const itemsStr = `${items.slice(itemsQueried, itemsQueried + chunkCount).join("','")}`;
      const queryChunk = query.replace(replaceToken, itemsStr);
      const result = await connection.tooling.query(queryChunk);
      if (result && result.records.length > 0) {
        records = records.concat(result.records);
      }
      itemsQueried += chunkCount;
    }
    return records;
  },

  /**
   *   Returns the number of items that can be included in a quoted comma-separated string (e.g., "'item1','item2'") not exceeding maxLength
   */
  getInClauseItemsCount(items: string[], startIndex: number, maxLength: number): number {
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
  },

  /**
   * Return a version string in Major.Minor.Patch.Build format, using 0 for any empty part
   */
  concatVersion(major: string, minor: string, patch: string, build: string) {
    return [major, minor, patch, build].map((part) => (part ? part : '0')).join('.');
  },

  /**
   * Given a package descriptor, return the ancestor ID. This code was duplicated to scratchOrgInfoGenerator.getAncestorIds,
   * changes here may need to be duplicated there until that code, and/or this code is moved to a separate plugin.
   *
   * @param packageDescriptorJson JSON for packageDirectories element in sfdx-project.json
   * @param connection For tooling query
   * @param org For tooling query
   */
  // TODO: is there a schema for packageDescriptorJson?
  async getAncestorId(
    packageDescriptorJson: PackageDir,
    connection: Connection,
    org: Org,
    versionNumberString: string,
    skipAncestorCheck: boolean
  ): Promise<string> {
    // eslint-disable-next-line complexity
    return Promise.resolve().then(async () => {
      // If an id property is present, use it.  Otherwise, look up the package id from the package property.
      // TODO: there is not an id property defined in the schema for packageDescriptorJson.
      const packageId: string =
        packageDescriptorJson['id'] ?? this.getPackageIdFromAlias(packageDescriptorJson.package, connection);

      // No need to proceed if Unlocked
      const packageType = await this.getPackage2Type(packageId, connection, org);
      if (packageType === 'Unlocked') {
        return '';
      }

      let ancestorId = '';
      // ancestorID can be alias, 05i, or 04t;
      // validate and convert to 05i, as needed

      const versionNumber = versionNumberString.split(VERSION_NUMBER_SEP);
      const isPatch = versionNumber[2] !== '0';

      let origSpecifiedAncestor = packageDescriptorJson.ancestorId;
      let highestReleasedVersion: IPackageVersion2GP = null;

      const explicitUseHighestRelease =
        packageDescriptorJson.ancestorId === BuildNumberToken.HIGHEST_VERSION_NUMBER_TOKEN ||
        packageDescriptorJson.ancestorVersion === BuildNumberToken.HIGHEST_VERSION_NUMBER_TOKEN;
      const explicitUseNoAncestor =
        packageDescriptorJson.ancestorId === BuildNumberToken.NONE_VERSION_NUMBER_TOKEN ||
        packageDescriptorJson.ancestorVersion === BuildNumberToken.NONE_VERSION_NUMBER_TOKEN;
      if (
        (explicitUseHighestRelease || explicitUseNoAncestor) &&
        packageDescriptorJson.ancestorId &&
        packageDescriptorJson.ancestorVersion
      ) {
        if (packageDescriptorJson.ancestorId !== packageDescriptorJson.ancestorVersion) {
          // both ancestorId and ancestorVersion specified, HIGHEST and/or NONE are used, the values disagree
          throw new Error(
            messages.getMessage('errorAncestorIdVersionHighestOrNoneMismatch', [
              packageDescriptorJson.ancestorId,
              packageDescriptorJson.ancestorVersion,
            ])
          );
        }
      }

      if (explicitUseNoAncestor && skipAncestorCheck) {
        return '';
      } else {
        const result = await this.getAncestorIdHighestRelease(
          connection,
          org,
          packageId,
          versionNumber,
          versionNumberString,
          isPatch,
          explicitUseHighestRelease,
          skipAncestorCheck
        );
        if (result.finalAncestorId) {
          return result.finalAncestorId;
        }
        highestReleasedVersion = result.highestReleasedVersion;
      }
      // at this point if explicitUseHighestRelease=true, we have returned the ancestorId or thrown an error
      // highestReleasedVersion should be null only if skipAncestorCheck or if there is no existing released package version

      if (!explicitUseNoAncestor && packageDescriptorJson.ancestorId) {
        ancestorId = this.getPackageIdFromAlias(packageDescriptorJson.ancestorId, connection);
        this.validateId([this.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, this.BY_LABEL.PACKAGE_VERSION_ID], ancestorId);
        ancestorId = await this.getPackageVersionId(ancestorId, connection, org);
      }

      if (!explicitUseNoAncestor && packageDescriptorJson.ancestorVersion) {
        const regNumbers = new RegExp('^[0-9]+$');
        const versionNumber = packageDescriptorJson.ancestorVersion.split(VERSION_NUMBER_SEP);
        if (
          versionNumber.length < 3 ||
          versionNumber.length > 4 ||
          !versionNumber[0].match(regNumbers) ||
          !versionNumber[1].match(regNumbers) ||
          !versionNumber[2].match(regNumbers)
        ) {
          throw new Error(
            messages.getMessage('errorInvalidAncestorVersionFormat', [packageDescriptorJson.ancestorVersion])
          );
        }

        const query =
          'SELECT Id, IsReleased FROM Package2Version ' +
          `WHERE Package2Id = '${packageId}' AND MajorVersion = ${versionNumber[0]} AND MinorVersion = ${versionNumber[1]} AND PatchVersion = ${versionNumber[2]}`;

        let queriedAncestorId;
        const ancestorVersionResult = await connection.tooling.query(query);
        if (!ancestorVersionResult || !ancestorVersionResult.totalSize) {
          throw new Error(
            messages.getMessage('errorNoMatchingAncestor', [packageDescriptorJson.ancestorVersion, packageId])
          );
        } else {
          const releasedAncestor = ancestorVersionResult.records.find((rec) => rec.IsReleased === true);
          if (!releasedAncestor) {
            throw new Error(messages.getMessage('errorAncestorNotReleased', [packageDescriptorJson.ancestorVersion]));
          } else {
            queriedAncestorId = releasedAncestor.Id;
          }
        }

        // check for discrepancy between queried ancestorId and descriptor's ancestorId
        if (
          Object.prototype.hasOwnProperty.call(packageDescriptorJson, 'ancestorId') &&
          ancestorId !== queriedAncestorId
        ) {
          throw new Error(
            messages.getMessage('errorAncestorIdVersionMismatch', [
              packageDescriptorJson.ancestorVersion,
              packageDescriptorJson.ancestorId,
            ])
          );
        }
        ancestorId = queriedAncestorId;
        origSpecifiedAncestor = packageDescriptorJson.ancestorVersion;
      }

      return this.validateAncestorId(
        ancestorId,
        highestReleasedVersion,
        explicitUseNoAncestor,
        isPatch,
        skipAncestorCheck,
        origSpecifiedAncestor
      );
    });
  },

  validateAncestorId(
    ancestorId: string,
    highestReleasedVersion: PackagingSObjects.Package2Version,
    explicitUseNoAncestor: boolean,
    isPatch: boolean,
    skipAncestorCheck: boolean,
    origSpecifiedAncestor: string
  ) {
    if (explicitUseNoAncestor) {
      if (!highestReleasedVersion) {
        return '';
      } else {
        // the explicitUseNoAncestor && skipAncestorCheck case is handled above
        throw new Error(
          messages.getMessage('errorAncestorNoneNotAllowed', [
            this.getPackage2VersionNumber(highestReleasedVersion) as string,
          ])
        );
      }
    }
    if (!isPatch && !skipAncestorCheck) {
      if (highestReleasedVersion) {
        if (highestReleasedVersion.Id !== ancestorId) {
          throw new Error(
            messages.getMessage('errorAncestorNotHighest', [
              origSpecifiedAncestor,
              this.getPackage2VersionNumber(highestReleasedVersion),
            ] as Tokens)
          );
        }
      } else {
        // looks like the initial version:create - allow
        ancestorId = '';
      }
    }
    return ancestorId;
  },

  async getAncestorIdHighestRelease(
    connection,
    org,
    packageId,
    versionNumber,
    versionNumberString,
    isPatch,
    explicitUseHighestRelease,
    skipAncestorCheck
  ) {
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
      const majorMinorVersionResult = await connection.toolingQuery(org, query);
      const majorMinorVersionRecords = majorMinorVersionResult.records;
      if (majorMinorVersionRecords && majorMinorVersionRecords?.length === 1 && majorMinorVersionRecords[0]) {
        result.finalAncestorId = majorMinorVersionRecords[0].Id;
      } else {
        const majorMinorNotFound = `${versionNumber[0]}.${versionNumber[1]}.0`;
        throw new Error(messages.getMessage('errorNoMatchingMajorMinorForPatch', [majorMinorNotFound]));
      }
    } else if (!isPatch && (explicitUseHighestRelease || !skipAncestorCheck)) {
      // ancestor must be set to latest released major.minor version
      const query =
        'SELECT Id, SubscriberPackageVersionId, MajorVersion, MinorVersion, PatchVersion FROM Package2Version ' +
        `WHERE Package2Id = '${packageId}' AND IsReleased = True AND IsDeprecated = False AND PatchVersion = 0 ` +
        'ORDER BY MajorVersion Desc, MinorVersion Desc, PatchVersion Desc, BuildNumber Desc LIMIT 1';
      const highestVersionResult = await connection.toolingQuery(org, query);
      const highestVersionRecords = highestVersionResult.records;
      if (highestVersionRecords && highestVersionRecords?.length === 1 && highestVersionRecords[0]) {
        result.highestReleasedVersion = highestVersionRecords[0];
        if (explicitUseHighestRelease) {
          result.finalAncestorId = result.highestReleasedVersion.Id;
        }
      } else if (explicitUseHighestRelease) {
        // there is no eligible ancestor version
        throw new Error(messages.getMessage('errorNoMatchingAncestor', [versionNumberString, packageId] as Tokens));
      }
    }
    return result;
  },

  getPackage2VersionNumber(package2VersionObj): string {
    return `${package2VersionObj.MajorVersion}.${package2VersionObj.MinorVersion}.${package2VersionObj.PatchVersion}`;
  },

  getConfigPackageDirectories(context) {
    return context.org.connection.config.getConfigContent().packageDirectories;
  },

  getConfigPackageDirectory(packageDirs, lookupProperty, lookupValue) {
    let packageDir;
    if (packageDirs) {
      packageDir = packageDirs.find((x) => x[lookupProperty] === lookupValue);
    }
    return packageDir;
  },

  /**
   * Given a packageAlias, attempt to return the associated id from the config
   *
   * @param packageAlias string representing a package alias
   * @param config for obtaining the project config
   * @returns the associated id or the arg given.
   */
  getPackageIdFromAlias(packageAlias: string, config: SfProject): string {
    const packageAliases = config.getSfProjectJson().getContents().packageAliases;

    // if there are no aliases defined, return
    if (!packageAliases) {
      return packageAlias;
    }

    // return alias if it exists, otherwise return what was passed in
    return packageAliases[packageAlias] || packageAlias;
  },

  /**
   * @param stringIn pascal or camel case string
   * @returns space delimited and lower-cased (except for 1st char) string (e.g. in "AbcdEfghIj" => "Abcd efgh ij")
   */
  convertCamelCaseStringToSentence(stringIn: string): string {
    return camelCaseToTitleCase(stringIn);
  },

  /**
   * Given a package id, attempt to return the associated aliases from the config
   *
   * @param packageid string representing a package id
   * @param config for obtaining the project config
   * @returns an array of alias for the given id.
   */
  // TODO: maybe pass in SfProjectJson instead of SfProject
  getPackageAliasesFromId(packageId: string, config: SfProject): string[] {
    const packageAliases = config.getSfProjectJson().getContents().packageAliases;

    // if there are no aliases defined, return undefined
    if (!packageAliases) {
      return [];
    }

    // otherwise check for a matching alias
    const matchingAliases = Object.entries(packageAliases).filter((alias) => alias[1] === packageId);

    return matchingAliases.map((alias) => alias[0]);
  },

  async findOrCreatePackage2(seedPackage: string, connection: Connection, org: Org) {
    const query = `SELECT Id FROM Package2 WHERE ConvertedFromPackageId = '${seedPackage}'`;
    const queryResult = await connection.tooling.query<PackagingSObjects.Package2>(query);
    const records = queryResult.records;
    if (records && records.length > 1) {
      const ids = records.map((r) => r.Id);
      throw new Error(messages.getMessage('errorMoreThanOnePackage2WithSeed', ids));
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
      throw new Error(messages.getMessage('errorNoSubscriberPackageRecord', [seedPackage]));
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
      throw new Error(createResult.errors.map((e) => e.message).join('\n'));
    }
    return createResult.id;
  },

  _getPackageVersionCreateRequestApi(connection: Connection) {
    // @ts-ignore
    return new PackageVersionCreateRequestApi({ connection });
  },

  pollForStatusWithInterval(
    context,
    id: string,
    retries: number,
    packageId: string,
    withProject: SfProject,
    connection: Connection,
    interval: number
  ) {
    const STATUS_ERROR = 'Error';
    const STATUS_SUCCESS = 'Success';
    const STATUS_UNKNOWN = 'Unknown';

    const pvcrApi = this._getPackageVersionCreateRequestApi(connection);

    return pvcrApi.byId(id).then(async (results) => {
      if (this._isStatusEqualTo(results, [STATUS_SUCCESS, STATUS_ERROR])) {
        // complete
        if (this._isStatusEqualTo(results, [STATUS_SUCCESS])) {
          // success

          // for Managed packages with removed metadata, output a warning
          if (results[0].HasMetadataRemoved === true) {
            // TODO: emit lifecycle event for this condition
            // CliUx.ux.warn(messages.getMessage('hasMetadataRemovedWarning'));
          }

          // update sfdx-project.json
          if (withProject && !process.env.SFDX_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_CREATE) {
            const query = `SELECT MajorVersion, MinorVersion, PatchVersion, BuildNumber FROM Package2Version WHERE Id = '${results[0].Package2VersionId}'`;
            const package2VersionVersionString = await connection.tooling
              .query<PackagingSObjects.Package2Version>(query)
              .then((pkgQueryResult) => {
                const record = pkgQueryResult.records[0];
                return `${record.MajorVersion}.${record.MinorVersion}.${record.PatchVersion}-${record.BuildNumber}`;
              });
            const newConfig = await this._generatePackageAliasEntry(
              context,
              results[0].SubscriberPackageVersionId,
              package2VersionVersionString,
              // TODO: need to pass in branch (context.branch)
              context.flags.branch,
              packageId
            );
            // TODO: should write sfProject here (goal of removing this function)
            await this._writeProjectConfigToDisk(context, newConfig);
          }
          return results[0];
        } else {
          let status = 'Unknown Error';
          if (results?.length > 0 && results[0].Error.length > 0) {
            const errors = [];
            // for multiple errors, display one per line prefixed with (x)
            if (results[0].Error.length > 1) {
              results[0].Error.forEach((error) => {
                errors.push(`(${errors.length + 1}) ${error}`);
              });
              // TODO: need new error message for this
              errors.unshift(messages.getMessage('version_create.multipleErrors'));
            }
            status = errors.length !== 0 ? errors.join('\n') : results[0].Error;
          }
          throw new Error(status);
        }
      } else {
        if (retries > 0) {
          // poll/retry
          let currentStatus = STATUS_UNKNOWN;
          if (results && results.length > 0) {
            currentStatus = results[0].Status;
          }
          // TODO: lifecycle emit for this event
          logger.info(
            `Request in progress. Sleeping ${interval} seconds. Will wait a total of ${
              interval * retries
            } more seconds before timing out. Current Status='${this.convertCamelCaseStringToSentence(currentStatus)}'`
          );
          const pollingClient = await PollingClient.create({
            poll: async (): Promise<StatusResult> => {
              return Promise.resolve({ completed: false, payload: {} });
            },
            frequency: Duration.milliseconds(interval * 1000),
            timeout: Duration.milliseconds(interval * retries * 1000),
          });

          return pollingClient.subscribe<unknown>();

          // return BBPromise.delay(interval * 1000).then(() =>
          //   this.pollForStatusWithInterval(context, id, retries - 1, packageId, withProject, connection, org)
          // );
        } else {
          // Timed out
        }
      }

      return results;
    });
  },
  /**
   * Writes objects specified in the config to the sfdx-project.json file on disk.
   *
   * @param context
   * @private
   */
  // TODO: this needs to be rewritten. Seems that `setWorkspaceConfigContent` no longer exists in core v3
  _writeProjectConfigToDisk(context, config: SfProject) {
    try {
      // write it to sfdx-project.json
      return context.org.connection.config
        .setWorkspaceConfigContent(context.org.connection.config.getProjectPath(), config)
        .then(() => {
          logger.info(messages.getMessage('updatedSfProject'));
        })
        .catch((err) => {
          logger.warn(
            context,
            messages.getMessage('errorSfProjectFileWrite', [JSON.stringify(config, null, 4), err.message] as Tokens)
          );
        });
    } catch (err) {
      logger.error(err.stack);
      return Promise.reject(err);
    }
  },

  /**
   * Generate package alias json entry for this package version that can be written to sfdx-project.json
   *
   * @param context
   * @param packageVersionId 04t id of the package to create the alias entry for
   * @param packageVersionNumber that will be appended to the package name to form the alias
   * @param packageId the 0Ho id
   * @private
   */
  async _generatePackageAliasEntry(
    context: Connection,
    packageVersionId: string,
    packageVersionNumber: string,
    branch: string,
    packageId: string
  ): Promise<{ packageAliases: { [p: string]: string } }> {
    // TODO: need to pass in SfProject.
    const project = await SfProject.resolve();
    const configContent = project.getSfProjectJson().getContents();
    const packageAliases = configContent.packageAliases || {};

    const aliasForPackageId = this.getPackageAliasesFromId(packageId, project);
    let packageName;
    if (!aliasForPackageId || aliasForPackageId.length === 0) {
      const query = `SELECT Name FROM Package2 WHERE Id = '${packageId}'`;
      packageName = await context.tooling
        .query<PackagingSObjects.Package2>(query)
        .then((pkgQueryResult) => pkgQueryResult.records[0]?.Name);
    } else {
      packageName = aliasForPackageId[0];
    }

    const packageAlias = branch
      ? `${packageName}@${packageVersionNumber}-${branch}`
      : `${packageName}@${packageVersionNumber}`;
    packageAliases[packageAlias] = packageVersionId;

    return { packageAliases };
  },

  /**
   * Return true if the queryResult.records[0].Status is equal to one of the values in statuses.
   *
   * @param results to examine
   * @param statuses array of statuses to look for
   * @returns {boolean} if one of the values in status is found.
   */
  _isStatusEqualTo(results, statuses?) {
    return results?.length <= 0 ? false : statuses?.some((status) => results[0].Status === status);
  },

  // added for unit testing
  getSoqlWhereClauseMaxLength() {
    return this.SQL_WHERE_CLAUSE_MAX_LENGTH;
  },

  formatDate(date: Date) {
    const pad = (num) => {
      return num < 10 ? `0${num}` : num;
    };
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
      date.getMinutes()
    )}`;
  },

  LATEST_BUILD_NUMBER_TOKEN: BuildNumberToken.LATEST_BUILD_NUMBER_TOKEN as string,
  NEXT_BUILD_NUMBER_TOKEN: BuildNumberToken.NEXT_BUILD_NUMBER_TOKEN as string,
  RELEASED_BUILD_NUMBER_TOKEN: BuildNumberToken.RELEASED_BUILD_NUMBER_TOKEN as string,
  HIGHEST_VERSION_NUMBER_TOKEN: BuildNumberToken.HIGHEST_VERSION_NUMBER_TOKEN as string,
  VERSION_NUMBER_SEP,
  INSTALL_URL_BASE,
  DEFAULT_PACKAGE_DIR,
  SOQL_WHERE_CLAUSE_MAX_LENGTH,
  POLL_INTERVAL_SECONDS,
};
