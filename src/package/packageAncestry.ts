/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages } from '@salesforce/core';
import { DirectedGraph } from 'graphology';
import { AsyncCreatable } from '@salesforce/kit';
import { Tree } from '@oclif/core/lib/cli-ux/styled/tree';
import { Attributes } from 'graphology-types';
import { bfs, dfsFromNode } from 'graphology-traversal';
import { PackageAncestryNodeOptions, PackageAncestryOptions, PackageType } from '../interfaces';
import * as pkgUtils from '../utils/packageUtils';
import { VersionNumber } from '../utils/versionNumber';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

const SELECT_PACKAGE_VERSION =
  'SELECT AncestorId, SubscriberPackageVersionId, MajorVersion, MinorVersion, PatchVersion, BuildNumber FROM Package2Version';
const SELECT_PACKAGE_CONTAINER_OPTIONS = 'SELECT ContainerOptions FROM Package2';

const SELECT_PACKAGE_VERSION_CONTAINER_OPTIONS = 'SELECT Package2ContainerOptions FROM SubscriberPackageVersion';

// Add this to query calls to only show released package versions in the output
const releasedOnlyFilter = ' AND IsReleased = true';

export class PackageAncestry extends AsyncCreatable<PackageAncestryOptions> {
  private graph: DirectedGraph = new DirectedGraph<PackageAncestryNode, Attributes, Attributes>();
  private roots: PackageAncestryNode[];
  public constructor(private options: PackageAncestryOptions) {
    super(options);
  }
  public async init(): Promise<void> {
    await this.buildAncestryTree();
  }
  public async buildAncestryTree(): Promise<void> {
    this.roots = await this.getRoots();
    await this.buildAncestryTreeFromRoots(this.roots);
  }
  public async getRoots(): Promise<PackageAncestryNode[]> {
    let roots = [];
    this.options.packageId = pkgUtils.getPackageIdFromAlias(this.options.packageId, this.options.project);
    switch (this.options.packageId.slice(0, 3)) {
      case '0Ho':
        pkgUtils.validateId(pkgUtils.BY_LABEL.PACKAGE_ID, this.options.packageId);
        roots = await this.findRootsForPackage();
        break;
      case '04t':
        pkgUtils.validateId(pkgUtils.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, this.options.packageId);
        roots = await this.findRootsForPackageVersion();
        break;
      default:
        throw messages.createError('idOrAliasNotFound', [this.options.packageId]);
    }
    return roots;
  }

  public async getAncestryGraph(): Promise<DirectedGraph<Attributes, Attributes, Attributes>> {
    return this.graph;
  }

  public async getLeafPathToRoot(subscriberPackageVersionId?: string): Promise<PackageAncestryNode[][]> {
    const root = this.graph.findNode((node, attributes) => attributes.node.getAncestorId() === null);
    const paths: PackageAncestryNode[][] = [];
    let path: PackageAncestryNode[] = [];
    dfsFromNode(this.graph, root, function (node, attr: { node: PackageAncestryNode }, depth) {
      if (depth === 0) {
        paths.push(path);
        path = [];
      }
      path.push(attr.node);
    });

    // push remaining path
    paths.push(path);
    return paths
      .filter(
        (path) =>
          path.length > 0 && // don't care about zero length paths
          (!subscriberPackageVersionId ||
            path.some((node) => node.getSubscriberPackageVersionId() === subscriberPackageVersionId))
      )
      .map((path) => path.reverse())
      .map((path) => {
        const subscriberPackageVersionIdIndex = path.findIndex(
          (node) => node.getSubscriberPackageVersionId() === subscriberPackageVersionId
        );
        return path.slice(subscriberPackageVersionIdIndex === -1 ? 0 : subscriberPackageVersionIdIndex);
      });
  }

  public async getGraphAsUxTree(root?: string): Promise<Tree> {
    // need to account for either 0Ho or 04t packageIds
    let tree = new Tree();
    const treeStack: Tree[] = [];
    bfs(this.graph, function (node, attr: { node: PackageAncestryNode }, depth) {
      if (treeStack.length > depth) {
        treeStack.splice(depth);
      }
      let t = treeStack[depth];
      if (!t) {
        t = new Tree();
        treeStack.push(t);
      }
      if (depth === 0) {
        tree.insert(node, t);
      } else {
        treeStack[depth - 1].insert(node, t);
      }
    });
    let requestedRoot;
    if (root) {
      requestedRoot = this.graph.findNode(
        (node, attributes) => attributes.node.getSubscriberPackageVersionId() === root
      );
    }
    tree = !root ? tree : tree.search(this.graph.getNodeAttributes(requestedRoot).node.getVersion() as string);
    return tree;
  }

  private async findRootsForPackageVersion(): Promise<PackageAncestryNode[]> {
    // Check to see if the package version is part of an unlocked package
    // if so, throw and error since ancestry only applies to managed packages
    const versionQuery = `${SELECT_PACKAGE_VERSION_CONTAINER_OPTIONS} WHERE Id = '${this.options.packageId}'`;
    const packageVersionTypeResults = await this.options.connection.singleRecordQuery<{
      Package2ContainerOptions?: PackageType;
    }>(versionQuery, { tooling: true });

    if (packageVersionTypeResults.Package2ContainerOptions !== 'Managed') {
      throw messages.createError('unlockedPackageError');
    }

    // Start with the node, and shoot up
    let node = await this.getPackageVersion(this.options.packageId);
    while (node.getAncestorId() !== null) {
      const ancestor = await this.getPackageVersion(node.getAncestorId());
      this.addToGraph(ancestor, node);
      node = ancestor;
    }
    return [node];
  }

  private async getPackageVersion(nodeId: string): Promise<PackageAncestryNode> {
    const query = `${SELECT_PACKAGE_VERSION} WHERE SubscriberPackageVersionId = '${nodeId}'`;

    const results = await this.options.connection.singleRecordQuery<PackageAncestryNode>(query, {
      tooling: true,
    });

    if (!results) {
      throw messages.createError('versionNotFound', [nodeId]);
    }
    return new PackageAncestryNode(results);
  }

  private async findRootsForPackage(): Promise<PackageAncestryNode[]> {
    // Check to see if the package is an unlocked package
    // if so, throw and error since ancestry only applies to managed packages
    const query = `${SELECT_PACKAGE_CONTAINER_OPTIONS} WHERE Id = '${this.options.packageId}'`;
    const packageTypeResults = await this.options.connection.tooling.query<{ ContainerOptions?: PackageType }>(query);

    if (packageTypeResults?.records?.length === 0) {
      throw messages.createError('invalidId', [this.options.packageId]);
    } else if (packageTypeResults?.records?.length && packageTypeResults?.records[0].ContainerOptions !== 'Managed') {
      throw messages.createError('unlockedPackageError');
    }

    const normalQuery = `${SELECT_PACKAGE_VERSION} WHERE AncestorId = NULL AND Package2Id = '${this.options.packageId}' ${releasedOnlyFilter}`;
    const subscriberPackageVersions = (
      await this.options.connection.tooling.query<PackageAncestryNode>(normalQuery)
    ).records?.map((record) => new PackageAncestryNode(record));

    // The package exists, but there are no versions for the provided package
    if (subscriberPackageVersions.length === 0) {
      throw messages.createError('noVersionsError');
    }

    return subscriberPackageVersions;
  }

  private async buildAncestryTreeFromRoots(roots: PackageAncestryNode[]): Promise<void> {
    while (roots.length > 0) {
      const subscriberPackageVersion = roots.shift();
      const descendants = await this.addDescendantsFromPackageVersion(subscriberPackageVersion);
      roots.push(...descendants);
    }
  }

  private async addDescendantsFromPackageVersion(
    subscriberPackageVersion: PackageAncestryNode
  ): Promise<PackageAncestryNode[]> {
    const descendants = await this.getDescendants(subscriberPackageVersion);
    descendants.forEach((descendant) => this.addToGraph(subscriberPackageVersion, descendant));
    return descendants;
  }

  private addToGraph(ancestor: PackageAncestryNode, descendant: PackageAncestryNode): void {
    if (!this.graph.hasNode(ancestor.getVersion())) {
      this.graph.addNode(ancestor.getVersion(), { node: ancestor });
    }
    if (!this.graph.hasNode(descendant.getVersion())) {
      this.graph.addNode(descendant.getVersion(), { node: descendant });
    }
    if (!this.graph.hasEdge(ancestor.getVersion(), descendant.getVersion())) {
      this.graph.addDirectedEdge(ancestor.getVersion(), descendant.getVersion(), {
        from: ancestor.getVersion(),
        to: descendant.getVersion(),
      });
    }
  }

  private async getDescendants(ancestor: PackageAncestryNode): Promise<PackageAncestryNode[]> {
    const query = `${SELECT_PACKAGE_VERSION} WHERE AncestorId = '${ancestor.getSubscriberPackageVersionId()}' ${releasedOnlyFilter}`;
    const results = await this.options.connection.tooling.query<PackageAncestryNode>(query);
    return results.records.map((result) => new PackageAncestryNode(result));
  }
}

class PackageAncestryNode implements Attributes {
  private version: VersionNumber;
  public constructor(private options: PackageAncestryNodeOptions) {
    this.version = new VersionNumber(
      this.options.MajorVersion,
      this.options.MinorVersion,
      this.options.PatchVersion,
      this.options.BuildNumber
    );
  }
  public getVersion(): string {
    return this.version.toString();
  }
  public getAncestorId(): string | null {
    return this.options.AncestorId;
  }
  public getSubscriberPackageVersionId(): string {
    return this.options.SubscriberPackageVersionId;
  }
}
