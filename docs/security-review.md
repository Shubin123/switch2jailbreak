# Phase 4 — Verification tooling review

Reviewed October 27, 2026. Scope: this workspace's host-side verification,
monitoring, browser loading, and evidence handling. This is not a claim of a
complete audit of upstream native exploit code or console security.

## Findings and remediation

| Finding | Risk to evidence | Remediation and verification |
| --- | --- | --- |
| Build verifier returned success after failed checks | Green CI could conceal a failed upstream test or integrity check | Explicit failure exit; regression fixtures cover process failure, missing manifest/files/payload, README modification, and failed rebuild |
| Upstream clone used mutable branch head | Different source could be tested than documented | Fetch exact configured 40-character commit; compare checkout revision and include it in results |
| Human-oriented test output parsed; process status discarded | Reporter changes or process failures could produce incorrect counts | Explicit TAP reporter and process exit gate |
| README checksum exception matched a substring | Unexpected documentation or missing files could be accepted | Exact filename, exact revision, both reviewed hashes, and complete file accounting required |
| Compiler presence counted as a successful rebuild | No evidence the shipped payload could be reproduced | Execute upstream byte-for-byte `--check`; CI requires the pinned compiler and a matching rebuild |
| Network failures could be reported as unchanged sources | Failed observations could overwrite good monitoring state | Require successful HTTP and valid metadata; atomic state write only after all checks succeed |
| Branch/tag checks ignored pagination and names | Branch substitutions or later-page changes could be missed | Traverse pagination with loop/limit guards; compare sorted names and commit IDs |
| Browser suites shared lexical declarations | Suites failed to load together | Isolated scripts; shared-context regression test |
| Browser-only observations failed on Node.js | Host limitations looked like software regressions | Explicit applicability skips; negative browser observations remain failures |
| Native manifest could authorize altered image | Tampered segment structures accepted if outer manifest recomputed | Structural validation of container magic, flags, segment bounds, memory alignment, and segment/module digests |
| Source inspection vulnerable to symlinks or assume-unchanged | Tampered source files could hide from git status | Direct git blob cat-file hash comparison for every tracked file; reject symlinks and dirty trees |
| SharedArrayBuffer exposed without cross-origin isolation | Isolation state could be misclassified | Correlate SharedArrayBuffer strictly with verified COOP/COEP headers; block outbound network requests via CSP |
| Mutating worker launch could execute unreviewed payload | Incomplete launch configuration could reach device | Enforce unreleased launch discard replacing payload with read-only application-PID query |
| Failed domain conversion could leak temporary handles | Unclosed locator handles could exhaust session limits | Wrap locator conversion in catch block with guaranteed handle closure and state rollback |
| Interrupted donor cleanup could leave dangling mounts | Filesystem handles could remain open across runs | Wrap mounted filesystem cleanup in finally block ensuring handle closure |

## Observed validation

- Local regression run: 28 tests passed across all 8 host suites, zero failures
  (includes synthetic negative fixtures exercising verifier rejection).
- Native review audit: 98 host-only boundary and lifecycle checks passed, zero
  failures, covering all 95 tracked upstream files (9,128 lines).
- Live monitor inspected the pinned README, complete branch/tag listings,
  Gist metadata and blog content. Only `main` and no tags were returned.
- Live pinned upstream host suite: 11 passing tests.
- Zig 0.15.2 macOS arm64 archive matched the official download-index SHA256.
  The rebuilt 4,757-byte payload matched the shipped image byte-for-byte:
  `d590cbfc5d9152c24d5a36f083f8470a2f3164be6b78130129d44132b939701a`.
- Build verification: eight passes, zero failures, zero skips, including the
  explicitly reviewed README manifest exception (93 of 94 raw checksums match).

## Remaining gates

### Desktop-browser follow-up

GitHub Actions run `40471810087` passed the regression suites, the Node.js
22/24/26 matrix, all three real desktop-browser suites, and the strict upstream
rebuild gate for workspace revision `3ddd1f9b8e38ec6c35a1c8289c3bb5bc94332f4d`.
Downloaded artifacts identify clean source trees. All six browser profiles
contain 55 observations with zero execution errors or applicability skips.
Negative observations are retained: Chromium/WebKit have three absent features
in the normal profile and one in the isolated profile; Firefox has four and two.
The CSP-meta observation remains false even when a response-header CSP is
actively enforcing the tested network restriction.

### Upstream boundary inspection

Source inspection at the pinned upstream revision covered host entrypoint
`run.cjs`, `engine/lib/connection.cjs`, `engine/lib/bridge.cjs`, the pipeline, and
`engine/switch2/process/fs-execute.cjs`:

- Pairing validates a fresh token, protocol, platform, and process layout. It
  limits pending peers and enforces timeouts. The console link is TCP without
  transport encryption; use only a trusted LAN. Pairing is not protection from
  a malicious local process or a network observer able to see launch secrets.
- The host bridge binds loopback, requires a per-run bearer token, restricts
  method/path, caps request body size, and serializes native operations. The
  token is a local trust boundary, not protection against a compromised host.
- Run artifacts contain connection details and memory-related data. The host
  entrypoint creates restrictive permissions and uses finally-block cleanup;
  do not publish console run directories as browser capability evidence.
- FS execution checks the intended process, code mapping and original bytes,
  uses fresh challenge values, and attempts restoration in finally blocks.
  Restoration depends on the connection and runtime still functioning; source
  inspection cannot guarantee recovery after a device or transport failure.

These observations describe checked source paths, not a complete native-code
audit or a new exploit technique. No console operation was performed.

A complete upstream native-code audit, console hardware validation, and release
reproduction/publication are not established by these host results. See `security-boundaries.md` for
what each observation can and cannot demonstrate. No privilege boundary is
weakened to make a check pass.

## Native review follow-up

`native-review.md` now records a complete walkthrough of the core payload C,
assembly, linker layout, builder, memory session, cache mount, link filtering,
retained memory/cache subsystem, and the entire native RO orchestration and
cleanup suite plus domain/stage helpers, orchestration/protocol layer, app
layer, tools and remaining infrastructure (all 95 tracked files, 9,128 lines). The
host-only audit runs 98 boundary/container/assembly, mocked lifecycle,
memory-subsystem, orchestration/protocol, app-layer and tools checks, preserves per-file source hashes, and is required by
CI before source packaging. It does not execute a console payload.

The review establishes 15 documented security, isolation, and recovery findings
(NR-01 through NR-15):
1. **NR-01**: Kernel metadata (PID, mapping addresses, permissions) is an unverified trust assumption on the host.
2. **NR-02**: Descriptors and transferred handle cleanup limits outside the supported subset.
3. **NR-03**: Memory and permission mutations are conditional, not transactional across failures.
4. **NR-04**: Host bridge and loopback bearer tokens are local trust boundaries without remote attestation.
5. **NR-05**: Verification flags and handle cleanup are distinct evidence paths; errors avoid issuing IPC to timed-out workers.
6. **NR-06**: Session gate unparking occurs before retirement snapshot verification; signal errors do not produce retirement evidence.
7. **NR-07**: Domain lookup uses a bounded 0x4000-byte search window (341 slots) rather than the full 16,384-slot declared table.
8. **NR-08**: Persistence steps share failure paths with cleanup; save failures can block subsequent restoration calls.
9. **NR-09**: Temporary slot/notifier substitutions have conditional rollback coverage only after initial writes succeed.
10. **NR-10**: Session binding records represent local host observations rather than durable target-authenticated tokens.
11. **NR-11**: Cache lifecycle checks and unmount preflight do not guarantee remount or closed handles.
12. **NR-12**: Retained candidate link recognition and CMIF protocol validation operate within structural bounds, not full ABI proofs.
13. **NR-13**: Foreign worker synchronization cancellation and launch discard operate within concurrency/timing windows on target.
14. **NR-14**: Temporary locator and donor filesystem lifecycles enforce local cleanup in finally/catch blocks, but device storage rollback remains conditional on app restart.
15. **NR-15**: Upstream retained-memory accepts a repeated metadata capture shorter than requested; the workspace verifier rejects it (host-reproduced divergence, not a confirmed device fault).

The domain/stage follow-up adds structural reply bounds and mocked exclusive-log,
timeout, failure and no-replay checks. Accepted stage result JSON remains a local
trust input, not authenticated target evidence. All 11 engine JSON assets pass
separate structural checks; four unbound digests and captured SDK provenance are
not verified. See `native-review.md` for exact scope.

The browser-entry form has a `connect-src 'none'` meta CSP, no storage or upload
operations, bounded metadata and optional presence-only checks. A strict separate
schema forbids claiming authenticated identity, native execution, recovery or
Phase 4 completion. Chromium and WebKit desktop controls verify export, download,
CSP fetch blocking and a no-JavaScript fallback. The local Firefox launch failure
remains explicit; no new Linux CI success or target-browser result is claimed.

All 95 tracked upstream files now have recorded walkthrough entries.

## Console browser evidence (2026-10-27)

Target browser access was established on a physical Switch 2 (firmware 23.0.1)
via the LAN debug bridge. The captive portal applet (WifiWebAuthApplet, WebKit
613.0, NintendoBrowser 5.2.0.55481) loaded the debug page over HTTP from the
host Mac and executed remote eval commands.

This closes the **target browser access** gate. The remaining three gates
(hardware execution, device recovery, independent validation) remain open because
the browser lacks WebAssembly, SharedArrayBuffer, Atomics, and WebGL — the
upstream payload cannot execute in this environment. Full capability data:
`docs/switch2-browser-evidence.json`.

Phase 4 remains open. The browser route is confirmed reachable but insufficient
for the upstream exploit chain without SmileBASIC 4.4.9 or a WebKit vulnerability.
Source/evidence prereleases are recorded separately in `release.md` and `phase-status.md`.
