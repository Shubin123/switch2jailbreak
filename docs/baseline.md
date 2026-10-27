# Baseline Report — Phase 1

**Date**: 2026-10-26
**Upstream revision**: `95f5525` (Oct 22, 2026)
**Target firmware**: 23.0.1

## Claims inventory

Each claim from upstream documentation and community sources is classified:

- **Verified**: independently confirmable from public source code, README, or blog
- **Reported**: stated by community members but not independently confirmed
- **Unknown**: mentioned but no source or evidence located

### Exploit mechanism

| # | Claim | Status | Source |
|---|-------|--------|--------|
| 1 | ns2jb achieves FS-module native code execution on Switch 2 | Verified | Upstream README, author blog (Oct 18) |
| 2 | Exploit targets firmware 23.0.1 specifically | Verified | Upstream README |
| 3 | Exploit is non-persistent (reboot clears it) | Verified | Upstream README |
| 4 | No CFW installation or kernel access provided | Verified | Upstream README |
| 5 | Relies on SmileBASIC 4.4.9 as the entry point | Verified | Upstream README |

### Prerequisites

| # | Claim | Status | Source |
|---|-------|--------|--------|
| 6 | Requires Node.js 22+ on the host machine | Verified | Upstream README |
| 7 | Host and console must share a LAN, port 39380 TCP | Verified | Upstream README |
| 8 | 20 MiB free in SmileBASIC save data required | Verified | Upstream README |
| 9 | SmileBASIC 4.4.9 is delisted from the eShop | Verified | eShop search (Oct 26) |
| 10 | SmileBASIC demo edition may serve as alternative | Unknown | Community speculation, no upstream docs |

### WebKit / browser route

| # | Claim | Status | Source |
|---|-------|--------|--------|
| 11 | Author's blog describes an initial browser-based attempt | Verified | pepsipu.com blog (Oct 18) |
| 12 | Browser attempt hit mitigations, pivoted to SmileBASIC | Verified | pepsipu.com blog (Oct 18) |
| 13 | A data-only WebKit approach proposed as future work | Verified | pepsipu.com blog (Oct 18) |
| 14 | Working WebKit port exists and was seeking testers | Reported | Reddit r/switch2hacks (Oct 24) |
| 15 | WebKit implementation source is publicly downloadable | Unknown | Not found in upstream repo or author's site |

### Build and reproduction

| # | Claim | Status | Source |
|---|-------|--------|--------|
| 16 | Upstream repo builds and runs on macOS/Linux | Verified | Upstream README |
| 17 | Exploit has been independently reproduced by third parties | Reported | Reddit comments, no verified reproduction log |
| 18 | Works on all Switch 2 hardware revisions | Unknown | No upstream documentation on hardware variants |

## Outstanding questions

1. Is the SmileBASIC demo edition a viable entry point?
2. When (if ever) will the WebKit route have public source?
3. Are there firmware versions below 23.0.1 that also work?
4. Does hardware revision (manufacturing batch) affect exploit reliability?

## Research checklist

- [x] Inventory upstream README claims
- [x] Inventory blog post claims
- [x] Check community reports (Reddit, GBAtemp)
- [x] Record target firmware version
- [x] Record SmileBASIC version and availability
- [x] Classify each claim
- [ ] Verify upstream builds successfully on macOS
- [ ] Verify upstream builds successfully on Linux
- [ ] Locate or rule out WebKit branch/fork
- [ ] Check for SmileBASIC demo availability
- [ ] Document exact test environment (OS version, Node version, network config)
