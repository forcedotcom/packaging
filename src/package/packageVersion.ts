/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import {
  Connection,
  Lifecycle,
  Messages,
  NamedPackageDir,
  PollingClient,
  SfProject,
  StatusResult,
} from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import {
  PackageSaveResult,
  PackageVersionCreateOptions,
  PackageVersionCreateRequestResult,
  PackageVersionListResult,
  PackageVersionOptions,
  PackageVersionQueryOptions,
  PackageVersionReportResult,
  PackagingSObjects,
} from '../interfaces';
import * as pkgUtils from '../utils';
import { PackageVersionCreate } from './packageVersionCreate';
import { getPackageVersionReport } from './packageVersionReport';
import { getCreatePackageVersionCreateRequestReport } from './packageVersionCreateRequestReport';
import { Package } from './package';
import { listPackageVersions } from './packageVersionList';

Messages.importMessagesDirectory(__dirname);

export class PackageVersion {
  private readonly project: SfProject;
  private readonly connection: Connection;

  public constructor(private options: PackageVersionOptions) {
    this.connection = this.options.connection;
    this.project = this.options.project;
  }

  /**
   * Creates a new package version.
   *
   * @param options
   */
  public async create(options: PackageVersionCreateOptions): Promise<Partial<PackageVersionCreateRequestResult>> {
    const pvc = new PackageVersionCreate({ ...options, ...this.options });
    const createResult = await pvc.createPackageVersion();
    return await this.waitForCreateVersion(
      createResult.Package2Id,
      createResult.Id,
      options.wait ?? Duration.milliseconds(0),
      options.pollInterval ? options.pollInterval : Duration.seconds(30)
    ).catch((err: Error) => {
      // TODO
      // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      throw pkgUtils.applyErrorAction(err);
    });
  }

  /**
   * Deletes a package version.
   *
   * @param idOrAlias
   */
  public async delete(idOrAlias: string): Promise<PackageSaveResult> {
    return this.updateDeprecation(idOrAlias, true);
  }

  /**
   * Undeletes a package version.
   *
   * @param idOrAlias
   */
  public async undelete(idOrAlias: string): Promise<PackageSaveResult> {
    return this.updateDeprecation(idOrAlias, false);
  }

  /**
   * Gets the package version report.
   *
   * @param createPackageRequestId
   * @param verbose
   */
  public async report(createPackageRequestId: string, verbose = false): Promise<PackageVersionReportResult> {
    const results = await getPackageVersionReport({
      idOrAlias: createPackageRequestId,
      connection: this.connection,
      project: this.project,
      verbose,
    }).catch((err: Error) => {
      // TODO
      // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      throw pkgUtils.applyErrorAction(err);
    });
    return results[0];
  }

  /**
   * Gets current state of a package version create request.
   *
   * @param createPackageRequestId
   */
  public async getCreateVersionReport(createPackageRequestId: string): Promise<PackageVersionCreateRequestResult> {
    return await getCreatePackageVersionCreateRequestReport({
      createPackageVersionRequestId: createPackageRequestId,
      connection: this.connection,
    }).catch((err: Error) => {
      // TODO
      // until package2 is GA, wrap perm-based errors w/ 'contact sfdc' action (REMOVE once package2 is GA'd)
      throw pkgUtils.applyErrorAction(err);
    });
  }

  /**
   * Convenience function that will wait for a package version to be created.
   *
   * This function emits LifeCycle events, "enqueued", "in-progress", "success", "error" and "timed-out" to
   * progress and current status. Events also carry a payload of type PackageVersionCreateRequestResult.
   *
   * @param createPackageVersionRequestId
   * @param wait - how long to wait for the package version to be created
   * @param interval - frequency of checking for the package version to be created
   */
  public async waitForCreateVersion(
    packageId: string,
    createPackageVersionRequestId: string,
    wait: Duration = Duration.milliseconds(0),
    interval: Duration = Duration.milliseconds(0)
  ): Promise<PackageVersionCreateRequestResult> {
    if (wait?.milliseconds <= 0) {
      return await this.getCreateVersionReport(createPackageVersionRequestId);
    }
    const resolvedWait = await this.resolveOrgDependentPollingTime(packageId, wait, interval);
    let remainingWaitTime: Duration = wait;
    let report: PackageVersionCreateRequestResult;
    const pollingClient = await PollingClient.create({
      poll: async (): Promise<StatusResult> => {
        report = await this.getCreateVersionReport(createPackageVersionRequestId);
        switch (report.Status) {
          case 'Queued':
            await Lifecycle.getInstance().emit('enqueued', { ...report, remainingWaitTime });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - interval.seconds);
            return {
              completed: false,
              payload: report,
            };
          case 'InProgress':
          case 'Initializing':
          case 'VerifyingFeaturesAndSettings':
          case 'VerifyingDependencies':
          case 'VerifyingMetadata':
          case 'FinalizingPackageVersion':
            await Lifecycle.getInstance().emit('in-progress', { ...report, remainingWaitTime });
            remainingWaitTime = Duration.seconds(remainingWaitTime.seconds - interval.seconds);
            return {
              completed: false,
              payload: report,
            };
          case 'Success':
            await this.updateProjectWithPackageVersion(this.project, report);
            await Lifecycle.getInstance().emit('success', report);
            return { completed: true, payload: report };
          case 'Error':
            await Lifecycle.getInstance().emit('error', report);
            return { completed: true, payload: report };
        }
      },
      frequency: interval,
      timeout: resolvedWait,
    });
    try {
      return pollingClient.subscribe<PackageVersionCreateRequestResult>();
    } catch (err) {
      await Lifecycle.getInstance().emit('timed-out', report);
      throw pkgUtils.applyErrorAction(err as Error);
    }
  }

  public convert(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public install(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public async list(options: PackageVersionQueryOptions): Promise<PackageVersionListResult[]> {
    return (await listPackageVersions(options)).records;
  }

  public uninstall(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public update(): Promise<void> {
    return Promise.resolve(undefined);
  }

  private async updateDeprecation(idOrAlias: string, IsDeprecated): Promise<PackageSaveResult> {
    const packageVersionId = pkgUtils.getPackageIdFromAlias(idOrAlias, this.project);

    // ID can be an 04t or 05i
    pkgUtils.validateId(
      [pkgUtils.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, pkgUtils.BY_LABEL.PACKAGE_VERSION_ID],
      packageVersionId
    );

    // lookup the 05i ID, if needed
    const packageId = await pkgUtils.getPackageVersionId(packageVersionId, this.connection);

    // setup the request
    const request: { Id: string; IsDeprecated: boolean } = {
      Id: packageId,
      IsDeprecated,
    };

    const updateResult = await this.connection.tooling.update('Package2Version', request);
    if (!updateResult.success) {
      throw pkgUtils.combineSaveErrors('Package2', 'update', updateResult.errors);
    }
    updateResult.id = await pkgUtils.getSubscriberPackageVersionId(packageVersionId, this.connection);
    return updateResult;
  }

  /**
   * Increase the wait time for a package version that is org dependent.
   *
   * @param resolvedPackageId
   * @param pollInterval
   * @param wait
   * @private
   */
  private async resolveOrgDependentPollingTime(
    resolvedPackageId: string,
    wait: Duration,
    pollInterval: Duration
  ): Promise<Duration> {
    // If we are polling check to see if the package is Org-Dependent, if so, update the poll time
    if (wait.milliseconds > 0) {
      const query = `SELECT IsOrgDependent FROM Package2 WHERE Id = '${resolvedPackageId}'`;
      try {
        const pkgQueryResult = await this.connection.singleRecordQuery<PackagingSObjects.Package2>(query, {
          tooling: true,
        });
        if (pkgQueryResult.IsOrgDependent) {
          return Duration.seconds((60 / pollInterval.seconds) * wait.seconds);
        }
      } catch {
        // do nothing
      }
    }
    return wait;
  }

  private async updateProjectWithPackageVersion(
    withProject: SfProject,
    results: PackageVersionCreateRequestResult
  ): Promise<void> {
    if (withProject && !process.env.SFDX_PROJECT_AUTOUPDATE_DISABLE_FOR_PACKAGE_VERSION_CREATE) {
      const query = `SELECT Name, Package2Id, MajorVersion, MinorVersion, PatchVersion, BuildNumber, Description, Branch FROM Package2Version WHERE Id = '${results.Package2VersionId}'`;
      const packageVersion = await this.connection.singleRecordQuery<PackagingSObjects.Package2Version>(query, {
        tooling: true,
      });
      const packageVersionVersionString = `${packageVersion.MajorVersion}.${packageVersion.MinorVersion}.${packageVersion.PatchVersion}.${packageVersion.BuildNumber}`;
      await this.generatePackageDirectory(packageVersion, withProject, packageVersionVersionString);
      const newConfig = await pkgUtils.generatePackageAliasEntry(
        this.connection,
        withProject,
        packageVersion.SubscriberPackageVersionId,
        packageVersionVersionString,
        packageVersion.Branch,
        packageVersion.Package2Id
      );
      withProject.getSfProjectJson().set('packageAliases', newConfig);
      await withProject.getSfProjectJson().write();
    }
  }

  private async generatePackageDirectory(
    packageVersion: PackagingSObjects.Package2Version,
    withProject: SfProject,
    packageVersionVersionString: string
  ) {
    const pkg = await (await Package.create({ connection: this.connection })).getPackage(packageVersion.Package2Id);
    const pkgDir =
      pkgUtils.getConfigPackageDirectory(withProject.getPackageDirectories(), 'id', pkg.Id) ?? ({} as NamedPackageDir);
    pkgDir.versionNumber = packageVersionVersionString;
    pkgDir.versionDescription = packageVersion.Description;
    const packageDirs = withProject.getPackageDirectories().map((pd) => (pkgDir['id'] === pd['id'] ? pkgDir : pd));
    withProject.getSfProjectJson().set('packageDirectories', packageDirs);
  }
}
