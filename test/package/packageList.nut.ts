/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { TestSession } from '@salesforce/cli-plugins-testkit';
import { ConfigAggregator, Org } from '@salesforce/core';
import { expect } from 'chai';
import { Package } from '../../src/package';
import { PackageVersion } from '../../lib/package';

describe('package list', () => {
  let session: TestSession;
  let aliasOrUsername: string;
  before(async () => {
    // session = await TestSession.create();
    const config = await ConfigAggregator.create({});
    aliasOrUsername = config.getPropertyValue('target-dev-hub');

    if (!aliasOrUsername) throw Error('no default username set');
  });

  after(async () => {
    await session?.clean();
  });
  it('should query Package2 table for all packages', async () => {
    const org = await Org.create({ aliasOrUsername });
    const connection = org.getConnection();
    const results = await Package.list(connection);
    expect(results).to.be.ok;
  });
  it('should list all create package version requests', async () => {
    const org = await Org.create({ aliasOrUsername });
    const connection = org.getConnection();
    const results = await PackageVersion.getPackageVersionCreateRequests(connection);
    expect(results).to.be.ok;
    expect(results.length).to.be.greaterThan(1);
  });
});
