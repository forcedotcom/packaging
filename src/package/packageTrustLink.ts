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
  PackageTrustLinkListStatusFilter,
  PackageTrustLinkRecord,
  PackageTrustLinkRequestOptions,
  PackageTrustLinkRequestResult,
  PackageTrustLinkStatus,
} from '../interfaces';
import { combineSaveErrors } from '../utils/packageUtils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_trust_link');

// Tooling API SObject backing the VerifiedDev (Public Secure) org-level trust relationship
// between the connected authoring org and a Verified PBO. See W-23970567 / SPI CLI design doc.
const TRUST_LINK_SOBJECT = 'PkgVrfyAuthOrgTrustRela';
const MINIMUM_API_VERSION = '68.0';
const ORGANIZATION_TYPE_VERIFIED = 'Verified';

const STATUS_FILTER_TO_API: Record<PackageTrustLinkListStatusFilter, PackageTrustLinkStatus> = {
  pending: 'Pending',
  approved: 'Accepted',
  declined: 'Declined',
  revoked: 'Revoked',
};

type PackageTrustLinkQueryRecord = PackageTrustLinkRecord & Schema;

const isStatusFilter = (status: string): status is PackageTrustLinkListStatusFilter =>
  Object.prototype.hasOwnProperty.call(STATUS_FILTER_TO_API, status);

const toApiStatus = (status: PackageTrustLinkListStatusFilter): PackageTrustLinkStatus => {
  if (!isStatusFilter(status)) {
    throw messages.createError('invalidStatus', [status]);
  }
  return STATUS_FILTER_TO_API[status];
};

type TrustLinkRecord = {
  Id: string;
  VerifiedOrg: string;
  Status: string;
};

export class PackageTrustLink {
  public constructor() {}

  /**
   * Request a Public Secure (VerifiedDev) trust link from the connected authoring org to a Verified PBO.
   *
   * Establishes the developer/authoring-org side of the two-way trust handshake by creating a
   * `Pending` trust relationship. A PBO admin approves it separately. This does not change any
   * package's distribution type — trust and enforcement are decoupled.
   *
   * @param connection - Connection to the authoring org (the 1GP namespace org or 2GP Dev Hub).
   * @param options - the verified org (PBO) ID to request a trust link to.
   * @returns the created trust relationship Id, verified org ID, and status.
   */
  public static async request(
    connection: Connection,
    options: PackageTrustLinkRequestOptions
  ): Promise<PackageTrustLinkRequestResult> {
    if (!options.verifiedOrgId.startsWith('00D') || !validateSalesforceId(options.verifiedOrgId)) {
      throw messages.createError('invalidVerifiedOrgId', [options.verifiedOrgId]);
    }
    // VerifiedOrg is a TEXT field that core stores as a 15-char ID, so normalize before
    // insert to avoid 18-char mismatches.
    const verifiedOrgId = trimTo15(options.verifiedOrgId);

    // An authoring org can hold at most one trust relationship at a time. The Tooling API
    // query below runs against the connected authoring org and only returns that org's own
    // rows (AuthoringOrg is server-set), so any existing row (in any status, to any verified
    // org) blocks a new request until it's deleted (unlinked).
    const existing = await queryExistingTrustLink(connection);
    if (existing) {
      throw messages.createError('trustLinkAlreadyExists', [existing.VerifiedOrg, existing.Status]);
    }

    // Create the trust relationship via the Tooling API. Status is required and must be
    // 'Pending' on create; the PBO admin advances it during the approval handshake.
    const createResult = await connection.tooling.create(TRUST_LINK_SOBJECT, {
      VerifiedOrg: verifiedOrgId,
      Status: 'Pending',
    });

    if (!createResult.success || !createResult.id) {
      throw combineSaveErrors(TRUST_LINK_SOBJECT, 'create', createResult.errors);
    }

    return {
      LinkRequestId: createResult.id,
      VerifiedOrgId: verifiedOrgId,
      Status: 'Pending',
    };
  }

  /**
   * List inbound Public Secure trust-link requests for the connected Verified PBO.
   *
   * Queries `PkgVrfyAuthOrgTrustRela` rows where this org is the Verified org, excluding the
   * self-trust record (`AuthoringOrg != VerifiedOrg`). Optional `--status` CLI values map to
   * Tooling statuses (`approved` → `Accepted`). Matches `sf package trust link list`.
   */
  public static async list(
    connection: Connection,
    status?: PackageTrustLinkListStatusFilter
  ): Promise<PackageTrustLinkRecord[]> {
    if (Number(connection.getApiVersion()) < Number(MINIMUM_API_VERSION)) {
      throw messages.createError('apiVersionTooLow', [MINIMUM_API_VERSION]);
    }
    const orgId = connection.getAuthInfoFields()?.orgId;
    if (!orgId) {
      throw messages.createError('missingOrgId');
    }

    const verifiedOrgId = trimTo15(orgId);
    const statusFilter = status ? toApiStatus(status) : undefined;
    const statusClause = statusFilter ? ` AND Status = '${statusFilter}'` : '';
    const query =
      'SELECT Id, AuthoringOrg, VerifiedOrg, Status, RequestedBy, CreatedDate, EstablishedDate, RevokedDate FROM ' +
      `${TRUST_LINK_SOBJECT} WHERE VerifiedOrg = '${verifiedOrgId}' AND OrganizationType = '${ORGANIZATION_TYPE_VERIFIED}' ` +
      `AND AuthoringOrg != '${verifiedOrgId}'${statusClause} ORDER BY CreatedDate DESC`;

    const result = await connection.autoFetchQuery<PackageTrustLinkQueryRecord>(query, { tooling: true });
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

async function queryExistingTrustLink(connection: Connection): Promise<TrustLinkRecord | undefined> {
  const query = `SELECT Id, VerifiedOrg, Status FROM ${TRUST_LINK_SOBJECT} LIMIT 1`;
  const result = await connection.autoFetchQuery<TrustLinkRecord & Schema>(query, { tooling: true });
  return result.records?.[0];
}
