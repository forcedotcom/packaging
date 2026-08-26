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
import util from 'node:util';
import type { Schema } from '@jsforce/jsforce-node';
import { Connection, Messages, SfError, trimTo15 } from '@salesforce/core';
import {
  PackageLinkListStatusFilter,
  PackageLinkRecord,
  PackageLinkRequestOptions,
  PackageLinkRequestResult,
  PackageLinkStatus,
} from '../interfaces';
import { applyErrorAction, BY_LABEL, massageErrorMessage, validateId } from '../utils/packageUtils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_link');

// Tooling API SObject backing the VerifiedDev (Public Secure) org-level trust relationship
// between the connected authoring org and a Verified PBO. See W-23970567 / SPI CLI design doc.
const LINK_REQUEST_SOBJECT = 'PkgVrfyAuthOrgTrustRela';
const MINIMUM_API_VERSION = '68.0';
const ORGANIZATION_TYPE_VERIFIED = 'Verified';

// Statuses that mean a trust relationship already exists and must be revoked (via unlink) before requesting again.
const ACTIVE_LINK_STATUSES = ['Pending', 'Accepted', 'Linked'];

const STATUS_FILTER_TO_API: Record<PackageLinkListStatusFilter, PackageLinkStatus> = {
  pending: 'Pending',
  approved: 'Accepted',
  declined: 'Declined',
  revoked: 'Revoked',
};

type LinkRequestRecord = {
  Id: string;
  VerifiedOrg: string;
  Status: string;
};

type LinkRequestCreateResult = {
  id: string;
  success: boolean;
  errors: object[];
};

type PackageLinkQueryRecord = PackageLinkRecord & Schema;

const isStatusFilter = (status: string): status is PackageLinkListStatusFilter =>
  Object.prototype.hasOwnProperty.call(STATUS_FILTER_TO_API, status);

const toApiStatus = (status: PackageLinkListStatusFilter): PackageLinkStatus => {
  if (!isStatusFilter(status)) {
    throw messages.createError('invalidStatus', [status]);
  }
  return STATUS_FILTER_TO_API[status];
};

export class PackageLink {
  public constructor() {}

  /**
   * Request a Public Secure (VerifiedDev) link from the connected authoring org to a Verified PBO.
   *
   * Establishes the developer/authoring-org side of the two-way trust handshake by creating a
   * `Pending` link request. A PBO admin approves it separately. This does not change any package's
   * distribution type — trust and enforcement are decoupled.
   *
   * @param connection - Connection to the authoring org (the 1GP namespace org or 2GP Dev Hub).
   * @param options - the verified org (PBO) ID to request a link to.
   * @returns the created link request Id, verified org ID, and status.
   */
  public static async request(
    connection: Connection,
    options: PackageLinkRequestOptions
  ): Promise<PackageLinkRequestResult> {
    try {
      validateId(BY_LABEL.ORGANIZATION_ID, options.verifiedOrgId);

      // Idempotent guard: fail if an active request/link to this org already exists.
      const existing = await queryExistingLink(connection, options.verifiedOrgId);
      if (existing && ACTIVE_LINK_STATUSES.includes(existing.Status)) {
        throw messages.createError('linkRequestAlreadyExists', [options.verifiedOrgId, existing.Status]);
      }

      // Create the trust relationship via the Tooling API. Status is required and must be
      // 'Pending' on create; the PBO admin advances it during the approval handshake.
      const createResult = await connection.tooling.request<LinkRequestCreateResult>({
        method: 'POST',
        url: `/services/data/v${connection.getApiVersion()}/tooling/sobjects/${LINK_REQUEST_SOBJECT}`,
        body: JSON.stringify({ VerifiedOrg: options.verifiedOrgId, Status: 'Pending' }),
      });

      if (!createResult.success) {
        throw messages.createError('linkRequestFailed', [options.verifiedOrgId]);
      }

      return {
        LinkRequestId: createResult.id,
        VerifiedOrgId: options.verifiedOrgId,
        Status: 'Pending',
      };
    } catch (err) {
      if (err instanceof SfError) {
        throw err;
      }
      if (err instanceof Error) {
        throw applyErrorAction(massageErrorMessage(err));
      }
      throw err;
    }
  }

  /**
   * List inbound Public Secure link requests for the connected Verified PBO.
   *
   * Queries `PkgVrfyAuthOrgTrustRela` rows where this org is the Verified org, excluding the
   * self-trust record (`AuthoringOrg != VerifiedOrg`). Optional `--status` CLI values map to
   * Tooling statuses (`approved` → `Accepted`).
   */
  public static async list(connection: Connection, status?: PackageLinkListStatusFilter): Promise<PackageLinkRecord[]> {
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
      `${LINK_REQUEST_SOBJECT} WHERE VerifiedOrg = '${verifiedOrgId}' AND OrganizationType = '${ORGANIZATION_TYPE_VERIFIED}' ` +
      `AND AuthoringOrg != '${verifiedOrgId}'${statusClause} ORDER BY CreatedDate DESC`;

    const result = await connection.autoFetchQuery<PackageLinkQueryRecord>(query, { tooling: true });
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

async function queryExistingLink(
  connection: Connection,
  verifiedOrgId: string
): Promise<LinkRequestRecord | undefined> {
  const query = util.format(getLinkRequestQuery(), verifiedOrgId);
  const result = await connection.tooling.query<LinkRequestRecord>(query);
  return result.records?.[0];
}

function getLinkRequestQuery(): string {
  return "SELECT Id, VerifiedOrg, Status FROM PkgVrfyAuthOrgTrustRela WHERE VerifiedOrg = '%s'";
}
