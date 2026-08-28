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
  PackageTrustLinkRequestOptions,
  PackageTrustLinkRequestResult,
  PackageTrustLinkStatusResult,
  PackageTrustLinkUnlinkResult,
} from '../interfaces';
import { combineSaveErrors } from '../utils/packageUtils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_trust_link');

// Tooling API SObject backing the VerifiedDev (Public Secure) org-level trust relationship
// between the connected authoring org and a Verified PBO. See W-23970567 / SPI CLI design doc.
const TRUST_LINK_SOBJECT = 'PkgVrfyAuthOrgTrustRela';

// The absence of a trust link record is a valid state the CLI reports; the SObject Status
// picklist itself only covers the states an existing link can be in.
const NOT_LINKED = 'Not Linked';

type TrustLinkRecord = {
  Id: string;
  VerifiedOrg: string;
  Status: string;
  EstablishedDate: string | null;
  RevokedDate: string | null;
  CreatedDate: string | null;
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
   * Report the connected authoring org's Public Secure (VerifiedDev) trust link state.
   *
   * Read-only developer/authoring-org side operation. An authoring org holds at most one trust
   * relationship, so this returns that org's link if one exists — its status (`Pending`, `Accepted`,
   * `Declined`, `Revoked`, or `Failed`) and the relevant timestamps — or the synthetic `Not Linked`
   * state when the org has no link at all. It never mutates anything.
   *
   * @param connection - Connection to the authoring org (the 1GP namespace org or 2GP Dev Hub).
   * @returns the current link state and, when a link exists, its Id, verified org ID, and timestamps.
   */
  public static async status(connection: Connection): Promise<PackageTrustLinkStatusResult> {
    // The Tooling API query runs against the connected authoring org (AuthoringOrg is server-set),
    // so this returns that org's own link if any. No record means the org was never linked.
    const existing = await queryExistingTrustLink(connection);
    if (!existing) {
      return { Status: NOT_LINKED, linked: false };
    }

    // Only surface timestamps that are actually set — a Pending link has no EstablishedDate, and
    // only a Revoked link has a RevokedDate. Emitting undefined keys would leak nulls into --json.
    return {
      Status: existing.Status,
      linked: true,
      LinkRequestId: existing.Id,
      VerifiedOrgId: existing.VerifiedOrg,
      ...(existing.CreatedDate ? { RequestedDate: existing.CreatedDate } : {}),
      ...(existing.EstablishedDate ? { EstablishedDate: existing.EstablishedDate } : {}),
      ...(existing.RevokedDate ? { RevokedDate: existing.RevokedDate } : {}),
    };
  }

  /**
   * Clear the connected authoring org's Public Secure (VerifiedDev) trust link, returning it to the
   * `Not Linked` state.
   *
   * Deletes the authoring org's single trust relationship regardless of its current status. This is
   * the developer/authoring-org side operation used both to abandon a request and to retry after a
   * decline (unlink, then request again). It is idempotent: if the org has no trust link, it reports
   * `removed: false` rather than erroring.
   *
   * @param connection - Connection to the authoring org (the 1GP namespace org or 2GP Dev Hub).
   * @returns whether a link was removed and, when one existed, its Id, verified org ID, and status.
   */
  public static async unlink(connection: Connection): Promise<PackageTrustLinkUnlinkResult> {
    // An authoring org holds at most one trust relationship, and the Tooling API query runs against
    // the connected org (AuthoringOrg is server-set), so this returns that org's own link if any.
    const existing = await queryExistingTrustLink(connection);
    if (!existing) {
      return { removed: false };
    }

    const deleteResult = await connection.tooling.sobject(TRUST_LINK_SOBJECT).destroy(existing.Id);
    if (!deleteResult.success) {
      throw combineSaveErrors(TRUST_LINK_SOBJECT, 'delete', deleteResult.errors);
    }

    return {
      removed: true,
      LinkRequestId: existing.Id,
      VerifiedOrgId: existing.VerifiedOrg,
      Status: existing.Status,
    };
  }
}

async function queryExistingTrustLink(connection: Connection): Promise<TrustLinkRecord | undefined> {
  const query = `SELECT Id, VerifiedOrg, Status, EstablishedDate, RevokedDate, CreatedDate FROM ${TRUST_LINK_SOBJECT} LIMIT 1`;
  const result = await connection.autoFetchQuery<TrustLinkRecord & Schema>(query, { tooling: true });
  return result.records?.[0];
}
