/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as os from 'os';
import * as path from 'path';
import { expect } from 'chai';
import { readJSON } from 'fs-extra';

import { TestSession, execCmd } from '@salesforce/cli-plugins-testkit';
import { Duration, sleep } from '@salesforce/kit';
import { ProjectJson } from '@salesforce/core/lib/sfProject';
import { Lifecycle, Org, SfProject } from '@salesforce/core';
import { uniqid } from '@salesforce/core/lib/testSetup';
import {
  PackageCreateOptions,
  PackageVersionCreateReportProgress,
  PackageVersionCreateRequestResultInProgressStatuses,
  AncestryRepresentationProducer,
  AncestryRepresentationProducerOptions,
  PackagingSObjects,
  createPackage,
  uninstallPackage,
  packageInstalledList,
  deletePackage,
  Package,
  PackageVersion,
  AncestryJsonProducer,
  PackageAncestry,
  AncestryTreeProducer,
  VersionNumber,
  PackageVersionEvents,
} from '../../src/exported';

let session: TestSession;

const VERSION_CREATE_RESPONSE_KEYS = [
  'Id',
  'Status',
  'Package2Id',
  'Package2VersionId',
  'SubscriberPackageVersionId',
  'Tag',
  'Branch',
  'Error',
  'CreatedDate',
  'HasMetadataRemoved',
  'CreatedBy',
];

// version
const TAG = 'Release 1.0.0';
const BRANCH = 'main';

// prefixes
const PKG2_ID_PREFIX = '0Ho';
const SUBSCRIBER_PKG_VERSION_UNINSTALL_ID_PREFIX = '06y';
const PKG2_VERSION_CREATE_REQUEST_ID_PREFIX = '08c';

const SUB_ORG_ALIAS = 'pk2TargetOrg';
const WAIT_INTERVAL_MS = 8000;
const INSTALLATION_KEY = '123456';

describe('Integration tests for @salesforce/packaging library', function () {
  let pkgId = ''; // 0Ho
  let pkgCreateVersionRequestId = ''; // 08c
  let subscriberPkgVersionId = ''; // 04t
  let installReqId = '';
  let uninstallReqId = ''; // 06y
  let pkgName = '';
  let devHubOrg: Org;
  let scratchOrg: Org;
  let project: SfProject;
  before('pkgSetup', async () => {
    process.env.TESTKIT_EXECUTABLE_PATH = 'sfdx';
    execCmd('config:set restDeploy=false', { cli: 'sfdx' });

    // will auth the hub
    session = await TestSession.create({
      project: {
        sourceDir: path.join('test', 'package', 'resources', 'packageProject'),
      },
      devhubAuthStrategy: 'AUTO',
      scratchOrgs: [
        {
          executable: 'sfdx',
          duration: 1,
          alias: SUB_ORG_ALIAS,
          config: path.join('config', 'project-scratch-def.json'),
        },
      ],
    });
    pkgName = uniqid({ template: 'pnh-dancingbears-', length: 16 });
    devHubOrg = await Org.create({ aliasOrUsername: session.hubOrg.username });
    scratchOrg = await Org.create({ aliasOrUsername: SUB_ORG_ALIAS });
    project = await SfProject.resolve();
  });

  after(async () => {
    await session?.zip();
    await session?.clean();
  });

  describe('create package/package version, report on pvc, update package/promote package', () => {
    it('package create', async () => {
      const options: PackageCreateOptions = {
        name: pkgName,
        packageType: 'Unlocked',
        path: 'force-app',
        description: "Don't ease, don't ease, don't ease me in.",
        noNamespace: undefined,
        orgDependent: false,
        errorNotificationUsername: undefined,
      };
      const result = await createPackage(devHubOrg.getConnection(), project, options);

      pkgId = result.Id;
      expect(pkgId).to.be.ok;
      expect(pkgId).to.match(new RegExp(PKG2_ID_PREFIX));

      // verify update to project.json packageDiretory using fs
      const projectFile = (await readJSON(path.join(session.project.dir, 'sfdx-project.json'))) as ProjectJson;
      expect(projectFile).to.have.property('packageDirectories').with.length(1);
      expect(projectFile.packageDirectories[0]).to.include.keys(['package', 'versionName', 'versionNumber']);
      expect(projectFile.packageDirectories[0].package).to.equal(pkgName);
      expect(projectFile.packageAliases).to.deep.equal({
        [pkgName]: pkgId,
      });
    });

    it('package version create', async () => {
      const result = await PackageVersion.create({
        connection: devHubOrg.getConnection(),
        project,
        packageId: pkgId,
        tag: TAG,
        codecoverage: true,
        branch: BRANCH,
        installationkey: INSTALLATION_KEY,
        installationkeybypass: true,
        definitionfile: path.join(session.project.dir, 'config', 'project-scratch-def.json'),
        versiondescription: 'This is a test',
        validateschema: true,
      });
      expect(result.Id).to.match(
        new RegExp(PKG2_VERSION_CREATE_REQUEST_ID_PREFIX),
        `\n${JSON.stringify(result, undefined, 2)}`
      );
      pkgCreateVersionRequestId = result.Id;
      pkgId = result.Package2Id;
    });

    it('get package version create status', async () => {
      const result = await PackageVersion.getCreateStatus(pkgCreateVersionRequestId, devHubOrg.getConnection());
      expect(result).to.include.keys(VERSION_CREATE_RESPONSE_KEYS);

      if (result.Status === 'Error') {
        throw new Error(`pv.getCreateVersionReport failed with status Error: ${result.Error.join(';')}`);
      }
    });

    it('poll for package version create to finish', async () => {
      // "enqueued", "in-progress", "success", "error" and "timed-out"
      Lifecycle.getInstance().on(
        PackageVersionEvents.create.enqueued,
        async (results: PackageVersionCreateReportProgress) => {
          expect(results.Status).to.equal(PackagingSObjects.Package2VersionStatus.queued);
        }
      );
      Lifecycle.getInstance().on(
        PackageVersionEvents.create.progress,
        async (results: PackageVersionCreateReportProgress) => {
          // eslint-disable-next-line no-console
          console.log(`in-progress: ${JSON.stringify(results, undefined, 2)}`);
          expect(PackageVersionCreateRequestResultInProgressStatuses).to.include(results.Status);
        }
      );
      Lifecycle.getInstance().on(
        PackageVersionEvents.create.success,
        async (results: PackageVersionCreateReportProgress) => {
          expect(results.Status).to.equal(PackagingSObjects.Package2VersionStatus.success);
        }
      );
      const result = await PackageVersion.pollCreateStatus(
        pkgCreateVersionRequestId,
        devHubOrg.getConnection(),
        project,
        { frequency: Duration.seconds(30), timeout: Duration.minutes(20) }
      );
      expect(result).to.include.keys(VERSION_CREATE_RESPONSE_KEYS);

      subscriberPkgVersionId = result.SubscriberPackageVersionId;

      if (result.Status === 'Error') {
        throw new Error(`pv.waitForCreateVersion failed with status Error: ${result.Error.join(';')}`);
      }
    });

    it('verifies packageversionrequest is in hubforce via package:version:create:list', () => {
      const result = execCmd<[{ Status: string; Id: string }]>('force:package:version:create:list --json').jsonOutput
        .result;

      expect(result).to.have.length.at.least(1);
      result.map((item) => expect(item).to.have.all.keys(VERSION_CREATE_RESPONSE_KEYS));
      expect(
        result.filter((item) => item.Id === pkgCreateVersionRequestId),
        `Did not find Package2CreateVersionRequestId '${pkgCreateVersionRequestId}' in 'force:package:version:create:list' result`
      ).to.have.length(1);
    });

    it('package version report', async () => {
      const pv = new PackageVersion({
        project,
        connection: devHubOrg.getConnection(),
        idOrAlias: subscriberPkgVersionId,
      });
      const result = await pv.report();

      expect(result).to.not.have.property('Id');
      expect(result.Package2Id).to.equal(
        pkgId,
        `Package Version Report Package Id mismatch: expected '${pkgId}', got '${result.Package2Id}'`
      );
      expect(result.SubscriberPackageVersionId).to.equal(
        subscriberPkgVersionId,
        `Package Version Report Subscriber Package Version Id mismatch: expected '${subscriberPkgVersionId}', got '${result.SubscriberPackageVersionId}'`
      );

      // TODO: PVC command writes new version to sfdx-project.json
      const projectFile = (await readJSON(path.join(session.project.dir, 'sfdx-project.json'))) as ProjectJson;

      // eslint-disable-next-line no-console
      console.log(`projectFile: ${JSON.stringify(projectFile, undefined, 2)}`);

      expect(result.Description).to.equal(
        projectFile.packageDirectories[0].versionDescription,
        `'force:package:version:report' Description mismatch: expected '${projectFile.packageDirectories[0].versionDescription}', got '${result.Description}'`
      );

      expect(result.Name).to.equal(
        projectFile.packageDirectories[0].versionName,
        `'force:package:version:report' Name mismatch: expected '${projectFile.packageDirectories[0].versionName}', got '${result.Name}'`
      );

      const version = projectFile.packageDirectories[0].versionNumber.replace('NEXT', '1');
      expect(result.Version).to.equal(
        version,
        `'force:package:version:report' Version mismatch: expected '${version}', got '${result.Version}'`
      );

      expect(result.IsReleased, 'Expected IsReleased to be false').to.be.false;
      expect(Object.values(projectFile.packageAliases).some((id) => id === subscriberPkgVersionId)).to.be.true;
    });

    it('will update the package version with a new branch', async () => {
      const pv = new PackageVersion({
        project,
        connection: devHubOrg.getConnection(),
        idOrAlias: subscriberPkgVersionId,
      });
      const result = await pv.update({ Branch: 'superFunBranch' });
      expect(result).to.include.keys('id', 'success', 'errors');
      expect(result.id.startsWith('04t')).to.be.true;
      expect(result.success).to.be.true;
      expect(result.errors).to.deep.equal([]);
    });

    it('will promote the package version', async () => {
      const pv = new PackageVersion({
        project,
        connection: devHubOrg.getConnection(),
        idOrAlias: subscriberPkgVersionId,
      });
      const result = await pv.promote();
      expect(result).to.have.all.keys('id', 'success', 'errors');
    });

    it('will update the package', async () => {
      const pkg = new Package({ connection: devHubOrg.getConnection() });
      const result = await pkg.update({ Id: pkgId, Description: 'new package description' });
      expect(result).to.have.all.keys('id', 'success', 'errors');
      expect(result.id.startsWith('0Ho')).to.be.true;
      expect(result.success).to.be.true;
      expect(result.errors).to.deep.equal([]);
    });

    it('will list all of the created package versions', async () => {
      const result = await PackageVersion.createdList(devHubOrg.getConnection());
      expect(result).to.have.length.at.least(1);
      expect(result[0]).to.have.all.keys(
        'Id',
        'Status',
        'Package2Id',
        'Package2VersionId',
        'SubscriberPackageVersionId',
        'Tag',
        'Branch',
        'Error',
        'CreatedDate',
        'HasMetadataRemoved',
        'CreatedBy'
      );
      expect(result[0].Id.startsWith('08c')).to.be.true;
      expect(result[0].Package2Id.startsWith('0Ho')).to.be.true;
      expect(result[0].Package2VersionId.startsWith('05i')).to.be.true;
      expect(result[0].SubscriberPackageVersionId.startsWith('04t')).to.be.true;
    });

    it('will list all of the created package versions (status = error)', async () => {
      const result = await PackageVersion.createdList(devHubOrg.getConnection(), { status: 'Success' });
      result.map((res) => {
        // we should've filtered to only successful package versions1
        expect(res.Status).to.equal('Success');
      });
    });

    it('will list all of the created package versions (createdLastDays = 3)', async () => {
      const result = await PackageVersion.createdList(devHubOrg.getConnection(), { createdlastdays: 3 });
      expect(result).to.have.length.at.least(1);
      expect(result[0]).to.have.all.keys(
        'Id',
        'Status',
        'Package2Id',
        'Package2VersionId',
        'SubscriberPackageVersionId',
        'Tag',
        'Branch',
        'Error',
        'CreatedDate',
        'HasMetadataRemoved',
        'CreatedBy'
      );
      const createdDate = new Date(result[0].CreatedDate);
      const currentDate = new Date();
      expect(currentDate > createdDate).to.be.true;
      // this package should've been made within the last 3 days
      expect(currentDate.getTime()).to.be.greaterThan(
        currentDate.getTime() - Duration.days(3).milliseconds,
        `Package was not created within the last 3 days, CreatedDate: ${result[0].CreatedDate}`
      );
    });
  });

  describe('install the package in scratch org', () => {
    it('install package async', async () => {
      const pkg = new Package({ connection: scratchOrg.getConnection() });
      await pkg.waitForPublish(subscriberPkgVersionId, 10, INSTALLATION_KEY);
      const result = await pkg.install({
        SubscriberPackageVersionKey: subscriberPkgVersionId,
        Password: INSTALLATION_KEY,
      });
      expect(result).to.have.property('Status', 'IN_PROGRESS');
      expect(result).to.have.property('Errors', null);
      expect(result).to.have.property('SubscriberPackageVersionKey', subscriberPkgVersionId);
      expect(result).to.have.property('Id');

      installReqId = result.Id;
    });

    it('getInstallStatus until it finishes', async () => {
      const waitForInstallRequestAndValidate = async (counter = 1): Promise<{ Status: string }> => {
        const pkg = new Package({ connection: scratchOrg.getConnection() });
        const pollResult = await pkg.getInstallStatus(installReqId);

        expect(pollResult).to.have.property('Status');
        expect(pollResult).to.have.property('Id', installReqId);
        expect(pollResult).to.have.property('Errors', null);
        expect(pollResult).to.have.property('SubscriberPackageVersionKey', subscriberPkgVersionId);

        if (pollResult.Status === 'IN_PROGRESS' && counter < 80) {
          return sleep(WAIT_INTERVAL_MS, Duration.Unit.MILLISECONDS).then(() =>
            waitForInstallRequestAndValidate(counter++)
          );
        } else {
          // break out of recursion, validate pollResult
          expect(
            pollResult.Status,
            `Checked InstallRequest ${counter} time(s) with interval of ${WAIT_INTERVAL_MS} ms and failed test with Status=${pollResult.Status}`
          ).to.equal('SUCCESS');
          return pollResult;
        }
      };
      const result = await waitForInstallRequestAndValidate();
      expect(result.Status).to.equal('SUCCESS');
    });

    it('packageInstalledList returns the correct information', async () => {
      const connection = scratchOrg.getConnection();
      const result = await packageInstalledList(connection);
      const foundRecord = result.filter((item) => item.SubscriberPackageVersion.Id === subscriberPkgVersionId);

      expect(result).to.have.length.at.least(1);
      expect(foundRecord, `Did not find SubscriberPackageVersionId ${subscriberPkgVersionId}`).to.have.length(1);
      expect(foundRecord[0]).to.have.property('Id');
      expect(foundRecord[0]).to.have.property('SubscriberPackageId');
      expect(foundRecord[0].SubscriberPackage).to.have.property('Name');
      expect(foundRecord[0].SubscriberPackage).to.have.property('NamespacePrefix');
      expect(foundRecord[0].SubscriberPackageVersion).to.have.property('Id');
      expect(foundRecord[0].SubscriberPackageVersion).to.have.property('Name');
      expect(foundRecord[0].SubscriberPackageVersion).to.have.property('MajorVersion');
      expect(foundRecord[0].SubscriberPackageVersion).to.have.property('MinorVersion');
      expect(foundRecord[0].SubscriberPackageVersion).to.have.property('PatchVersion');
      expect(foundRecord[0].SubscriberPackageVersion).to.have.property('BuildNumber');
    });
  });

  describe('uninstall the package', () => {
    it('uninstallPackage', async () => {
      const conn = scratchOrg.getConnection();
      const result = await uninstallPackage(subscriberPkgVersionId, conn);

      expect(result).to.include.keys(['Status', 'Id', 'SubscriberPackageVersionId']);
      uninstallReqId = result.Id;
      expect(uninstallReqId).to.match(new RegExp(SUBSCRIBER_PKG_VERSION_UNINSTALL_ID_PREFIX));

      // sometimes uninstall is pretty fast!
      expect(['InProgress', 'Success'].includes(result.Status));
      expect(result).to.have.property('SubscriberPackageVersionId', subscriberPkgVersionId);
    });

    it('runs force:package:uninstall:report to wait for results', async () => {
      const MAX_TRIES = 40;
      const pkg = new Package({ connection: scratchOrg.getConnection() });
      const waitForUninstallRequestAndValidate = async (
        counter = 1
      ): Promise<{
        Status: string;
        SubscriberPackageVersionId?: string;
      }> => {
        const pollResult = await pkg.uninstallReport(uninstallReqId);

        if (pollResult.Status === 'InProgress' && counter < MAX_TRIES) {
          return sleep(WAIT_INTERVAL_MS, Duration.Unit.MILLISECONDS).then(() =>
            waitForUninstallRequestAndValidate(counter++)
          );
        } else {
          // break out of recursion, validate result
          expect(
            pollResult.Status,
            `Checked UninstallRequest ${counter} time(s) with interval of ${WAIT_INTERVAL_MS} ms and failed test with Status=${pollResult.Status}.`
          ).to.equal('Success');
          return pollResult;
        }
      };
      const result = await waitForUninstallRequestAndValidate();

      expect(result.Status).to.equal('Success');
      expect(result).to.have.property('Id').to.match(new RegExp(SUBSCRIBER_PKG_VERSION_UNINSTALL_ID_PREFIX));
      expect(result.SubscriberPackageVersionId).to.equal(subscriberPkgVersionId);
      expect(result).to.include.keys([
        'CreatedDate',
        'CreatedById',
        'LastModifiedDate',
        'LastModifiedById',
        'SystemModstamp',
      ]);
    });

    it('gets zero results from package:installed:list', () => {
      const result = execCmd<[]>(`force:package:installed:list --targetusername ${SUB_ORG_ALIAS} --json`, {
        ensureExitCode: 0,
      }).jsonOutput.result;
      expect(result).to.have.length(0);
    });
  });

  describe('delete package/version from the devhub', () => {
    it('deletes the package version', async () => {
      const pv = new PackageVersion({
        project,
        connection: devHubOrg.getConnection(),
        idOrAlias: subscriberPkgVersionId,
      });
      const result = await pv.delete();
      expect(result.success).to.be.true;
      expect(result.id).to.equal(subscriberPkgVersionId);
    });

    it('deletes the package', async () => {
      const result = await deletePackage(pkgId, project, devHubOrg.getConnection(), false);
      expect(result.success).to.be.true;
      expect(result.id).to.be.equal(pkgId);
    });
  });
});
describe('ancestry tests', () => {
  type PackageVersionQueryResult = PackagingSObjects.Package2Version & {
    Package2: {
      Id: string;
      Name: string;
      NamespacePrefix: string;
    };
  };
  let project: SfProject;
  let devHubOrg: Org;
  let pkgName: string;
  let versions: VersionNumber[];
  let sortedVersions: VersionNumber[];
  let aliases: { [alias: string]: string };

  before('ancestry project setup', async () => {
    const query =
      "SELECT AncestorId, SubscriberPackageVersionId, MajorVersion, MinorVersion, PatchVersion, BuildNumber, Package2Id, Package2.Name, package2.NamespacePrefix FROM Package2Version where package2.containeroptions = 'Managed' AND IsReleased = true";

    execCmd('config:set restDeploy=false', { cli: 'sfdx' });
    process.env.TESTKIT_EXECUTABLE_PATH = 'sfdx';
    // will auth the hub
    session = await TestSession.create({
      project: {
        sourceDir: path.join('test', 'package', 'resources', 'packageProject'),
      },
      devhubAuthStrategy: 'AUTO',
    });
    devHubOrg = await Org.create({ aliasOrUsername: session.hubOrg.username });
    let pvRecords = (await devHubOrg.getConnection().tooling.query<PackageVersionQueryResult>(query)).records;
    // preferred well known package pnhcoverage3, but if it's not available, use the first one
    if (pvRecords.some((pv) => pv.Package2.Name === 'pnhcoverage3')) {
      pkgName = 'pnhcoverage3';
    } else {
      pkgName = pvRecords[0].Package2.Name;
    }
    pvRecords = pvRecords.filter((pv) => pv.Package2.Name === pkgName);
    versions = pvRecords.map((pv) => {
      return new VersionNumber(pv.MajorVersion, pv.MinorVersion, pv.PatchVersion, pv.BuildNumber);
    });
    sortedVersions = [...versions].sort((a, b) => a.compareTo(b));
    project = await SfProject.resolve();
    const pjson = project.getSfProjectJson();
    const pkg = project.getDefaultPackage();
    pkg.package = pkgName;
    pkg.versionNumber = sortedVersions[0].toString();
    pkg.versionName = 'v1';
    pjson.set('packageDirectories', [pkg]);
    aliases = Object.fromEntries([
      ...pvRecords.map((pv, index) => [
        `${pv.Package2.Name}@${versions[index].toString()}`,
        pv.SubscriberPackageVersionId,
      ]),
      [pkgName, pvRecords[0].Package2Id],
    ]);
    pjson.set('packageAliases', aliases);
    pjson.set('namespace', pvRecords[0].Package2.NamespacePrefix);
    pjson.writeSync();
  });

  after(async () => {
    await session?.zip();
    await session?.clean();
  });
  it('should have a correct project config', async () => {
    expect(project.getSfProjectJson().get('packageAliases')).to.have.property(pkgName);
  });
  it('should produce a json representation of the ancestor tree from package name (0Ho)', async () => {
    const pa = await PackageAncestry.create({ packageId: pkgName, project, connection: devHubOrg.getConnection() });
    expect(pa).to.be.ok;
    const jsonProducer = await pa.getRepresentationProducer(
      (opts: AncestryRepresentationProducerOptions) => new AncestryJsonProducer(opts),
      undefined
    );
    expect(jsonProducer).to.be.ok;
    const jsonTree = await jsonProducer.produce();
    expect(jsonTree).to.have.property('data');
    expect(jsonTree).to.have.property('children');
  });
  it('should produce a graphic representation of the ancestor tree from package name (0Ho)', async () => {
    const pa = await PackageAncestry.create({ packageId: pkgName, project, connection: devHubOrg.getConnection() });
    expect(pa).to.be.ok;
    class TestAncestryTreeProducer extends AncestryTreeProducer implements AncestryRepresentationProducer {
      public static treeAsText: string;
      public constructor(options?: AncestryRepresentationProducerOptions) {
        super(options);
      }
    }
    const treeProducer = await pa.getRepresentationProducer(
      (opts: AncestryRepresentationProducerOptions) =>
        new TestAncestryTreeProducer({ ...opts, logger: (text) => (TestAncestryTreeProducer.treeAsText = text) }),
      undefined
    );
    expect(treeProducer).to.be.ok;
    await treeProducer.produce();
    const treeText = TestAncestryTreeProducer.treeAsText.split(os.EOL);
    expect(treeText[0]).to.match(new RegExp(`^└─ ${sortedVersions[0].toString()}`));
  });
  it('should produce a verbose graphic representation of the ancestor tree from package name (0Ho)', async () => {
    const pa = await PackageAncestry.create({ packageId: pkgName, project, connection: devHubOrg.getConnection() });
    expect(pa).to.be.ok;
    class TestAncestryTreeProducer extends AncestryTreeProducer implements AncestryRepresentationProducer {
      public static treeAsText: string;
      public constructor(options?: AncestryRepresentationProducerOptions) {
        super(options);
      }
    }
    const treeProducer = await pa.getRepresentationProducer(
      (opts: AncestryRepresentationProducerOptions) =>
        new TestAncestryTreeProducer({
          ...opts,
          logger: (text) => (TestAncestryTreeProducer.treeAsText = text),
          verbose: true,
        }),
      undefined
    );
    expect(treeProducer).to.be.ok;
    await treeProducer.produce();
    const treeText = TestAncestryTreeProducer.treeAsText.split(os.EOL);
    expect(treeText[0]).to.match(new RegExp(`^└─ ${sortedVersions[0].toString()} \\(04t.{12,15}\\)`));
  });
  it('should get path from leaf to root', async () => {
    const pa = await PackageAncestry.create({ packageId: pkgName, project, connection: devHubOrg.getConnection() });
    expect(pa).to.be.ok;
    const graph = pa.getAncestryGraph();
    const root = graph.findNode((n) => graph.inDegree(n) === 0);
    const subIds: string[] = Object.values(project.getSfProjectJson().get('packageAliases')).filter((id) =>
      id.startsWith('04t')
    );
    const leaf = subIds[subIds.length - 1];
    const pathsToRoots = await pa.getLeafPathToRoot(leaf);
    expect(pathsToRoots).to.be.ok;
    expect(pathsToRoots).to.have.lengthOf(1);
    expect(pathsToRoots[0][0].SubscriberPackageVersionId).to.equal(leaf);
    expect(pathsToRoots[0][pathsToRoots[0].length - 1].getVersion()).to.equal(root);
  });
});
