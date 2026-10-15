# Security model

## Trust boundary

All uploaded files are untrusted. Parsers accept `unknown` and narrow only after runtime checks. CloudFormation templates are treated as data.

## Deliberately prohibited behavior

- No JavaScript evaluation.
- No CloudFormation macro execution.
- No SAM translation or transform execution. Statically resolvable `Fn::ForEach` loops may be expanded into a non-authoritative in-memory analysis projection; authored syntax remains the export source.
- No remote `TemplateURL` download.
- No dynamic reference resolution.
- No AWS credential request.
- No AWS network call in local import.
- No automatic loading of arbitrary ZIP entry types.

ZIP expansion accepts only `.json`, `.yaml`, and `.yml` files. Unknown template keys and resource properties are preserved as inert AST data.

## Local persistence

Documents and original template source are stored in browser local storage under the repository abstraction. Users should treat browser-profile access as equivalent to access to their imported architecture files. Exported ZIPs may contain infrastructure names, account IDs, Regions, parameters, outputs, tags, and original source.

## External integration port

`src/cloudformation/gateway.ts` defines an asynchronous `CloudFormationGateway` interface. It has no delivered implementation and is not invoked by local workflows. A future adapter should add explicit authentication, least-privilege IAM requirements, pagination, throttling, audit logging, and redaction policies without changing parser or domain layers.

## Browser and rendering safety

React renders labels as text content. The source viewer escapes all untrusted source before Prism adds syntax-token spans; templates are never interpreted as executable markup. Download filenames are normalized by exporter code. Import, layout, and export failures are reported through diagnostics and ARIA live regions rather than thrown into render.

The versioned `us-east-1` AWS resource specification is a checked-in build artifact and is lazy-loaded from the application bundle. Property validation has no runtime network dependency. Refreshing that artifact is an explicit maintainer command, not an end-user workflow.

PNG, SVG, and PDF rendering occurs entirely in the browser. Capture filters editor controls and validates conservative canvas dimensions before allocation. PDF pages are rendered independently to avoid one oversized full-diagram canvas.
