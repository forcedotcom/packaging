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
import { Connection, Logger, Messages, SfProject } from '@salesforce/core';
import { ComponentSet, MetadataConverter, ZipTreeContainer } from '@salesforce/source-deploy-retrieve';
import { env } from '@salesforce/kit';
import { PackageDir } from '@salesforce/schemas';
import { PackageVersionMetadataDownloadOptions, PackageVersionMetadataDownloadResult } from '../interfaces';
import { generatePackageAliasEntry, isPackageDirectoryEffectivelyEmpty } from '../utils/packageUtils';
import { createPackageDirEntry } from './packageCreate';
import { Package } from './package';
import { PackageVersion } from './packageVersion';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package');

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

  // Get the DeveloperUsePkgZip URL from the Package2Version record
  const subscriberPackageVersionId =
    project.getPackageIdFromAlias(options.subscriberPackageVersionId) ?? options.subscriberPackageVersionId;

  // Query Package2Version to get the record by SubscriberPackageVersionId
  const queryOptions = {
    whereClause: `WHERE SubscriberPackageVersionId = '${subscriberPackageVersionId}'`,
  };
  let versionInfo;
  try {
    [versionInfo] = await PackageVersion.queryPackage2Version(connection, queryOptions);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("No such column 'DeveloperUsePkgZip' on entity 'Package2Version'")) {
      throw messages.createError('developerUsePkgZipFieldUnavailable');
    }
    if (msg.includes("sObject type 'Package2Version' is not supported.")) {
      throw messages.createError('packagingNotEnabledOnOrg');
    }
    throw e;
  }

  if (!versionInfo?.DeveloperUsePkgZip) {
    throw messages.createError('developerUsePkgZipFieldUnavailable');
  }

  const responseBase64 = await connection.tooling.request<string>(versionInfo.DeveloperUsePkgZip, {
    encoding: 'base64',
  });
  const buffer = Buffer.from(responseBase64, 'base64');

  let tree;
  try {
    tree = await ZipTreeContainer.create(buffer);
  } catch (e) {
    if (e instanceof Error && e.message.includes('data length = 0')) {
      throw messages.createError('downloadDeveloperPackageZipHasNoData');
    }
    throw e;
  }

  let dependencies: string[] = [];

  // 2GP packages declare their dependencies in dependency-ids.json within the outer zip.
  if (tree.exists('dependency-ids.json')) {
    const f = await tree.readFile('dependency-ids.json');
    const idsObj = JSON.parse(f.toString()) as {
      ids: string[];
    };
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
    versionInfo.Package2Id,
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
  const logger = Logger.childFromRoot('packageVersionRetrieve');
  if (env.getBoolean('SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_RETRIEVE')) {
    logger.info(
      'Skipping sfdx-project.json updates because SF_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_RETRIEVE is set'
    );
    return;
  }
  try {
    const queryOptions = {
      whereClause: `WHERE SubscriberPackageVersionId = '${subscriberPackageVersionId}'`,
    };

    const [version] = await PackageVersion.queryPackage2Version(connection, queryOptions);

    if (version) {
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

        const namedDir: PackageDir = {
          ...dirEntry,
          versionNumber: '<set version number>',
          versionName: '<set version name>',
          ancestorVersion: '<set ancestor version>',
          dependencies: dependencyIds.map((dep) => ({ package: dep })),
        };

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
        logger.warn(
          `Failed to update sfdx-project.json. Could not find package for ${version.Package2Id}. This should never happen.`
        );
      }
    } else {
      logger.info(
        `Could not find Package2Version record for ${subscriberPackageVersionId}. No updates to sfdx-project.json will be made.`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : e;
    logger.error(
      `Encountered error trying to update sfdx-project.json after retrieving package version metadata: ${msg as string}`
    );
  }
}
