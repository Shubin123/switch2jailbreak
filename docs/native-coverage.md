# Native-chain coverage and browser-entry gates

Updated October 27, 2026 against upstream revision
`95f5525089273c5fce0b95047f3600f8442e96ae`.

## Reproducible inventory

```sh
node scripts/native-coverage.cjs /path/to/pinned/ns2jb results/native-coverage.json
node --test tests/native-coverage.test.cjs
```

The current inventory contains 95 tracked files, all of which now belong to the
recorded static walkthrough. Each entry records a SHA256 and byte length from
the pinned Git blob.
This report is deliberately separate from the runtime-results JSON schema:
inventory membership is not a passing test.

The tool reads Git objects, never imports upstream modules, rejects symlinks
and submodules, and refuses to replace an existing report. A dirty working
tree does not affect the inventory: it is not the source of the bytes being
reported. Run the existing native reviewer separately to validate checkout
identity and reproduce its host-only assertions. Recorded review membership
does not mean this inventory reran or independently verified that review.

## Review slice completion

All 95 tracked files now belong to the recorded walkthrough (98 checks,
9,128 lines). The following slices have been completed:

| Slice | Files | Status |
| --- | --- | --- |
| Core payload and build | C, assembly, linker, manifest, ELF builder | 46 checks, complete |
| Host interfaces | connection, bridge, native, IPC, domain, stages | 14 checks, complete |
| Memory subsystem | session-tools, verify-proof, cache plans, lower-window, retained-memory | 12 checks, complete |
| Orchestration/protocol | frames, rpc, pipeline, acquire, run, qualify, find-metadata, bind-notifier, process/qualify | 13 checks, complete |
| App layer | session, worker, events, domain, rpc, filesystem, map, native-worker, qualify, timing, affinity, bulk-transfer, inspect-mounts, mounted-save | Structural checks, complete |
| Memory control | capture-workers, fs-memory-control, fs-root-control, mounted-rom, probe-reserved-gap, run-control, normalized-path, paths, native-links | Functional + structural checks, complete |
| Tools | endpoint, fs-memory, fs-root-pid, cleanup-scratch | Functional checks, complete |
| Generated assets | 11 JSON files (sdk-functions, sdk-layout, 7 app JSON, 2 reference JSON) | Structural checks, complete |
| Infrastructure | test.cjs, bootstrap.bas, SHA256SUMS, test-function.bin, payload/main, README.md | Hash + structural checks, complete |

File-level walkthrough coverage is complete. Path/branch-level coverage of
every conditional, captured SDK provenance and instruction semantics remain
outside the scope of this static host-only review.

All 11 engine JSON assets now have separate structural checks covering 56
instruction-byte declarations. Four unbound digest fields and captured SDK
provenance remain unverified; structural success is not semantic source review.
Generate that report with
`node scripts/review-native-assets.cjs /path/to/pinned/ns2jb results/native-assets.json`.

## Browser-based entry: separate evidence gates

The upstream native chain cannot be assumed transferable to a browser.
The following gates remain open independently of host coverage:

1. **Navigation:** manually record firmware, entry context, displayed URL,
   time and load errors for an ordinary static page. The proposed captive
   portal route remains unverified; this inventory performs no network or
   console actions.
2. **Capabilities:** only after reviewing resource requirements, collect a
   separate, unmodified browser-harness export. User-agent and manually
   recorded firmware are descriptive, not authenticated device identity.
3. **Execution boundary:** require an identified, reviewable browser-specific
   implementation and evidence of its execution boundary. A page load,
   WebAssembly support or downloaded native image cannot satisfy this gate.
4. **Compatibility and recovery:** require explicit target support and
   independent execution/restoration observations. Host mocks cannot establish
   device behavior or guaranteed recovery.

No browser native loader, vulnerability trigger, sandbox escape or automatic
fallback to the SmileBASIC chain is added. The inventory always marks browser
native execution as not established and Phase 4 as incomplete. Those fields
are current evidence statements, not an automatic release decision engine.

The [browser entry evidence page](browser-entry.md) now implements the manual
navigation record and opt-in low-impact property observations. Its desktop
controls are not target observations and do not close the remaining gates.
