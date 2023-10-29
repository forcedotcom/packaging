/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { expect } from 'chai';
import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { Duration, sleep } from '@salesforce/kit';
import { ProjectJson } from '@salesforce/core/lib/sfProject';
import { Lifecycle, Org, SfProject } from '@salesforce/core';
import { uniqid } from '@salesforce/core/lib/testSetup';
import {
  AncestryRepresentationProducer,
  AncestryRepresentationProducerOptions,
  Package,
  PackageCreateOptions,
  PackageVersion,
  PackageVersionCreateReportProgress,
  PackageVersionCreateRequestResultInProgressStatuses,
  PackageVersionEvents,
  PackagingSObjects,
  Package2VersionFields,
  Package2VersionFieldTypes,
} from '../../src/exported';
import { PackageEvents } from '../../src/interfaces';
import { SubscriberPackageVersion, VersionNumber } from '../../src/package';
import { AncestryJsonProducer, AncestryTreeProducer, PackageAncestry } from '../../src/package/packageAncestry';

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
  'ConvertedFromVersionId',
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

describe('Integration tests for @salesforce/packaging library', () => {
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
        noNamespace: false,
        orgDependent: false,
        errorNotificationUsername: devHubOrg.getUsername() as string,
      };
      const pkg = await Package.create(devHubOrg.getConnection(), project, options);
      pkgId = pkg.Id;
      expect(pkgId).to.be.ok;
      expect(pkgId).to.match(new RegExp(PKG2_ID_PREFIX));

      // verify update to project.json packageDiretory using fs
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const dxPjsonData = await fs.readFile(path.join(session.project.dir, 'sfdx-project.json'), 'utf8');
      const projectFile = JSON.parse(dxPjsonData) as ProjectJson;
      expect(projectFile).to.have.property('packageDirectories').with.length(1);
      expect(projectFile.packageDirectories[0]).to.include.keys(['package', 'versionName', 'versionNumber']);
      expect(projectFile.packageDirectories[0].package).to.equal(pkgName);
      expect(projectFile.packageAliases).to.deep.equal({
        [pkgName]: pkgId,
      });
    });

    it('should list all packages in the dev hub', async () => {
      const packages = await Package.list(devHubOrg.getConnection());
      expect(packages).to.have.length.greaterThan(0);
    });

    it('should find no package versions for the new package', async () => {
      const pkg = new Package({ connection: devHubOrg.getConnection(), project, packageAliasOrId: pkgId });
      const pkgVersions = await pkg.getPackageVersions();
      expect(pkgVersions).to.be.empty;
    });

    describe('queryPackage2Version', () => {
      it('should return expected results when querying Package2Version, default options', async () => {
        const connection = devHubOrg.getConnection();
        const res = await PackageVersion.queryPackage2Version(connection);
        expect(res).to.be.an('Array').with.length.greaterThan(0);
        expect(res[0]).to.have.keys([...Package2VersionFields, 'attributes']);
      });

      it('should return expected results when querying Package2Version, with fields', async () => {
        const connection = devHubOrg.getConnection();
        const fields = ['Id', 'Name'] satisfies Package2VersionFieldTypes;
        const res = await PackageVersion.queryPackage2Version(connection, { fields });
        expect(res).to.be.an('Array').with.length.greaterThan(0);
        expect(res[0]).to.have.keys([...fields, 'attributes']);
      });

      it('should return expected results when querying Package2Version, with whereClause', async () => {
        const connection = devHubOrg.getConnection();
        const fields = ['Id', 'Name'] satisfies Package2VersionFieldTypes;
        const whereClause = "WHERE Id IN ('05i46000000KymZAAS')";
        const res = await PackageVersion.queryPackage2Version(connection, { fields, whereClause });
        expect(res).to.be.an('Array').with.lengthOf(1);
        expect(res[0]).to.have.keys([...fields, 'attributes']);
      });

      it('should return expected results when querying Package2Version, with whereClauseItems', async () => {
        const connection = devHubOrg.getConnection();
        const fields = ['Id', 'Name'] satisfies Package2VersionFieldTypes;
        const whereClause = "WHERE Id IN ('%IDS%')";
        const whereClauseItems = ['05i46000000KymAAAS', '05i46000000KymKAAS', '05i46000000KymFAAS'];
        const res = await PackageVersion.queryPackage2Version(connection, { fields, whereClause, whereClauseItems });
        expect(res).to.be.an('Array').with.lengthOf(3);
        expect(res[0]).to.have.keys([...fields, 'attributes']);
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
      pkgCreateVersionRequestId = result.Id ?? '';
      pkgId = result.Package2Id ?? '';
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

      subscriberPkgVersionId = result.SubscriberPackageVersionId ?? '';

      if (result.Status === 'Error') {
        throw new Error(`pv.waitForCreateVersion failed with status Error: ${result.Error.join(';')}`);
      }
    });

    it('verifies the package version create request is in dev hub via PackageVersion.getPackageVersionCreateRequests', async () => {
      const result = await PackageVersion.getPackageVersionCreateRequests(devHubOrg.getConnection());

      expect(result).to.have.length.at.least(1);
      result.forEach((item) => expect(item).to.have.all.keys(VERSION_CREATE_RESPONSE_KEYS));
      expect(
        result.filter((item) => item.Id === pkgCreateVersionRequestId),
        `Did not find Package2CreateVersionRequestId '${pkgCreateVersionRequestId}' in 'PackageVersion.getPackageVersionCreateRequests' result`
      ).to.have.length(1);
    });

    it('package version should be in results of Package#getPackageVersions', async () => {
      const pkg = new Package({ connection: devHubOrg.getConnection(), project, packageAliasOrId: pkgId });
      const pkgVersions = await pkg.getPackageVersions();
      expect(pkgVersions).to.have.length(1);
      expect(pkgVersions.some((pvlr) => pvlr.SubscriberPackageVersionId === subscriberPkgVersionId)).to.be.true;
    });

    it('package version should be in results of static Package#listVersions', async () => {
      const pkgVersions = await Package.listVersions(devHubOrg.getConnection(), project);
      expect(pkgVersions.some((pvlr) => pvlr.SubscriberPackageVersionId === subscriberPkgVersionId)).to.be.true;
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      const dxPjsonData = await fs.readFile(path.join(session.project.dir, 'sfdx-project.json'), 'utf8');
      const projectFile = JSON.parse(dxPjsonData) as ProjectJson;

      expect(result.Name).to.equal(
        projectFile.packageDirectories[0].versionName,
        `'force:package:version:report' Name mismatch: expected '${projectFile.packageDirectories[0].versionName}', got '${result.Name}'`
      );

      const version = projectFile.packageDirectories[0].versionNumber?.replace('NEXT', '1');
      expect(result.Version).to.equal(
        version,
        `'force:package:version:report' Version mismatch: expected '${version}', got '${result.Version}'`
      );

      expect(result.IsReleased, 'Expected IsReleased to be false').to.be.false;
      expect(Object.values(projectFile.packageAliases ?? []).some((id) => id === subscriberPkgVersionId)).to.be.true;
    });

    it('will update the package version with a new branch', async () => {
      const pv = new PackageVersion({
        project,
        connection: devHubOrg.getConnection(),
        idOrAlias: subscriberPkgVersionId,
      });
      const result = await pv.update({ Branch: 'superFunBranch' });
      expect(result).to.include.keys('id', 'success', 'errors');
      expect(result.id?.startsWith('04t')).to.be.true;
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
      const pkg = new Package({ connection: devHubOrg.getConnection(), packageAliasOrId: pkgId, project });
      const result = await pkg.update({ Id: pkgId, Description: 'new package description' });
      expect(result).to.have.all.keys('id', 'success', 'errors');
      expect(result.id?.startsWith('0Ho')).to.be.true;
      expect(result.success).to.be.true;
      expect(result.errors).to.deep.equal([]);
    });

    it('will list all of the created package versions', async () => {
      const result = await PackageVersion.getPackageVersionCreateRequests(devHubOrg.getConnection());
      expect(result).to.have.length.at.least(1);
    });

    it('will list all of the created package versions (status = Success)', async () => {
      const result = await PackageVersion.getPackageVersionCreateRequests(devHubOrg.getConnection(), {
        status: 'Success',
      });
      result.map((res) => {
        // we should've filtered to only successful package versions1
        expect(res.Status).to.equal('Success');
        expect(res).to.have.all.keys(
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
          'ConvertedFromVersionId'
        );
        expect(res.Id.startsWith('08c')).to.be.true;
        expect(res.Package2Id.startsWith('0Ho')).to.be.true;
        expect(res.Package2VersionId.startsWith('05i')).to.be.true;
        expect(res.SubscriberPackageVersionId?.startsWith('04t')).to.be.true;
      });
    });

    it('will list all of the created package versions (createdLastDays = 3)', async () => {
      const result = await PackageVersion.getPackageVersionCreateRequests(devHubOrg.getConnection(), {
        createdlastdays: 3,
      });
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
        'CreatedBy',
        'ConvertedFromVersionId'
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
      let subscriberStatus = false;
      let presend = false;
      let postsend = false;

      Lifecycle.getInstance().on(PackageEvents.install['subscriber-status'], async () => {
        subscriberStatus = true;
      });
      Lifecycle.getInstance().on(PackageEvents.install.presend, async () => {
        presend = true;
      });
      Lifecycle.getInstance().on(PackageEvents.install.postsend, async () => {
        postsend = true;
      });

      const pkg = new SubscriberPackageVersion({
        connection: scratchOrg.getConnection(),
        aliasOrId: subscriberPkgVersionId,
        password: INSTALLATION_KEY,
      });
      const result = await pkg.install(
        {
          SubscriberPackageVersionKey: subscriberPkgVersionId,
          Password: INSTALLATION_KEY,
        },
        { publishFrequency: Duration.seconds(30), publishTimeout: Duration.minutes(20) }
      );
      expect(['IN_PROGRESS', 'SUCCESS']).to.include(result.Status);
      expect(result).to.have.property('Errors', null);
      expect(result).to.have.property('SubscriberPackageVersionKey', subscriberPkgVersionId);
      expect(result).to.have.property('Id');
      expect(subscriberStatus).to.be.true;
      expect(presend).to.be.true;
      expect(postsend).to.be.true;

      installReqId = result.Id;
    });

    it('check installStatus until it finishes', async () => {
      let installStatus = false;
      Lifecycle.getInstance().on(PackageEvents.install.status, async () => {
        installStatus = true;
      });
      const result = await SubscriberPackageVersion.installStatus(
        scratchOrg.getConnection(),
        installReqId,
        INSTALLATION_KEY,
        {
          pollingFrequency: Duration.seconds(30),
          pollingTimeout: Duration.minutes(30),
        }
      );
      expect(installStatus).to.be.true;
      expect(result.Status).to.equal('SUCCESS');
    });

    it('packageInstalledList returns the correct information', async () => {
      const connection = scratchOrg.getConnection();
      const result = await SubscriberPackageVersion.installedList(connection);
      const foundRecord = result.filter((item) => item.SubscriberPackageVersion?.Id === subscriberPkgVersionId);

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
      const pkg = new SubscriberPackageVersion({
        connection: scratchOrg.getConnection(),
        aliasOrId: subscriberPkgVersionId,
        password: INSTALLATION_KEY,
      });
      const result = await pkg.uninstall();

      expect(result).to.include.keys(['Status', 'Id', 'SubscriberPackageVersionId']);
      uninstallReqId = result.Id;
      expect(uninstallReqId).to.match(new RegExp(SUBSCRIBER_PKG_VERSION_UNINSTALL_ID_PREFIX));

      // sometimes uninstall is pretty fast!
      expect(['InProgress', 'Success'].includes(result.Status));
      expect(result).to.have.property('SubscriberPackageVersionId', subscriberPkgVersionId);
    });

    it('runs force:package:uninstall:report to wait for results', async () => {
      const MAX_TRIES = 40;
      const waitForUninstallRequestAndValidate = async (
        counter = 1
      ): Promise<{
        Status: string;
        SubscriberPackageVersionId?: string;
      }> => {
        const pollResult = await SubscriberPackageVersion.uninstallStatus(uninstallReqId, scratchOrg.getConnection());
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

    it('gets zero results from packageInstalledList', async () => {
      const result = await SubscriberPackageVersion.installedList(scratchOrg.getConnection());
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
      const pkg = new Package({ project, connection: devHubOrg.getConnection(), packageAliasOrId: pkgId });
      const result = await pkg.delete();
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
    versions = pvRecords.map(
      (pv) => new VersionNumber(pv.MajorVersion, pv.MinorVersion, pv.PatchVersion, pv.BuildNumber)
    );
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
    ]) as { [alias: string]: string };
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
    const jsonProducer = pa.getRepresentationProducer(
      (opts: AncestryRepresentationProducerOptions) => new AncestryJsonProducer(opts),
      undefined
    );
    expect(jsonProducer).to.be.ok;
    const jsonTree = jsonProducer.produce();
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

    const treeProducer = pa.getRepresentationProducer(
      (opts: AncestryRepresentationProducerOptions) =>
        new TestAncestryTreeProducer({
          ...opts,
          logger: (text: string) => (TestAncestryTreeProducer.treeAsText = text),
        }),
      undefined
    );
    expect(treeProducer).to.be.ok;
    treeProducer.produce();
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

    const treeProducer = pa.getRepresentationProducer(
      (opts: AncestryRepresentationProducerOptions) =>
        new TestAncestryTreeProducer({
          ...opts,
          logger: (text: string) => (TestAncestryTreeProducer.treeAsText = text),
          verbose: true,
        }),
      undefined
    );
    expect(treeProducer).to.be.ok;
    treeProducer.produce();
    const treeText = TestAncestryTreeProducer.treeAsText.split(os.EOL);
    expect(treeText[0]).to.match(new RegExp(`^└─ ${sortedVersions[0].toString()} \\(04t.{12,15}\\)`));
  });
  it('should get path from leaf to root', async () => {
    const pa = await PackageAncestry.create({ packageId: pkgName, project, connection: devHubOrg.getConnection() });
    expect(pa).to.be.ok;
    const graph = pa.getAncestryGraph();
    const root = graph.findNode((n) => graph.inDegree(n) === 0);
    const subIds: string[] = Object.values(project.getSfProjectJson().getContents().packageAliases ?? []).filter(
      (id: string) => id.startsWith('04t')
    );
    const leaf = subIds[subIds.length - 1];
    const pathsToRoots = pa.getLeafPathToRoot(leaf);
    expect(pathsToRoots).to.be.ok;
    expect(pathsToRoots).to.have.lengthOf(1);
    expect(pathsToRoots[0][0].SubscriberPackageVersionId).to.equal(leaf);
    expect(pathsToRoots[0][pathsToRoots[0].length - 1].getVersion()).to.equal(root);
  });
});
