# Architecture

## Layering

```text
UI components
    ↓
Application commands and services
    ↓
Normalized Zustand store
    ↓
Domain model, schemas, validation
    ↓
Importers, analyzers, generators, layout, persistence, serializers
```

React components do not parse CloudFormation, migrate documents, decide containment, run graph construction, or generate templates.

## Normalized document

`DiagramDocument` persists:

- schema version, metadata, provenance, and revision metadata;
- `nodesById` plus deterministic node order;
- `edgesById` plus deterministic edge order;
- deployment groups, logical groups, StackSet instances, templates, and import sources;
- viewport, preferences, view mode, layers, and layout preferences.

Selection, clipboard, interaction baselines, undo/redo stacks, import preview, layout state, validation, autosave status, pending connections, source navigation, inspector navigation, and operation progress remain transient editor state in `useDiagramStore`.

Schema version 5 adds fidelity analysis, transform/dialect records, analysis projections, CDK metadata, and read-only deployment artifacts. Versions 1–4 migrate locally; v4 records receive deterministic analysis defaults. A nested deployment group's `templateId` remains the authoritative child-template ownership link.

## Domain invariants

`physicalParentId` can represent only actual physical or administrative containment. The central `containmentPolicy` is called by drag reparenting, detachment, import placement, layout result validation, programmatic commands, and tests.

Deployment and semantic relationships remain independent:

- `stackId`
- `stackSetId`
- `stackInstanceId`
- `logicalGroupIds`
- `attachedControlIds`
- `securityGroupIds`
- `sourceTemplateId`
- `sourceLogicalId`

React Flow `parentId` is derived only from `physicalParentId`. Parent nodes are topologically ordered before children in the adapter.

## CloudFormation source model

Each imported template retains its original filename, format, source text, canonical AST, top-level sections, resource map, source identity, SHA-256 content hash, source-path locations, timestamps, diagnostics, dialects, ordered transform records, and derived fidelity projection.

The parser accepts `unknown`, validates the top-level template shape, canonicalizes CloudFormation YAML short tags, and does not execute code, macros, includes, URLs, or remote content. The shared analyzer safely expands only statically resolvable `Fn::ForEach` loops. Projection nodes are selectable and layoutable but cannot mutate or delete authored CloudFormation.

The CloudFormation property editor lazy-loads the bundled `us-east-1` AWS resource specification plus pinned SAM descriptors. Required/type violations block Apply; unknown resource types and properties are warnings and remain lossless. No runtime network request is used for schema validation.

Semantic validation runs after import, edits, load, undo/redo, and before generation. It covers observable CloudFormation quotas, names, collisions, resource and stack dependency cycles, export scopes, and transform-analysis confidence. Import remains inspectable when these checks fail; CloudFormation exports are blocked until errors are resolved.

## Import transaction

1. Input files and ZIP entries are normalized and sorted.
2. Files are classified as templates, import manifests, CDK cloud assemblies, deployment metadata, stack metadata, StackSet metadata, or instance pages.
3. Templates are parsed independently once; errors become file-specific diagnostics.
4. Immutable analysis ranks stack/StackSet identities and nested associations with confidence and evidence.
5. User resolutions build plans from retained ASTs without reparsing. Ambiguous/low-confidence top-level matches and every nested match require confirmation; identity collisions block commit.
6. StackSet desired target groups and operation preferences are validated independently from observed concrete instances.
7. The immutable plan and reconciliation are previewed.
8. Commit merges or replaces the document in one Zustand command and one history entry.

A plan with blocking diagnostics cannot mutate the store. Identical source identity plus identical content hashes is idempotent.

## Re-import

Resource matching uses deployment owner, logical ID, and CloudFormation resource type. Reconciliation calculates added, removed, and changed resources; recursive property diffs with before/after values; edge changes; parameter/output changes; and StackSet instance changes.

Unchanged and changed resources preserve stable IDs, position, valid physical parent, logical memberships, controls, security associations, lock, pin, collapse, z-order, and user metadata. New resources retain import positions and can be laid out independently. A default removed-resource policy can be overridden per resource: remove, detach to manual, or mark removed.

## Nested and StackSet ownership

Each `AWS::CloudFormation::Stack` resource has a nested deployment group identifying the exact parent resource. Confirmed local child templates can be reused by multiple nested deployments; each group owns its generated child artifact through `templateId`. Confirmed unresolved children keep their external `TemplateURL` representation and do not block commit.

StackSet target groups represent desired accounts, organization roots/OUs, Regions, parameter overrides, account filters, and operation preferences. Imported StackSet instances remain observed deployment records and are never conflated with desired targets. Generation manifest version 3 exports both views plus validation, round-trip, CDK, and deployment-metadata references.

## Lossless generation

Generation clones each canonical AST and overlays supported diagram edits. Unknown sections, macros, loops, CDK helpers, and unmodeled resources remain present. Canonical comparison ignores object-key order and equivalent `Fn::GetAtt` spelling while preserving array order. Unexpected loss and semantic errors set `canExport=false`; diagram JSON and image exports remain independent.

## Source and relationship workflows

Prism renders retained and generated YAML/JSON, individual resources, and diffs with line numbers and local search. Parser-recorded paths allow **Go to source** to choose the original source and focus the exact line, with logical-ID search as a fallback.

Canvas connections are staged until a semantic relationship is selected. Self-links and exact duplicates are rejected. A relationship can remain visual-only or carry a CloudFormation property path used by same-stack and cross-stack generation.

## Export and progress services

The shared diagram capture service calculates full or viewport bounds and filters editor-only controls. It exports scaled PNG/SVG and renders PDF pages as independent, overlapping tiles through lazy-loaded jsPDF. A transient progress model reports file reading, ZIP expansion, parsing, analysis, reconciliation, layout, generation, image capture, and PDF page rendering through dialogs, the activity panel, and ARIA announcements.

## Layout

`DiagramLayoutService` converts the normalized domain into a deterministic ELK compound graph. It uses the layered algorithm with fully qualified `elk.*` options, stable ordering, orthogonal routing, fixed seed, density presets, and direction controls.

The browser executor uses a Vite module worker. Requests carry IDs; a late result is ignored when a newer request has become current. Locked and pinned nodes are omitted. Result application revalidates containment, converts ELK child coordinates to React Flow parent-relative coordinates, resizes compound boundaries, and applies a single store command only when differences exceed the configured epsilon.

## Controlled React Flow and loop prevention

- One source of truth for nodes, edges, positions, dimensions, and selection.
- Selection is processed only through node/edge change events.
- Equivalent selection and position updates return the prior Zustand state.
- Drag start captures one document baseline; pointer movement is transient; drag stop creates one history entry.
- Measurement updates under 0.5 px are ignored.
- Static node/edge registries and React Flow configuration live at module scope.
- Components use narrow Zustand selectors.
- No layout, parsing, template generation, or store writes occur during render.
- Autosave subscribes to persisted revision changes rather than transient pointer updates.

## Persistence

`LocalStorageDiagramRepository` serializes a deterministic JSON document. The decoder validates unknown input with Zod, migrates supported historical versions, rejects malformed or forward-version documents, and performs referential-integrity validation before returning a document.

## Security boundary

The application is local-first. File parsing never evaluates JavaScript, expands macros, follows URLs, or requests AWS credentials. ZIP input accepts only JSON/YAML entries. AWS integration is represented by the `CloudFormationGateway` port and is not required by any delivered workflow.
