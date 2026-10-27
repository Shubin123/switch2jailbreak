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
| Phase 4: security/isolation review | `docs/security-review.md`, `docs/native-review.md`, documented boundaries, negative fixtures, real CSP/COOP/COEP controls, 98 host-only native checks over all 95 tracked files (9,128 lines), 15 documented findings (NR-01 through NR-15), structural checks for 11 JSON assets and a local-export browser entry page | Partial; file-level native coverage complete, independent console validation remains open |
| Phase 5: reproducible workspace release | Two local source packages match; independent Linux/macOS archives match; extracted archive regressions pass; tagged prerelease includes checksums and preserved CI evidence | Complete for workspace source/evidence publication; no jailbreak or hardware claim |

## Priority mapping

The pinned [native coverage inventory](native-coverage.md) now accounts for all
95 upstream tracked files; every one belongs to the recorded walkthrough.
These are file-level inventory counts, not executable-path coverage. Browser
navigation, target capture, native execution and recovery remain separate gates.

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

## Console browser evidence (2026-10-27)

Target browser access was established via LAN debug bridge on a physical Switch 2
(firmware 23.0.1). The captive portal browser (WifiWebAuthApplet) loaded the
debug page from the host Mac over HTTP and executed JavaScript including remote
eval commands. Full evidence: `docs/switch2-browser-evidence.json`.

Key findings:
- WebKit 613.0 / NintendoBrowser 5.2.0.55481
- 1920x1080 @1x, 4 CPU cores, 0 touch points (maxTouchPoints)
- **No WebAssembly** — `Can't find variable: WebAssembly`
- No SharedArrayBuffer, no Atomics, no WebGL, no WebGPU
- No ServiceWorker, no raw sockets
- performance.now() clamped to 1ms resolution
- BigInt, Proxy, WeakRef, async/await, generators, Fetch, Workers, Blob,
  IndexedDB, localStorage, crypto.getRandomValues all available

The absence of WebAssembly is decisive: the upstream ns2jb payload is compiled
native code that requires WebAssembly or equivalent memory access to execute in
a browser context. The captive portal applet cannot run it. The remaining Phase 4
gates (hardware execution, device recovery, independent validation) require either
SmileBASIC 4.4.9 or a WebKit 613.0 exploit providing arbitrary code execution.
Neither is available.

## Remaining gates

1. ~~Complete the remaining upstream native-chain review at the pinned revision.~~
   File-level walkthrough coverage is complete: all 95 tracked files have recorded
   entries with SHA256, line counts and 98 host-only boundary checks in
   `native-review.md`. Path/branch coverage of every conditional remains open.
2. ~~Establish whether the intended console has a usable browser context without
   relying on an unverified WebKit exploit announcement.~~
   Confirmed: the captive portal browser is reachable and runs JavaScript. However,
   it lacks WebAssembly, SharedArrayBuffer, and WebGL — insufficient for the
   upstream exploit chain. See `docs/switch2-browser-evidence.json`.
3. If a browser context is available and resource-heavy tests are appropriate,
   capture the target firmware, entry context and an unmodified 55-observation
   export. Record limitations or incomplete loading rather than inventing data.
4. Independently validate any claimed console execution and recovery behavior
   on the documented hardware/firmware. Requires SmileBASIC 4.4.9 or a WebKit
   vulnerability — the captive portal browser alone is not sufficient.

Do not update firmware, alter network security settings, open an unauthenticated
host listener, or execute a console payload simply to remove an unchecked box.
These actions are not part of the automated host validation pipeline.
