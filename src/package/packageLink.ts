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
import { Connection, Messages, SfError } from '@salesforce/core';
import { PackageLinkRequestOptions, PackageLinkRequestResult } from '../interfaces';
import { applyErrorAction, BY_LABEL, massageErrorMessage, validateId } from '../utils/packageUtils';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_link');

// Tooling API SObject backing the VerifiedDev (Public Secure) org-level trust relationship
// between the connected authoring org and a Verified PBO. See W-23970567 / SPI CLI design doc.
const LINK_REQUEST_SOBJECT = 'PkgVrfyAuthOrgTrustRela';

// Statuses that mean a trust relationship already exists and must be revoked (via unlink) before requesting again.
const ACTIVE_LINK_STATUSES = ['Pending', 'Accepted', 'Linked'];

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
