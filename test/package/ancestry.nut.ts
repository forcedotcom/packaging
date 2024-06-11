/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import os from 'node:os';
import path from 'node:path';
import { expect, config } from 'chai';
import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { SfProject } from '@salesforce/core/project';
import { Org } from '@salesforce/core';
import {
  AncestryRepresentationProducer,
  AncestryRepresentationProducerOptions,
  PackagingSObjects,
} from '../../src/exported';
import { VersionNumber } from '../../src/package/versionNumber';
import { AncestryJsonProducer, AncestryTreeProducer, PackageAncestry } from '../../src/package/packageAncestry';

let session: TestSession;
config.truncateThreshold = 0;
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

    // will auth the hub
    session = await TestSession.create({
      project: {
        sourceDir: path.join('test', 'package', 'resources', 'packageProject'),
      },
      devhubAuthStrategy: 'AUTO',
    });
    execCmd('config:set restDeploy=false', { ensureExitCode: 0, cli: 'sf' });

    devHubOrg = await Org.create({ aliasOrUsername: session.hubOrg.username });
    const queryRecords = (await devHubOrg.getConnection().tooling.query<PackageVersionQueryResult>(query)).records;

    // preferred well known package pnhcoverage3, but if it's not available, use the first one
    pkgName = queryRecords.some((pv) => pv.Package2.Name === 'pnhcoverage3')
      ? 'pnhcoverage3'
      : queryRecords[0].Package2.Name;

    const pvRecords = queryRecords.filter((pv) => pv.Package2.Name === pkgName);
    versions = pvRecords.map(
      (pv) => new VersionNumber(pv.MajorVersion, pv.MinorVersion, pv.PatchVersion, pv.BuildNumber)
    );
    sortedVersions = [...versions].sort((a, b) => a.compareTo(b));
    project = await SfProject.resolve();
    const pjson = project.getSfProjectJson();
    const pkg = {
      ...project.getDefaultPackage(),
      package: pkgName,
      versionNumber: sortedVersions[0].toString(),
      versionName: 'v1',
    };

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
    await pjson.write();
  });

  after(async () => {
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
