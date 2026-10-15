/**
 * @file Core architecture domain model.
 * @module domain/types
 * @author AWS CloudFormation Architecture Studio contributors
 * @license UNLICENSED
 * @description This file defines persisted document, node, edge, import, layout, validation, and generation types.
 */
/** Unique string identifier used for every persisted diagram entity. */
export type EntityId = string;
/** Primitive JSON value accepted in user metadata. */
export type JsonPrimitive = string | number | boolean | null;
/** Recursive JSON-compatible value accepted in persisted metadata. */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
/** Two-dimensional canvas coordinate in diagram units. */
export type Point = Readonly<{ x: number; y: number }>;
/** Width and height pair used by nodes and layout results. */
export type Size = Readonly<{ width: number; height: number }>;

/** One-based source location for a canonical CloudFormation path. */
export interface SourceLocation {
  readonly line: number;
  readonly column: number;
  readonly endLine?: number;
  readonly endColumn?: number;
}

/** Physical AWS containment boundary types shown on the canvas. */
export type BoundaryType =
  | 'organization'
  | 'organizational-unit'
  | 'account'
  | 'region'
  | 'vpc'
  | 'availability-zone'
  | 'subnet';

/** Normalized AWS service categories used for resource rendering and palettes. */
export type AwsResourceType =
  | 'ec2'
  | 'alb'
  | 'nlb'
  | 'ecs'
  | 'eks'
  | 'lambda'
  | 'lambda-layer'
  | 'step-functions'
  | 'appsync'
  | 'serverless-application'
  | 'serverless-connector'
  | 'api-gateway'
  | 'rds'
  | 'dynamodb'
  | 's3'
  | 'sqs'
  | 'sns'
  | 'eventbridge'
  | 'kinesis'
  | 'elasticache'
  | 'secrets-manager'
  | 'ssm-parameter'
  | 'cloudfront'
  | 'route53'
  | 'iam-role'
  | 'iam-policy'
  | 'security-group'
  | 'route-table'
  | 'nat-gateway'
  | 'internet-gateway'
  | 'vpc-endpoint'
  | 'vpc-peering'
  | 'transit-gateway'
  | 'nested-stack'
  | 'cloudformation-generic';

/** Governance and security control categories supported by the model. */
export type ControlType = 'service-control-policy' | 'config-rule' | 'guardrail' | 'kms-key' | 'waf' | 'shield';
/** Semantic relationship labels used for diagram edges and imported references. */
export type RelationshipType =
  | 'network-traffic'
  | 'depends-on'
  | 'imports-cloudformation-output'
  | 'references-resource'
  | 'assumes-role'
  | 'trusts-principal'
  | 'permits-access'
  | 'denies-access'
  | 'associated-with'
  | 'routes-through'
  | 'shares-through-aws-ram'
  | 'publishes-event'
  | 'subscribes-to-event'
  | 'reads-from'
  | 'writes-to'
  | 'replicates-to'
  | 'deploys-to'
  | 'stackset-manages-stack-instance'
  | 'nested-stack'
  | 'external-unresolved-reference';

/** Inspector tabs available for selected nodes and edges. */
export type InspectorTab =
  | 'properties'
  | 'placement'
  | 'stack-membership'
  | 'logical-groups'
  | 'security'
  | 'relationships'
  | 'validation'
  | 'template';

/** Current selected node and edge identifiers. */
export interface SelectionState {
  readonly nodeIds: readonly EntityId[];
  readonly edgeIds: readonly EntityId[];
}

/** Top-level presentation modes for the architecture workspace. */
export type ViewMode = 'infrastructure' | 'deployment' | 'security' | 'cloudformation-source';
/** Toggleable visual layer identifiers used by React Flow adapters. */
export type LayerId =
  | 'administrative-boundaries'
  | 'network-boundaries'
  | 'aws-resources'
  | 'stack-overlays'
  | 'stackset-overlays'
  | 'stack-instance-overlays'
  | 'logical-overlays'
  | 'iam-governance'
  | 'security-groups'
  | 'network-traffic'
  | 'deployment-dependencies'
  | 'data-flow'
  | 'external-references'
  | 'import-diagnostics'
  | 'labels-metadata'
  | 'review-comments';

/** A presentation annotation attached to an architecture node. */
export interface NodeAnnotation {
  readonly id: EntityId;
  readonly label: string;
  readonly body?: string;
  readonly tone: 'info' | 'success' | 'warning' | 'critical' | 'neutral';
  readonly color: string;
}

/** Shared persisted properties present on every diagram node. */
export interface NodeBase {
  readonly id: EntityId;
  readonly name: string;
  readonly position: Point;
  readonly size: Size;
  readonly physicalParentId?: EntityId;
  readonly stackId?: EntityId;
  readonly stackSetId?: EntityId;
  readonly stackInstanceId?: EntityId;
  readonly logicalGroupIds: readonly EntityId[];
  readonly attachedControlIds: readonly EntityId[];
  readonly securityGroupIds: readonly EntityId[];
  readonly sourceTemplateId?: EntityId;
  readonly sourceLogicalId?: string;
  readonly sourceResourceType?: string;
  readonly sourcePropertyPath?: string;
  /** Provenance for a resource projected from a transform rather than authored as a concrete resource. */
  readonly sourceProjection?: Readonly<{
    kind: 'foreach';
    loopName: string;
    iterationValue: string;
    sourcePath: string;
  }>;
  /** AWS CDK construct path retained from resource metadata. */
  readonly cdkConstructPath?: string;
  /** True for CDK framework/bootstrap resources that remain losslessly exportable. */
  readonly cdkHelper?: boolean;
  readonly locked: boolean;
  readonly pinned: boolean;
  readonly collapsed: boolean;
  readonly zIndex: number;
  readonly userMetadata: Readonly<Record<string, JsonValue>>;
  readonly diagramTags: Readonly<Record<string, string>>;
  readonly annotations: readonly NodeAnnotation[];
  readonly importStatus?: 'imported' | 'changed' | 'removed' | 'manual';
  readonly placementConfidence?: 'high' | 'medium' | 'low' | 'unresolved';
}

/** Physical or administrative AWS boundary that can contain other nodes. */
export interface BoundaryNode extends NodeBase {
  readonly kind: 'boundary';
  readonly boundaryType: BoundaryType;
  readonly accountId?: string;
  readonly regionName?: string;
  readonly availabilityZoneName?: string;
  readonly cidr?: string;
  /** Editable CloudFormation resource data for imported VPC and subnet boundaries. */
  readonly cloudFormation?: Readonly<{
    type: string;
    properties: Readonly<Record<string, unknown>>;
    condition?: string;
    metadata?: Readonly<Record<string, unknown>>;
    deletionPolicy?: string;
    updateReplacePolicy?: string;
  }>;
}

/** CloudFormation-backed or manually created AWS resource node. */
export interface AwsResourceNode extends NodeBase {
  readonly kind: 'aws-resource';
  readonly resourceType: AwsResourceType;
  readonly cloudFormationType: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly condition?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly deletionPolicy?: string;
  readonly updateReplacePolicy?: string;
}

/** Governance or security control node attached to architecture elements. */
export interface ControlNode extends NodeBase {
  readonly kind: 'control';
  readonly controlType: ControlType;
  readonly properties: Readonly<Record<string, unknown>>;
}

/** Unresolved dependency target outside the imported or modeled templates. */
export interface ExternalReferenceNode extends NodeBase {
  readonly kind: 'external-reference';
  readonly referenceType: 'cloudformation-export' | 'arn' | 'parameter' | 'resource' | 'principal' | 'template-url';
  readonly referenceValue: string;
  readonly resolved: boolean;
}

/** Visual-only free-form text that is never emitted to CloudFormation. */
export interface TextNode extends NodeBase {
  readonly kind: 'text';
  readonly text: string;
  readonly style: Readonly<{
    fontSize: number;
    fontWeight: 'normal' | 'bold';
    alignment: 'left' | 'center' | 'right';
    color: string;
    backgroundColor?: string;
  }>;
}

/** One manually curated legend entry. */
export interface LegendEntry {
  readonly id: EntityId;
  readonly label: string;
  readonly description?: string;
  readonly color: string;
  readonly symbol?: string;
}

/** Visual-only automatic or manually curated diagram legend. */
export interface LegendNode extends NodeBase {
  readonly kind: 'legend';
  readonly title: string;
  readonly mode: 'automatic' | 'manual';
  readonly entries: readonly LegendEntry[];
}

/** Union of every node kind stored in a diagram document. */
export type DiagramNode = BoundaryNode | AwsResourceNode | ControlNode | ExternalReferenceNode | TextNode | LegendNode;

/** A lightweight local review comment anchored to the canvas or a node. */
export interface DiagramComment {
  readonly id: EntityId;
  readonly message: string;
  readonly target:
    | Readonly<{ kind: 'canvas'; position: Point }>
    | Readonly<{ kind: 'node'; nodeId: EntityId; offset: Point }>;
  readonly resolved: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Facets stored for one reusable diagram filter. */
export interface SavedFilterCriteria {
  readonly accountIds: readonly string[];
  readonly regions: readonly string[];
  readonly stackIds: readonly EntityId[];
  readonly stackSetIds: readonly EntityId[];
  readonly awsServices: readonly string[];
  readonly validationStatuses: readonly ('valid' | 'warning' | 'error' | 'unresolved')[];
}

/** Named document-local visibility filter. */
export interface SavedFilter {
  readonly id: EntityId;
  readonly name: string;
  readonly criteria: SavedFilterCriteria;
}

/** Persisted semantic relationship between two diagram nodes. */
export interface DiagramEdge {
  readonly id: EntityId;
  readonly source: EntityId;
  readonly target: EntityId;
  readonly relationshipType: RelationshipType;
  readonly sourceHandle?: string;
  readonly targetHandle?: string;
  readonly label?: string;
  readonly description?: string;
  readonly direction: 'forward' | 'reverse' | 'bidirectional' | 'none';
  readonly protocol?: string;
  readonly port?: string;
  readonly metadata: Readonly<Record<string, JsonValue>>;
  readonly sourcePropertyPath?: string;
  readonly sourceTemplateId?: EntityId;
  readonly importProvenance?: ImportProvenance;
  readonly validationStatus: 'valid' | 'warning' | 'error' | 'unresolved';
}

/** Shared metadata for stack, StackSet, and nested-stack deployment groups. */
export interface DeploymentGroupBase {
  readonly id: EntityId;
  readonly name: string;
  readonly nodeIds: readonly EntityId[];
  readonly description?: string;
  readonly metadata: Readonly<Record<string, JsonValue>>;
}

/** CloudFormation stack ownership, parameters, outputs, and member nodes. */
export interface StackDeploymentGroup extends DeploymentGroupBase {
  readonly kind: 'stack';
  readonly accountId?: string;
  readonly region?: string;
  readonly templateId?: EntityId;
  readonly status?: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly tags: Readonly<Record<string, string>>;
  readonly deploymentMetadata: readonly DeploymentMetadataArtifact[];
}

/** Read-only AWS deployment metadata supplied beside a template. */
export interface DeploymentMetadataArtifact {
  readonly id: EntityId;
  readonly kind: 'stack-policy' | 'change-set' | 'termination-protection' | 'stack-drift' | 'resource-drifts' | 'unassociated';
  readonly originalFilename: string;
  readonly payload: JsonValue;
  readonly stackId?: string;
  readonly stackName?: string;
  readonly associationEvidence?: 'manifest' | 'stack-identity' | 'single-stack' | 'unassociated';
}

/** CloudFormation StackSet ownership and target-resolution state. */
export interface StackSetDeploymentGroup extends DeploymentGroupBase {
  readonly kind: 'stackset';
  readonly templateId?: EntityId;
  readonly permissionModel?: string;
  readonly unresolvedTargets: boolean;
  readonly targetGroups: readonly StackSetTargetGroup[];
  readonly operationPreferences?: StackSetOperationPreferences;
}

/** Desired targets for one StackSet stack-instances group. */
export interface StackSetTargetGroup {
  readonly id: EntityId;
  readonly accounts: readonly string[];
  readonly organizationalUnitIds: readonly string[];
  readonly accountFilterType?: 'NONE' | 'UNION' | 'INTERSECTION' | 'DIFFERENCE';
  readonly regions: readonly string[];
  readonly parameterOverrides: Readonly<Record<string, unknown>>;
}

/** CloudFormation StackSet operation execution preferences. */
export interface StackSetOperationPreferences {
  readonly concurrencyMode?: 'STRICT_FAILURE_TOLERANCE' | 'SOFT_FAILURE_TOLERANCE';
  readonly failureToleranceCount?: number;
  readonly failureTolerancePercentage?: number;
  readonly maxConcurrentCount?: number;
  readonly maxConcurrentPercentage?: number;
  readonly regionConcurrencyType?: 'SEQUENTIAL' | 'PARALLEL';
  readonly regionOrder?: readonly string[];
}

/** Nested stack relationship to its parent stack and child template state. */
export interface NestedStackDeploymentGroup extends DeploymentGroupBase {
  readonly kind: 'nested-stack';
  readonly parentStackId: EntityId;
  readonly parentResourceNodeId: EntityId;
  readonly templateUrl?: string;
  readonly templateId?: EntityId;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly unresolvedTemplate: boolean;
  readonly associationConfirmed: boolean;
}

/** Union of all CloudFormation deployment ownership groups. */
export type DeploymentGroup = StackDeploymentGroup | StackSetDeploymentGroup | NestedStackDeploymentGroup;

/** User-defined cross-cutting grouping used for visual organization. */
export interface LogicalGroup {
  readonly id: EntityId;
  readonly name: string;
  readonly nodeIds: readonly EntityId[];
  readonly description?: string;
  readonly colorToken: string;
}

/** Concrete StackSet target account and Region instance metadata. */
export interface StackInstance {
  readonly id: EntityId;
  readonly stackSetId: EntityId;
  readonly accountId: string;
  readonly region: string;
  readonly stackId?: string;
  readonly status?: string;
  readonly driftStatus?: string;
  readonly parameterOverrides: Readonly<Record<string, unknown>>;
  readonly lastOperationId?: string;
}

/** Normalized imported CloudFormation template plus source and diagnostics. */
export interface CloudFormationTemplateRecord {
  readonly id: EntityId;
  readonly stackId?: EntityId;
  readonly stackSetId?: EntityId;
  readonly originalFilename: string;
  readonly originalFormat: 'yaml' | 'json';
  readonly originalSourceText: string;
  readonly canonicalAst: Readonly<Record<string, unknown>>;
  readonly description?: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly mappings: Readonly<Record<string, unknown>>;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly rules: Readonly<Record<string, unknown>>;
  readonly transform?: unknown;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly resources: Readonly<Record<string, unknown>>;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly hooks: Readonly<Record<string, unknown>>;
  readonly unknownTopLevel: Readonly<Record<string, unknown>>;
  readonly importedAt: string;
  readonly sourceIdentity: string;
  readonly contentHash: string;
  readonly parseDiagnostics: readonly CloudFormationImportDiagnostic[];
  readonly unsupportedFeatureDiagnostics: readonly CloudFormationImportDiagnostic[];
  readonly sourceLocations: Readonly<Record<string, SourceLocation>>;
  readonly fidelity: CloudFormationFidelityAnalysis;
}

/** Supported template dialects detected without executing transforms. */
export type CloudFormationDialect = 'standard' | 'language-extensions' | 'sam' | 'cdk' | 'macro';

/** Resource exposed by the safe, non-authoritative template analysis projection. */
export interface ProjectedCloudFormationResource {
  readonly logicalId: string;
  readonly resource: Readonly<Record<string, unknown>>;
  readonly sourcePath: string;
  readonly origin: 'authored' | 'foreach';
  readonly loopName?: string;
  readonly iterationValue?: string;
}

/** Persisted fidelity analysis derived from the canonical authored AST. */
export interface CloudFormationFidelityAnalysis {
  readonly dialects: readonly CloudFormationDialect[];
  readonly confidence: 'complete' | 'partial';
  readonly transforms: readonly Readonly<{
    name: string;
    path: string;
    executionOrder: number;
    scope: 'top-level' | 'nested';
    support: 'partial' | 'preserved';
  }>[];
  readonly projectedResources: Readonly<Record<string, ProjectedCloudFormationResource>>;
  readonly projectedConditions: Readonly<Record<string, unknown>>;
  readonly projectedOutputs: Readonly<Record<string, unknown>>;
  readonly cdkConstructPaths: Readonly<Record<string, string>>;
  readonly cdkHelperLogicalIds: readonly string[];
  readonly transformDiagnostics: readonly CloudFormationImportDiagnostic[];
}

/** Fingerprint and provenance for a set of imported source files. */
export interface CloudFormationImportSource {
  readonly id: EntityId;
  readonly sourceIdentity: string;
  readonly filenames: readonly string[];
  readonly importType: 'single-stack' | 'stack-bundle' | 'multi-stack' | 'stackset' | 'reimport';
  readonly importedAt: string;
  readonly contentHashes: readonly string[];
  readonly cloudAssembly?: CloudAssemblyMetadata;
  readonly unassociatedDeploymentMetadata?: readonly DeploymentMetadataArtifact[];
}

/** Safe subset of a CDK cloud assembly manifest retained for stack association. */
export interface CloudAssemblyMetadata {
  readonly manifestVersion: string;
  readonly artifacts: readonly Readonly<{
    id: string;
    type: string;
    templateFile?: string;
    displayName?: string;
    environment?: string;
    dependencies: readonly string[];
  }>[];
  readonly assetManifestFiles: readonly string[];
}

/** Parser or importer diagnostic surfaced during CloudFormation ingestion. */
export interface CloudFormationImportDiagnostic {
  readonly id: EntityId;
  readonly filename: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly path?: string;
  readonly blocking: boolean;
}

/** Previewable set of entities produced by CloudFormation import. */
export interface CloudFormationImportPlan {
  readonly id: EntityId;
  readonly source: CloudFormationImportSource;
  readonly templates: readonly CloudFormationTemplateRecord[];
  readonly deploymentGroups: readonly DeploymentGroup[];
  readonly stackInstances: readonly StackInstance[];
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  readonly diagnostics: readonly CloudFormationImportDiagnostic[];
  readonly placementResolutions: readonly PlacementResolution[];
  readonly collisions: readonly string[];
  readonly summary: Readonly<{
    fileCount: number;
    stackCount: number;
    stackSetCount: number;
    instanceCount: number;
    resourceCount: number;
    relationshipCount: number;
    unresolvedReferenceCount: number;
    unsupportedResourceCount: number;
  }>;
  readonly reconciliation?: ReimportChangeSet;
}

/** Evidence-backed owner candidate discovered before import-plan construction. */
export interface ImportAssociationCandidate {
  readonly id: EntityId;
  readonly templateId: EntityId;
  readonly ownerKind: 'stack' | 'stackset';
  readonly ownerId: EntityId;
  readonly name: string;
  readonly accountId?: string;
  readonly region?: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly evidence: readonly string[];
  readonly metadataSource?: string;
}

/** Suggested local child for one AWS::CloudFormation::Stack resource. */
export interface NestedAssociationCandidate {
  readonly id: EntityId;
  readonly parentTemplateId: EntityId;
  readonly parentLogicalId: string;
  readonly childTemplateId: EntityId;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly score: number;
  readonly evidence: readonly string[];
}

/** Immutable parsed input reused while import associations are edited. */
export interface CloudFormationImportAnalysis {
  readonly id: EntityId;
  readonly source: CloudFormationImportSource;
  readonly templates: readonly CloudFormationTemplateRecord[];
  readonly diagnostics: readonly CloudFormationImportDiagnostic[];
  readonly associationCandidates: readonly ImportAssociationCandidate[];
  readonly nestedAssociationCandidates: readonly NestedAssociationCandidate[];
  readonly requiresAssociationConfirmation: readonly EntityId[];
  readonly draftPlan: CloudFormationImportPlan;
}

/** User-confirmed top-level template owner. */
export interface ImportAssociationResolution {
  readonly templateId: EntityId;
  readonly candidateId?: EntityId;
  readonly ownerKind: 'stack' | 'stackset';
  readonly ownerId: EntityId;
  readonly name: string;
  readonly accountId?: string;
  readonly region?: string;
  readonly confirmed: boolean;
}

/** User-confirmed local-child or intentionally unresolved nested association. */
export interface NestedAssociationResolution {
  readonly parentTemplateId: EntityId;
  readonly parentLogicalId: string;
  readonly childTemplateId?: EntityId;
  readonly disposition: 'associate' | 'leave-unresolved';
  readonly confirmed: boolean;
}

/** Commit result summary for an import operation. */
export interface CloudFormationImportResult {
  readonly committed: boolean;
  readonly sourceId?: EntityId;
  readonly addedNodeIds: readonly EntityId[];
  readonly updatedNodeIds: readonly EntityId[];
  readonly removedNodeIds: readonly EntityId[];
  readonly diagnosticIds: readonly EntityId[];
}

/** Known CloudFormation intrinsic function object shapes preserved by parsing. */
export type CloudFormationIntrinsic =
  | { readonly Ref: unknown }
  | { readonly 'Fn::GetAtt': unknown }
  | { readonly 'Fn::Sub': unknown }
  | { readonly 'Fn::Join': unknown }
  | { readonly 'Fn::Select': unknown }
  | { readonly 'Fn::Split': unknown }
  | { readonly 'Fn::FindInMap': unknown }
  | { readonly 'Fn::ImportValue': unknown }
  | { readonly 'Fn::GetStackOutput': unknown }
  | { readonly 'Fn::GetAZs': unknown }
  | { readonly 'Fn::If': unknown }
  | { readonly 'Fn::Equals': unknown }
  | { readonly 'Fn::And': unknown }
  | { readonly 'Fn::Or': unknown }
  | { readonly 'Fn::Not': unknown }
  | { readonly 'Fn::Base64': unknown }
  | { readonly 'Fn::Cidr': unknown }
  | { readonly 'Fn::Transform': unknown }
  | { readonly Condition: unknown };

/** Reference discovered inside a CloudFormation resource property path. */
export interface IntrinsicReference {
  readonly sourceLogicalId: string;
  readonly target: string;
  readonly intrinsic: string;
  readonly propertyPath: string;
  readonly relationshipType: RelationshipType;
  readonly attribute?: string;
  readonly external: boolean;
  readonly targetExpression?: unknown;
  readonly inferenceRule?: string;
  readonly inferenceConfidence?: 'high' | 'medium' | 'low';
}

/** Importer explanation for proposed physical placement of a node. */
export interface PlacementResolution {
  readonly nodeId: EntityId;
  readonly proposedParentId?: EntityId;
  readonly confidence: 'high' | 'medium' | 'low' | 'unresolved';
  readonly rationale: string;
  readonly candidates: readonly EntityId[];
}

/** Document validation issue shown in diagnostics and inspectors. */
export interface ValidationIssue {
  readonly id: EntityId;
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly nodeId?: EntityId;
  readonly edgeId?: EntityId;
  readonly path?: string;
  readonly templateId?: EntityId;
  readonly filename?: string;
}

/** Source location metadata for an imported node or edge. */
export interface ImportProvenance {
  readonly sourceId: EntityId;
  readonly templateId?: EntityId;
  readonly logicalId?: string;
  readonly propertyPath?: string;
  readonly importedAt: string;
}

/** User or import-triggered request for automatic diagram layout. */
export interface LayoutRequest {
  readonly id: EntityId;
  readonly direction: 'RIGHT' | 'DOWN';
  readonly density: 'compact' | 'balanced' | 'spacious';
  readonly mode: 'dependencies' | 'physical-hierarchy';
  readonly scope: 'all' | 'selected' | 'newly-imported';
  readonly selectedNodeIds: readonly EntityId[];
  readonly onlyUnpositioned: boolean;
  readonly createdAt: string;
}

/** Issue reported while translating automatic layout back to the domain model. */
export interface LayoutDiagnostic {
  readonly id: EntityId;
  readonly severity: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly message: string;
  readonly nodeId?: EntityId;
}

/** Positions, sizes, diagnostics, and change flag from a layout run. */
export interface LayoutResult {
  readonly requestId: EntityId;
  readonly positions: Readonly<Record<EntityId, Point>>;
  readonly sizes: Readonly<Record<EntityId, Size>>;
  readonly diagnostics: readonly LayoutDiagnostic[];
  readonly changed: boolean;
}

/** Recoverable CloudFormation generation warning tied to a document entity. */
export interface GenerationWarning {
  readonly code: string;
  readonly message: string;
  readonly nodeId?: EntityId;
  readonly edgeId?: EntityId;
  readonly stackId?: EntityId;
}

/** Blocking CloudFormation generation error tied to a document entity. */
export interface GenerationError {
  readonly code: string;
  readonly message: string;
  readonly nodeId?: EntityId;
  readonly stackId?: EntityId;
}

/** Manifest emitted beside generated templates and StackSet instance data. */
export interface GenerationManifest {
  readonly schemaVersion: 3;
  readonly generatedAt: string;
  readonly documentId: EntityId;
  readonly templates: readonly {
    readonly ownerId: EntityId;
    readonly ownerKind: 'stack' | 'stackset' | 'nested-stack';
    readonly filename: string;
    readonly format: 'yaml' | 'json';
    readonly accountId?: string;
    readonly region?: string;
    readonly parentStackId?: EntityId;
    readonly parentResourceNodeId?: EntityId;
    readonly parentLogicalId?: string;
  }[];
  readonly stackSets: readonly {
    readonly stackSetId: EntityId;
    readonly permissionModel?: string;
    readonly targetGroups: readonly StackSetTargetGroup[];
    readonly operationPreferences?: StackSetOperationPreferences;
  }[];
  readonly nestedStacks: readonly {
    readonly deploymentGroupId: EntityId;
    readonly parentStackId: EntityId;
    readonly parentResourceNodeId: EntityId;
    readonly parentLogicalId?: string;
    readonly templateId?: EntityId;
    readonly templateFilename?: string;
    readonly templateUrl?: string;
    readonly unresolvedTemplate: boolean;
    readonly associationConfirmed: boolean;
  }[];
  readonly stackInstancesFilename?: string;
  readonly warnings: readonly GenerationWarning[];
  readonly errors: readonly GenerationError[];
  readonly validationReportFilename: 'validation-report.json';
  readonly roundTripReportFilename: 'round-trip-report.json';
  readonly deploymentMetadataFiles: readonly string[];
  readonly cloudAssemblies: readonly Readonly<{
    sourceId: EntityId;
    manifestVersion: string;
    stackArtifactIds: readonly string[];
    assetManifestFiles: readonly string[];
  }>[];
}

/** Semantic comparison of an imported canonical AST and its generated AST. */
export interface RoundTripComparison {
  readonly templateId: EntityId;
  readonly filename: string;
  readonly status: 'exact' | 'expected-differences' | 'unexpected-differences';
  readonly differences: readonly Readonly<{ path: string; before?: unknown; after?: unknown; expected: boolean }>[];
}

/** Semantic diff between an existing import and a new import plan. */
export interface ReimportChangeSet {
  readonly addedResourceKeys: readonly string[];
  readonly removedResourceKeys: readonly string[];
  readonly changedResourceKeys: readonly string[];
  readonly addedEdgeFingerprints: readonly string[];
  readonly removedEdgeFingerprints: readonly string[];
  readonly changedParameters: readonly string[];
  readonly changedOutputs: readonly string[];
  readonly changedStackInstances: readonly string[];
  readonly resourceDiffs: readonly ResourceReimportDiff[];
}

/** One recursive semantic change within a re-imported resource. */
export interface PropertyChange {
  readonly path: string;
  readonly kind: 'added' | 'removed' | 'changed';
  readonly before?: unknown;
  readonly after?: unknown;
}

/** Side-by-side resource payload and property changes for re-import review. */
export interface ResourceReimportDiff {
  readonly resourceKey: string;
  readonly logicalId: string;
  readonly resourceType: string;
  readonly kind: 'added' | 'removed' | 'changed';
  readonly before?: unknown;
  readonly after?: unknown;
  readonly propertyChanges: readonly PropertyChange[];
}

/** Shared status reported by long-running import and export operations. */
export interface OperationProgress {
  readonly id: EntityId;
  readonly kind: 'import' | 'export' | 'layout';
  readonly status: 'running' | 'complete' | 'error';
  readonly phase: string;
  readonly completed: number;
  readonly total: number;
  readonly percent?: number;
  readonly message: string;
}

/** User-selected diagram image or document export behavior. */
export interface DiagramExportOptions {
  readonly format: 'png' | 'svg' | 'pdf';
  readonly scope: 'full-diagram' | 'current-viewport';
  readonly scale: 1 | 2 | 4;
  readonly transparent: boolean;
  readonly backgroundColor: string;
  readonly padding: number;
  readonly pageSize: 'letter' | 'a4' | 'a3';
  readonly orientation: 'auto' | 'portrait' | 'landscape';
  readonly tileOverlapInches: number;
}

/** Versioned persisted architecture document used as the application source of truth. */
export interface DiagramDocument {
  readonly schemaVersion: 6;
  readonly id: EntityId;
  readonly metadata: Readonly<{
    title: string;
    description: string;
    createdAt: string;
    updatedAt: string;
  }>;
  readonly nodesById: Readonly<Record<EntityId, DiagramNode>>;
  readonly nodeOrder: readonly EntityId[];
  readonly edgesById: Readonly<Record<EntityId, DiagramEdge>>;
  readonly edgeOrder: readonly EntityId[];
  readonly commentsById: Readonly<Record<EntityId, DiagramComment>>;
  readonly commentOrder: readonly EntityId[];
  readonly deploymentGroupsById: Readonly<Record<EntityId, DeploymentGroup>>;
  readonly deploymentGroupOrder: readonly EntityId[];
  readonly logicalGroupsById: Readonly<Record<EntityId, LogicalGroup>>;
  readonly logicalGroupOrder: readonly EntityId[];
  readonly stackInstancesById: Readonly<Record<EntityId, StackInstance>>;
  readonly stackInstanceOrder: readonly EntityId[];
  readonly templatesById: Readonly<Record<EntityId, CloudFormationTemplateRecord>>;
  readonly templateOrder: readonly EntityId[];
  readonly importSourcesById: Readonly<Record<EntityId, CloudFormationImportSource>>;
  readonly importSourceOrder: readonly EntityId[];
  readonly savedFiltersById: Readonly<Record<EntityId, SavedFilter>>;
  readonly savedFilterOrder: readonly EntityId[];
  readonly activeFilterId?: EntityId;
  readonly viewport: Readonly<{ x: number; y: number; zoom: number }>;
  readonly preferences: Readonly<{
    snapToGrid: boolean;
    gridSize: number;
    keyboardMoveIncrement: number;
    autosave: boolean;
    reducedMotion: boolean;
    layoutDirection: 'RIGHT' | 'DOWN';
    layoutDensity: 'compact' | 'balanced' | 'spacious';
  }>;
  readonly visibleLayers: Readonly<Record<LayerId, boolean>>;
  readonly currentViewMode: ViewMode;
  readonly layoutPreferences: Readonly<{
    algorithm: 'layered';
    onlyUnpositioned: boolean;
    epsilon: number;
  }>;
  readonly importProvenance?: Readonly<Record<EntityId, ImportProvenance>>;
  readonly revision: Readonly<{
    number: number;
    lastCommand: string;
    updatedAt: string;
  }>;
}
