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
import { Connection, Messages, trimTo15 } from '@salesforce/core';
import { PackageLinkListStatusFilter, PackageLinkOptions, PackageLinkRecord, PackageLinkStatus } from '../interfaces';

const PACKAGE_LINK_SOBJECT = 'PkgVrfyAuthOrgTrustRela';
const MINIMUM_API_VERSION = '68.0';
const ORGANIZATION_TYPE_VERIFIED = 'Verified';

const STATUS_FILTER_TO_API: Record<PackageLinkListStatusFilter, PackageLinkStatus> = {
  pending: 'Pending',
  approved: 'Accepted',
  declined: 'Declined',
  revoked: 'Revoked',
};

type PackageLinkQueryRecord = PackageLinkRecord & Schema;

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_link');

const isStatusFilter = (status: string): status is PackageLinkListStatusFilter =>
  Object.prototype.hasOwnProperty.call(STATUS_FILTER_TO_API, status);

const toApiStatus = (status: PackageLinkListStatusFilter): PackageLinkStatus => {
  if (!isStatusFilter(status)) {
    throw messages.createError('invalidStatus', [status]);
  }
  return STATUS_FILTER_TO_API[status];
};

export class PackageLink {
  private readonly connection: Connection;
  private readonly verifiedOrgId: string;

  public constructor(options: PackageLinkOptions) {
    if (Number(options.connection.getApiVersion()) < Number(MINIMUM_API_VERSION)) {
      throw messages.createError('apiVersionTooLow', [MINIMUM_API_VERSION]);
    }
    const orgId = options.connection.getAuthInfoFields()?.orgId;
    if (!orgId) {
      throw messages.createError('missingOrgId');
    }
    this.connection = options.connection;
    this.verifiedOrgId = trimTo15(orgId);
  }

  public async list(status?: PackageLinkListStatusFilter): Promise<PackageLinkRecord[]> {
    const statusFilter = status ? toApiStatus(status) : undefined;
    const statusClause = statusFilter ? ` AND Status = '${statusFilter}'` : '';
    const query =
      'SELECT Id, AuthoringOrg, VerifiedOrg, Status, RequestedBy, CreatedDate, EstablishedDate, RevokedDate FROM ' +
      `${PACKAGE_LINK_SOBJECT} WHERE VerifiedOrg = '${this.verifiedOrgId}' AND OrganizationType = '${ORGANIZATION_TYPE_VERIFIED}' ` +
      `AND AuthoringOrg != '${this.verifiedOrgId}'${statusClause} ORDER BY CreatedDate DESC`;

    const result = await this.connection.autoFetchQuery<PackageLinkQueryRecord>(query, { tooling: true });
    return (result.records ?? []).map(
      ({ Id, AuthoringOrg, VerifiedOrg, Status, RequestedBy, CreatedDate, EstablishedDate, RevokedDate }) => ({
        Id,
        AuthoringOrg,
        VerifiedOrg,
        Status,
        RequestedBy: RequestedBy ?? null,
        CreatedDate,
        EstablishedDate: EstablishedDate ?? null,
        RevokedDate: RevokedDate ?? null,
      })
    );
  }
}
