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
  destroy = sinon.stub().resolves({ success: true, id: trustLinkId, errors: [] }),
  autoFetchQuery = sinon.stub().resolves({ records: [] }),
  getApiVersion = sinon.stub().returns('64.0'),
}: {
  create?: sinon.SinonStub;
  destroy?: sinon.SinonStub;
  autoFetchQuery?: sinon.SinonStub;
  getApiVersion?: sinon.SinonStub;
} = {}) =>
  ({
    autoFetchQuery,
    getApiVersion,
    tooling: { create, sobject: sinon.stub().returns({ destroy }) },
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

    it('looks up any existing link for the authoring org, not scoped by verified org', async () => {
      const autoFetchQuery = sinon.stub().resolves({ records: [] });
      const connection = createConnection({ autoFetchQuery });

      await PackageTrustLink.request(connection, { verifiedOrgId: verifiedOrgId18 });

      // An org can hold only one link, and the Tooling API query already scopes to the
      // connected org, so the duplicate lookup must not filter by VerifiedOrg.
      expect(autoFetchQuery.firstCall.args[0]).to.not.contain('WHERE');
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

    it('blocks when the org already has any trust link, even to a different verified org', async () => {
      // A Declined row to some OTHER verified org still means this org is already linked,
      // so a new request must be blocked and must report the existing link's verified org.
      const otherVerifiedOrg = '00Dxx0000009zZZ';
      const autoFetchQuery = sinon
        .stub()
        .resolves({ records: [{ Id: trustLinkId, VerifiedOrg: otherVerifiedOrg, Status: 'Declined' }] });
      const create = sinon.stub();
      const connection = createConnection({ autoFetchQuery, create });

      try {
        await PackageTrustLink.request(connection, { verifiedOrgId: verifiedOrgId18 });
        expect.fail('expected an error for an existing trust link');
      } catch (err) {
        expect((err as Error).message).to.contain('Declined');
        expect((err as Error).message).to.contain(otherVerifiedOrg);
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

  describe('status', () => {
    it('reports Not Linked when the org has no trust link', async () => {
      const autoFetchQuery = sinon.stub().resolves({ records: [] });
      const connection = createConnection({ autoFetchQuery });

      const result = await PackageTrustLink.status(connection);

      expect(result).to.deep.equal({ Status: 'Not Linked', linked: false });
    });

    it('reports the existing link status, verified org, and timestamps', async () => {
      const autoFetchQuery = sinon.stub().resolves({
        records: [
          {
            Id: trustLinkId,
            VerifiedOrg: verifiedOrgId15,
            Status: 'Accepted',
            EstablishedDate: '2026-08-20T10:00:00.000+0000',
            RevokedDate: null,
            CreatedDate: '2026-08-19T09:00:00.000+0000',
          },
        ],
      });
      const connection = createConnection({ autoFetchQuery });

      const result = await PackageTrustLink.status(connection);

      expect(result).to.deep.equal({
        Status: 'Accepted',
        linked: true,
        LinkRequestId: trustLinkId,
        VerifiedOrgId: verifiedOrgId15,
        RequestedDate: '2026-08-19T09:00:00.000+0000',
        EstablishedDate: '2026-08-20T10:00:00.000+0000',
      });
    });

    it('omits unset timestamps (e.g. a Pending link never established)', async () => {
      const autoFetchQuery = sinon.stub().resolves({
        records: [
          {
            Id: trustLinkId,
            VerifiedOrg: verifiedOrgId15,
            Status: 'Pending',
            EstablishedDate: null,
            RevokedDate: null,
            CreatedDate: '2026-08-19T09:00:00.000+0000',
          },
        ],
      });
      const connection = createConnection({ autoFetchQuery });

      const result = await PackageTrustLink.status(connection);

      expect(result.Status).to.equal('Pending');
      expect(result.linked).to.equal(true);
      expect(result.RequestedDate).to.equal('2026-08-19T09:00:00.000+0000');
      expect(result).to.not.have.property('EstablishedDate');
      expect(result).to.not.have.property('RevokedDate');
    });

    it('surfaces a Revoked link with its revoked timestamp', async () => {
      const autoFetchQuery = sinon.stub().resolves({
        records: [
          {
            Id: trustLinkId,
            VerifiedOrg: verifiedOrgId15,
            Status: 'Revoked',
            EstablishedDate: '2026-08-20T10:00:00.000+0000',
            RevokedDate: '2026-08-25T12:00:00.000+0000',
            CreatedDate: '2026-08-19T09:00:00.000+0000',
          },
        ],
      });
      const connection = createConnection({ autoFetchQuery });

      const result = await PackageTrustLink.status(connection);

      expect(result.Status).to.equal('Revoked');
      expect(result.RevokedDate).to.equal('2026-08-25T12:00:00.000+0000');
    });

    it('does not scope the query by verified org (an org holds at most one link)', async () => {
      const autoFetchQuery = sinon.stub().resolves({ records: [] });
      const connection = createConnection({ autoFetchQuery });

      await PackageTrustLink.status(connection);

      expect(autoFetchQuery.firstCall.args[0]).to.not.contain('WHERE');
      expect(autoFetchQuery.firstCall.args[1]).to.deep.equal({ tooling: true });
    });
  });

  describe('unlink', () => {
    it('removes the existing trust link and returns its details', async () => {
      const autoFetchQuery = sinon
        .stub()
        .resolves({ records: [{ Id: trustLinkId, VerifiedOrg: verifiedOrgId15, Status: 'Pending' }] });
      const destroy = sinon.stub().resolves({ success: true, id: trustLinkId, errors: [] });
      const connection = createConnection({ autoFetchQuery, destroy });

      const result = await PackageTrustLink.unlink(connection);

      expect(result).to.deep.equal({
        removed: true,
        LinkRequestId: trustLinkId,
        VerifiedOrgId: verifiedOrgId15,
        Status: 'Pending',
      });
      expect(destroy.calledOnceWithExactly(trustLinkId)).to.equal(true);
    });

    it('removes a link in any status, e.g. Declined (retry-after-decline flow)', async () => {
      const autoFetchQuery = sinon
        .stub()
        .resolves({ records: [{ Id: trustLinkId, VerifiedOrg: verifiedOrgId15, Status: 'Declined' }] });
      const destroy = sinon.stub().resolves({ success: true, id: trustLinkId, errors: [] });
      const connection = createConnection({ autoFetchQuery, destroy });

      const result = await PackageTrustLink.unlink(connection);

      expect(result.removed).to.equal(true);
      expect(result.Status).to.equal('Declined');
      expect(destroy.calledOnce).to.equal(true);
    });

    it('is idempotent: reports removed=false when the org is already Not Linked', async () => {
      const autoFetchQuery = sinon.stub().resolves({ records: [] });
      const destroy = sinon.stub();
      const connection = createConnection({ autoFetchQuery, destroy });

      const result = await PackageTrustLink.unlink(connection);

      expect(result).to.deep.equal({ removed: false });
      expect(destroy.called).to.equal(false);
    });

    it('surfaces Tooling API delete errors', async () => {
      const autoFetchQuery = sinon
        .stub()
        .resolves({ records: [{ Id: trustLinkId, VerifiedOrg: verifiedOrgId15, Status: 'Pending' }] });
      const destroy = sinon.stub().resolves({
        success: false,
        errors: [{ errorCode: 'INSUFFICIENT_ACCESS', message: 'no delete access', fields: [] }],
      });
      const connection = createConnection({ autoFetchQuery, destroy });

      try {
        await PackageTrustLink.unlink(connection);
        expect.fail('expected the Tooling API delete error');
      } catch (err) {
        expect((err as Error).message).to.contain('INSUFFICIENT_ACCESS');
        expect((err as Error).message).to.contain('no delete access');
      }
    });
  });
});
