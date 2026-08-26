/*
 * Copyright 2026, Salesforce, Inc.
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
import type { Schema } from '@jsforce/jsforce-node';
import { Connection, Messages, trimTo15, validateSalesforceId } from '@salesforce/core';
import {
  PackageAuthorizationAddResult,
  PackageAuthorizationOptions,
  PackageAuthorizationRecord,
  PackageAuthorizationRemoveResult,
} from '../interfaces';
import { combineSaveErrors } from '../utils/packageUtils';

const PACKAGE_AUTHORIZATION_SOBJECT = 'PkgAuthOrgSbscrbTrustRela';
const MINIMUM_API_VERSION = '68.0';

type PackageAuthorizationQueryRecord = Omit<PackageAuthorizationRecord, 'CreatedByUsername'> &
  Schema & {
    CreatedBy?: { Username?: string };
  };

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_authorize');

const normalizeSubscriberOrg = (subscriberOrg: string): string => {
  if (!subscriberOrg.startsWith('00D') || !validateSalesforceId(subscriberOrg)) {
    throw messages.createError('invalidSubscriberOrg', [subscriberOrg]);
  }
  return trimTo15(subscriberOrg);
};

export class PackageAuthorization {
  private readonly connection: Connection;
  private readonly subscriberPackageId?: string;

  public constructor(options: PackageAuthorizationOptions) {
    if (Number(options.connection.getApiVersion()) < Number(MINIMUM_API_VERSION)) {
      throw messages.createError('apiVersionTooLow', [MINIMUM_API_VERSION]);
    }
    if (
      options.subscriberPackageId &&
      (!options.subscriberPackageId.startsWith('033') || !validateSalesforceId(options.subscriberPackageId))
    ) {
      throw messages.createError('invalidSubscriberPackage', [options.subscriberPackageId]);
    }
    this.connection = options.connection;
    this.subscriberPackageId = options.subscriberPackageId;
  }

  public async add(subscriberOrgs: string[]): Promise<PackageAuthorizationAddResult[]> {
    if (subscriberOrgs.length === 0) {
      throw messages.createError('noSubscriberOrgs');
    }
    const normalizedSubscriberOrgs = subscriberOrgs.map(normalizeSubscriberOrg);

    return normalizedSubscriberOrgs.reduce<Promise<PackageAuthorizationAddResult[]>>(
      async (resultsPromise, subscriberOrg) => {
        const results = await resultsPromise;
        const result = await this.connection.tooling.create(PACKAGE_AUTHORIZATION_SOBJECT, {
          SubscriberOrg: subscriberOrg,
          ...(this.subscriberPackageId ? { SubscriberPackageId: this.subscriberPackageId } : {}),
          Status: 'Active',
        });

        if (!result.success || !result.id) {
          throw combineSaveErrors(PACKAGE_AUTHORIZATION_SOBJECT, 'create', result.errors);
        }

        results.push({ Id: result.id, SubscriberOrg: subscriberOrg });
        return results;
      },
      Promise.resolve([])
    );
  }

  public async remove(subscriberOrg: string): Promise<PackageAuthorizationRemoveResult> {
    const normalizedSubscriberOrg = normalizeSubscriberOrg(subscriberOrg);
    const subscriberPackageFilter = this.subscriberPackageId
      ? `SubscriberPackageId = '${this.subscriberPackageId}'`
      : 'SubscriberPackageId = NULL';

    const records = await this.query(
      `WHERE SubscriberOrg = '${normalizedSubscriberOrg}' AND ${subscriberPackageFilter} LIMIT 1`
    );
    const record = records[0];
    if (!record) {
      return { SubscriberOrg: normalizedSubscriberOrg, removed: false };
    }

    const result = await this.connection.tooling.sobject(PACKAGE_AUTHORIZATION_SOBJECT).destroy(record.Id);
    if (!result.success) {
      throw combineSaveErrors(PACKAGE_AUTHORIZATION_SOBJECT, 'delete', result.errors);
    }

    return { SubscriberOrg: normalizedSubscriberOrg, removed: true };
  }

  public async list(): Promise<PackageAuthorizationRecord[]> {
    const packageFilter = this.subscriberPackageId ? `WHERE SubscriberPackageId = '${this.subscriberPackageId}' ` : '';
    return this.query(`${packageFilter}ORDER BY SubscriberOrg`);
  }

  private async query(whereClause: string): Promise<PackageAuthorizationRecord[]> {
    const query =
      'SELECT Id, SubscriberOrg, SubscriberPackageId, Status, CreatedDate, CreatedById, CreatedBy.Username FROM ' +
      `${PACKAGE_AUTHORIZATION_SOBJECT} ${whereClause}`;
    const result = await this.connection.autoFetchQuery<PackageAuthorizationQueryRecord>(query, { tooling: true });
    return (result.records ?? []).map(
      ({ Id, SubscriberOrg, SubscriberPackageId, Status, CreatedDate, CreatedById, CreatedBy }) => ({
        Id,
        SubscriberOrg,
        SubscriberPackageId,
        Status,
        CreatedDate,
        CreatedById,
        CreatedByUsername: CreatedBy?.Username ?? CreatedById,
      })
    );
  }
}
