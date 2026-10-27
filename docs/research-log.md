# Research log

Chronological record of verified findings. Each entry notes the date, source,
and what was confirmed vs. what remains unverified.

---

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
