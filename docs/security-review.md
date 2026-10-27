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

Real browser captures and policy-enforcement checks, a complete upstream native
code audit, console hardware validation, and release reproduction/publication
are not established by these host results. See `security-boundaries.md` for
what each observation can and cannot demonstrate. No privilege boundary is
weakened to make a check pass.
