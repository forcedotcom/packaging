/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { EOL } from 'os';
import { Messages } from '@salesforce/core';
import { DirectedGraph } from 'graphology';
import { AsyncCreatable } from '@salesforce/kit';
import { Tree } from '@oclif/core/lib/cli-ux/styled/tree';
import { Attributes } from 'graphology-types';
import { dfs, dfsFromNode } from 'graphology-traversal';
import {
  AncestryRepresentationProducer,
  AncestryRepresentationProducerOptions,
  PackageAncestryNodeData,
  PackageAncestryNodeOptions,
  PackageAncestryOptions,
  PackageType,
} from '../interfaces';
import * as pkgUtils from '../utils/packageUtils';
import { PackageVersion } from './packageVersion';
import { Package } from './package';
import { VersionNumber } from './versionNumber';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package_ancestry');

const SELECT_PACKAGE_VERSION =
  'SELECT AncestorId, SubscriberPackageVersionId, MajorVersion, MinorVersion, PatchVersion, BuildNumber FROM Package2Version';

// Add this to query calls to only show released package versions in the output
const releasedOnlyFilter = ' AND IsReleased = true';

const sortAncestryNodeData = (a: AncestryRepresentationProducer, b: AncestryRepresentationProducer): number => {
  const aVersion = new VersionNumber(
    a.options.node.MajorVersion,
    a.options.node.MinorVersion,
    a.options.node.PatchVersion,
    a.options.node.BuildNumber
  );
  const bVersion = new VersionNumber(
    b.options.node.MajorVersion,
    b.options.node.MinorVersion,
    b.options.node.PatchVersion,
    b.options.node.BuildNumber
  );
  return aVersion.compareTo(bVersion);
};
/**
 * A class that represents the package ancestry graph.
 * Given a package Id (0Ho) or a package version Id (04t), it will build a graph of the package's ancestors.
 */
export class PackageAncestry extends AsyncCreatable<PackageAncestryOptions> {
  #requestedPackageId: string;
  private graph: DirectedGraph = new DirectedGraph<PackageAncestryNode, Attributes, Attributes>();
  private roots: PackageAncestryNode[];
  public constructor(private options: PackageAncestryOptions) {
    super(options);
  }

  public get requestedPackageId(): string {
    return this.#requestedPackageId;
  }

  public async init(): Promise<void> {
    await this.buildAncestryTree();
  }

  /**
   * Returns the internal representation of the requested package ancestry graph.
   */
  public getAncestryGraph(): DirectedGraph<Attributes, Attributes, Attributes> {
    return this.graph;
  }

  /**
   * Convenience method to get the json representation of the package ancestry graph.
   */
  public getJsonProducer(): AncestryRepresentationProducer {
    return this.getRepresentationProducer(
      (opts: AncestryRepresentationProducerOptions) => new AncestryJsonProducer(opts),
      this.requestedPackageId
    );
  }

  /**
   * Convenience method to get the CliUx.Tree representation of the package ancestry graph.
   */
  public getTreeProducer(verbose: boolean): AncestryRepresentationProducer {
    return this.getRepresentationProducer(
      (opts: AncestryRepresentationProducerOptions) => new AncestryTreeProducer({ ...opts, verbose: !!verbose }),
      this.requestedPackageId
    );
  }

  /**
   * Convenience method to get the dot representation of the package ancestry graph.
   */
  public getDotProducer(): AncestryRepresentationProducer {
    return this.getRepresentationProducer(
      (opts: AncestryRepresentationProducerOptions) => new AncestryDotProducer(opts),
      this.requestedPackageId
    );
  }

  /**
   * Returns the producer representation of the package ancestry graph.
   *
   * @param producerCtor - function that returns a new instance of the producer
   * @param root - the subscriber package version id of the root node
   */
  public getRepresentationProducer(
    producerCtor: (options?: AncestryRepresentationProducerOptions) => AncestryRepresentationProducer,
    root: string | undefined
  ): AncestryRepresentationProducer {
    const treeRoot = root
      ? this.graph.findNode(
          (node, attributes: { node: { SubscriberPackageVersionId: string } }) =>
            attributes.node.SubscriberPackageVersionId === root
        )
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

  /**
   * Returns a list of ancestry nodes that represent the path from subscriber package version id to the root of the
   * package ancestry tree.
   *
   * @param subscriberPackageVersionId
   */
  public getLeafPathToRoot(subscriberPackageVersionId?: string): PackageAncestryNode[][] {
    const root = this.graph.findNode(
      (node, attributes: { node: { AncestorId: string } }) => attributes.node.AncestorId === null
    );
    const paths: PackageAncestryNode[][] = [];
    let path: PackageAncestryNode[] = [];
    let previousDepth = 0;
    dfsFromNode(this.graph, root, (node, attr: { node: PackageAncestryNode }, depth) => {
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
    return (
      paths
        .filter(
          // eslint-disable-next-line @typescript-eslint/no-shadow
          (path) =>
            path.length > 0 && // don't care about zero length paths
            (!subscriberPackageVersionId ||
              path.some((node) => node.SubscriberPackageVersionId === subscriberPackageVersionId))
        )
        // eslint-disable-next-line @typescript-eslint/no-shadow
        .map((path) => path.reverse())
        // eslint-disable-next-line @typescript-eslint/no-shadow
        .map((path) => {
          const subscriberPackageVersionIdIndex = path.findIndex(
            (node) => node.SubscriberPackageVersionId === subscriberPackageVersionId
          );
          return path.slice(subscriberPackageVersionIdIndex === -1 ? 0 : subscriberPackageVersionIdIndex);
        })
    );
  }

  private async buildAncestryTree(): Promise<void> {
    this.roots = await this.getRoots();
    await this.buildAncestryTreeFromRoots(this.roots);
  }

  private async getRoots(): Promise<PackageAncestryNode[]> {
    let roots: PackageAncestryNode[] = [];
    this.#requestedPackageId =
      this.options.project.getPackageIdFromAlias(this.options.packageId) ?? this.options.packageId;
    switch (this.requestedPackageId.slice(0, 3)) {
      case '0Ho':
        pkgUtils.validateId(pkgUtils.BY_LABEL.PACKAGE_ID, this.requestedPackageId);
        roots = await this.findRootsForPackage();
        break;
      case '04t':
        pkgUtils.validateId(pkgUtils.BY_LABEL.SUBSCRIBER_PACKAGE_VERSION_ID, this.requestedPackageId);
        roots = await this.findRootsForPackageVersion();
        break;
      default:
        throw messages.createError('idOrAliasNotFound', [this.requestedPackageId]);
    }
    await this.validatePackageType();
    return roots;
  }

  private async findRootsForPackageVersion(): Promise<PackageAncestryNode[]> {
    // Start with the node, and shoot up
    let node = await this.getPackageVersion(this.requestedPackageId);
    while (node.AncestorId !== null) {
      // eslint-disable-next-line no-await-in-loop
      const ancestor = await this.getPackageVersion(node.AncestorId);
      this.addToGraph(ancestor, node);
      node = ancestor;
    }
    return [node];
  }

  private async validatePackageType(): Promise<void> {
    // Check to see if the package version is part of an unlocked package
    // if so, throw an error since ancestry only applies to managed packages
    let packageType: PackageType;
    switch (this.requestedPackageId.slice(0, 3)) {
      case '04t':
        // eslint-disable-next-line no-case-declarations
        const packageVersion = new PackageVersion({
          idOrAlias: this.requestedPackageId,
          project: this.options.project,
          connection: this.options.connection,
        });
        packageType = await packageVersion.getPackageType();
        break;
      case '0Ho':
        // eslint-disable-next-line no-case-declarations
        const pkg = new Package({
          packageAliasOrId: this.requestedPackageId,
          project: this.options.project,
          connection: this.options.connection,
        });
        packageType = await pkg.getType();
        break;
    }

    if (packageType !== 'Managed') {
      throw messages.createError('unlockedPackageError');
    }
  }

  private async getPackageVersion(nodeId: string): Promise<PackageAncestryNode> {
    const query = `${SELECT_PACKAGE_VERSION} WHERE SubscriberPackageVersionId = '${nodeId}'`;

    try {
      const results = await this.options.connection.singleRecordQuery<PackageAncestryNode>(query, {
        tooling: true,
      });
      return new PackageAncestryNode(results);
    } catch (e) {
      if ((e as Error).message.includes('No record found for')) {
        throw messages.createError('versionNotFound', [nodeId]);
      }
      throw e;
    }
  }

  private async findRootsForPackage(): Promise<PackageAncestryNode[]> {
    // Check to see if the package is an unlocked package
    // if so, throw and error since ancestry only applies to managed packages
    await this.validatePackageType();
    const normalQuery = `${SELECT_PACKAGE_VERSION} WHERE AncestorId = NULL AND Package2Id = '${this.requestedPackageId}' ${releasedOnlyFilter}`;
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
      // eslint-disable-next-line no-await-in-loop
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

export class AncestryTreeProducer extends Tree implements AncestryRepresentationProducer {
  public label: string;
  public options: AncestryRepresentationProducerOptions;
  private verbose = false;
  public constructor(options?: AncestryRepresentationProducerOptions) {
    super();
    this.options = options;
    this.label = this.options?.node?.getVersion() || 'root';
    this.verbose = this.options?.verbose || false;
  }

  public addNode(node: AncestryTreeProducer): void {
    const label = this.createLabel(node);
    this.insert(label, node);
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
          delete producer.nodes[this.createLabel(child)];
          producer.addNode(child);
          producers.push(child);
        });
    }
    this.display(this.options ? this.options['logger'] : undefined);
  }

  private createLabel(node: AncestryTreeProducer): string {
    const subscriberId =
      this.verbose && node?.options?.node?.SubscriberPackageVersionId
        ? ` (${node.options.node.SubscriberPackageVersionId})`
        : '';
    return node?.label ? `${node.label}${subscriberId}` : 'root';
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

  public produce<PackageAncestryNodeData>(): PackageAncestryNodeData {
    const producers: AncestryJsonProducer[] = [];
    producers.push(this);

    while (producers.length > 0) {
      const producer = producers.shift();
      producer.children.sort(sortAncestryNodeData);
      producers.push(...producer.children);
    }

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
      producer.children.sort(sortAncestryNodeData);
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
    return `strict graph G {${EOL}${dotLines.join(EOL)}${EOL}}`;
  }
}

export class PackageAncestryNode extends AsyncCreatable<PackageAncestryNodeOptions> implements Attributes {
  readonly #version: VersionNumber;
  readonly #MajorVersion: number;
  readonly #MinorVersion: number;
  readonly #PatchVersion: number;
  readonly #BuildNumber: number | string;
  readonly #AncestorId: string;
  readonly #SubscriberPackageVersionId: string;
  readonly #depthCounter: number;

  public constructor(public options: PackageAncestryNodeOptions) {
    super(options);
    this.#version = new VersionNumber(
      this.options.MajorVersion,
      this.options.MinorVersion,
      this.options.PatchVersion,
      this.options.BuildNumber
    );
    this.#AncestorId = this.options.AncestorId;
    this.#SubscriberPackageVersionId = this.options.SubscriberPackageVersionId;
    this.#MajorVersion =
      typeof this.options.MajorVersion === 'number'
        ? this.options.MajorVersion
        : parseInt(this.options.MajorVersion, 10);
    this.#MinorVersion =
      typeof this.options.MinorVersion === 'number'
        ? this.options.MinorVersion
        : parseInt(this.options.MinorVersion, 10);
    this.#PatchVersion =
      typeof this.options.PatchVersion === 'number'
        ? this.options.PatchVersion
        : parseInt(this.options.PatchVersion, 10);
    this.#BuildNumber = this.options.BuildNumber;
  }

  public get AncestorId(): string {
    return this.#AncestorId;
  }

  public get SubscriberPackageVersionId(): string {
    return this.#SubscriberPackageVersionId;
  }

  public get version(): VersionNumber {
    return this.#version;
  }

  public get MinorVersion(): number {
    return this.#MinorVersion;
  }

  public get PatchVersion(): number {
    return this.#PatchVersion;
  }

  public get BuildNumber(): number | string {
    return this.#BuildNumber;
  }
  public get MajorVersion(): number {
    return this.#MajorVersion;
  }

  public get depthCounter(): number {
    return this.#depthCounter;
  }

  public getVersion(): string {
    return this.#version.toString();
  }
  // eslint-disable-next-line class-methods-use-this
  protected init(): Promise<void> {
    return Promise.resolve();
  }
}
