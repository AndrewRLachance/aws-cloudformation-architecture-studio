# AWS CloudFormation Architecture Studio

A local-first AWS architecture editor for creating diagrams, importing CloudFormation, reconciling updated templates, applying deterministic ELK layouts, and exporting normalized diagrams and CloudFormation bundles.

The interface uses an AWS-console-inspired navy, slate, and orange visual system with high-contrast focus states, compound-boundary styling, semantic edge treatments, and a responsive CSS Grid editor shell.

## Architectural assumptions

1. **The normalized document is the diagram source of truth; imported canonical ASTs are the CloudFormation source of truth.** React Flow is an interaction adapter, and generation overlays supported edits onto cloned authored templates.
2. **Physical containment and deployment ownership are independent.** `physicalParentId` is used only for valid physical containment. `stackId`, `stackSetId`, `stackInstanceId`, logical groups, controls, and security groups remain orthogonal.
3. **CloudFormation import is local and semantic.** Original source text and the canonical AST are retained. Macros, transforms, dynamic references, unknown properties, and unknown resource types are preserved rather than executed or discarded.
4. **Imports are planned before commit.** Parsing and reconciliation create immutable previews. Store commit is atomic and one-step undoable.
5. **StackSet instances are normalized deployment records.** The canonical template is stored once; account/Region instance visuals are derived projections.
6. **Layout is a command, never a render side effect.** ELK runs in a worker in supported browsers, with stale-result suppression and a main-thread executor for unsupported environments and deterministic tests.
7. **AWS APIs are optional future adapters.** The delivered application needs no credentials or network access. `CloudFormationGateway` defines the integration port without coupling local import to AWS SDK behavior.

## Implemented capabilities

- Manual AWS resource and boundary creation from a searchable, keyboard-accessible palette.
- Controlled React Flow canvas with custom nodes, semantic edges, minimap, grid, zoom, fit, selection, copy/paste, duplicate, delete, locking, pinning, z-order, detach/reparent, context menus, and presentation mode.
- Central physical-containment policy and absolute/relative coordinate conversion.
- JSON and YAML CloudFormation parsing, including required short-form intrinsic tags.
- Raw template, `get-template`, stack metadata, multi-file/ZIP, multi-stack manifest, StackSet, paginated StackSet instance, and re-import workflows with immutable analysis and graphical association resolution.
- Unified fidelity analysis for explicit intrinsics, ordered property-aware relationship rules, static `Fn::ForEach` projections, SAM resources/events, CDK construct metadata, symbolic cross-stack exports/imports, and unresolved nested-stack representation.
- Original template retention with searchable, highlighted source views, exact source-path navigation, recursive re-import diffs, and semantic-resource inspection.
- CloudFormation-aware property editing backed by lazy-loaded, pinned AWS and SAM specifications; intrinsic functions and unknown/custom types remain lossless.
- Semantic relationship creation and editing with optional CloudFormation property paths and same-stack or cross-stack generation.
- Lossless CloudFormation generation by stack, StackSet, and nested deployment group; validation and semantic round-trip reports; deployment-metadata artifacts; version-three generation manifests; JSON/YAML/ZIP export; normalized diagram JSON export; and configurable PNG, SVG, and tiled PDF diagram export.
- Schema-versioned serialization at version 6, v1–v5 migration, forward-version rejection, referential and CloudFormation semantic validation, local storage, and debounced autosave.
- Precision diagram editing with alignment guides and snapping, align/distribute commands, contained-boundary resizing, sibling-scoped z-order, configurable grid spacing, and configurable keyboard nudging.
- Built-in AWS architecture starters and patterns plus a browser-local reusable selection library with collision-safe insertion.
- Visual annotations, review comments, automatic/manual legends, free-form text, mixed-selection bulk editing, and document-scoped account/Region/stack/StackSet/service/validation filters.
- Shared, accessible operation progress for import, parsing, reconciliation, layout, CloudFormation/ZIP generation, image capture, and PDF rendering.
- Deterministic ELK layered layout for physical compounds, selected scopes, and newly imported nodes; locked and pinned nodes are excluded.
- Bounded command history with one movement transaction per drag and one transaction per import, re-import, resize, or layout.
- Seed architecture covering Organization, OU, accounts, Regions, VPC, AZs, subnets, ALB, ECS, RDS, S3, DynamoDB, IAM, security groups, StackSet instances, cross-stack references, and cross-account role assumption.

## Requirements

- Node.js **22.12 or newer**
- npm **10 or newer**
- Chromium installed by Playwright, or a system Chromium/Chrome executable

## Setup

```bash
npm ci
npx playwright install chromium
npm run dev
```

Open the Vite URL printed in the terminal.

For a system browser instead of the Playwright-managed browser:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run test:e2e
```

## Commands

```bash
npm run dev          # Vite development server
npm run typecheck    # strict TypeScript project build
npm run lint         # ESLint flat-config verification
npm run test         # Vitest unit and component suites
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Playwright real-browser interaction regression
npm run build        # TypeScript + optimized Vite production build
npm run check        # all verification commands in release order
npm run update:cfn-spec # refresh the pinned us-east-1 resource specification
```

## Exact dependency versions

### Runtime

| Package | Version |
|---|---:|
| React / React DOM | 19.2.7 |
| Vite | 8.0.16 |
| TypeScript | 6.0.3 |
| `@xyflow/react` | 12.11.0 |
| Zustand | 5.0.14 |
| `elkjs` | 0.11.1 |
| `yaml` | 2.9.0 |
| Zod | 4.4.3 |
| JSZip | 3.10.1 |
| `html-to-image` | 1.11.13 |
| jsPDF | 4.2.1 |
| PrismJS | 1.30.0 |

### Verification tooling

| Package | Version |
|---|---:|
| Vitest | 4.1.9 |
| React Testing Library | 16.3.2 |
| Playwright | 1.61.0 |
| ESLint | 9.39.1 |
| `typescript-eslint` | 8.61.1 |

Every version is exact in `package.json` and `package-lock.json`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [CloudFormation import formats](docs/CLOUDFORMATION_IMPORT.md)
- [Diagram exports](docs/EXPORTS.md)
- [Import manifest schema](docs/IMPORT_MANIFEST.md)
- [Security model](docs/SECURITY.md)
- [Verification report](docs/VERIFICATION.md)
- [Complete file structure](docs/FILE_STRUCTURE.txt)

## Known limitations

- Remote nested-stack `TemplateURL` documents are never fetched. A nested deployment group and external reference remain visible until a local child template is associated.
- CloudFormation transforms and macros are never executed. Statically resolvable `Fn::ForEach` declarations receive an analysis-only projection, SAM resources are modeled without low-level translation, and all authored transform syntax remains canonical.
- Ambiguous or low-confidence top-level associations and every nested association require explicit confirmation. A confirmed “no local child” remains visible as a nonblocking `TemplateURL` reference.
- Property-aware relationship inference covers curated networking, load balancing, compute/serverless, IAM/KMS, storage/database, messaging/event, observability, configuration, and edge/DNS families; unmatched explicit references use a conservative generic relationship.
- Property validation uses bundled `us-east-1` CloudFormation and SAM specifications. Region-specific differences and macro-expanded custom schemas are not inferred.
- Browser canvas limits vary. The export dialog rejects unsafe PNG dimensions; PDF avoids a single oversized canvas by rendering tiles independently.
- There is no authenticated AWS API implementation in this repository. The gateway is an explicit port for a later adapter.
