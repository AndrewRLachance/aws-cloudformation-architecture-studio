# Next Steps

## P0 — Release Readiness

* [ ] Run the application locally and complete a manual smoke test covering:
  * CloudFormation import
  * Diagram editing
  * Re-import
  * CloudFormation generation
  * ZIP export
  * PNG export
  * Undo and redo
  * Local persistence
* [ ] Validate real production CloudFormation templates, including:
  * Large nested templates
  * SAM templates
  * `AWS::LanguageExtensions`
  * Uncommon intrinsic-function combinations
* [ ] Test large diagrams containing:
  * 500 resources
  * 1,000 resources
  * 2,000 resources
* [ ] Record performance for:
  * Import
  * Dependency analysis
  * ELK layout
  * React Flow rendering
  * Export
* [ ] Add CI that runs the following on every pull request:
  ```bash
  npm ci
  npm run check
  ```
* [ ] Add dependency, security, and license scanning.
* [ ] Configure automated dependency updates with Dependabot or Renovate.
* [ ] Deploy a preview environment.
* [ ] Verify production behavior for:
  * Asset paths
  * Browser caching
  * Web Worker loading
  * Local storage
  * ZIP imports
* [ ] Define the supported browser matrix.
* [ ] Test Chrome, Firefox, Safari, and Edge.

## P1 — Product Improvements

* [x] Build a complete graphical ambiguity-resolution workflow for multi-stack imports.
* [x] Add a richer nested-stack association workflow.
* [x] Suggest likely nested-stack templates by filename and metadata.
* [x] Require explicit confirmation of parent and child stack associations.
* [x] Add StackSet target editing for:

  * Accounts
  * Organizational units
  * Regions
  * Parameter overrides
  * Deployment preferences
* [x] Expand re-import conflict resolution with:

  * Side-by-side resource diffs
  * Property-level changes
  * Per-resource removal policies
* [x] Add CloudFormation-aware resource property editing.
* [x] Add schema validation to the property editor.
* [x] Add manual semantic relationship creation.
* [x] Add relationship connection handles.
* [x] Add template search.
* [x] Add syntax highlighting.
* [x] Add line numbers.
* [x] Add navigation from a selected node to its source-template path.
* [x] Improve PNG export with:

  * Full-diagram capture
  * Scale selection
  * Transparent backgrounds
  * High-resolution output
* [x] Add SVG export.
* [x] Add PDF export.
* [x] Add progress reporting for large imports and exports.

## P1 — CloudFormation Fidelity

* [x] Expand property-aware dependency inference across additional AWS resource types.
* [x] Improve support for `Fn::ForEach`.
* [x] Improve support for SAM resources.
* [x] Improve support for CDK-generated templates.
* [x] Preserve macro-related sections with clearer diagnostics.
* [x] Improve cross-stack export and import matching when export names use intrinsic functions.
* [x] Add validation for:

  * Stack-level limits
  * Logical ID collisions
  * Cyclic dependencies
  * Unsupported cross-Region references
  * Unsupported cross-account references
* [x] Add semantic round-trip comparison between imported and generated canonical ASTs.
* [x] Preserve and export optional deployment metadata when supplied:

  * Stack policies
  * Change-set metadata
  * Termination protection
  * Drift details
* [x] Add an optional bundled AWS resource specification for offline property validation.

## P1 — Diagram Editing

* [x] Add visible alignment guides.
* [x] Add multi-selection alignment commands.
* [x] Add distribution commands.
* [x] Enforce boundary resize constraints based on contained children.
* [x] Add explicit z-order controls to the inspector.
* [x] Add z-order controls to context menus.
* [x] Add configurable grid spacing.
* [x] Add configurable keyboard movement increments.
* [x] Add reusable architecture templates.
* [x] Add common AWS architecture patterns.
* [x] Add node annotations.
* [x] Add comments.
* [x] Add legends.
* [x] Add free-form text elements.
* [x] Add bulk editing for:

  * Stack ownership
  * Tags
  * Governance controls
  * Logical groups
  * Security groups
* [x] Add saved filters for:

  * Account
  * Region
  * Stack
  * StackSet
  * AWS service
  * Validation status

## P2 — Collaboration and Integrations

* [ ] Implement the AWS integration interface for authenticated retrieval of:

  * Stacks
  * StackSets
  * Stack instances
  * Change sets
* [ ] Add Git-based template import and export workflows.
* [ ] Add optional server-backed document persistence.
* [ ] Add server-backed revision history.
* [ ] Add collaborative editing after server persistence is established.
* [ ] Add collaborator presence.
* [ ] Add read-only share links.
* [ ] Add presentation snapshots.
* [ ] Add architecture-review comments.
* [ ] Add approval and review states.

## P2 — Quality and Observability

* [ ] Add visual-regression snapshots for:

  * Infrastructure view
  * Deployment view
  * Security view
  * CloudFormation source view
  * Import previews
  * Error states
* [ ] Add automated accessibility testing with Axe.
* [ ] Run accessibility tests in both component and browser suites.
* [ ] Add mutation testing for:

  * Containment rules
  * Reconciliation
  * CloudFormation generation
* [ ] Add property-based tests for:

  * Coordinate conversion
  * Serialization round trips
  * Stable ID generation
* [ ] Add structured client-side error reporting.
* [ ] Ensure uploaded templates and sensitive resource data are excluded from telemetry by default.
* [ ] Define performance budgets for:
  * Initial load
  * Import planning
  * ELK layout
  * Diagram interaction
  * Export
* [ ] Add crash-recovery testing for:
  * Malformed local-storage documents
  * Interrupted imports
  * Interrupted layout requests
  * Corrupted ZIP bundles

## Documentation

* [ ] Add a complete user guide.
* [ ] Add screenshots for every import workflow.
* [ ] Add screenshots for every export workflow.
* [ ] Add example import manifests for:

  * Single-stack bundles
  * Multi-stack bundles
  * Nested-stack bundles
  * StackSet bundles
* [ ] Document the supported CloudFormation feature matrix.
* [ ] Add a troubleshooting guide covering:
  * Parsing failures
  * Layout failures
  * Browser-storage failures
  * ZIP-import failures
  * Re-import conflicts
* [ ] Document performance expectations and recommended limits.
* [ ] Document browser support.

## Release Management

* [ ] Adopt semantic versioning.
* [ ] Add a changelog.
* [ ] Add a release checklist.
* [ ] Add release notes for every published version.
* [ ] Create realistic sample repositories for:
  * Demonstrations
  * Regression testing
  * Import examples
* [ ] Publish versioned ZIP artifacts.
* [ ] Publish checksums for release artifacts.
* [ ] Tag verified releases in source control.
