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
import { Connection, SfProject, SfError } from '@salesforce/core';
import { Package } from '../../src/package/package';

describe('Package Version Metadata Retrieve', () => {
  const $$ = instantiateContext();
  const testOrg = new MockTestOrgData();
  const packageName = 'TESTPACKAGE';
  const packageVersionId = '04txx0000004HjmAAE';
  const destinationFolder = 'downloaded-metadata';
  const metadataZipURL = `/services/data/v59.0/tooling/sobjects/MetadataPackageVersion/${packageVersionId}/MetadataZip`;
  const zipBytesBase64 = fs.readFileSync('test/data/package.zip').toString('base64');
  const downloadOptions = {
    allPackageVersionId: packageVersionId,
    destinationFolder,
  };

  let project: SfProject;
  let connection: Connection;
  let packageVersionRetrieveStub: sinon.SinonStub;

  beforeEach(async () => {
    $$.inProject(true);
    project = SfProject.getInstance();
    await project.getSfProjectJson().write({
      packageDirectories: [
        {
          path: 'force-app',
          package: packageName,
          versionName: 'ver 0.1',
          versionNumber: '0.1.0.NEXT',
          default: true,
        },
      ],
    });
    stubContext($$);
    await $$.stubAuths(testOrg);
    connection = await testOrg.getConnection();

    $$.SANDBOX.stub(connection.tooling, 'request').resolves(zipBytesBase64);
    packageVersionRetrieveStub = $$.SANDBOX.stub(connection.tooling, 'retrieve').resolves({
      Id: packageVersionId,
      MetadataZip: metadataZipURL,
    });
  });

  afterEach(async () => {
    restoreContext($$);
    const pathToClean = path.join(project.getPath(), destinationFolder);
    if (fs.existsSync(pathToClean)) {
      await fs.promises.rm(pathToClean, { recursive: true });
    }
    // @ts-ignore
    project.packageDirectories = undefined;
  });

  it('should succeed for a valid package version when the destination dir is nonexistent', async () => {
    const result = await Package.downloadPackageVersionMetadata(project, downloadOptions, connection);
    expect(result.converted).to.not.be.undefined;
    expect(result.converted?.length).to.equal(4);
  });

  it('should succeed for a valid package version when the destination dir is present but empty', async () => {
    fs.mkdirSync(path.join(project.getPath(), destinationFolder), { recursive: true });
    const result = await Package.downloadPackageVersionMetadata(project, downloadOptions, connection);
    expect(result.converted).to.not.be.undefined;
    expect(result.converted?.length).to.equal(4);
  });

  it('should fail if the destination directory is not empty', async () => {
    const directoryToCreate = path.join(project.getPath(), destinationFolder);
    fs.mkdirSync(directoryToCreate, { recursive: true });
    const testFilePath = path.join(directoryToCreate, 'test.txt');
    fs.writeFileSync(testFilePath, 'Some content to make this directory not empty');
    try {
      await Package.downloadPackageVersionMetadata(project, downloadOptions, connection);
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.equal(
        'Can’t retrieve package version metadata. The specified directory isn’t empty. Empty the directory, or create a new one and then retry this command.'
      );
    }
  });

  it('should fail if the MetadataZip field is inaccessible to the user', async () => {
    packageVersionRetrieveStub.resolves({
      Id: packageVersionId,
    });
    try {
      await Package.downloadPackageVersionMetadata(project, downloadOptions, connection);
    } catch (e) {
      const error = e as SfError;
      expect(error.message).to.equal(
        // eslint-disable-next-line @typescript-eslint/quotes
        'Can’t retrieve package version metadata. Ensure that you’re using API version 59.0 or higher, and that you have the user permissions needed to access fields on the MetadataPackageVersion object.\nThen retry this command.'
      );
    }
  });
});
