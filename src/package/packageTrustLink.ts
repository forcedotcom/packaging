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
import { PackageTrustLinkRequestOptions, PackageTrustLinkRequestResult } from '../interfaces';
import { combineSaveErrors } from '../utils/packageUtils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_trust_link');

// Tooling API SObject backing the VerifiedDev (Public Secure) org-level trust relationship
// between the connected authoring org and a Verified PBO. See W-23970567 / SPI CLI design doc.
const TRUST_LINK_SOBJECT = 'PkgVrfyAuthOrgTrustRela';

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
    // both the duplicate lookup and the insert to avoid 18-char mismatches.
    const verifiedOrgId = trimTo15(options.verifiedOrgId);

    // Idempotent guard: any existing relationship (in any status) occupies the unique key,
    // so a re-request would fail on insert. Block until the existing row is deleted (unlinked).
    const existing = await queryExistingTrustLink(connection, verifiedOrgId);
    if (existing) {
      throw messages.createError('trustLinkAlreadyExists', [verifiedOrgId, existing.Status]);
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
}

async function queryExistingTrustLink(
  connection: Connection,
  verifiedOrgId: string
): Promise<TrustLinkRecord | undefined> {
  const query = `SELECT Id, VerifiedOrg, Status FROM ${TRUST_LINK_SOBJECT} WHERE VerifiedOrg = '${verifiedOrgId}' LIMIT 1`;
  const result = await connection.autoFetchQuery<TrustLinkRecord & Schema>(query, { tooling: true });
  return result.records?.[0];
}
