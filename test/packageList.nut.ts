/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { TestSession } from '@salesforce/cli-plugins-testkit';
import { Org } from '@salesforce/core';
import { expect } from 'chai';
import { listPackages } from '../src/package';

describe.skip('package list', () => {
  let session: TestSession;
  before(async () => {
    session = await TestSession.create({
      devhubAuthStrategy: 'AUTO',
    });
  });

  after(async () => {
    await session?.clean();
  });
  it('should query Package2 table for all packages', async () => {
    const org = await Org.create({ aliasOrUsername: session.hubOrg.username });
    const results = await listPackages(org.getConnection());
    expect(results).to.be.ok;
  });
});
