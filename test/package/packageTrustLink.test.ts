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
import { Connection } from '@salesforce/core';
import sinon from 'sinon';
import { PackageTrustLink } from '../../src/package';

const verifiedOrgId15 = '00Dxx0000001gER';
const verifiedOrgId18 = '00Dxx0000001gEREAY';
const trustLinkId = '2vtxx0000000001AAA';

const createConnection = ({
  create = sinon.stub().resolves({ success: true, id: trustLinkId, errors: [] }),
  autoFetchQuery = sinon.stub().resolves({ records: [] }),
  getApiVersion = sinon.stub().returns('64.0'),
}: {
  create?: sinon.SinonStub;
  autoFetchQuery?: sinon.SinonStub;
  getApiVersion?: sinon.SinonStub;
} = {}) =>
  ({
    autoFetchQuery,
    getApiVersion,
    tooling: { create },
  } as unknown as Connection);

describe('PackageTrustLink', () => {
  describe('request', () => {
    it('creates a pending trust link when none exists', async () => {
      const create = sinon.stub().resolves({ success: true, id: trustLinkId, errors: [] });
      const connection = createConnection({ create });

      const result = await PackageTrustLink.request(connection, { verifiedOrgId: verifiedOrgId18 });

      expect(result).to.deep.equal({
        LinkRequestId: trustLinkId,
        VerifiedOrgId: verifiedOrgId15,
        Status: 'Pending',
      });
      // Normalizes the 18-char org ID to 15 chars before creating.
      expect(
        create.calledOnceWithExactly('PkgVrfyAuthOrgTrustRela', {
          VerifiedOrg: verifiedOrgId15,
          Status: 'Pending',
        })
      ).to.equal(true);
    });

    it('normalizes the org ID to 15 chars in the duplicate lookup query', async () => {
      const autoFetchQuery = sinon.stub().resolves({ records: [] });
      const connection = createConnection({ autoFetchQuery });

      await PackageTrustLink.request(connection, { verifiedOrgId: verifiedOrgId18 });

      expect(autoFetchQuery.firstCall.args[0]).to.contain(`WHERE VerifiedOrg = '${verifiedOrgId15}'`);
      expect(autoFetchQuery.firstCall.args[1]).to.deep.equal({ tooling: true });
    });

    it('throws for an invalid verified org ID', async () => {
      const create = sinon.stub();
      const connection = createConnection({ create });

      try {
        await PackageTrustLink.request(connection, { verifiedOrgId: 'not-an-org-id' });
        expect.fail('expected an error for an invalid org ID');
      } catch (err) {
        expect((err as Error).message).to.contain('not-an-org-id');
      }
      expect(create.called).to.equal(false);
    });

    it('blocks when any existing trust link is present, regardless of status', async () => {
      // A Declined row still occupies the unique key, so it must block a re-request.
      const autoFetchQuery = sinon
        .stub()
        .resolves({ records: [{ Id: trustLinkId, VerifiedOrg: verifiedOrgId15, Status: 'Declined' }] });
      const create = sinon.stub();
      const connection = createConnection({ autoFetchQuery, create });

      try {
        await PackageTrustLink.request(connection, { verifiedOrgId: verifiedOrgId18 });
        expect.fail('expected an error for an existing trust link');
      } catch (err) {
        expect((err as Error).message).to.contain('Declined');
      }
      expect(create.called).to.equal(false);
    });

    it('surfaces Tooling API create errors', async () => {
      const create = sinon.stub().resolves({
        success: false,
        errors: [{ errorCode: 'DUPLICATE_VALUE', message: 'Trust link already exists', fields: [] }],
      });
      const connection = createConnection({ create });

      try {
        await PackageTrustLink.request(connection, { verifiedOrgId: verifiedOrgId18 });
        expect.fail('expected the Tooling API create error');
      } catch (err) {
        expect((err as Error).message).to.contain('DUPLICATE_VALUE');
        expect((err as Error).message).to.contain('Trust link already exists');
      }
    });
  });
});
