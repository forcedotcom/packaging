/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as path from 'path';
import * as fs from 'fs';
import sinon = require('sinon');
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/lib/testSetup';
import { assert, expect } from 'chai';
import { Connection, SfProject, SfError } from '@salesforce/core';
import * as packageUtils from '../../src/utils/packageUtils';
import { Package } from '../../src/package/package';
import { PackageVersion } from '../../src/package/packageVersion';
import { PackageType } from '../../src/interfaces/packagingInterfacesAndType';

describe('Package Version Retrieve', () => {
  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();
  const namespacePrefix = 'MyNamespace';
  const packageName = 'TESTPACKAGE';
  const packageVersionId2GP = '04txx00000000002gp';
  const packageVersionId1GP = '04txx00000000001gp';
  const destinationFolder = 'force-app';
  const packageId1GP = '033xx00000001gp';
  const packageId2GP = '033xx00000002gp';
  const package2Id = '0Ho000000000001';
  const package2VersionId = '05i00000000001';
  const dependencyPackageVersion1 = '04txx000000dep1';
  const dependencyPackageVersion2 = '04txx000000dep2';
  const metadataZipURL2GP = `/services/data/v59.0/tooling/sobjects/MetadataPackageVersion/${packageVersionId2GP}/MetadataZip`;
  const metadataZipURL1GP = `/services/data/v59.0/tooling/sobjects/MetadataPackageVersion/${packageVersionId1GP}/MetadataZip`;
  const firstGenBytesBase64 = fs.readFileSync('test/data/package-1gp.zip').toString('base64');
  const secondGenBytesBase64 = fs.readFileSync('test/data/package-2gp.zip').toString('base64');

  const mockPackage2Version = {
    Id: package2VersionId,
    IsDeleted: false,
    CreatedDate: 0,
    CreatedById: '',
    LastModifiedDate: 0,
    LastModifiedById: '',
    SystemModstamp: 0,
    Package2Id: package2Id,
    SubscriberPackageVersionId: packageVersionId2GP,
    Tag: '',
    Branch: '',
    AncestorId: '',
    ValidationSkipped: false,
    Name: '',
    Description: '',
    MajorVersion: 0,
    MinorVersion: 1,
    PatchVersion: 0,
    BuildNumber: 0,
    IsDeprecated: false,
    IsPasswordProtected: false,
    CodeCoverage: null,
    CodeCoveragePercentages: null,
    HasPassedCodeCoverageCheck: true,
    InstallKey: '',
    IsReleased: true,
    ConvertedFromVersionId: '',
    ReleaseVersion: 248,
    BuildDurationInSeconds: 0,
    HasMetadataRemoved: false,
    Language: '',
  };

  const mockPackage2 = {
    Id: package2Id,
    IsDeleted: false,
    CreatedDate: 0,
    CreatedById: '',
    LastModifiedDate: 0,
    LastModifiedById: '',
    SystemModstamp: 0,
    SubscriberPackageId: '033000000000000',
    Name: packageName,
    Description: 'My package description',
    NamespacePrefix: namespacePrefix,
    ContainerOptions: 'Managed' as PackageType,
    IsDeprecated: false,
    IsOrgDependent: false,
    ConvertedFromPackageId: '',
    PackageErrorUsername: '',
  };

  const downloadOptions2GP = {
    subscriberPackageVersionId: packageVersionId2GP,
    destinationFolder,
  };

  const downloadOptions1GP = {
    subscriberPackageVersionId: packageVersionId1GP,
    destinationFolder,
  };

  let project: SfProject;
  let connection: Connection;
  let toolingRetrieveStub: sinon.SinonStub;
  let queryPackage2VersionStub: sinon.SinonStub;
  let requestMetadataZipStub: sinon.SinonStub;
  let getPackageDataStub: sinon.SinonStub;

  beforeEach(async () => {
    $$.inProject(true);
    project = SfProject.getInstance();
    await project.getSfProjectJson().write({
      packageDirectories: [
        {
          path: 'force-app',
          default: true,
        },
      ],
    });
    stubContext($$);
    await $$.stubAuths(testOrg);
    connection = await testOrg.getConnection();

    toolingRetrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve');
    toolingRetrieveStub.withArgs('MetadataPackageVersion', packageVersionId2GP).resolves({
      Id: packageVersionId2GP,
      MetadataPackageId: packageId2GP,
      MetadataZip: metadataZipURL2GP,
    });

    toolingRetrieveStub.withArgs('MetadataPackageVersion', packageVersionId1GP).resolves({
      Id: packageVersionId1GP,
      MetadataPackageId: packageId1GP,
      MetadataZip: metadataZipURL1GP,
    });

    toolingRetrieveStub.withArgs('MetadataPackage', packageId2GP).resolves({
      Name: packageName,
      NamespacePrefix: namespacePrefix,
      PackageCategory: 'Package2',
    });

    toolingRetrieveStub.withArgs('MetadataPackage', packageId1GP).resolves({
      Name: packageName,
      NamespacePrefix: namespacePrefix,
      PackageCategory: 'Package',
    });

    getPackageDataStub = $$.SANDBOX.stub(Package.prototype, 'getPackageData');
    getPackageDataStub.resolves(mockPackage2);

    requestMetadataZipStub = $$.SANDBOX.stub(connection.tooling, 'request');
    requestMetadataZipStub.withArgs(metadataZipURL2GP, { encoding: 'base64' }).resolves(secondGenBytesBase64);
    requestMetadataZipStub.withArgs(metadataZipURL1GP, { encoding: 'base64' }).resolves(firstGenBytesBase64);

    queryPackage2VersionStub = $$.SANDBOX.stub(PackageVersion, 'queryPackage2Version');
    queryPackage2VersionStub
      .withArgs(connection, { whereClause: `WHERE SubscriberPackageVersionId = '${packageVersionId2GP}'` })
      .resolves([mockPackage2Version]);

    $$.SANDBOX.stub(packageUtils, 'generatePackageAliasEntry').resolves([
      `${packageName}@0.1.0-1-main`,
      packageVersionId2GP,
    ]);

    delete process.env.SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_RETRIEVE;
  });

  afterEach(async () => {
    restoreContext($$);
    $$.restore();
    const pathToClean = path.join(project.getPath(), destinationFolder);
    if (fs.existsSync(pathToClean)) {
      await fs.promises.rm(pathToClean, { recursive: true });
    }
    // @ts-ignore
    project.packageDirectories = undefined;
    delete process.env.SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_RETRIEVE;
  });

  it('should set the namespace in sfdx-project.json when retrieving a managed 2GP if it is not already set', async () => {
    const result = await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
    expect(result.converted).to.not.be.undefined;
    expect(project.getSfProjectJson().getContents().namespace).to.equal(namespacePrefix);
  });

  it('should not set the namespace in sfdx-project.json when retrieving an unlocked 2GP if it is not already set', async () => {
    getPackageDataStub.resolves({ ...mockPackage2, ContainerOptions: 'Unlocked' as PackageType });
    const result = await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
    expect(result.converted).to.not.be.undefined;
    expect(project.getSfProjectJson().getContents().namespace).to.be.undefined;
  });

  it('should not change the namespace in sfdx-project.json if it is already set', async () => {
    await project.getSfProjectJson().write({
      packageDirectories: [
        {
          path: 'force-app',
          default: true,
        },
      ],
      namespace: 'existingNS',
    });

    const result = await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
    expect(result.converted).to.not.be.undefined;
    expect(project.getSfProjectJson().getContents().namespace).to.equal('existingNS');
  });

  it('should add a correctly formed packageDirectory entry after retrieving a managed 2GP version', async () => {
    const result = await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
    expect(result.converted).to.not.be.undefined;
    expect(project.getSfProjectJson().getContents().packageDirectories.length).to.equal(1);
    expect(project.getSfProjectJson().getContents().packageDirectories[0]).to.deep.equal({
      path: destinationFolder,
      default: true,
      package: packageName,
      versionName: '<set version name>',
      versionNumber: '<set version number>',
      ancestorVersion: '<set ancestor version>',
      versionDescription: 'My package description',
      dependencies: [
        {
          package: dependencyPackageVersion1,
        },
        {
          package: dependencyPackageVersion2,
        },
      ],
    });
  });

  it('should not add a packageDirectory entry to sfdx-project.json after retrieving a managed 1GP version', async () => {
    queryPackage2VersionStub.withArgs(connection, sinon.match.any).resolves([]);
    expect(project.getSfProjectJson().getContents().packageDirectories.length).to.equal(1);
    const result = await Package.downloadPackageVersionMetadata(project, downloadOptions1GP, connection);
    expect(result.converted).to.not.be.undefined;
    expect(project.getSfProjectJson().getContents().packageDirectories.length).to.equal(1);
  });

  it('should not add a packageDirectory to sfdx-project.json when SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_RETRIEVE env var is set', async () => {
    process.env.SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_RETRIEVE = '1';
    expect(project.getSfProjectJson().getContents().packageDirectories.length).to.equal(1);
    const result = await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
    expect(result.converted).to.not.be.undefined;
    expect(project.getSfProjectJson().getContents().packageDirectories.length).to.equal(1);
  });

  it('should add a a package alias to sfdx-project.json for the retrieved package version', async () => {
    const result = await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
    expect(result.converted).to.not.be.undefined;
    expect(project.getSfProjectJson().getPackageAliases()?.[`${packageName}@0.1.0-1-main`]).to.equal(
      packageVersionId2GP
    );
  });

  it('should succeed for a valid package version when the destination dir is nonexistent', async () => {
    const result = await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
    expect(result.converted).to.not.be.undefined;
    expect(result.converted?.length).to.equal(4);
  });

  it('should succeed for a valid package version when the destination dir is present but empty', async () => {
    fs.mkdirSync(path.join(project.getPath(), destinationFolder), { recursive: true });
    const result = await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
    expect(result.converted).to.not.be.undefined;
    expect(result.converted?.length).to.equal(4);
  });

  it('should succeed for a valid package version when the destination dir is a newly created package directory', async () => {
    const apexPath = path.join(project.getPath(), destinationFolder, 'main', 'default', 'classes');
    fs.mkdirSync(apexPath, { recursive: true });
    fs.writeFileSync(path.join(apexPath, '.eslintrc.json'), '{ }');
    const result = await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
    expect(result.converted).to.not.be.undefined;
    expect(result.converted?.length).to.equal(4);
  });

  it('should succeed for a valid 2gp package', async () => {
    const result = await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
    expect(result.converted).to.not.be.undefined;
    expect(result.converted?.length).to.equal(4);
  });

  it('should fail if the destination directory is not empty', async () => {
    const directoryToCreate = path.join(project.getPath(), destinationFolder);
    fs.mkdirSync(directoryToCreate, { recursive: true });
    const testFilePath = path.join(directoryToCreate, 'test.txt');
    fs.writeFileSync(testFilePath, 'Some content to make this directory not empty');
    try {
      await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
      assert.fail('Expected test execution to raise an error');
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.equal(
        'Can’t retrieve package version metadata. The specified directory isn’t empty. Empty the directory, or create a new one and try again.'
      );
    }
  });

  it('should fail if the given destination directory is really a file', async () => {
    const filename = 'some.file';
    fs.writeFileSync(path.join(project.getPath(), filename), 'some contents');
    try {
      await Package.downloadPackageVersionMetadata(
        project,
        { ...downloadOptions2GP, destinationFolder: filename },
        connection
      );
      assert.fail('Expected test execution to raise an error');
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.equal(
        'Can’t retrieve package version metadata. The specified directory isn’t empty. Empty the directory, or create a new one and try again.'
      );
    }
  });

  it('should fail if the given destination directory is an absolute file path', async () => {
    const absolutePath = path.resolve(destinationFolder);
    try {
      await Package.downloadPackageVersionMetadata(
        project,
        { ...downloadOptions2GP, destinationFolder: absolutePath },
        connection
      );
      assert.fail('Expected test execution to raise an error');
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.equal(
        'Can’t retrieve package version metadata. The specified directory must be relative to your Salesforce DX project directory, and not an absolute path.'
      );
    }
  });

  it('should fail if the MetadataZip field is inaccessible to the user', async () => {
    toolingRetrieveStub.withArgs('MetadataPackageVersion', packageVersionId2GP).resolves({
      Id: packageVersionId2GP,
    });
    try {
      await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
      assert.fail('Expected test execution to raise an error');
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.equal(
        'The sf package version retrieve command has been removed. This feature isn’t quite ready for prime time, so we’re removing it for now while we make improvements. We’ll let you know after it’s back up.'
      );
    }
  });
});
