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
import { expect } from 'chai';
import { Connection, SfError } from '@salesforce/core';
import { instantiateContext, restoreContext, stubContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { AnyJson, ensureJsonMap, ensureString } from '@salesforce/ts-types';
import { PackageLink } from '../../src/package/packageLink';

describe('PackageLink', () => {
  const testContext = instantiateContext();
  const testOrg = new MockTestOrgData();
  const verifiedOrgId = '00Dxx0000001gEREAY';
  let connection: Connection;

  beforeEach(async () => {
    stubContext(testContext);
    connection = await testOrg.getConnection();
  });

  afterEach(() => {
    restoreContext(testContext);
  });

  describe('request', () => {
    it('creates a pending link request when none exists', async () => {
      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        const url = ensureString(requestMap.url);
        // The existing-link lookup returns no records.
        if (url.includes('query')) {
          return Promise.resolve({ done: true, totalSize: 0, records: [] });
        }
        // The POST that creates the trust relationship. It must target the Tooling API and
        // send Status 'Pending' along with the verified org.
        if (requestMap.method === 'POST' && url.includes('/tooling/sobjects/PkgVrfyAuthOrgTrustRela')) {
          const sent = JSON.parse(ensureString(requestMap.body)) as Record<string, unknown>;
          expect(sent).to.deep.equal({ VerifiedOrg: verifiedOrgId, Status: 'Pending' });
          return Promise.resolve({ id: '0Lkxx0000000001CAA', success: true, errors: [] });
        }
        return Promise.reject(new SfError(`Unexpected request: ${url}`));
      };

      const result = await PackageLink.request(connection, { verifiedOrgId });
      expect(result).to.deep.equal({
        LinkRequestId: '0Lkxx0000000001CAA',
        VerifiedOrgId: verifiedOrgId,
        Status: 'Pending',
      });
    });

    it('throws for an invalid verified org ID', async () => {
      try {
        await PackageLink.request(connection, { verifiedOrgId: 'not-an-org-id' });
        expect.fail('expected an error for an invalid org ID');
      } catch (err) {
        expect(err).to.be.instanceOf(Error);
        expect((err as Error).message).to.include('not-an-org-id');
      }
    });

    it('throws when an active link request already exists', async () => {
      testContext.fakeConnectionRequest = (request: AnyJson): Promise<AnyJson> => {
        const requestMap = ensureJsonMap(request);
        const url = ensureString(requestMap.url);
        if (url.includes('query')) {
          return Promise.resolve({
            done: true,
            totalSize: 1,
            records: [{ Id: '0Lkxx0000000001CAA', VerifiedOrg: verifiedOrgId, Status: 'Pending' }],
          });
        }
        return Promise.reject(new SfError(`Unexpected request: ${url}`));
      };

      try {
        await PackageLink.request(connection, { verifiedOrgId });
        expect.fail('expected an error for an existing link request');
      } catch (err) {
        expect(err).to.be.instanceOf(Error);
        expect((err as Error).message).to.include('Pending');
      }
    });
  });
});
