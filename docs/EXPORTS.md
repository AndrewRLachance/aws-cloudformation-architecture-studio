# Diagram exports

The **Export Diagram…** dialog uses one capture service for PNG, SVG, and PDF. It can capture the current viewport or the full diagram bounds, add padding, use 1×/2×/4× scaling, and render a transparent or solid background. The preview reports the estimated output dimensions before capture.

Selection outlines, connection handles, node resize controls, the minimap, and canvas controls are excluded from every exported image.

## PNG and SVG

PNG uses the selected resolution and background. SVG uses the same bounds and UI filtering and downloads with the SVG MIME type. PNG rendering rejects dimensions above conservative browser canvas limits rather than attempting an allocation likely to fail.

## PDF

PDF export lazy-loads jsPDF and supports Letter, A4, and A3 paper. Orientation may be automatic, portrait, or landscape. Diagram geometry is mapped at 96 CSS pixels per physical inch. Pages overlap by 0.25 inch by default, are ordered row by row, and include crop marks and page numbers.

Each page is rendered independently at 2× or the selected higher scale, so PDF generation does not depend on one full-diagram canvas. The dialog and activity panel report page-by-page progress and preserve errors for review.

All rendering is local in the browser. Export never sends diagram content to an external service.

## CloudFormation bundle

CloudFormation generation overlays supported edits onto cloned canonical ASTs. Generation manifest v3 retains the v2 stack, StackSet, nested-stack, and instance fields and adds `validation-report.json`, `round-trip-report.json`, CDK cloud-assembly references, and paths for supplied deployment metadata.

Errors from semantic validation or unexpected canonical-AST loss set `canExport=false`; single-template and ZIP downloads then fail with a typed validation error while diagnostics remain visible. Diagram JSON, PNG, SVG, and PDF exports are not blocked by CloudFormation validity.
