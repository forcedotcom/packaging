/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as path from 'path';
import * as fs from 'fs';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { expect } from 'chai';
import { Connection, SfProject } from '@salesforce/core';
import * as xml2js from 'xml2js';
// import * as pkgUtils from '../../src/utils/packageUtils';

import { PackageVersionCreate } from '../../src/package/packageVersionCreate';
import { PackagingSObjects } from '../../src/interfaces';

describe('Package Version Create', () => {
  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();
  const packageId = '0Ho3i000000Gmj6XXX';
  let connection: Connection;
  let packageTypeQuery: sinon.SinonStub;
  let packageCreateStub: sinon.SinonStub;
  // let packageTypeStub: sinon.SinonStub;

  let project: SfProject;

  beforeEach(async () => {
    $$.inProject(true);
    project = SfProject.getInstance();
    await project.getSfProjectJson().write({
      packageDirectories: [
        {
          path: 'force-app',
          package: 'TEST',
          versionName: 'ver 0.1',
          versionNumber: '0.1.0.NEXT',
          default: true,
          ancestorId: 'TEST2',
        },
      ],
      packageAliases: {
        TEST: packageId,
        TEST2: '05i3i000000Gmj6XXX',
      },
    });
    await fs.promises.mkdir(path.join(project.getPath(), 'force-app'));
    stubContext($$);
    await $$.stubAuths(testOrg);
    connection = await testOrg.getConnection();
    packageTypeQuery = $$.SANDBOX.stub(connection.tooling, 'query')
      .onFirstCall() // @ts-ignore
      .resolves({ records: [{ Id: '05i3i000000Gmj6XXX' }] }) // @ts-ignore
      .resolves({ records: [{}] });
    packageCreateStub = $$.SANDBOX.stub(connection.tooling, 'create').resolves({
      id: '123',
      success: true,
      errors: undefined,
    });
    $$.SANDBOX.stub(xml2js, 'parseStringPromise').resolves({
      Package: { types: [{ name: ['Apexclass'], members: ['MyApexClass'] }] },
    });
    // packageTypeStub = $$.SANDBOX.stub(pkgUtils, 'getPackageType').resolves('Managed');
  });

  afterEach(async () => {
    restoreContext($$);
    await fs.promises.rmdir(path.join(project.getPath(), 'force-app'));
    // @ts-ignore
    project.packageDirectories = undefined;
  });

  it('should throw an error when no package directories exist in the sfdx-project.json', async () => {
    await project.getSfProjectJson().write({
      packageDirectories: [],
      packageAliases: {},
    });
    const pvc = new PackageVersionCreate({ connection, project, packageId });

    try {
      await pvc.createPackageVersion();
    } catch (e) {
      expect(e.message).to.equal(
        'In sfdx-project.json, be sure to specify which package directory (path) is the default. Example: `[{ "path": "packageDirectory1", "default": true }, { "path": "packageDirectory2" }]`'
      );
    }
  });

  it('should create the package version create request', async () => {
    const pvc = new PackageVersionCreate({ connection, project, packageId });
    const result = await pvc.createPackageVersion();
    expect(result).to.have.all.keys(
      'Branch',
      'CreatedBy',
      'CreatedDate',
      'Error',
      'HasMetadataRemoved',
      'Id',
      'Package2Id',
      'Package2VersionId',
      'Status',
      'SubscriberPackageVersionId',
      'Tag'
    );
  });

  it('should create the package version create request with codecoverage=true', async () => {
    const pvc = new PackageVersionCreate({ connection, project, codecoverage: true, packageId });
    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].CalculateCodeCoverage).to.equal(true);
    expect(result).to.have.all.keys(
      'Branch',
      'CreatedBy',
      'CreatedDate',
      'Error',
      'HasMetadataRemoved',
      'Id',
      'Package2Id',
      'Package2VersionId',
      'Status',
      'SubscriberPackageVersionId',
      'Tag'
    );
  });

  it('should create the package version create request with codecoverage=false', async () => {
    const pvc = new PackageVersionCreate({ connection, project, codecoverage: false, packageId });
    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].CalculateCodeCoverage).to.equal(false);
    expect(result).to.have.all.keys(
      'Branch',
      'CreatedBy',
      'CreatedDate',
      'Error',
      'HasMetadataRemoved',
      'Id',
      'Package2Id',
      'Package2VersionId',
      'Status',
      'SubscriberPackageVersionId',
      'Tag'
    );
  });

  it('should create the package version create request with tag info', async () => {
    const pvc = new PackageVersionCreate({
      connection,
      project,
      tag: 'DancingBears',
      packageId,
    });
    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].Tag).to.equal('DancingBears');
    expect(result).to.have.all.keys(
      'Branch',
      'CreatedBy',
      'CreatedDate',
      'Error',
      'HasMetadataRemoved',
      'Id',
      'Package2Id',
      'Package2VersionId',
      'Status',
      'SubscriberPackageVersionId',
      'Tag'
    );
  });

  it('should create the package version create request with skipancestorcheck info', async () => {
    const pvc = new PackageVersionCreate({
      connection,
      project,
      tag: 'DancingBears',
      packageId,
      skipancestorcheck: true,
    });
    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].skipancestorcheck).to.equal(undefined);
    expect(result).to.have.all.keys(
      'Branch',
      'CreatedBy',
      'CreatedDate',
      'Error',
      'HasMetadataRemoved',
      'Id',
      'Package2Id',
      'Package2VersionId',
      'Status',
      'SubscriberPackageVersionId',
      'Tag'
    );
  });

  it('should create the package version create request with skip validation', async () => {
    const pvc = new PackageVersionCreate({
      connection,
      project,
      skipvalidation: true,
      packageId,
    });
    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].SkipValidation).to.equal(true);
    expect(result).to.have.all.keys(
      'Branch',
      'CreatedBy',
      'CreatedDate',
      'Error',
      'HasMetadataRemoved',
      'Id',
      'Package2Id',
      'Package2VersionId',
      'Status',
      'SubscriberPackageVersionId',
      'Tag'
    );
  });

  it('should create the package version create request with installationkey', async () => {
    const pvc = new PackageVersionCreate({
      connection,
      project,
      installationkey: 'guessMyPassword',
      packageId,
    });
    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].InstallKey).to.equal('guessMyPassword');
    expect(packageCreateStub.firstCall.args[1].SkipValidation).to.equal(false);
    expect(result).to.have.all.keys(
      'Branch',
      'CreatedBy',
      'CreatedDate',
      'Error',
      'HasMetadataRemoved',
      'Id',
      'Package2Id',
      'Package2VersionId',
      'Status',
      'SubscriberPackageVersionId',
      'Tag'
    );
  });

  it('should create the package version create request with branch', async () => {
    const pvc = new PackageVersionCreate({ connection, project, branch: 'main', packageId });
    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].Branch).to.equal('main');
    expect(result).to.have.all.keys(
      'Branch',
      'CreatedBy',
      'CreatedDate',
      'Error',
      'HasMetadataRemoved',
      'Id',
      'Package2Id',
      'Package2VersionId',
      'Status',
      'SubscriberPackageVersionId',
      'Tag'
    );
  });

  it('should validate options when package type = unlocked (scripts)', async () => {
    packageTypeQuery.restore();
    // @ts-ignore
    packageTypeQuery = $$.SANDBOX.stub(connection.tooling, 'query')
      .onFirstCall() // @ts-ignore
      .resolves({ records: [{ Id: '05i3i000000Gmj6XXX' }] }) // @ts-ignore
      .resolves({ records: [{ ContainerOptions: 'Unlocked' }] });
    let pvc = new PackageVersionCreate({
      connection,
      project,
      postinstallscript: 'myScript.sh',
      packageId,
    });
    try {
      await pvc.createPackageVersion();
    } catch (e) {
      expect(e.message).to.equal(
        'We can’t create the package version. This parameter is available only for second-generation managed packages. Create the package version without the postinstallscript or uninstallscript parameters.'
      );
    }

    packageTypeQuery.restore();
    // @ts-ignore
    packageTypeQuery = $$.SANDBOX.stub(connection.tooling, 'query')
      .onFirstCall() // @ts-ignore
      .resolves({ records: [{ Id: '05i3i000000Gmj6XXX' }] }) // @ts-ignore
      .resolves({ records: [{ ContainerOptions: 'Unlocked' }] });

    // check uninstallscript
    pvc = new PackageVersionCreate({
      connection,
      project,
      uninstallscript: 'myScript.sh',
      packageId,
    });
    try {
      await pvc.createPackageVersion();
    } catch (e) {
      expect(e.message).to.equal(
        'We can’t create the package version. This parameter is available only for second-generation managed packages. Create the package version without the postinstallscript or uninstallscript parameters.'
      );
    }
  });

  it('should validate options when package type = unlocked (ancestors)', async () => {
    await project.getSfProjectJson().write({
      packageDirectories: [
        {
          path: 'force-app',
          package: 'TEST',
          versionName: 'ver 0.1',
          versionNumber: '0.1.0.NEXT',
          default: true,
          ancestorId: '123',
        },
      ],
      packageAliases: {
        TEST: '0Ho3i000000Gmj6XXX',
      },
    });
    packageTypeQuery.restore();
    packageTypeQuery = $$.SANDBOX.stub(connection.tooling, 'query')
      .onFirstCall() // @ts-ignore
      .resolves({ records: [{ Id: '05i3i000000Gmj6XXX' }] });
    $$.SANDBOX.stub(connection.tooling, 'retrieve').resolves({ ContainerOptions: 'Unlocked' });
    const pvc = new PackageVersionCreate({
      connection,
      project,
      packageId,
    });
    try {
      await pvc.createPackageVersion();
    } catch (e) {
      expect(e.message).to.equal(
        'Can’t create package version. Specifying an ancestor is available only for second-generation managed packages. Remove the ancestorId or ancestorVersion from your sfdx-project.json file, and then create the package version again.'
      );
    }

    // check ancestorVersion
    await project.getSfProjectJson().write({
      packageDirectories: [
        {
          path: 'force-app',
          package: 'TEST',
          versionName: 'ver 0.1',
          versionNumber: '0.1.0.NEXT',
          default: true,
          ancestorVersion: '123',
        },
      ],
      packageAliases: {
        TEST: '0Ho3i000000Gmj6XXX',
      },
    });
    try {
      await pvc.createPackageVersion();
    } catch (e) {
      expect(e.message).to.equal(
        'Can’t create package version. Specifying an ancestor is available only for second-generation managed packages. Remove the ancestorId or ancestorVersion from your sfdx-project.json file, and then create the package version again.'
      );
    }
  });

  it('should create the package version create request and validate the sfdx-project.json schema', async () => {
    const validationSpy = $$.SANDBOX.spy(project.getSfProjectJson(), 'schemaValidate');
    const pvc = new PackageVersionCreate({
      connection,
      project,
      validateschema: true,
      packageId,
    });
    const result = await pvc.createPackageVersion();
    expect(validationSpy.callCount).to.equal(1);
    expect(result).to.have.all.keys(
      'Branch',
      'CreatedBy',
      'CreatedDate',
      'Error',
      'HasMetadataRemoved',
      'Id',
      'Package2Id',
      'Package2VersionId',
      'Status',
      'SubscriberPackageVersionId',
      'Tag'
    );
  });
  describe('validateAncestorId', () => {
    let pvc: PackageVersionCreate;
    beforeEach(() => {
      pvc = new PackageVersionCreate({ connection, project, packageId });
    });
    it('should throw if the explicitUseNoAncestor is true and highestReleasedVersion is not undefined', () => {
      const ancestorId = 'ancestorId';
      const highestReleasedVersion = {
        Id: 'foo',
        MajorVersion: 1,
        MinorVersion: 2,
        PatchVersion: 3,
      } as PackagingSObjects.Package2Version;
      const explicitUseNoAncestor = true;
      const isPatch = false;
      const skipAncestorCheck = false;
      const origSpecifiedAncestor = 'orgAncestorId';
      expect(() =>
        pvc['validateAncestorId'](
          ancestorId,
          highestReleasedVersion,
          explicitUseNoAncestor,
          isPatch,
          skipAncestorCheck,
          origSpecifiedAncestor
        )
      ).to.throw(/Can’t create package version because you didn’t specify a package ancestor/);
    });
    it('should throw if !isPatch and !skipAncestorCheck and highestReleasedVersion.Id is not equal ancestorId', () => {
      const ancestorId = 'ancestorId';
      const highestReleasedVersion = {
        Id: 'foo',
        MajorVersion: 1,
        MinorVersion: 2,
        PatchVersion: 3,
      } as PackagingSObjects.Package2Version;
      const explicitUseNoAncestor = false;
      const isPatch = false;
      const skipAncestorCheck = false;
      const origSpecifiedAncestor = 'orgAncestorId';
      expect(() =>
        pvc['validateAncestorId'](
          ancestorId,
          highestReleasedVersion,
          explicitUseNoAncestor,
          isPatch,
          skipAncestorCheck,
          origSpecifiedAncestor
        )
      ).to.throw(
        /The ancestor version \[orgAncestorId\] you specified isn’t the highest released package version\. Set the ancestor version to 1\.2\.3/
      );
    });
    it('should identify the ancestor as "" when version is the first version', () => {
      const ancestorId = 'ancestorId';
      const highestReleasedVersion = undefined as PackagingSObjects.Package2Version;
      const explicitUseNoAncestor = false;
      const isPatch = false;
      const skipAncestorCheck = false;
      const origSpecifiedAncestor = 'orgAncestorId';
      const result = pvc['validateAncestorId'](
        ancestorId,
        highestReleasedVersion,
        explicitUseNoAncestor,
        isPatch,
        skipAncestorCheck,
        origSpecifiedAncestor
      );
      expect(result).to.be.equal('');
    });
    it('should identify the correct ancestor as the value passed to the function', () => {
      const ancestorId = 'ancestorId';
      const highestReleasedVersion = undefined as PackagingSObjects.Package2Version;
      const explicitUseNoAncestor = false;
      const isPatch = true;
      const skipAncestorCheck = true;
      const origSpecifiedAncestor = 'orgAncestorId';
      const result = pvc['validateAncestorId'](
        ancestorId,
        highestReleasedVersion,
        explicitUseNoAncestor,
        isPatch,
        skipAncestorCheck,
        origSpecifiedAncestor
      );
      expect(result).to.be.equal('ancestorId');
    });
  });
  describe('validateVersionNumber', () => {
    let pvc: PackageVersionCreate;
    beforeEach(() => {
      pvc = new PackageVersionCreate({ connection, project, packageId });
    });
    it('should return version number as valid', () => {
      const versionNumber = pvc['validateVersionNumber']('1.2.3.NEXT', 'NEXT', 'LATEST');
      expect(versionNumber).to.be.equal('1.2.3.NEXT');
    });
    it('should throw error if version number is invalid', () => {
      expect(() => {
        pvc['validateVersionNumber']('1.2.3.NEXT', 'foo', 'bar');
      }).to.throw(
        Error,
        /The provided VersionNumber '1.2.3.NEXT' is invalid. Provide an integer value or use the keyword/
      );
    });
    it('should throw error if build2 is undefined', () => {
      expect(() => {
        pvc['validateVersionNumber']('1.2.3.NEXT', 'foo', undefined);
      }).to.throw(
        Error,
        /The provided VersionNumber '1.2.3.NEXT' is invalid. Provide an integer value or use the keyword/
      );
    });
  });
});
