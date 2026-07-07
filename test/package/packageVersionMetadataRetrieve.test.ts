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
import path from 'node:path';
import fs from 'node:fs';
import * as sinon from 'sinon';
import { instantiateContext, MockTestOrgData, restoreContext, stubContext } from '@salesforce/core/testSetup';
import { assert, expect } from 'chai';
import { Connection, SfProject, SfError } from '@salesforce/core';
import { ZipTreeContainer } from '@salesforce/source-deploy-retrieve';
import * as packageUtils from '../../src/utils/packageUtils';
import { Package } from '../../src/package/package';
import { PackageVersion } from '../../src/package/packageVersion';
import { PackageType } from '../../src/interfaces/packagingInterfacesAndType';

// The retrieve flow issues two distinct queryPackage2Version calls that share a whereClause but
// differ by their selected fields: a disambiguation query (non-gated columns) and a separate fetch
// of the permission-gated DeveloperUsePkgZip URL. Match each by its field list.
const disambiguationQuery = (subscriberPackageVersionId: string): sinon.SinonMatcher =>
  sinon.match({
    whereClause: `WHERE SubscriberPackageVersionId = '${subscriberPackageVersionId}'`,
    fields: ['Package2Id', 'ConvertedFromVersionId'],
  });
const zipUrlQuery = (subscriberPackageVersionId: string): sinon.SinonMatcher =>
  sinon.match({
    whereClause: `WHERE SubscriberPackageVersionId = '${subscriberPackageVersionId}'`,
    fields: ['DeveloperUsePkgZip'],
  });

describe('Package Version Retrieve', () => {
  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();
  const namespacePrefix = 'MyNamespace';
  const packageName = 'TESTPACKAGE';
  const packageVersionId2GP = '04txx00000000002gp';
  const packageVersionId1GP = '04txx00000000001gp';
  const destinationFolder = 'force-app';
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
    DeveloperUsePkgZip: metadataZipURL2GP,
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
  let queryPackage2VersionStub: sinon.SinonStub;
  let requestMetadataZipStub: sinon.SinonStub;
  let getPackageDataStub: sinon.SinonStub;
  let toolingQueryStub: sinon.SinonStub;

  beforeEach(async () => {
    $$.inProject(true);
    project = SfProject.getInstance();
    project.getSfProjectJson().set('packageDirectories', [
      {
        path: 'force-app',
        default: true,
      },
    ]);
    await project.getSfProjectJson().write();
    stubContext($$);
    await $$.stubAuths(testOrg);
    connection = await testOrg.getConnection();

    getPackageDataStub = $$.SANDBOX.stub(Package.prototype, 'getPackageData');
    getPackageDataStub.resolves(mockPackage2);

    requestMetadataZipStub = $$.SANDBOX.stub(connection.tooling, 'request');
    requestMetadataZipStub.withArgs(metadataZipURL2GP, { encoding: 'base64' }).resolves(secondGenBytesBase64);
    requestMetadataZipStub.withArgs(metadataZipURL1GP, { encoding: 'base64' }).resolves(firstGenBytesBase64);

    // SubscriberPackageVersion existence probe used to disambiguate retrieve failures.
    // Default to "exists" so happy-path tests are unaffected; override per-test as needed.
    toolingQueryStub = $$.SANDBOX.stub(connection.tooling, 'query');
    toolingQueryStub.resolves({ records: [{ Id: packageVersionId2GP }], done: true, totalSize: 1 });

    queryPackage2VersionStub = $$.SANDBOX.stub(PackageVersion, 'queryPackage2Version');
    queryPackage2VersionStub.resolves([mockPackage2Version]);

    $$.SANDBOX.stub(packageUtils, 'generatePackageAliasEntry').resolves([
      `${packageName}@0.1.0-1-main`,
      packageVersionId2GP,
    ]);

    delete process.env.SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_RETRIEVE;
  });

  afterEach(async () => {
    restoreContext($$);
    $$.restore();
    project.getSfProjectJson().unsetAll(['namespace', 'packageAliases']);
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
    project.getSfProjectJson().set('packageDirectories', [
      {
        path: 'force-app',
        default: true,
      },
    ]);
    project.getSfProjectJson().set('namespace', 'existingNS');
    await project.getSfProjectJson().write();

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
    // For 1GP packages, queryPackage2Version returns empty array, which means no Package2Version found.
    queryPackage2VersionStub.withArgs(connection, disambiguationQuery(packageVersionId1GP)).resolves([]);
    // The SubscriberPackageVersion exists globally, so this resolves to "not in this Dev Hub".
    toolingQueryStub.resolves({ records: [{ Id: packageVersionId1GP }], done: true, totalSize: 1 });

    try {
      await Package.downloadPackageVersionMetadata(project, downloadOptions1GP, connection);
      assert.fail('Expected test execution to raise an error');
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.equal(
        "Can't retrieve package metadata. Package version 04txx00000000001gp isn't accessible from this Dev Hub org. You can only retrieve package metadata from the Dev Hub that created the package version. Verify that you specified the correct target Dev Hub."
      );
    }
  });

  it('should throw packageVersionNotFound when no Package2Version row exists and the 04t is unknown', async () => {
    queryPackage2VersionStub.withArgs(connection, disambiguationQuery(packageVersionId1GP)).resolves([]);
    // No SubscriberPackageVersion either => the 04t doesn't exist anywhere.
    toolingQueryStub.resolves({ records: [], done: true, totalSize: 0 });

    try {
      await Package.downloadPackageVersionMetadata(project, downloadOptions1GP, connection);
      assert.fail('Expected test execution to raise an error');
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.equal(
        "Can't retrieve package metadata. We can't find the package version 04txx00000000001gp. Verify that the 04t ID is correct and that the package version exists."
      );
    }
  });

  it('should throw packageVersionNotFound for a malformed 04t without querying', async () => {
    const malformedId = '04tinvalid';

    try {
      await Package.downloadPackageVersionMetadata(
        project,
        { subscriberPackageVersionId: malformedId, destinationFolder },
        connection
      );
      assert.fail('Expected test execution to raise an error');
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.equal(
        "Can't retrieve package metadata. We can't find the package version 04tinvalid. Verify that the 04t ID is correct and that the package version exists."
      );
      // The malformed ID must be rejected before any SOQL is issued, so no raw error can leak.
      expect(queryPackage2VersionStub.called).to.equal(false);
    }
  });

  it('should throw packageVersionNotInDevHub when no Package2Version row exists but the SubscriberPackageVersion does', async () => {
    queryPackage2VersionStub.withArgs(connection, disambiguationQuery(packageVersionId2GP)).resolves([]);
    toolingQueryStub.resolves({ records: [{ Id: packageVersionId2GP }], done: true, totalSize: 1 });

    try {
      await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
      assert.fail('Expected test execution to raise an error');
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.equal(
        "Can't retrieve package metadata. Package version 04txx00000000002gp isn't accessible from this Dev Hub org. You can only retrieve package metadata from the Dev Hub that created the package version. Verify that you specified the correct target Dev Hub."
      );
    }
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
        "Can't retrieve package version metadata. The specified directory isn't empty. Empty the directory, or create a new one and try again."
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
        "Can't retrieve package version metadata. The specified directory isn't empty. Empty the directory, or create a new one and try again."
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
        "Can't retrieve package version metadata. The specified directory must be relative to your Salesforce DX project directory, and not an absolute path."
      );
    }
  });

  it('should throw the native-2GP "unretrievable dev zip" error when ZipTreeContainer is empty and ConvertedFromVersionId is unset', async () => {
    $$.SANDBOX.stub(ZipTreeContainer, 'create').rejects(new Error('data length = 0'));
    queryPackage2VersionStub
      .withArgs(connection, disambiguationQuery(packageVersionId2GP))
      .resolves([{ ...mockPackage2Version, ConvertedFromVersionId: '' }]);

    try {
      await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
      assert.fail('Expected test execution to raise an error');
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.include('native 2GP package version is unretrievable');
      expect(error.message).to.include('--generate-pkg-zip');
      expect(error.message).to.include('Then retry retrieving your package metadata');
      expect(error.message).to.not.include('converted');
    }
  });

  it('should throw the converted-2GP "unretrievable dev zip" error when ZipTreeContainer is empty and ConvertedFromVersionId is set', async () => {
    $$.SANDBOX.stub(ZipTreeContainer, 'create').rejects(new Error('data length = 0'));
    queryPackage2VersionStub
      .withArgs(connection, disambiguationQuery(packageVersionId2GP))
      .resolves([{ ...mockPackage2Version, ConvertedFromVersionId: '04txx0000004HwAAAU' }]);

    try {
      await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
      assert.fail('Expected test execution to raise an error');
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.include('converted 2GP package version is unretrievable');
      expect(error.message).to.include('retry conversion to produce a new converted package version');
      expect(error.message).to.not.include('--generate-pkg-zip');
      expect(error.message).to.not.include('native');
    }
  });

  it('should fail if the DeveloperUsePkgZip field value is empty for the user', async () => {
    // Row exists (disambiguation succeeds), but the gated URL query comes back empty: no permission.
    queryPackage2VersionStub
      .withArgs(connection, zipUrlQuery(packageVersionId2GP))
      .resolves([{ DeveloperUsePkgZip: undefined }]);

    try {
      await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
      assert.fail('Expected test execution to raise an error');
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.equal(
        "Can't retrieve package metadata. To use this feature, you must first assign yourself the DownloadPackageVersionZips user permission. Then retry retrieving your package metadata."
      );
    }
  });

  it('should fail if the DeveloperUsePkgZip column is not selectable for the user (No such column)', async () => {
    // Selecting the gated column throws "No such column"; that must still surface the perm message.
    queryPackage2VersionStub
      .withArgs(connection, zipUrlQuery(packageVersionId2GP))
      .rejects(new Error("No such column 'DeveloperUsePkgZip' on entity 'Package2Version'."));

    try {
      await Package.downloadPackageVersionMetadata(project, downloadOptions2GP, connection);
      assert.fail('Expected test execution to raise an error');
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.equal(
        "Can't retrieve package metadata. To use this feature, you must first assign yourself the DownloadPackageVersionZips user permission. Then retry retrieving your package metadata."
      );
    }
  });
});
