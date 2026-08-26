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
import { PackageLink } from '../../src/package';

const verifiedOrg15 = '00D000000000001';
const verifiedOrg18 = '00D000000000001EAA';
const authoringOrg = '00D000000000002';

const LIST_SELECT =
  'SELECT Id, AuthoringOrg, VerifiedOrg, Status, RequestedBy, CreatedDate, EstablishedDate, RevokedDate FROM PkgVrfyAuthOrgTrustRela';

const createConnection = ({
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
    const link = new PackageLink({ connection: createConnection({ autoFetchQuery }) });

    const results = await link.list();

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
    const link = new PackageLink({ connection: createConnection({ autoFetchQuery }) });

    await link.list('approved');

    expect(autoFetchQuery.firstCall.args[0]).to.contain("AND Status = 'Accepted'");
  });

  it('filters pending, declined, and revoked to Tooling API values', async () => {
    const autoFetchQuery = sinon.stub().resolves({ records: [] });
    const link = new PackageLink({ connection: createConnection({ autoFetchQuery }) });

    await link.list('pending');
    await link.list('declined');
    await link.list('revoked');

    expect(autoFetchQuery.firstCall.args[0]).to.contain("AND Status = 'Pending'");
    expect(autoFetchQuery.secondCall.args[0]).to.contain("AND Status = 'Declined'");
    expect(autoFetchQuery.thirdCall.args[0]).to.contain("AND Status = 'Revoked'");
  });

  it('rejects an unsupported status filter', async () => {
    const autoFetchQuery = sinon.stub();
    const link = new PackageLink({ connection: createConnection({ autoFetchQuery }) });

    try {
      await link.list('failed' as 'pending');
      expect.fail('Expected an invalid status error');
    } catch (error) {
      expect((error as Error).message).to.contain('pending, approved, declined, revoked');
    }
    expect(autoFetchQuery.called).to.equal(false);
  });

  it('requires API version 68.0 or later', () => {
    expect(
      () =>
        new PackageLink({
          connection: createConnection({ getApiVersion: sinon.stub().returns('67.0') }),
        })
    ).to.throw('Package link requires API version 68.0 or later.');
  });

  it('compares API versions numerically so 100.0 is not treated as lower than 68.0', () => {
    expect(
      () =>
        new PackageLink({
          connection: createConnection({ getApiVersion: sinon.stub().returns('100.0') }),
        })
    ).to.not.throw();
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
    const link = new PackageLink({ connection: createConnection({ autoFetchQuery }) });

    const results = await link.list();
    expect(results[0]?.RequestedBy).to.equal(null);
    expect(results[0]?.EstablishedDate).to.equal('2026-08-25T00:00:00.000Z');
  });

  it('throws when the connection has no org id', () => {
    expect(
      () =>
        new PackageLink({
          connection: createConnection({ orgId: '' }),
        })
    ).to.throw('Unable to determine the target org ID');
  });
});
