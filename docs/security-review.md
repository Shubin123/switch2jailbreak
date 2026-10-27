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

## Observed validation

- Local regression run: 15 tests passed, zero failures (includes synthetic
  negative fixtures; those deliberately exercise verifier rejection).
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
assembly, linker layout, builder, loader gates and selected host interfaces
(20 text files). The host-only audit runs 23 boundary/container/assembly and
mocked lifecycle checks, preserves
per-file source hashes, and is required by CI before source packaging. It does
not execute a console payload. The report distinguishes kernel assumptions,
an unconfirmed descriptor-cleanup concern, partial table discovery, and
conditional restoration from
verified hardware results. Remaining native-chain coverage and console evidence
keep Phase 4 open. Source/evidence prereleases are recorded separately in
`release.md` and `phase-status.md`; the older snapshots above are historical.
