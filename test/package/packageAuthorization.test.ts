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
import { PackageAuthorization } from '../../src/package';

const subscriberPackageId = '033000000000001AAA';
const subscriberOrg = '00D000000000001';
const subscriberOrg18 = '00D000000000001EAA';

const createConnection = ({
  create = sinon.stub().resolves({ success: true, id: '2at000000000001AAA', errors: [] }),
  autoFetchQuery = sinon.stub().resolves({ records: [] }),
  destroy = sinon.stub().resolves({ success: true, errors: [] }),
  sobject = sinon.stub().returns({ destroy }),
  getApiVersion = sinon.stub().returns('68.0'),
}: {
  create?: sinon.SinonStub;
  autoFetchQuery?: sinon.SinonStub;
  destroy?: sinon.SinonStub;
  sobject?: sinon.SinonStub;
  getApiVersion?: sinon.SinonStub;
} = {}) =>
  ({
    autoFetchQuery,
    getApiVersion,
    tooling: {
      create,
      sobject,
    },
  } as unknown as Connection);

describe('PackageAuthorization', () => {
  it('creates active authorization records', async () => {
    const create = sinon.stub().resolves({ success: true, id: '2at000000000001AAA', errors: [] });
    const authorization = new PackageAuthorization({
      connection: createConnection({ create }),
      subscriberPackageId,
    });

    const results = await authorization.add([subscriberOrg]);

    expect(results).to.deep.equal([{ Id: '2at000000000001AAA', SubscriberOrg: subscriberOrg }]);
    expect(
      create.calledOnceWithExactly('PkgAuthOrgSbscrbTrustRela', {
        SubscriberOrg: subscriberOrg,
        SubscriberPackageId: subscriberPackageId,
        Status: 'Active',
      })
    ).to.equal(true);
  });

  it('creates authorization records without a subscriber package', async () => {
    const create = sinon.stub().resolves({ success: true, id: '2at000000000001AAA', errors: [] });
    const authorization = new PackageAuthorization({ connection: createConnection({ create }) });

    const results = await authorization.add([subscriberOrg]);

    expect(results).to.deep.equal([{ Id: '2at000000000001AAA', SubscriberOrg: subscriberOrg }]);
    expect(
      create.calledOnceWithExactly('PkgAuthOrgSbscrbTrustRela', {
        SubscriberOrg: subscriberOrg,
        Status: 'Active',
      })
    ).to.equal(true);
  });

  it('creates multiple authorization records in input order', async () => {
    const secondSubscriberOrg = '00D000000000002';
    const create = sinon.stub();
    create.onFirstCall().resolves({ success: true, id: '2at000000000001AAA', errors: [] });
    create.onSecondCall().resolves({ success: true, id: '2at000000000002AAA', errors: [] });
    const authorization = new PackageAuthorization({
      connection: createConnection({ create }),
      subscriberPackageId,
    });

    const results = await authorization.add([subscriberOrg, secondSubscriberOrg]);

    expect(results).to.deep.equal([
      { Id: '2at000000000001AAA', SubscriberOrg: subscriberOrg },
      { Id: '2at000000000002AAA', SubscriberOrg: secondSubscriberOrg },
    ]);
    expect(create.firstCall.args[1].SubscriberOrg).to.equal(subscriberOrg);
    expect(create.secondCall.args[1].SubscriberOrg).to.equal(secondSubscriberOrg);
  });

  it('requires at least one subscriber org', async () => {
    const create = sinon.stub();
    const authorization = new PackageAuthorization({
      connection: createConnection({ create }),
      subscriberPackageId,
    });

    try {
      await authorization.add([]);
      expect.fail('Expected a missing subscriber org error');
    } catch (error) {
      expect((error as Error).message).to.equal('Provide at least one subscriber org ID.');
    }
    expect(create.called).to.equal(false);
  });

  it('validates subscriber org IDs before creating records', async () => {
    const create = sinon.stub();
    const authorization = new PackageAuthorization({
      connection: createConnection({ create }),
      subscriberPackageId,
    });

    try {
      await authorization.add(['invalid-org']);
      expect.fail('Expected an invalid subscriber org error');
    } catch (error) {
      expect((error as Error).message).to.contain('The subscriber org ID invalid-org is invalid');
    }
    expect(create.called).to.equal(false);
  });

  it('normalizes 18-character subscriber org IDs', async () => {
    const create = sinon.stub().resolves({ success: true, id: '2at000000000001AAA', errors: [] });
    const authorization = new PackageAuthorization({
      connection: createConnection({ create }),
      subscriberPackageId,
    });

    const results = await authorization.add([subscriberOrg18]);

    expect(results).to.deep.equal([{ Id: '2at000000000001AAA', SubscriberOrg: subscriberOrg }]);
    expect(create.firstCall.args[1].SubscriberOrg).to.equal(subscriberOrg);
  });

  it('surfaces Tooling API create errors', async () => {
    const create = sinon.stub().resolves({
      success: false,
      errors: [{ errorCode: 'DUPLICATE_VALUE', message: 'Authorization already exists', fields: [] }],
    });
    const authorization = new PackageAuthorization({
      connection: createConnection({ create }),
      subscriberPackageId,
    });

    try {
      await authorization.add([subscriberOrg]);
      expect.fail('Expected the Tooling API error');
    } catch (error) {
      expect((error as Error).message).to.contain('DUPLICATE_VALUE');
      expect((error as Error).message).to.contain('Authorization already exists');
    }
  });

  it('propagates rejected Tooling API create errors unchanged', async () => {
    const toolingError = new Error('Raw Tooling API create error');
    const authorization = new PackageAuthorization({
      connection: createConnection({ create: sinon.stub().rejects(toolingError) }),
      subscriberPackageId,
    });

    try {
      await authorization.add([subscriberOrg]);
      expect.fail('Expected the Tooling API error');
    } catch (error) {
      expect(error).to.equal(toolingError);
    }
  });

  it('lists authorization records for a subscriber package', async () => {
    const autoFetchQuery = sinon.stub().resolves({
      records: [
        {
          Id: '2at000000000001AAA',
          SubscriberOrg: subscriberOrg,
          SubscriberPackageId: subscriberPackageId,
          Status: 'Active',
          CreatedDate: '2026-08-24T00:00:00.000Z',
          CreatedById: '005000000000001AAA',
          CreatedBy: { Username: 'publisher@example.com' },
          attributes: { type: 'PkgAuthOrgSbscrbTrustRela' },
        },
      ],
    });
    const authorization = new PackageAuthorization({
      connection: createConnection({ autoFetchQuery }),
      subscriberPackageId,
    });

    const results = await authorization.list();

    expect(results).to.have.length(1);
    expect(results[0]).to.deep.equal({
      Id: '2at000000000001AAA',
      SubscriberOrg: subscriberOrg,
      SubscriberPackageId: subscriberPackageId,
      Status: 'Active',
      CreatedDate: '2026-08-24T00:00:00.000Z',
      CreatedById: '005000000000001AAA',
      CreatedByUsername: 'publisher@example.com',
    });
    expect(
      autoFetchQuery.calledOnceWithExactly(
        `SELECT Id, SubscriberOrg, SubscriberPackageId, Status, CreatedDate, CreatedById, CreatedBy.Username FROM PkgAuthOrgSbscrbTrustRela WHERE SubscriberPackageId = '${subscriberPackageId}' ORDER BY SubscriberOrg`,
        { tooling: true }
      )
    ).to.equal(true);
  });

  it('deletes one matching authorization record', async () => {
    const autoFetchQuery = sinon.stub().resolves({ records: [{ Id: '2at000000000001AAA' }] });
    const destroy = sinon.stub().resolves({ success: true, errors: [] });
    const sobject = sinon.stub().returns({ destroy });
    const connection = createConnection({ autoFetchQuery, destroy, sobject });
    const authorization = new PackageAuthorization({ connection, subscriberPackageId });

    const result = await authorization.remove(subscriberOrg);

    expect(result).to.deep.equal({ SubscriberOrg: subscriberOrg, removed: true });
    expect(
      autoFetchQuery.calledOnceWithExactly(
        `SELECT Id, SubscriberOrg, SubscriberPackageId, Status, CreatedDate, CreatedById, CreatedBy.Username FROM PkgAuthOrgSbscrbTrustRela WHERE SubscriberOrg = '${subscriberOrg}' AND SubscriberPackageId = '${subscriberPackageId}' LIMIT 1`,
        { tooling: true }
      )
    ).to.equal(true);
    expect(sobject.calledOnceWithExactly('PkgAuthOrgSbscrbTrustRela')).to.equal(true);
    expect(destroy.calledOnceWithExactly('2at000000000001AAA')).to.equal(true);
  });

  it('does not delete when no matching authorization exists', async () => {
    const autoFetchQuery = sinon.stub().resolves({ records: [] });
    const destroy = sinon.stub();
    const authorization = new PackageAuthorization({
      connection: createConnection({ autoFetchQuery, destroy }),
      subscriberPackageId,
    });

    const result = await authorization.remove(subscriberOrg);

    expect(result).to.deep.equal({ SubscriberOrg: subscriberOrg, removed: false });
    expect(destroy.called).to.equal(false);
  });

  it('deletes one matching authorization with a null subscriber package', async () => {
    const autoFetchQuery = sinon.stub().resolves({ records: [{ Id: '2at000000000001AAA' }] });
    const destroy = sinon.stub().resolves({ success: true, errors: [] });
    const sobject = sinon.stub().returns({ destroy });
    const authorization = new PackageAuthorization({
      connection: createConnection({ autoFetchQuery, destroy, sobject }),
    });

    const result = await authorization.remove(subscriberOrg);

    expect(result).to.deep.equal({ SubscriberOrg: subscriberOrg, removed: true });
    expect(
      autoFetchQuery.calledOnceWithExactly(
        `SELECT Id, SubscriberOrg, SubscriberPackageId, Status, CreatedDate, CreatedById, CreatedBy.Username FROM PkgAuthOrgSbscrbTrustRela WHERE SubscriberOrg = '${subscriberOrg}' AND SubscriberPackageId = NULL LIMIT 1`,
        { tooling: true }
      )
    ).to.equal(true);
    expect(destroy.calledOnceWithExactly('2at000000000001AAA')).to.equal(true);
  });

  it('normalizes the subscriber org ID before removing', async () => {
    const autoFetchQuery = sinon.stub().resolves({ records: [] });
    const authorization = new PackageAuthorization({
      connection: createConnection({ autoFetchQuery }),
      subscriberPackageId,
    });

    const result = await authorization.remove(subscriberOrg18);

    expect(result).to.deep.equal({ SubscriberOrg: subscriberOrg, removed: false });
    expect(autoFetchQuery.firstCall.args[0]).to.contain(`SubscriberOrg = '${subscriberOrg}'`);
  });

  it('lists all authorizations without a subscriber package filter', async () => {
    const autoFetchQuery = sinon.stub().resolves({
      records: [
        {
          Id: '2at000000000001AAA',
          SubscriberOrg: subscriberOrg,
          SubscriberPackageId: null,
          Status: 'Active',
          CreatedDate: '2026-08-24T00:00:00.000Z',
          CreatedById: '005000000000001AAA',
          CreatedBy: { Username: 'publisher@example.com' },
          attributes: { type: 'PkgAuthOrgSbscrbTrustRela' },
        },
      ],
    });
    const authorization = new PackageAuthorization({ connection: createConnection({ autoFetchQuery }) });

    const results = await authorization.list();

    expect(results[0]?.SubscriberPackageId).to.equal(null);
    expect(
      autoFetchQuery.calledOnceWithExactly(
        'SELECT Id, SubscriberOrg, SubscriberPackageId, Status, CreatedDate, CreatedById, CreatedBy.Username FROM PkgAuthOrgSbscrbTrustRela ORDER BY SubscriberOrg',
        { tooling: true }
      )
    ).to.equal(true);
  });

  it('surfaces Tooling API delete errors', async () => {
    const autoFetchQuery = sinon.stub().resolves({ records: [{ Id: '2at000000000001AAA' }] });
    const destroy = sinon.stub().resolves({
      success: false,
      errors: [{ errorCode: 'DELETE_FAILED', message: 'Authorization could not be deleted', fields: [] }],
    });
    const authorization = new PackageAuthorization({
      connection: createConnection({ autoFetchQuery, destroy }),
      subscriberPackageId,
    });

    try {
      await authorization.remove(subscriberOrg);
      expect.fail('Expected the Tooling API error');
    } catch (error) {
      expect((error as Error).message).to.contain('DELETE_FAILED');
      expect((error as Error).message).to.contain('Authorization could not be deleted');
    }
  });

  it('propagates rejected Tooling API delete errors unchanged', async () => {
    const toolingError = new Error('Raw Tooling API delete error');
    const authorization = new PackageAuthorization({
      connection: createConnection({
        autoFetchQuery: sinon.stub().resolves({ records: [{ Id: '2at000000000001AAA' }] }),
        destroy: sinon.stub().rejects(toolingError),
      }),
      subscriberPackageId,
    });

    try {
      await authorization.remove(subscriberOrg);
      expect.fail('Expected the Tooling API error');
    } catch (error) {
      expect(error).to.equal(toolingError);
    }
  });

  it('rejects invalid subscriber package IDs', () => {
    expect(
      () =>
        new PackageAuthorization({
          connection: createConnection(),
          subscriberPackageId: '033-invalid',
        })
    ).to.throw('The subscriber package ID 033-invalid is invalid');
  });

  it('requires API version 68.0 or later', () => {
    expect(
      () =>
        new PackageAuthorization({
          connection: createConnection({ getApiVersion: sinon.stub().returns('67.0') }),
          subscriberPackageId,
        })
    ).to.throw('Package authorization requires API version 68.0 or later.');
  });

  it('accepts three-digit API versions', () => {
    expect(
      () =>
        new PackageAuthorization({
          connection: createConnection({ getApiVersion: sinon.stub().returns('100.0') }),
          subscriberPackageId,
        })
    ).not.to.throw();
  });
});
