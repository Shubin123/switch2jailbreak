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

## What's here

| Path | Purpose |
|------|---------|
| `scripts/check-env.sh` | Verify macOS prerequisites (Node.js, network) |
| `scripts/check-upstream.sh` | Pull latest commit info and README from upstream |
| `scripts/monitor-upstream.sh` | Watch for new commits (run periodically or via cron) |
| `docs/firmware-notes.md` | Firmware preservation and version check guide |
| `docs/research-log.md` | Chronological log of verified findings |
| `docs/environment-setup.md` | macOS environment setup instructions |

## Quick start

```sh
# Verify your Mac is ready
./scripts/check-env.sh

# Check upstream for changes
./scripts/check-upstream.sh

# Watch for new commits (runs every 30 min by default)
./scripts/monitor-upstream.sh
```

## References

- [Author's technical write-up](https://pepsipu.com/blog/2026-10-switch2-jailbreak-ns2jb/)
- [Upstream repo](https://gitlab.com/pepsipu/ns2jb)
- [Public status gist](https://gist.github.com/Shubin123/c1a5a09ec5005e93cf86380260060dac)
