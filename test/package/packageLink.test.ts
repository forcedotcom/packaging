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
import sinon from 'sinon';
import { PackageLink } from '../../src/package/packageLink';

const verifiedOrg15 = '00D000000000001';
const verifiedOrg18 = '00D000000000001EAA';
const authoringOrg = '00D000000000002';

const LIST_SELECT =
  'SELECT Id, AuthoringOrg, VerifiedOrg, Status, RequestedBy, CreatedDate, EstablishedDate, RevokedDate FROM PkgVrfyAuthOrgTrustRela';

const createListConnection = ({
  autoFetchQuery = sinon.stub().resolves({ records: [] }),
  getApiVersion = sinon.stub().returns('68.0'),
  orgId = verifiedOrg18,
}: {
  autoFetchQuery?: sinon.SinonStub;
  getApiVersion?: sinon.SinonStub;
  orgId?: string;
} = {}) =>
  ({
    autoFetchQuery,
    getApiVersion,
    getAuthInfoFields: sinon.stub().returns({ orgId }),
  } as unknown as Connection);

describe('PackageLink', () => {
  describe('request', () => {
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

  describe('list', () => {
    it('lists verified-org inbound requests excluding self-trust, newest first', async () => {
      const autoFetchQuery = sinon.stub().resolves({
        records: [
          {
            Id: '2vt000000000001AAA',
            AuthoringOrg: authoringOrg,
            VerifiedOrg: verifiedOrg15,
            Status: 'Pending',
            RequestedBy: 'Ada Lovelace',
            CreatedDate: '2026-08-24T00:00:00.000Z',
            EstablishedDate: null,
            RevokedDate: null,
          },
        ],
      });

      const results = await PackageLink.list(createListConnection({ autoFetchQuery }));

      expect(results).to.deep.equal([
        {
          Id: '2vt000000000001AAA',
          AuthoringOrg: authoringOrg,
          VerifiedOrg: verifiedOrg15,
          Status: 'Pending',
          RequestedBy: 'Ada Lovelace',
          CreatedDate: '2026-08-24T00:00:00.000Z',
          EstablishedDate: null,
          RevokedDate: null,
        },
      ]);
      expect(
        autoFetchQuery.calledOnceWithExactly(
          `${LIST_SELECT} WHERE VerifiedOrg = '${verifiedOrg15}' AND OrganizationType = 'Verified' AND AuthoringOrg != '${verifiedOrg15}' ORDER BY CreatedDate DESC`,
          { tooling: true }
        )
      ).to.equal(true);
    });

    it('filters by CLI status approved as Tooling Accepted', async () => {
      const autoFetchQuery = sinon.stub().resolves({ records: [] });

      await PackageLink.list(createListConnection({ autoFetchQuery }), 'approved');

      expect(autoFetchQuery.firstCall.args[0]).to.contain("AND Status = 'Accepted'");
    });

    it('filters pending, declined, and revoked to Tooling API values', async () => {
      const autoFetchQuery = sinon.stub().resolves({ records: [] });
      const connection = createListConnection({ autoFetchQuery });

      await PackageLink.list(connection, 'pending');
      await PackageLink.list(connection, 'declined');
      await PackageLink.list(connection, 'revoked');

      expect(autoFetchQuery.firstCall.args[0]).to.contain("AND Status = 'Pending'");
      expect(autoFetchQuery.secondCall.args[0]).to.contain("AND Status = 'Declined'");
      expect(autoFetchQuery.thirdCall.args[0]).to.contain("AND Status = 'Revoked'");
    });

    it('rejects an unsupported status filter', async () => {
      const autoFetchQuery = sinon.stub();

      try {
        await PackageLink.list(createListConnection({ autoFetchQuery }), 'failed' as 'pending');
        expect.fail('Expected an invalid status error');
      } catch (error) {
        expect((error as Error).message).to.contain('pending, approved, declined, revoked');
      }
      expect(autoFetchQuery.called).to.equal(false);
    });

    it('requires API version 68.0 or later', async () => {
      try {
        await PackageLink.list(createListConnection({ getApiVersion: sinon.stub().returns('67.0') }));
        expect.fail('Expected an API version error');
      } catch (error) {
        expect((error as Error).message).to.contain('Package link requires API version 68.0 or later.');
      }
    });

    it('compares API versions numerically so 100.0 is not treated as lower than 68.0', async () => {
      const autoFetchQuery = sinon.stub().resolves({ records: [] });
      await PackageLink.list(createListConnection({ autoFetchQuery, getApiVersion: sinon.stub().returns('100.0') }));
      expect(autoFetchQuery.calledOnce).to.equal(true);
    });

    it('maps a null RequestedBy from Tooling', async () => {
      const autoFetchQuery = sinon.stub().resolves({
        records: [
          {
            Id: '2vt000000000001AAA',
            AuthoringOrg: authoringOrg,
            VerifiedOrg: verifiedOrg15,
            Status: 'Accepted',
            RequestedBy: null,
            CreatedDate: '2026-08-24T00:00:00.000Z',
            EstablishedDate: '2026-08-25T00:00:00.000Z',
            RevokedDate: null,
          },
        ],
      });

      const results = await PackageLink.list(createListConnection({ autoFetchQuery }));
      expect(results[0]?.RequestedBy).to.equal(null);
      expect(results[0]?.EstablishedDate).to.equal('2026-08-25T00:00:00.000Z');
    });

    it('throws when the connection has no org id', async () => {
      try {
        await PackageLink.list(createListConnection({ orgId: '' }));
        expect.fail('Expected a missing org ID error');
      } catch (error) {
        expect((error as Error).message).to.contain('Unable to determine the target org ID');
      }
    });
  });
});
