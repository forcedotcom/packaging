/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { expect } from 'chai';
import { Org, SfProject } from '@salesforce/core';
import { PackageAncestry } from '../../src/package/packageAncestry';

describe('Package', () => {
  describe('debug it', () => {
    it('should get ancestors from package', async () => {
      const org = await Org.create({ aliasOrUsername: 'na40DevHub' });
      const pa = await PackageAncestry.create({
        connection: org.getConnection(),
        packageId: 'pnhcoverage',
        project: SfProject.getInstance('/Users/peter.hale/sfdxProjects/coverage'),
      });
      const tree = await pa.getGraphAsUxTree();
      tree.display();
      expect(tree).to.be.ok;
    });
    it('should get ancestors from leaf', async () => {
      const org = await Org.create({ aliasOrUsername: 'na40DevHub' });
      const pa = await PackageAncestry.create({
        connection: org.getConnection(),
        packageId: '04t4p0000027oc7AAA',
        project: SfProject.getInstance('/Users/peter.hale/sfdxProjects/coverage'),
      });
      const pathToRoot = await pa.getLeafPathToRoot('04t4p0000027oc7AAA');
      // eslint-disable-next-line no-console
      const pathToLeafText = pathToRoot.map((path) => path.map((node) => node.getVersion()).join(' -> ')).join('\n');
      expect(pathToRoot.length).to.equal(1);
      expect(pathToLeafText).to.equal('0.4.0.0 -> 0.3.0.0 -> 0.2.0.0 -> 0.1.0.4');
      // eslint-disable-next-line no-console
      console.log(pathToLeafText + '\n');
      const tree = await pa.getGraphAsUxTree();
      tree.display();
      expect(tree).to.be.ok;
    });
  });
  // describe('validateId', () => {
  //   it('should not throw for valid PackageId', async () => {
  //     Package.validateId('0Ho6A000002zgKSQAY', 'PackageId');
  //   });
  //   it('should not throw for valid PackageInstallRequestId', async () => {
  //     Package.validateId('0Hf1h0000006runCAA', 'PackageInstallRequestId');
  //   });
  //   it('should not throw for valid PackageUninstallRequestId', async () => {
  //     Package.validateId('06y6A000002zgKSQAY', 'PackageUninstallRequestId');
  //   });
  //   it('should not throw for valid SubscriberPackageVersionId', async () => {
  //     Package.validateId('04t6A000002zgKSQAY', 'SubscriberPackageVersionId');
  //   });
  //   it('should throw for invalid ID length', async () => {
  //     const msg = 'The PackageId: [0Ho6A000002zgKSQ] is invalid. It must be either 15 or 18 characters.';
  //     expect(() => Package.validateId('0Ho6A000002zgKSQ', 'PackageId')).to.throw(msg);
  //   });
  //   it('should throw for invalid ID prefix', async () => {
  //     const msg = 'The PackageId: [04t6A000002zgKSQAY] is invalid. It must start with "0Ho"';
  //     expect(() => Package.validateId('04t6A000002zgKSQAY', 'PackageId')).to.throw(msg);
  //   });
  // });
});
