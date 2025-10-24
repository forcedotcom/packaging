/*
 * Copyright 2025, Salesforce, Inc.
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
import path from 'node:path';
import fs from 'node:fs';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/testSetup';
import { assert, expect } from 'chai';
import { Connection, Logger, SfProject } from '@salesforce/core';
import { isPackagingDirectory } from '@salesforce/core/project';
import { PackageDir, PackagePackageDir } from '@salesforce/schemas';
import {
  MetadataResolver,
  PackageVersionCreate,
  packageXmlStringToPackageXmlJson,
  packageXmlJsonToXmlString,
  validateAncestorId,
  validateVersionNumber,
} from '../../src/package/packageVersionCreate';
import * as PVCStubs from '../../src/package/packageVersionCreate';
import { PackagingSObjects } from '../../src/interfaces';
import { PackageProfileApi } from '../../src/package/packageProfileApi';
import { VersionNumber } from '../../src/package/versionNumber';

describe('Package Version Create', () => {
  const expectedKeys = [
    'Branch',
    'CodeCoverage',
    'ConvertedFromVersionId',
    'CreatedBy',
    'CreatedDate',
    'Error',
    'HasMetadataRemoved',
    'HasPassedCodeCoverageCheck',
    'Id',
    'Package2Id',
    'Package2Name',
    'Package2VersionId',
    'Status',
    'SubscriberPackageVersionId',
    'Tag',
    'VersionNumber',
    'TotalNumberOfMetadataFiles',
    'TotalSizeOfMetadataFiles',
  ];

  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();
  const packageId = '0Ho3i000000Gmj6XXX';
  let connection: Connection;
  let packageTypeQuery: sinon.SinonStub;
  let packageCreateStub: sinon.SinonStub;
  let pjsonXmlConversionStub: sinon.SinonStub;
  let pvcStub: sinon.SinonStub;
  let project: SfProject;

  // we can't stub all converts in the before each because each test has a unique PVC with different options
  const stubConvert = (): void => {
    $$.SANDBOX.stub(fs, 'existsSync').returns(true);
    $$.SANDBOX.stub(fs.promises, 'readFile').resolves();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $$.SANDBOX.stub(MetadataResolver.prototype, 'convertMetadata' as any).resolves({
      packagePath: '/var/folders/lc/yk0hz4l50kq0vs79yb3m_lmm0000gp/T/0Ho3i000000Gmj6XXX-TESTING/md-files',
      converted: [],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $$.SANDBOX.stub(MetadataResolver.prototype, 'generateMDFolderForArtifact' as any).resolves();
  };

  beforeEach(async () => {
    $$.inProject(true);
    project = SfProject.getInstance();
    project.getSfProjectJson().set('packageDirectories', [
      {
        path: 'pkg',
        package: 'DEP',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: false,
      },
      {
        path: 'force-app',
        package: 'TEST',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: true,
        ancestorId: 'TEST2',
        unpackagedMetadata: {
          path: 'unpackaged',
        },
        seedMetadata: {
          path: 'seed',
        },
        dependencies: [
          {
            package: 'DEP@0.1.0-1',
          },
        ],
      },
    ]);
    project.getSfProjectJson().set(
      'packageAliases',

      {
        TEST: packageId,
        TEST2: '05i3i000000Gmj6XXX',
        DEP: '0Ho4J000000TNmPXXX',
        'DEP@0.1.0-1': '04t3i000002eyYXXXX',
      }
    );
    await project.getSfProjectJson().write();
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
      errors: [],
    });
    pjsonXmlConversionStub = $$.SANDBOX.stub(PVCStubs, 'packageXmlStringToPackageXmlJson').returns({
      types: [{ name: 'Apexclass', members: ['MyApexClass'] }],
      version: '58.0',
    });
    // @ts-ignore
    pvcStub = $$.SANDBOX.stub(PackageVersionCreate.prototype, 'verifyHasSource').returns(true);
  });

  afterEach(async () => {
    restoreContext($$);
    await fs.promises.rm(path.join(project.getPath(), 'force-app'), { recursive: true, force: true });
    // @ts-ignore
    project.packageDirectories = undefined;
  });

  it('should throw an error when no package directories exist in the sfdx-project.json', async () => {
    project.getSfProjectJson().set('packageDirectories', []);
    project.getSfProjectJson().set('packageAliases', {});

    await project.getSfProjectJson().write();
    const pvc = new PackageVersionCreate({ connection, project, packageId });
    try {
      await pvc.createPackageVersion();
      expect(false, 'package version create should have failed').to.be.true;
    } catch (e) {
      assert(e instanceof Error);
      expect(e.message).to.equal(
        'In sfdx-project.json, be sure to specify which package directory (path) is the default. Example: `[{ "path": "packageDirectory1", "default": true }, { "path": "packageDirectory2" }]`'
      );
    }
  });

  it('should throw an error when Package entry missing from package.xml', async () => {
    pvcStub.restore();
    pjsonXmlConversionStub.restore();
    // @ts-expect-error because we're intentionally testing a validation
    pjsonXmlConversionStub = $$.SANDBOX.stub(PVCStubs, 'packageXmlStringToPackageXmlJson').returns({});
    const pvc = new PackageVersionCreate({ connection, project, packageId });

    try {
      await pvc.createPackageVersion();
    } catch (e) {
      assert(e instanceof Error);
      expect(e.message).to.equal('No matching source was found within the package root directory: force-app');
    }
  });

  it('should create the package version create request', async () => {
    const pvc = new PackageVersionCreate({ connection, project, packageId });
    stubConvert();

    const result = await pvc.createPackageVersion();
    expect(result).to.have.all.keys(expectedKeys);
    const dir1 = project.getSfProjectJson().getContents().packageDirectories[1];
    assert(isPackagingDirectory(dir1));
    expect(dir1.dependencies).to.deep.equal([
      {
        package: 'DEP@0.1.0-1',
      },
    ]);
  });

  it('should create the package version create request with codecoverage=true', async () => {
    const pvc = new PackageVersionCreate({ connection, project, codecoverage: true, packageId });
    const hasUnpackagedMdSpy = $$.SANDBOX.spy(MetadataResolver.prototype, 'resolveMetadata');
    stubConvert();
    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].CalculateCodeCoverage).to.equal(true);
    expect(result).to.have.all.keys(expectedKeys);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const unpackagedMD = hasUnpackagedMdSpy.secondCall.args[0];
    expect(unpackagedMD).to.equal('unpackaged');
  });

  it('should create the package version create request with codecoverage=false', async () => {
    const pvc = new PackageVersionCreate({ connection, project, codecoverage: false, packageId });
    const hasSeedMdSpy = $$.SANDBOX.spy(MetadataResolver.prototype, 'resolveMetadata');
    stubConvert();

    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].CalculateCodeCoverage).to.equal(false);
    expect(result).to.have.all.keys(expectedKeys);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const hasSeedMd = hasSeedMdSpy.firstCall.args[0];
    expect(hasSeedMd).to.equal('seed');
  });

  it('should create the package version create request with tag info', async () => {
    const pvc = new PackageVersionCreate({
      connection,
      project,
      tag: 'DancingBears',
      packageId,
    });
    stubConvert();

    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].Tag).to.equal('DancingBears');
    expect(result).to.have.all.keys(expectedKeys);
  });

  it('should create the package version create request with skipancestorcheck info', async () => {
    const pvc = new PackageVersionCreate({
      connection,
      project,
      tag: 'DancingBears',
      packageId,
      skipancestorcheck: true,
    });
    stubConvert();

    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].skipancestorcheck).to.equal(undefined);
    expect(result).to.have.all.keys(expectedKeys);
  });

  it('should create the package version create request with skip validation', async () => {
    const pvc = new PackageVersionCreate({
      connection,
      project,
      skipvalidation: true,
      packageId,
    });
    stubConvert();

    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].SkipValidation).to.equal(true);
    expect(result).to.have.all.keys(expectedKeys);
  });

  it('should create the package version create request with installationkey', async () => {
    const pvc = new PackageVersionCreate({
      connection,
      project,
      installationkey: 'guessMyPassword',
      packageId,
    });
    stubConvert();

    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].InstallKey).to.equal('guessMyPassword');
    expect(packageCreateStub.firstCall.args[1].SkipValidation).to.equal(false);
    expect(result).to.have.all.keys(expectedKeys);
  });

  it('should create the package version create request with branch', async () => {
    const pvc = new PackageVersionCreate({ connection, project, branch: 'main', packageId });
    stubConvert();
    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].Branch).to.equal('main');
    expect(result).to.have.all.keys(expectedKeys);
  });

  it('should resolve dependency version using the --branch parameter only if the branch is undefined in config', async () => {
    // @ts-ignore: Argument of type '"resolveBuildNumber"' is not assignable to parameter of type '"createPackageVersion"'.
    const packageVersionCreateSpy = $$.SANDBOX.spy(PackageVersionCreate.prototype, 'resolveBuildNumber');

    const config = project.getSfProjectJson().getContents();
    if (isDirWithDependencies(config.packageDirectories[1])) {
      config.packageDirectories[1].dependencies[0].package = 'DEP';
      config.packageDirectories[1].dependencies[0].versionNumber = '0.1.0.1';
    }

    project.getSfProjectJson().set('packageDirectories', config.packageDirectories);
    await project.getSfProjectJson().write();

    const pvc = new PackageVersionCreate({ connection, project, branch: 'main', packageId, skipancestorcheck: true });
    stubConvert();

    const result = await pvc.createPackageVersion();

    /*
      Assert that the --branch argument was passed in and is used to
      retrieve the appropriate version/build number using the value in the
      dependency definition.
    */
    expect(packageCreateStub.firstCall.args[1].Branch).to.equal('main');
    // @ts-ignore: Expected 0 arguments, but got 3
    expect(packageVersionCreateSpy.calledWith(VersionNumber.from('0.1.0.1'), '0Ho4J000000TNmPXXX', 'main')).to.equal(
      true
    );

    expect(result).to.have.all.keys(expectedKeys);
  });

  it('should resolve dependency version ignoring the --branch parameter if the branch is explicitly set in config', async () => {
    // @ts-ignore: Argument of type '"resolveBuildNumber"' is not assignable to parameter of type '"createPackageVersion"'.
    const packageVersionCreateSpy = $$.SANDBOX.spy(PackageVersionCreate.prototype, 'resolveBuildNumber');

    const config = project.getSfProjectJson().getContents();
    if (isDirWithDependencies(config.packageDirectories[1])) {
      config.packageDirectories[1].dependencies[0].package = 'DEP';
      config.packageDirectories[1].dependencies[0].versionNumber = '0.1.0.1';
      config.packageDirectories[1].dependencies[0].branch = 'dev';
    }
    project.getSfProjectJson().set('packageDirectories', config.packageDirectories);
    await project.getSfProjectJson().write();

    const pvc = new PackageVersionCreate({ connection, project, branch: 'main', packageId, skipancestorcheck: true });
    stubConvert();

    const result = await pvc.createPackageVersion();

    /*
      Assert that the --branch argument was passed in and is used to
      retrieve the appropriate version/build number using the value in the
      dependency definition.
    */
    expect(packageCreateStub.firstCall.args[1].Branch).to.equal('main');
    // @ts-ignore: Expected 0 arguments, but got 3
    expect(packageVersionCreateSpy.calledWith(VersionNumber.from('0.1.0.1'), '0Ho4J000000TNmPXXX', 'dev')).to.equal(
      true
    );

    expect(result).to.have.all.keys(expectedKeys);
  });

  it("should resolve dependency version to `null` if the --branch parameter is set but the branch is explicitly '' in config", async () => {
    // @ts-ignore: Argument of type '"resolveBuildNumber"' is not assignable to parameter of type '"createPackageVersion"'.
    const packageVersionCreateSpy = $$.SANDBOX.spy(PackageVersionCreate.prototype, 'resolveBuildNumber');

    const config = project.getSfProjectJson().getContents();
    if (isDirWithDependencies(config.packageDirectories[1])) {
      config.packageDirectories[1].dependencies[0].package = 'DEP';
      config.packageDirectories[1].dependencies[0].versionNumber = '0.1.0.1';
      config.packageDirectories[1].dependencies[0].branch = '';
    }
    project.getSfProjectJson().set('packageDirectories', config.packageDirectories);
    await project.getSfProjectJson().write();

    const pvc = new PackageVersionCreate({ connection, project, branch: 'main', packageId, skipancestorcheck: true });
    stubConvert();

    const result = await pvc.createPackageVersion();

    /*
      Assert that the --branch argument was passed in and is used to
      retrieve the appropriate version/build number using the value in the
      dependency definition.
    */
    expect(packageCreateStub.firstCall.args[1].Branch).to.equal('main');
    // @ts-ignore: Expected 0 arguments, but got 3
    expect(packageVersionCreateSpy.calledWith(VersionNumber.from('0.1.0.1'), '0Ho4J000000TNmPXXX', '')).to.equal(true);

    expect(result).to.have.all.keys(expectedKeys);
  });

  it('should create the package version create request with language and API version >= 57.0', async () => {
    $$.SANDBOX.stub(connection, 'getApiVersion').returns('57.0');
    const pvc = new PackageVersionCreate({ connection, project, language: 'en_US', packageId });
    stubConvert();
    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].Language).to.equal('en_US');
    expect(result).to.have.all.keys(expectedKeys);
  });

  it('should NOT create the package version create request with language and API version < 57.0', async () => {
    $$.SANDBOX.stub(connection, 'getApiVersion').returns('56.0');
    stubConvert();
    const pvc = new PackageVersionCreate({ connection, project, language: 'en_US', packageId });
    const result = await pvc.createPackageVersion();
    expect(packageCreateStub.firstCall.args[1].Language).to.be.undefined;
    expect(result).to.have.all.keys(expectedKeys);
  });

  it("should set the build org language (i.e., package2-descriptor.json's language) from the scratch org definition file's language", async () => {
    const scratchOrgDefFileContent = '{ "language": "buildOrgLanguage" }';
    const scratchOrgDefFileName = 'project-scratch-def.json';
    $$.SANDBOX.stub(fs.promises, 'readFile').withArgs(scratchOrgDefFileName).resolves(scratchOrgDefFileContent);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $$.SANDBOX.stub(MetadataResolver.prototype, 'generateMDFolderForArtifact' as any).resolves();
    $$.SANDBOX.stub(fs, 'existsSync').returns(true);
    const writeFileSpy = $$.SANDBOX.spy(fs.promises, 'writeFile');

    const pvc = new PackageVersionCreate({ connection, project, definitionfile: scratchOrgDefFileName, packageId });
    const result = await pvc.createPackageVersion();
    expect(result).to.have.all.keys(expectedKeys);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const package2DescriptorJson = writeFileSpy.firstCall.args[1]; // package2-descriptor.json contents
    expect(package2DescriptorJson).to.have.string('buildOrgLanguage');
  });

  it('should set packageMetadataPermissions in package2descriptor.json when specified in sfdx-project.json ', async () => {
    project.getSfProjectJson().set('packageDirectories', [
      {
        path: 'force-app',
        package: 'TEST',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: true,
        packageMetadataAccess: {
          permissionSets: ['Allow_Trial_Permission'],
          permissionSetLicenses: ['B2BBuyerPsl'],
        },
      },
    ]);

    await project.getSfProjectJson().write();

    const validationSpy = $$.SANDBOX.spy(project.getSfProjectJson(), 'schemaValidate');
    const pvc = new PackageVersionCreate({
      connection,
      project,
      validateschema: true,
      packageId,
      skipancestorcheck: true,
    });
    stubConvert();

    const writeFileSpy = $$.SANDBOX.spy(fs.promises, 'writeFile');

    const result = await pvc.createPackageVersion();
    expect(validationSpy.callCount).to.equal(1);
    expect(result).to.have.all.keys(expectedKeys);

    const package2DescriptorJson = writeFileSpy.firstCall.args[1]; // package2-descriptor.json contents
    expect(package2DescriptorJson).to.have.string('packageMetadataPermissionSetNames');
    expect(package2DescriptorJson).to.have.string('packageMetadataPermissionSetLicenseNames');
    expect(package2DescriptorJson).to.have.string('Allow_Trial_Permission');
    expect(package2DescriptorJson).to.have.string('B2BBuyerPsl');
  });

  it('should set apexTestAccess permissions in package2descriptor.json when codecoverage is enabled', async () => {
    project.getSfProjectJson().set('packageDirectories', [
      {
        path: 'force-app',
        package: 'TEST',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: true,
        apexTestAccess: {
          permissionSets: ['Test_Permission_Set', 'Another_Test_PermSet'],
          permissionSetLicenses: ['TestPsl', 'AnotherTestPsl'],
        },
      },
    ]);

    await project.getSfProjectJson().write();

    const pvc = new PackageVersionCreate({
      connection,
      project,
      codecoverage: true,
      packageId,
      skipancestorcheck: true,
    });
    stubConvert();

    const writeFileSpy = $$.SANDBOX.spy(fs.promises, 'writeFile');

    const result = await pvc.createPackageVersion();
    expect(result).to.have.all.keys(expectedKeys);

    const package2DescriptorJson = writeFileSpy.firstCall.args[1]; // package2-descriptor.json contents
    expect(package2DescriptorJson).to.have.string('permissionSetNames');
    expect(package2DescriptorJson).to.have.string('permissionSetLicenseDeveloperNames');
    expect(package2DescriptorJson).to.have.string('Test_Permission_Set');
    expect(package2DescriptorJson).to.have.string('Another_Test_PermSet');
    expect(package2DescriptorJson).to.have.string('TestPsl');
    expect(package2DescriptorJson).to.have.string('AnotherTestPsl');
    // apexTestAccess should be removed from the descriptor
    expect(package2DescriptorJson).to.not.have.string('apexTestAccess');
  });

  it('should NOT process apexTestAccess permissions when codecoverage is false', async () => {
    project.getSfProjectJson().set('packageDirectories', [
      {
        path: 'force-app',
        package: 'TEST',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: true,
        apexTestAccess: {
          permissionSets: ['Test_Permission_Set'],
          permissionSetLicenses: ['TestPsl'],
        },
      },
    ]);

    await project.getSfProjectJson().write();

    const pvc = new PackageVersionCreate({
      connection,
      project,
      codecoverage: false,
      packageId,
      skipancestorcheck: true,
    });
    stubConvert();

    const writeFileSpy = $$.SANDBOX.spy(fs.promises, 'writeFile');

    const result = await pvc.createPackageVersion();
    expect(result).to.have.all.keys(expectedKeys);

    const package2DescriptorJson = writeFileSpy.firstCall.args[1]; // package2-descriptor.json contents
    // These fields should NOT be present when codecoverage is false
    expect(package2DescriptorJson).to.not.have.string('permissionSetNames');
    expect(package2DescriptorJson).to.not.have.string('permissionSetLicenseDeveloperNames');
    // apexTestAccess should still be removed from the descriptor
    expect(package2DescriptorJson).to.not.have.string('apexTestAccess');
  });

  it('should validate options when package type = unlocked (scripts) - postinstall script', async () => {
    packageTypeQuery.restore();
    // @ts-ignore
    packageTypeQuery = $$.SANDBOX.stub(connection.tooling, 'query')
      .onFirstCall() // @ts-ignore
      .resolves({ records: [{ Id: '05i3i000000Gmj6XXX' }] }) // @ts-ignore
      .resolves({ records: [{ ContainerOptions: 'Unlocked' }] });
    const pvc = new PackageVersionCreate({
      connection,
      project,
      postinstallscript: 'myScript.sh',
      packageId,
    });
    stubConvert();

    try {
      await pvc.createPackageVersion();
    } catch (e) {
      assert(e instanceof Error);
      expect(e.message).to.equal(
        'We can’t create the package version. This parameter is available only for second-generation managed packages. Create the package version without the postinstallscript or uninstallscript parameters.'
      );
    }
  });

  it('should validate options when package type = unlocked (scripts) - uninstall script', async () => {
    packageTypeQuery.restore();
    // @ts-ignore
    packageTypeQuery = $$.SANDBOX.stub(connection.tooling, 'query')
      .onFirstCall() // @ts-ignore
      .resolves({ records: [{ Id: '05i3i000000Gmj6XXX' }] }) // @ts-ignore
      .resolves({ records: [{ ContainerOptions: 'Unlocked' }] });

    // check uninstallscript
    const pvc = new PackageVersionCreate({
      connection,
      project,
      uninstallscript: 'myScript.sh',
      packageId,
    });
    stubConvert();

    try {
      await pvc.createPackageVersion();
    } catch (e) {
      assert(e instanceof Error);
      expect(e.message).to.equal(
        'We can’t create the package version. This parameter is available only for second-generation managed packages. Create the package version without the postinstallscript or uninstallscript parameters.'
      );
    }
  });

  it('should validate options when package type = unlocked (ancestors)', async () => {
    project.getSfProjectJson().set('packageDirectories', [
      {
        path: 'force-app',
        package: 'TEST',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: true,
        ancestorId: '123',
      },
    ]);
    project.getSfProjectJson().set('packageAliases', {
      TEST: '0Ho3i000000Gmj6XXX',
    });

    await project.getSfProjectJson().write();

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
      assert(e instanceof Error);
      expect(e.message).to.equal(
        'Can’t create package version. Specifying an ancestor is available only for second-generation managed packages. Remove the ancestorId or ancestorVersion from your sfdx-project.json file, and then create the package version again.'
      );
    }

    // check ancestorVersion
    project.getSfProjectJson().set('packageDirectories', [
      {
        path: 'force-app',
        package: 'TEST',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: true,
        ancestorVersion: '123',
      },
    ]);
    project.getSfProjectJson().set('packageAliases', {
      TEST: '0Ho3i000000Gmj6XXX',
    });
    await project.getSfProjectJson().write();

    try {
      await pvc.createPackageVersion();
    } catch (e) {
      assert(e instanceof Error);
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
    stubConvert();

    const result = await pvc.createPackageVersion();
    expect(validationSpy.callCount).to.equal(1);
    expect(result).to.have.all.keys(expectedKeys);
  });

  it('should not package the profiles from unpackaged metadata dirs', async () => {
    project.getSfProjectJson().set('packageDirectories', [
      {
        path: 'pkg',
        package: 'dep',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: false,
        unpackagedMetadata: {
          path: 'unpackaged-pkg',
        },
      },
      {
        path: 'force-app',
        package: 'TEST',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: true,
        ancestorId: 'TEST2',
        unpackagedMetadata: {
          path: 'unpackaged-force-app',
        },
        seedMetadata: {
          path: 'seed',
        },
        dependencies: [
          {
            package: 'DEP@0.1.0-1',
          },
        ],
      },
      {
        path: 'unpackaged-pkg',
      },
      {
        path: 'unpackaged-force-app',
      },
    ]);
    project.getSfProjectJson().set('packageAliases', {
      TEST: packageId,
      TEST2: '05i3i000000Gmj6XXX',
      DEP: '05i3i000000Gmj6XXX',
      'DEP@0.1.0-1': '04t3i000002eyYXXXX',
    });
    await project.getSfProjectJson().write();
    const pvc = new PackageVersionCreate({ connection, project, codecoverage: true, packageId });
    const profileSpyGenerate = $$.SANDBOX.spy(PackageProfileApi.prototype, 'generateProfiles');
    const profileSpyFilter = $$.SANDBOX.spy(PackageProfileApi.prototype, 'filterAndGenerateProfilesForManifest');
    stubConvert();
    const result = await pvc.createPackageVersion();
    expect(result).to.have.all.keys(expectedKeys);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const excludedDirsGenerate = profileSpyGenerate.firstCall.args[2];
    expect(excludedDirsGenerate?.length).to.equal(2);
    expect(excludedDirsGenerate).to.contain('unpackaged-pkg');
    expect(excludedDirsGenerate).to.contain('unpackaged-force-app');
    const excludedDirsFilter = profileSpyFilter.firstCall.args[1];
    expect(excludedDirsFilter?.length).to.equal(2);
    expect(excludedDirsFilter).to.contain('unpackaged-pkg');
    expect(excludedDirsFilter).to.contain('unpackaged-force-app');
  });

  it('should only package profiles in the package dir when scopeProfiles = true', async () => {
    project.getSfProjectJson().set('packageDirectories', [
      {
        path: 'pkg',
        package: 'dep',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: false,
        unpackagedMetadata: {
          path: 'unpackaged-pkg',
        },
      },
      {
        path: 'force-app',
        package: 'TEST',
        versionName: 'ver 0.1',
        versionNumber: '0.1.0.NEXT',
        default: true,
        ancestorId: 'TEST2',
        scopeProfiles: true,
        unpackagedMetadata: {
          path: 'unpackaged-force-app',
        },
        seedMetadata: {
          path: 'seed',
        },
        dependencies: [
          {
            package: 'DEP@0.1.0-1',
          },
        ],
      },
      {
        path: 'unpackaged-pkg',
      },
      {
        path: 'unpackaged-force-app',
      },
    ]);
    project.getSfProjectJson().set('packageAliases', {
      TEST: packageId,
      TEST2: '05i3i000000Gmj6XXX',
      DEP: '05i3i000000Gmj6XXX',
      'DEP@0.1.0-1': '04t3i000002eyYXXXX',
    });
    await project.getSfProjectJson().write();
    const loggerSpy = $$.SANDBOX.spy(Logger.prototype, 'debug');
    const pvc = new PackageVersionCreate({ connection, project, packageId });
    const profileSpyGenerate = $$.SANDBOX.spy(PackageProfileApi.prototype, 'generateProfiles');
    const profileSpyFilter = $$.SANDBOX.spy(PackageProfileApi.prototype, 'filterAndGenerateProfilesForManifest');
    stubConvert();
    const result = await pvc.createPackageVersion();

    expect(result).to.have.all.keys(expectedKeys);
    expect(loggerSpy.called).to.be.true;
    const logMsg =
      "packageDirectory: force-app has 'scopeProfiles' set, so only including profiles from within this directory";
    expect(loggerSpy.calledWith(logMsg)).to.be.true;
    expect(profileSpyGenerate.called).to.be.true;
    expect(profileSpyGenerate.firstCall.args[2]).to.deep.equal(['pkg', 'unpackaged-pkg', 'unpackaged-force-app']);
    expect(profileSpyFilter.called).to.be.true;
    expect(profileSpyFilter.firstCall.args[1]).to.deep.equal(['pkg', 'unpackaged-pkg', 'unpackaged-force-app']);
  });

  it('should not package profiles from outside of project package directories', async () => {
    const pkgProfileApi = await PackageProfileApi.create({ project, includeUserLicenses: false });
    const types = [
      { name: 'Layout', members: ['Test Layout'] },
      { name: 'Profile', members: ['Test Profile'] },
    ];
    // write a Profile in the project but outside of the package dirs
    const outsideDir = path.join(project.getPath(), 'outside-pkg-dirs');
    const forceAppDir = path.join(project.getPath(), 'force-app');
    await fs.promises.mkdir(outsideDir);
    const fileContents = '<?xml version="1.0" encoding="UTF-8"?>';
    await fs.promises.writeFile(path.join(outsideDir, 'Outside Profile.profile-meta.xml'), fileContents);
    await fs.promises.writeFile(path.join(forceAppDir, 'Test Profile.profile-meta.xml'), fileContents);

    const pkgTypeMembers = pkgProfileApi.filterAndGenerateProfilesForManifest(types);
    expect(pkgTypeMembers.length).to.equal(2);
    expect(pkgTypeMembers[0].members).to.deep.equal(['Test Layout']);
    expect(pkgTypeMembers[1].members).to.deep.equal(['Test Profile']);
  });

  describe('validateAncestorId', () => {
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
        validateAncestorId(
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
        validateAncestorId(
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
      const highestReleasedVersion = undefined as unknown as PackagingSObjects.Package2Version;
      const explicitUseNoAncestor = false;
      const isPatch = false;
      const skipAncestorCheck = false;
      const origSpecifiedAncestor = 'orgAncestorId';
      const result = validateAncestorId(
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
      const highestReleasedVersion = undefined as unknown as PackagingSObjects.Package2Version;
      const explicitUseNoAncestor = false;
      const isPatch = true;
      const skipAncestorCheck = true;
      const origSpecifiedAncestor = 'orgAncestorId';
      const result = validateAncestorId(
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
    it('should return version number as valid', () => {
      const versionNumber = validateVersionNumber('1.2.3.NEXT', 'NEXT', 'LATEST');
      expect(versionNumber).to.be.equal('1.2.3.NEXT');
    });
    it('should throw error if version number is invalid', () => {
      expect(() => {
        validateVersionNumber('1.2.3.NEXT', 'foo', 'bar');
      }).to.throw(
        Error,
        /The provided VersionNumber '1.2.3.NEXT' is invalid. Provide an integer value or use the keyword/
      );
    });
    it('should throw error if build2 is undefined', () => {
      expect(() => {
        validateVersionNumber('1.2.3.NEXT', 'foo', undefined);
      }).to.throw(
        Error,
        /The provided VersionNumber '1.2.3.NEXT' is invalid. Provide an integer value or use the keyword/
      );
    });
  });

  describe('handle case sensitivity for project-scratch-def.json keys', () => {
    it('should create package version from the snapshot (lower-case) property in definition file', async () => {
      const scratchOrgDefFileContent = '{ "snapshot": "SnapScratchOrg" }';
      const scratchOrgDefFileName = 'project-scratch-def.json';
      $$.SANDBOX.stub(fs.promises, 'readFile').withArgs(scratchOrgDefFileName).resolves(scratchOrgDefFileContent);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $$.SANDBOX.stub(MetadataResolver.prototype, 'generateMDFolderForArtifact' as any).resolves();
      $$.SANDBOX.stub(fs, 'existsSync').returns(true);
      const writeFileSpy = $$.SANDBOX.spy(fs.promises, 'writeFile');

      const pvc = new PackageVersionCreate({ connection, project, definitionfile: scratchOrgDefFileName, packageId });
      const result = await pvc.createPackageVersion();
      expect(result).to.have.all.keys(expectedKeys);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const package2DescriptorJson = writeFileSpy.firstCall.args[1]; // package2-descriptor.json contents
      expect(package2DescriptorJson).to.have.string('snapshot');
    });

    it("should create package version from the snapShot (camel-case or any-case) property in definition file's", async () => {
      const scratchOrgDefFileContent = '{ "snapShot": "SnapScratchOrg2" }';
      const scratchOrgDefFileName = 'project-scratch-def.json';
      $$.SANDBOX.stub(fs.promises, 'readFile').withArgs(scratchOrgDefFileName).resolves(scratchOrgDefFileContent);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      $$.SANDBOX.stub(MetadataResolver.prototype, 'generateMDFolderForArtifact' as any).resolves();
      $$.SANDBOX.stub(fs, 'existsSync').returns(true);
      const writeFileSpy = $$.SANDBOX.spy(fs.promises, 'writeFile');

      const pvc = new PackageVersionCreate({ connection, project, definitionfile: scratchOrgDefFileName, packageId });
      const result = await pvc.createPackageVersion();
      expect(result).to.have.all.keys(expectedKeys);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const package2DescriptorJson = writeFileSpy.firstCall.args[1]; // package2-descriptor.json contents
      expect(package2DescriptorJson).to.have.string('snapshot');
    });
  });
});

describe('PackageXml read/write', () => {
  describe('multiple types', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>Account.Keep_Me__c</members>
        <members>Activity.Event_Field__c</members>
        <members>Activity.Task_Field__c</members>
        <name>CustomField</name>
    </types>
    <types>
        <members>Account-AccountLayout</members>
        <members>Event-EventLayout</members>
        <members>Task-TaskLayout</members>
        <name>Layout</name>
    </types>
    <types>
        <members>DummyProfile</members>
        <name>Profile</name>
    </types>
    <version>58.0</version>
</Package>
`;

    const json = {
      types: [
        {
          members: ['Account.Keep_Me__c', 'Activity.Event_Field__c', 'Activity.Task_Field__c'],
          name: 'CustomField',
        },
        {
          members: ['Account-AccountLayout', 'Event-EventLayout', 'Task-TaskLayout'],
          name: 'Layout',
        },
        {
          members: ['DummyProfile'],
          name: 'Profile',
        },
      ],
      version: '58.0',
    };
    it('read', () => {
      expect(packageXmlStringToPackageXmlJson(xml)).to.deep.equal(json);
    });
    it('write', () => {
      expect(packageXmlJsonToXmlString(json)).to.deep.equal(xml);
    });
  });
  describe('single type', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>Account.Keep_Me__c</members>
        <name>CustomField</name>
    </types>
    <version>58.0</version>
</Package>
`;

    const json = {
      types: [
        {
          members: ['Account.Keep_Me__c'],
          name: 'CustomField',
        },
      ],
      version: '58.0',
    };
    it('read', () => {
      expect(packageXmlStringToPackageXmlJson(xml)).to.deep.equal(json);
    });
    it('write', () => {
      expect(packageXmlJsonToXmlString(json)).to.deep.equal(xml);
    });
  });
});

const isDirWithDependencies = (
  dir: PackageDir
): dir is PackagePackageDir & Required<Pick<PackagePackageDir, 'dependencies'>> =>
  isPackagingDirectory(dir) && dir.dependencies !== undefined;
