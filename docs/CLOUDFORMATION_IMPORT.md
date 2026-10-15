# CloudFormation import formats

## Accepted local inputs

### Raw template

- `.yaml`
- `.yml`
- `.json`
- AWS CLI `get-template` response with `TemplateBody`
- JSON object whose `TemplateBody` is either source text or a parsed object

### Deployed-stack bundle

A ZIP or multiple selected files may contain:

- raw template or `get-template` output;
- `describe-stacks` output;
- `list-stack-resources` / resource-summary output;
- parameter, output, tag, physical-ID, status, or drift metadata.
- `get-stack-policy`, `describe-change-set`, termination-protection, stack-drift, and paginated resource-drift JSON.

Only a template is required. Metadata enriches the normalized stack record when present.

### Multi-stack bundle

Multiple templates or a ZIP are accepted. A versioned `import-manifest.json` is recommended for deterministic stack/account/Region association. Analysis parses each source once, ranks candidate identities, and shows the candidate name, account, Region, metadata origin, confidence, evidence, and conflicts. Ambiguous and low-confidence top-level assignments require confirmation, and colliding identities block commit. Changing a resolution rebuilds the plan from retained templates without reparsing.

A zipped CDK cloud assembly is recognized from `manifest.json`. CloudFormation stack artifacts, names, environments, dependencies, template filenames, and JSON asset-manifest references are retained; referenced stack templates are parsed and binary assets are ignored.

### StackSet

Accepted combinations include:

- StackSet template alone;
- template plus `describe-stack-set`;
- template plus one or more paginated `list-stack-instances` result files;
- ZIP containing those files.

A template-only import creates one canonical StackSet definition and warns that targets are unresolved. Instance summaries are deduplicated by StackSet/account/Region and retain status, drift status, Stack ID, overrides, and operation ID.

The association step and selected StackSet inspector edit repeatable desired target groups containing accounts, organization root/OU IDs, Regions, account filters, and parameter overrides, along with Region order/concurrency, failure tolerance, and maximum concurrency preferences. Permission-model rules, identifiers, duplicate targets, mutually exclusive count/percentage fields, and numeric limits are validated before commit. Desired targets and observed concrete instances are distinct records.

### Re-import

Choose **Re-import updated source** and use the same logical source filename or stack identity. The preview displays added, removed, and changed resources side by side and lists recursive property paths with change kind and before/after values. Select a default removed-resource policy and optionally override it for each removed resource before commit:

- **Remove**: delete removed imported resources.
- **Detach**: preserve as manual nodes with source and deployment ownership removed.
- **Mark removed**: preserve visual/history context but omit from generated CloudFormation.

## YAML intrinsic support

Short-form tags are canonicalized to long form:

- `!Ref`
- `!GetAtt`
- `!Sub`
- `!Join`
- `!Select`
- `!Split`
- `!FindInMap`
- `!ImportValue`
- `!GetStackOutput`
- `!GetAZs`
- `!If`
- `!Equals`
- `!And`
- `!Or`
- `!Not`
- `!Base64`
- `!Cidr`
- `!Transform`
- `!Condition`

Nested intrinsics, dynamic references, pseudo parameters, aliases supported by the YAML parser, unknown intrinsic-like structures, `Fn::ForEach`, and transforms are retained in the canonical AST. Literal/default-backed `Fn::ForEach` collections are expanded only into a guarded analysis projection across Resources, Conditions, and Outputs; unresolved declarations remain unchanged with diagnostics.

## Diagnostics

Diagnostics include filename, template/node context, severity, code, message, source path, blocking status, and line/column when available. Syntax failures block the file, while semantic failures commit for inspection and block only CloudFormation template/ZIP export. Unknown resource types remain generic and lossless.

## Dependency analysis

The recursive visitor discovers every explicit `Ref`, `Fn::GetAtt`, `Fn::Sub`, `Fn::ImportValue`, `Fn::GetStackOutput`, and `DependsOn`. Ordered source-type/property-path rules infer common AWS semantics and persist their rule, source path, and confidence. Missing targets become external-reference nodes.

Cross-stack names are retained as expression ASTs and matched by supported local evaluation or normalized symbolic fingerprint. Known `Fn::ImportValue` account/Region mismatches are errors; unknown context is a warning. `Fn::GetStackOutput` remains a separate cross-context-capable reference.

## SAM, CDK, and transforms

Authored SAM resources receive native visual categories and documented event-target analysis without synthesizing transform-generated low-level resources. CDK construct paths and helper resources are badged and preserved. Top-level and nested transforms retain path and order; LanguageExtensions and SAM report partial local support, while custom/unexecuted transforms warn that analysis may be incomplete.

Deployment metadata association uses explicit manifest v2 entries first, stack ARN/name second, and unambiguous single-stack evidence last. Unassociated artifacts are retained with warnings. Metadata is read-only.

## Nested stacks

`AWS::CloudFormation::Stack` creates a nested deployment group and a nested-stack relationship. `TemplateURL` is represented as an unresolved external reference. Remote URLs are never fetched.

The association view ranks local child templates using manifest parent identifiers, AWS `ParentId`/`RootId` metadata, normalized `TemplateURL` basename/path, filename stems, and parent/child parameter compatibility. Every nested association requires explicit confirmation. A user can select a child, change the association, or confirm **No local child**; that unresolved reference remains visible but becomes nonblocking. One local template can back multiple nested deployments because deployment groups, not template records, own the exact parent resource and generated artifact.

## Source locations and property editing

Parsing records source locations for resource and property paths when the source format exposes offsets. **Go to source** opens the retained original YAML/JSON, scrolls to the exact line, and highlights it. Logical-ID search is the fallback for enveloped inputs without exact offsets.

Imported AWS resources and source-backed VPC/subnet boundaries can be edited with the bundled offline CloudFormation specification. Syntax, missing required fields, and type errors block Apply; intrinsics, unknown/custom types, and unknown properties are preserved. Raw JSON mode remains available.

## Commit semantics

Import is atomic, idempotent for identical content, and one-step undoable. Required confirmations and invalid StackSet target definitions block commit. Automatic layout is an independent optional command after commit, and ordinary dragging never triggers ELK. File reading, ZIP expansion, parsing, analysis, reconciliation, and layout report shared operation progress with ARIA announcements.
