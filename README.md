# Switch 2 Jailbreak Workspace (ns2jb)

Personal workspace for tracking and preparing for the ns2jb exploit on
Nintendo Switch 2, firmware **23.0.1**.

## Current status (2026-10-26)

- **Upstream**: [gitlab.com/pepsipu/ns2jb](https://gitlab.com/pepsipu/ns2jb)
  — commit `95f5525` (Oct 22, 2026). Requires SmileBASIC 4.4.9.
- **WebKit route**: announced but **not publicly released**. The author's
  blog describes a browser-based approach as future work; community posts
  report a working port seeking testers. No downloadable source confirmed.
- **SmileBASIC 4.4.9**: delisted from the eShop. Not currently obtainable
  through official channels.

## Project structure

```
switch2jailbreak/
├── docs/
│   ├── baseline.md           ← Phase 1 claims inventory and classification
│   ├── firmware-notes.md     ← Firmware preservation guide
│   ├── research-log.md       ← Chronological verified findings
│   └── environment-setup.md  ← macOS prereqs and network setup
├── config/
│   └── targets.json          ← Target versions, upstream URLs, entry points
├── tests/
│   └── javascript-features/
│       └── feature-detect.js ← JS engine capability tests (Node + browser)
├── results/
│   ├── schema.json           ← JSON schema for test output
│   └── local-baseline-*.json ← Baseline results from local Node.js
├── scripts/
│   ├── check-upstream.sh     ← Verify upstream repo, Gist, and reference URLs
│   ├── monitor-upstream.sh   ← Periodic upstream watch (cron or manual)
│   ├── summarize-results     ← Aggregate test result JSON files
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

# Run JS feature-detection tests (local baseline)
node tests/javascript-features/feature-detect.js > results/local-baseline.json

# Summarize all test results
./scripts/summarize-results

# Watch for new commits (runs every 30 min by default)
./scripts/monitor-upstream.sh
```

## Phase progress

- [x] **Phase 1** — Baseline report and claims inventory (`docs/baseline.md`)
- [ ] **Phase 2** — Upstream and build verification
- [ ] **Phase 3** — Compatibility test harness (started: `tests/javascript-features/`)
- [ ] **Phase 4** — Security and isolation review
- [ ] **Phase 5** — Reproducible release and publication

## References

- [Author's technical write-up](https://pepsipu.com/blog/2026-10-switch2-jailbreak-ns2jb/)
- [Upstream repo](https://gitlab.com/pepsipu/ns2jb)
- [Public status gist](https://gist.github.com/Shubin123/c1a5a09ec5005e93cf86380260060dac)
