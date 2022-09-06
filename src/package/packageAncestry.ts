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
import { dfs, dfsFromNode } from 'graphology-traversal';
import {
  PackageAncestryNodeData,
  PackageAncestryNodeOptions,
  PackageAncestryOptions,
  PackageType,
} from '../interfaces';
import * as pkgUtils from '../utils/packageUtils';
import { VersionNumber } from '../utils/versionNumber';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'messages');

const SELECT_PACKAGE_VERSION =
  'SELECT AncestorId, SubscriberPackageVersionId, MajorVersion, MinorVersion, PatchVersion, BuildNumber FROM Package2Version';
const SELECT_PACKAGE_CONTAINER_OPTIONS = 'SELECT ContainerOptions FROM Package2   ';

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

  public getAncestryGraph(): DirectedGraph<Attributes, Attributes, Attributes> {
    return this.graph;
  }

  public async getGraphAs(
    producerCtor: (options?: AncestryRepresentationProducerOptions) => AncestryRepresentationProducer,
    root: string | undefined
  ): Promise<AncestryRepresentationProducer> {
    const treeRoot = root
      ? this.graph.findNode((node, attributes) => attributes.node.SubscriberPackageVersionId === root)
      : undefined;

    const tree = producerCtor();
    const treeStack: AncestryRepresentationProducer[] = [];

    function handleNode(node, attr: AncestryRepresentationProducerOptions, depth: number): void {
      if (treeStack.length > depth) {
        treeStack.splice(depth);
      }
      let t = treeStack[depth];
      if (!t) {
        t = producerCtor({ node: attr.node, depth });
        treeStack.push(t);
      }
      if (depth === 0) {
        tree.addNode(t);
      } else {
        treeStack[depth - 1].addNode(t);
      }
    }

    if (treeRoot) {
      dfsFromNode(this.graph, treeRoot, handleNode);
    } else {
      dfs(this.graph, handleNode);
    }
    return tree;
  }

  public async getLeafPathToRoot(subscriberPackageVersionId?: string): Promise<PackageAncestryNode[][]> {
    const root = this.graph.findNode((node, attributes) => attributes.node.AncestorId === null);
    const paths: PackageAncestryNode[][] = [];
    let path: PackageAncestryNode[] = [];
    let previousDepth = 0;
    dfsFromNode(this.graph, root, function (node, attr: { node: PackageAncestryNode }, depth) {
      if (depth === 0) {
        paths.push(path);
        path = [];
      } else if (depth <= previousDepth) {
        paths.push(path);
        path = path.slice(0, depth);
      }
      previousDepth = depth;
      path.push(attr.node);
    });

    // push remaining path
    paths.push(path);
    return paths
      .filter(
        (path) =>
          path.length > 0 && // don't care about zero length paths
          (!subscriberPackageVersionId ||
            path.some((node) => node.SubscriberPackageVersionId === subscriberPackageVersionId))
      )
      .map((path) => path.reverse())
      .map((path) => {
        const subscriberPackageVersionIdIndex = path.findIndex(
          (node) => node.SubscriberPackageVersionId === subscriberPackageVersionId
        );
        return path.slice(subscriberPackageVersionIdIndex === -1 ? 0 : subscriberPackageVersionIdIndex);
      });
  }

  private async findRootsForPackageVersion(): Promise<PackageAncestryNode[]> {
    // Check to see if the package version is part of an unlocked package
    // if so, throw an error since ancestry only applies to managed packages
    const versionQuery = `${SELECT_PACKAGE_VERSION_CONTAINER_OPTIONS} WHERE Id = '${this.options.packageId}'`;
    const packageVersionTypeResults = await this.options.connection.singleRecordQuery<{
      Package2ContainerOptions?: PackageType;
    }>(versionQuery, { tooling: true });

    if (packageVersionTypeResults.Package2ContainerOptions !== 'Managed') {
      throw messages.createError('unlockedPackageError');
    }

    // Start with the node, and shoot up
    let node = await this.getPackageVersion(this.options.packageId);
    while (node.AncestorId !== null) {
      const ancestor = await this.getPackageVersion(node.AncestorId);
      this.addToGraph(ancestor, node);
      node = ancestor;
    }
    return [node];
  }

  private async getPackageVersion(nodeId: string): Promise<PackageAncestryNode> {
    const query = `${SELECT_PACKAGE_VERSION} WHERE SubscriberPackageVersionId = '${nodeId}'`;

    try {
      const results = await this.options.connection.singleRecordQuery<PackageAncestryNode>(query, {
        tooling: true,
      });
      return new PackageAncestryNode(results);
    } catch (e) {
      if (e.message.includes('No record found for')) {
        throw messages.createError('versionNotFound', [nodeId]);
      }
      throw e;
    }
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
      this.graph.addDirectedEdgeWithKey(
        `${ancestor.getVersion()}->${descendant.getVersion()}`,
        ancestor.getVersion(),
        descendant.getVersion(),
        {
          from: ancestor.getVersion(),
          to: descendant.getVersion(),
        }
      );
    }
  }

  private async getDescendants(ancestor: PackageAncestryNode): Promise<PackageAncestryNode[]> {
    const query = `${SELECT_PACKAGE_VERSION} WHERE AncestorId = '${ancestor.SubscriberPackageVersionId}' ${releasedOnlyFilter}`;
    const results = await this.options.connection.tooling.query<PackageAncestryNode>(query);
    return results.records.map((result) => new PackageAncestryNode(result));
  }
}

export type AncestryRepresentationProducerOptions = {
  [key: string]: unknown;
  node: PackageAncestryNode;
  depth?: number;
};

export interface AncestryRepresentationProducer {
  label: string;
  options: AncestryRepresentationProducerOptions;
  addNode(node: AncestryRepresentationProducer): void;
  produce<T>(): T | string | void;
}

export class AncestryTreeProducer extends Tree implements AncestryRepresentationProducer {
  public label: string;
  public options: AncestryRepresentationProducerOptions;
  public constructor(options?: AncestryRepresentationProducerOptions) {
    super();
    this.options = options;
    this.label = this.options?.node?.getVersion() || 'root';
  }

  public addNode(node: AncestryTreeProducer): void {
    this.insert(node?.label || 'root', node);
  }

  public produce(): void {
    const producers: AncestryTreeProducer[] = [];
    producers.push(this);

    while (producers.length > 0) {
      const producer = producers.shift();
      Object.values(producer.nodes)
        .sort((a: AncestryTreeProducer, b: AncestryTreeProducer) =>
          a.options.node.version.compareTo(b.options.node.version)
        )
        .forEach((child: AncestryTreeProducer) => {
          delete producer.nodes[child.label];
          producer.addNode(child);
          producers.push(child);
        });
    }
    this.display(this.options ? this.options['logger'] : undefined);
  }
}
export class AncestryJsonProducer implements AncestryRepresentationProducer {
  public label: string;
  public options: AncestryRepresentationProducerOptions;
  private children: AncestryJsonProducer[] = [];
  private readonly data: PackageAncestryNodeData;
  public constructor(options?: AncestryRepresentationProducerOptions) {
    this.options = options;
    this.label = this.options?.node?.getVersion() || 'root';
    this.data = {
      children: [],
      data: {
        SubscriberPackageVersionId: this.options?.node?.SubscriberPackageVersionId,
        MajorVersion: this.options?.node?.MajorVersion,
        MinorVersion: this.options?.node?.MinorVersion,
        PatchVersion: this.options?.node?.PatchVersion,
        BuildNumber: this.options?.node?.BuildNumber,
        depthCounter: this.options?.depth,
      },
    };
  }

  public addNode(node: AncestryJsonProducer): void {
    this.data.children.push(node.data);
    this.children.push(node);
  }

  public search(version: string): AncestryJsonProducer {
    const producers: AncestryJsonProducer[] = [];
    producers.push(this);
    while (producers.length > 0) {
      const producer = producers.shift();
      if (producer.label === version) {
        return producer;
      }
      producers.push(...producer.children);
    }
    return undefined;
  }

  public produce<PackageAncestryNodeData>(): PackageAncestryNodeData {
    return this.data.children[0] as unknown as PackageAncestryNodeData;
  }
}
export class AncestryDotProducer implements AncestryRepresentationProducer {
  public label: string;
  public options: AncestryRepresentationProducerOptions;
  private children: AncestryDotProducer[] = [];
  public constructor(options?: AncestryRepresentationProducerOptions) {
    this.options = options;
    this.label = this.options?.node?.getVersion() || 'root';
  }
  /**
   * Builds a node line in DOT, of the form nodeID [label="MAJOR.MINOR.PATCH"]
   *
   * @param currentNode
   */
  public static buildDotNode(currentNode: AncestryDotProducer): string {
    return `\t node${currentNode.options.node.SubscriberPackageVersionId} [label="${currentNode.label}"]`;
  }

  /**
   * Builds an edge line in DOT, of the form fromNode -- toNode
   *
   * @param fromNode
   * @param toNode
   */
  public static buildDotEdge(fromNode: AncestryDotProducer, toNode: AncestryDotProducer): string {
    return `\t node${fromNode.options.node.SubscriberPackageVersionId} -- node${toNode.options.node.SubscriberPackageVersionId}`;
  }

  public addNode(node: AncestryDotProducer): void {
    this.children.push(node);
  }

  public produce(): string {
    const producers: AncestryDotProducer[] = [];
    producers.push(this);
    const dotLines: string[] = [];

    while (producers.length > 0) {
      const producer = producers.shift();
      if (producer.options) {
        dotLines.push(AncestryDotProducer.buildDotNode(producer));
      }
      producers.push(...producer.children);
    }
    producers.push(this);
    while (producers.length > 0) {
      const producer = producers.shift();
      if (producer.options) {
        producer.children.forEach((child) => dotLines.push(AncestryDotProducer.buildDotEdge(producer, child)));
      }
      producers.push(...producer.children);
    }
    return `strict graph G {\n${dotLines.join('\n')}}`;
  }
}

export class PackageAncestryNode extends AsyncCreatable<PackageAncestryNodeOptions> implements Attributes {
  private readonly _version: VersionNumber;
  private readonly _MajorVersion: number;
  private readonly _MinorVersion: number;
  private readonly _PatchVersion: number;
  private readonly _BuildNumber: number | string;
  private readonly _AncestorId: string;
  private readonly _SubscriberPackageVersionId: string;
  private readonly _depthCounter: number;

  public constructor(public options: PackageAncestryNodeOptions) {
    super(options);
    this._version = new VersionNumber(
      this.options.MajorVersion,
      this.options.MinorVersion,
      this.options.PatchVersion,
      this.options.BuildNumber
    );
    this._AncestorId = this.options.AncestorId;
    this._SubscriberPackageVersionId = this.options.SubscriberPackageVersionId;
    this._MajorVersion =
      typeof this.options.MajorVersion === 'number'
        ? this.options.MajorVersion
        : parseInt(this.options.MajorVersion, 10);
    this._MinorVersion =
      typeof this.options.MinorVersion === 'number'
        ? this.options.MinorVersion
        : parseInt(this.options.MinorVersion, 10);
    this._PatchVersion =
      typeof this.options.PatchVersion === 'number'
        ? this.options.PatchVersion
        : parseInt(this.options.PatchVersion, 10);
    this._BuildNumber = this.options.BuildNumber;
  }

  public get AncestorId(): string {
    return this._AncestorId;
  }

  public get SubscriberPackageVersionId(): string {
    return this._SubscriberPackageVersionId;
  }

  public get version(): VersionNumber {
    return this._version;
  }

  public get MinorVersion(): number {
    return this._MinorVersion;
  }

  public get PatchVersion(): number {
    return this._PatchVersion;
  }

  public get BuildNumber(): number | string {
    return this._BuildNumber;
  }
  public get MajorVersion(): number {
    return this._MajorVersion;
  }

  public get depthCounter(): number {
    return this._depthCounter;
  }

  public getVersion(): string {
    return this._version.toString();
  }
  protected init(): Promise<void> {
    return Promise.resolve();
  }
}
