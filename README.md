# Switch 2 Jailbreak Workspace (ns2jb)

Personal workspace for tracking and preparing for the ns2jb exploit on
Nintendo Switch 2, firmware **23.0.1**.

## Current status (2026-10-27)

- **Upstream**: [gitlab.com/pepsipu/ns2jb](https://gitlab.com/pepsipu/ns2jb)
  — commit `95f5525` (Oct 22, 2026). 11/11 tests pass. Zero npm dependencies.
- **WebKit route**: announced but **not publicly released**. No downloadable
  source confirmed.
- **SmileBASIC 4.4.9**: delisted from the eShop.

## Project structure

```
switch2jailbreak/
├── docs/
│   ├── baseline.md           ← Phase 1 claims inventory (18 classified)
│   ├── build-status.md       ← Phase 2 dependency matrix and build report
│   ├── compatibility.md      ← Phase 3 test results and interpretation guide
│   ├── firmware-notes.md     ← Firmware preservation guide
│   ├── research-log.md       ← Chronological verified findings
│   └── environment-setup.md  ← macOS prereqs and network setup
├── config/
│   └── targets.json          ← Target versions, upstream URLs, entry points
├── tests/
│   ├── run-all.sh            ← Run all test suites, output JSON results
│   ├── browser-harness.html  ← Run all tests in a browser, export JSON
│   ├── javascript-features/
│   │   └── feature-detect.js ← ES2020–2024 + WebAPI detection (20 tests)
│   ├── runtime-errors/
│   │   └── error-handling.js ← Error recovery and limits (15 tests)
│   └── isolation/
│       └── sandbox-detect.js ← Browser sandbox probing (20 tests)
├── results/
│   ├── schema.json           ← JSON schema for all test output
│   └── *.json                ← Timestamped result files
├── scripts/
│   ├── check-upstream.sh     ← Verify repo, Gist, URLs with change tracking
│   ├── verify-upstream.sh    ← Clone, test, checksum, and audit upstream
│   ├── monitor-upstream.sh   ← Periodic upstream watch
│   ├── summarize-results     ← Aggregate all result JSON files
│   └── check-env.sh          ← Verify macOS prerequisites
└── .github/
    └── workflows/
        └── verify.yml        ← CI: upstream checks + config validation
```

## Quick start

```sh
# Verify your Mac is ready
./scripts/check-env.sh

# Check upstream for changes (tracks state between runs)
./scripts/check-upstream.sh

# Run the full compatibility test suite (55 tests)
./tests/run-all.sh

# Install pinned host verification dependencies and run regression tests
npm ci --ignore-scripts
npm test

# Real desktop browser controls (not console emulation)
npx playwright install chromium firefox webkit
npm run test:browser

# Verify upstream build integrity (clones, tests, checksums)
./scripts/verify-upstream.sh

# Summarize all results
./scripts/summarize-results

# In a browser: open tests/browser-harness.html
```

The workspace now uses pinned development dependencies for browser automation
and JSON Schema validation. The upstream package's zero-npm-dependency claim
does not apply to these optional workspace development tools. Browser capability
observations may legitimately report absent features; the browser regression
suite verifies complete evidence, accurate counts, policy controls and failures
being reported rather than hidden. See `docs/browser-capabilities.md`.

## Phase progress

Priority follow-up: [P0 upstream recheck](docs/upstream-recheck.md),
[P1 browser baseline](docs/browser-capabilities.md), P2 regression check
(`node --test tests/browser-loading.test.cjs`), and
[P3 security boundaries](docs/security-boundaries.md). Target-browser validation
and a full security review remain pending.

Follow-up evidence: [verification review](docs/security-review.md) and
[reproducible workspace release protocol](docs/release.md). Desktop Chromium,
Firefox and WebKit controls now pass in Linux CI; this is not console validation.

- [x] **Phase 1** — Baseline report and claims inventory (`docs/baseline.md`)
- [x] **Phase 2** — Upstream and build verification (`docs/build-status.md`)
- [x] **Phase 3** — Compatibility test harness (`tests/`, `docs/compatibility.md`)
- [ ] **Phase 4** — Security and isolation review
- [ ] **Phase 5** — Reproducible release and publication

## References

- [Author's technical write-up](https://pepsipu.com/blog/2026-10-switch2-jailbreak-ns2jb/)
- [Upstream repo](https://gitlab.com/pepsipu/ns2jb)
- [Public status gist](https://gist.github.com/Shubin123/c1a5a09ec5005e93cf86380260060dac)
