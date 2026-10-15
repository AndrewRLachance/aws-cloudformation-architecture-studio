# Verification report

Verification date: **June 18, 2026**

## P1 CloudFormation-fidelity verification — October 15, 2026

The schema-v5 fidelity milestone was verified with Node.js 22.23.3:

```text
TypeScript       passed, no diagnostics
ESLint           passed, no warnings or errors
Vitest           12 files passed, 100 tests passed
Playwright       3 Chromium scenarios passed
Production build passed, 590 modules transformed
```

Acceptance coverage includes static, nested, unresolved, and colliding `Fn::ForEach`; SAM resources/events and the offline SAM schema; standalone CDK metadata and zipped cloud assemblies; intrinsic export/import matching; same-account/Region enforcement and stack dependency cycles; quotas and invalid logical IDs; import-manifest v2 deployment metadata; schema v4→v5 migration; analysis-only projection behavior; semantic round trips; typed export blocking; and validation/round-trip/deployment-metadata ZIP artifacts.

The Playwright-managed Chromium 149 binary was installed locally to execute the complete browser suite. The final suite passed after correcting deterministic initial placement for multi-template imports and source-location navigation to prefer YAML key locations.

## P1 product-improvements verification — July 22, 2026

The current workspace was verified after the P1 implementation with:

```text
npm run typecheck   passed
npm run lint        passed
npm run test        11 files passed, 89 tests passed
npm run build       passed, 587 modules transformed
```

The production build emits the full `us-east-1` CloudFormation resource specification as a separate lazy chunk (13,293.74 kB raw, 792.90 kB gzip) and jsPDF as a separate lazy chunk (399.37 kB raw, 129.67 kB gzip). Vite's non-failing large-chunk advisory remains expected for the application, ELK worker, and specification artifact.

Playwright successfully discovered all three browser scenarios: controlled dragging, semantic relationship/export initiation, and graphical multi-stack association/source navigation. They were not executed in this workspace because neither a system Chromium nor a Playwright-managed Chromium binary is installed. Per the project plan, browser installation/manual browser verification and the aggregate `npm run check` browser stage remain deferred P0 work; this does not gate P1 completion.

The pinned offline specification is version `257.0.0`, with SHA-256 `fe59da71f18d6e5cb8c52e62c6cbac37fd5a109aa2bcbf9d388cc083bc159136`.

## Original clean-install release verification

## Environment

| Item | Value |
|---|---|
| Operating system | Linux x86_64 |
| Node.js | 22.16.0 |
| npm | 10.9.2 |
| Browser | Chromium 144.0.7559.96 |
| Package manager input | `package-lock.json` |

## Clean-install verification

A new checkout was copied to `/tmp/aws-studio-clean` with all generated output and `node_modules` excluded.

```text
npm ci --no-audit --no-fund --prefer-offline
added 297 packages in 14s
```

The exact aggregate command was then run from that clean installation:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run check
```

**Result: exit code 0.** The complete sanitized command output is retained in [`CLEAN_INSTALL_CHECK.log`](CLEAN_INSTALL_CHECK.log).

## TypeScript

```text
> tsc -b --pretty false
```

Result: **passed**, exit code 0, no diagnostics. The application project uses strict mode, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, and `noUnusedParameters`.

## ESLint

```text
> eslint .
```

Result: **passed**, exit code 0, no warnings or errors.

## Unit and component tests

```text
Test Files  9 passed (9)
Tests       69 passed (69)
Duration    29.06s
```

Coverage areas include:

- domain containment and coordinate conversion;
- parser and intrinsic canonicalization;
- single-stack, multi-stack, ZIP, StackSet, nested, external, and atomic imports;
- re-import matching and removed-resource policies;
- normalized store history and idempotent controlled updates;
- persistence, migration, and validation;
- ELK graph construction, real ELK integration, stale suppression, and no-op identity;
- CloudFormation generation and ZIP export;
- React component accessibility and inspector keyboard resizing.

## Browser interaction test

```text
Running 1 test using 1 worker
1 passed (27.1s)
```

The Playwright regression runs the actual application in Chromium and performs:

- multiple pointer drags;
- movement inside the current parent;
- valid physical reparenting;
- invalid IAM-to-subnet placement with state preservation;
- detachment and reattachment;
- selection and deselection around dragging;
- view and layer changes;
- ELK layout followed by another drag;
- undo and redo;
- console, page-error, and unhandled-rejection monitoring.

The test requires the collected browser error array to be exactly empty. It also verifies one history entry for a movement and guards against update-depth, rerender, controlled-state, and unhandled-exception failures.

## Production build

```text
vite v8.0.16 building client environment for production...
373 modules transformed.
✓ built in 10.76s
```

Generated artifacts in the clean verification checkout:

```text
dist/index.html                            0.53 kB │ gzip:   0.33 kB
dist/assets/layout.worker-DGRWRQU9.js  1,433.37 kB
dist/assets/index-Bn0qwaMr.css            34.48 kB │ gzip:   7.86 kB
dist/assets/es-BOAyukm3.js                12.54 kB │ gzip:   5.01 kB
dist/assets/jszip.min-BQMzlTLW.js         95.92 kB │ gzip:  28.49 kB
dist/assets/index-BzI4F3oJ.js          2,096.82 kB │ gzip: 643.92 kB
```

Vite emitted a non-failing chunk-size advisory for the main application and ELK worker. JSZip and YAML serialization are independently chunked; export dependencies are dynamically imported. This warning does not affect build success.

## Release command

```bash
npm run check
```

expands to:

```bash
npm run typecheck && npm run lint && npm run test && npm run test:e2e && npm run build
```

Every stage passed from the clean lockfile installation.
