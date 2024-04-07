/*
 * Copyright (c) 2023, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { Connection, Logger, Messages, NamedPackageDir, PackageDirDependency, SfProject } from '@salesforce/core';
import { ComponentSet, MetadataConverter, ZipTreeContainer } from '@salesforce/source-deploy-retrieve';
import { env } from '@salesforce/kit';
import {
  PackagingSObjects,
  PackageVersionMetadataDownloadOptions,
  PackageVersionMetadataDownloadResult,
} from '../interfaces';
import { generatePackageAliasEntry, isPackageDirectoryEffectivelyEmpty } from '../utils/packageUtils';
import { createPackageDirEntry } from './packageCreate';
import { Package } from './package';
import { PackageVersion } from './packageVersion';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package');

let logger: Logger;
const getLogger = (): Logger => {
  if (!logger) {
    logger = Logger.childFromRoot('packageVersionRetrieve');
  }
  return logger;
};

/**
 * Download the metadata files for a previously published package version, convert them to source format, and put them into a new project folder within the sfdx project.
 *
 * @param project
 * @param options {@link PackageVersionMetadataDownloadOptions}
 * @param connection
 * @returns
 */
export async function retrievePackageVersionMetadata(
  project: SfProject,
  options: PackageVersionMetadataDownloadOptions,
  connection: Connection
): Promise<PackageVersionMetadataDownloadResult> {
  // Validate the destination path is suitable to extract package version metadata (must be new or empty)
  const destinationFolder = options.destinationFolder ?? 'force-app';

  if (path.isAbsolute(destinationFolder)) {
    throw messages.createError('sourcesDownloadDirectoryMustBeRelative');
  }

  const destinationPath = path.join(project.getPath(), destinationFolder);
  if (!fs.existsSync(destinationPath)) {
    fs.mkdirSync(destinationPath, { recursive: true });
  }
  if (!isPackageDirectoryEffectivelyEmpty(destinationPath)) {
    throw messages.createError('sourcesDownloadDirectoryNotEmpty');
  }

  // Get the MetadataZip URL from the MetadataPackageVersion record
  const subscriberPackageVersionId =
    project.getPackageIdFromAlias(options.subscriberPackageVersionId) ?? options.subscriberPackageVersionId;
  const versionInfo: PackagingSObjects.MetadataPackageVersion = (await connection.tooling
    .sobject('MetadataPackageVersion')
    .retrieve(subscriberPackageVersionId)) as PackagingSObjects.MetadataPackageVersion;

  if (!versionInfo.MetadataZip) {
    throw messages.createError('unableToAccessMetadataZip');
  }

  const responseBase64 = await connection.tooling.request<string>(versionInfo.MetadataZip, {
    encoding: 'base64',
  });
  const buffer = Buffer.from(responseBase64, 'base64');

  let tree = await ZipTreeContainer.create(buffer);
  let dependencies: string[] = [];

  // 2GP packages declare their dependencies in dependency-ids.json within the outer zip.
  if (tree.exists('dependency-ids.json')) {
    type DependencyIds = {
      ids: string[];
    }
    const f = await tree.readFile('dependency-ids.json');
    const idsObj: DependencyIds = JSON.parse(f.toString()) as DependencyIds;
    if (idsObj?.ids) {
      dependencies = idsObj.ids;
    }
  }

  // 2GP packages have the package.zip wrapped in an outer zip.
  if (tree.exists('package.zip')) {
    tree = await ZipTreeContainer.create(await tree.readFile('package.zip'));
  }

  const zipComponents = ComponentSet.fromSource({
    fsPaths: ['.'],
    tree,
  })
    .getSourceComponents()
    .toArray();

  const result = await new MetadataConverter().convert(zipComponents, 'source', {
    type: 'directory',
    outputDirectory: destinationPath,
    genUniqueDir: false,
  });

  await attemptToUpdateProjectJson(
    project,
    connection,
    versionInfo.MetadataPackageId,
    subscriberPackageVersionId,
    dependencies,
    destinationFolder
  );

  return result;
}

/**
 * Attempt to update the sfdx-project.json file to add information about the retrieved sources. If this fails for some reason we
 * print out an error message and return so the user will still see a list of retrieved metadata.
 *
 */
async function attemptToUpdateProjectJson(
  project: SfProject,
  connection: Connection,
  packageId: string,
  subscriberPackageVersionId: string,
  dependencyIds: string[],
  destinationFolder: string
): Promise<void> {
  if (env.getBoolean('SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_RETRIEVE')) {
    getLogger().info(
      'Skipping sfdx-project.json updates because SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_RETRIEVE is set'
    );
    return;
  }
  try {
    const packageInfo: PackagingSObjects.MetadataPackage = (await connection.tooling
      .sobject('MetadataPackage')
      .retrieve(packageId)) as PackagingSObjects.MetadataPackage;

    if (packageInfo.PackageCategory !== 'Package2') {
      getLogger().info(
        `Skipping sfdx-project.json updates because ${packageId} is not a 2GP package. It has a PackageCategory of '${packageInfo.PackageCategory}'`
      );
      return;
    }

    const queryOptions = {
      whereClause: `WHERE SubscriberPackageVersionId = '${subscriberPackageVersionId}'`,
    };

    const versions = await PackageVersion.queryPackage2Version(connection, queryOptions);

    if (versions.length && versions[0]) {
      const version = versions[0];
      const pkg = new Package({
        packageAliasOrId: version.Package2Id,
        project,
        connection,
      });

      const pkgData = await pkg.getPackageData();
      if (pkgData) {
        const dirEntry = createPackageDirEntry(project, {
          name: pkgData.Name,
          description: pkgData.Description,
          path: destinationFolder,
          noNamespace: pkgData.NamespacePrefix != null,
          orgDependent: pkgData.IsOrgDependent,
          packageType: pkgData.ContainerOptions,
          errorNotificationUsername: pkgData.PackageErrorUsername,
        });

        const dependencies: PackageDirDependency[] = dependencyIds.map(
          (dep) => ({ package: dep } as PackageDirDependency)
        );

        const namedDir = {
          ...dirEntry,
          versionNumber: '<set version number>',
          versionName: '<set version name>',
          ancestorVersion: '<set ancestor version>',
          dependencies,
        } as NamedPackageDir;

        project.getSfProjectJson().addPackageDirectory(namedDir);

        const packageVersionVersionString = `${version.MajorVersion}.${version.MinorVersion}.${version.PatchVersion}-${version.BuildNumber}`;
        const [alias, writtenId] = await generatePackageAliasEntry(
          connection,
          project,
          subscriberPackageVersionId,
          packageVersionVersionString,
          'main',
          pkg.getId()
        );

        project.getSfProjectJson().addPackageAlias(alias, writtenId);
        if (pkgData.ContainerOptions === 'Managed' && !project.getSfProjectJson().get('namespace')) {
          project.getSfProjectJson().set('namespace', pkgData.NamespacePrefix);
        }

        await project.getSfProjectJson().write();
      } else {
        getLogger().warn(
          `Failed to update sfdx-project.json. Could not find package for ${version.Package2Id}. This should never happen.`
        );
      }
    } else {
      getLogger().info(
        `Could not find Package2Version record for ${subscriberPackageVersionId}. No updates to sfdx-project.json will be made.`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : e;
    getLogger().error(
      `Encountered error trying to update sfdx-project.json after retrieving package version metadata: ${msg as string}`
    );
  }
}
