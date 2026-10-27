# Phase completion audit

Updated October 27, 2026. This audit distinguishes source/tooling deliverables
from proof of console execution. Passing a host test cannot substitute for a
target observation. The overall all-phases objective remains incomplete while
Phase 4 is open.

| Requirement | Evidence | Status |
| --- | --- | --- |
| Phase 1: research baseline | `docs/baseline.md`, research log, target configuration | Complete as a source-backed inventory, not independent hardware proof |
| Phase 2: upstream/build verification | Pinned commit, 11 host tests, checksum policy, payload manifest, Zig 0.15.2 byte-for-byte rebuild; Linux and macOS results agree | Complete for host/build scope |
| Phase 3: compatibility harness | 55 observations, applicability handling, validated JSON exports, three real desktop engines, missing/malformed-suite controls | Harness complete; target-console observations unavailable |
| Phase 4: security/isolation review | `docs/security-review.md`, `docs/native-review.md`, documented boundaries, negative fixtures, real CSP/COOP/COEP controls, core payload/activation/probe/loader-gate/handle-copy/cache/protocol and complete RO orchestration/cleanup walkthrough; 36 host-only native checks | Partial; remaining native-chain paths and independent console validation remain open |
| Phase 5: reproducible workspace release | Two local source packages match; independent Linux/macOS archives match; extracted archive regressions pass; tagged prerelease includes checksums and preserved CI evidence | Complete for workspace source/evidence publication; no jailbreak or hardware claim |

## Priority mapping

- P0: upstream metadata and the pinned README have been rechecked. Failed HTTP
  or malformed metadata now fail the check without overwriting good state.
- P1: desktop capabilities and policy-dependent differences are measurable.
  No target console browser access has been established.
- P2: regressions verify shared-script loading, schema/accounting integrity,
  failure propagation, browser controls, and repeatable source packaging.
- P3: boundaries and review scope are documented. Coverage is explicitly not
  described as a complete native-code audit.
- P4: source/evidence prereleases preserve raw JSON. Public Gist summaries must
  distinguish access-controlled repository links from public source releases.

## Gates that cannot be inferred from green CI

1. Complete the remaining upstream native-chain review at the pinned revision,
   recording coverage, findings, and unresolved assumptions. The core C/assembly
   payload and selected host interfaces now have a recorded walkthrough, exact
   source hashes, and repeatable host-only boundary checks in `native-review.md`.
2. Establish whether the intended console has a usable browser context without
   relying on an unverified WebKit exploit announcement.
3. If a browser context is available and resource-heavy tests are appropriate,
   capture the target firmware, entry context and an unmodified 55-observation
   export. Record limitations or incomplete loading rather than inventing data.
4. Independently validate any claimed console execution and recovery behavior
   on the documented hardware/firmware. No device was available for this work.

Do not update firmware, alter network security settings, open an unauthenticated
host listener, or execute a console payload simply to remove an unchecked box.
These actions are not part of the automated host validation pipeline.
