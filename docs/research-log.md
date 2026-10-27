# Research log

Chronological record of verified findings. Each entry notes the date, source,
and what was confirmed vs. what remains unverified.

---

## 2026-10-27 — File-level native coverage complete

Local workspace evidence, not independent console reproduction:

- Browser entry now provides bounded manual metadata, opt-in presence-only
  observations, copyable JSON and downloads without storage or upload. Changing
  metadata clears stale exports. A strict separate schema cannot claim native
  execution, attested identity, recovery or Phase 4 completion.
- Chromium and WebKit desktop controls pass. The full local browser run records
  14 passes and two Firefox process-launch failures; no failure is hidden.
- The pinned native audit records 98/98 passing checks over all 95 tracked
  upstream files (9,128 lines), including domain framing, mocked stage
  failure/timeout cleanup, memory-subsystem boundaries, orchestration/protocol
  layer, app-layer structural checks, tools, and JSON-asset validation.
- File-level walkthrough coverage is complete: all 95 tracked upstream files
  belong to the recorded review with SHA256 and line-count entries.
- All 11 engine JSON assets pass separate structural checks covering 56 byte
  declarations. Four digest fields lack local byte bindings and remain
  unverified; SDK provenance and instruction semantics are not established.
- Phase 4 remains open for path/branch-level coverage, target-browser
  access/capture, browser-native execution and independent physical recovery.

See `browser-entry.md`, `native-coverage.md` and `native-review.md` for scope.

## 2026-10-26 — Initial research

**Source**: upstream README (`95f5525`, Oct 22), pepsipu.com blog (Oct 18),
Reddit r/switch2hacks.

### Confirmed

- ns2jb demonstrates FS-module native code execution on Switch 2 fw 23.0.1.
- Requires SmileBASIC 4.4.9, Node.js 22+, macOS/Linux, shared LAN, 20 MiB
  free in SmileBASIC save.
- SmileBASIC 4.4.9 is delisted from the eShop.
- The exploit is not persistent — restarting the console ends the session.
- The demo does not install custom firmware or provide kernel access.
- Author's blog describes an initial browser-based attempt that hit mitigations.
- Blog proposes a data-only WebKit approach as future work.

### Unverified

- Community reports claim a WebKit port exists and was seeking testers (Oct 24).
- No downloadable WebKit implementation found in the upstream repo or author's site.
- Demo edition of SmileBASIC as an alternative entry point — not documented upstream.

### Action items

- [ ] Monitor upstream repo for WebKit-related commits or branches.
- [ ] Check author's blog for updates.
- [ ] Watch r/switch2hacks and GBAtemp for reproduction reports.
- [ ] Do not update console firmware.
