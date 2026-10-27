# macOS environment setup

## Prerequisites

| Requirement | Minimum | Check command |
|-------------|---------|---------------|
| Node.js | 22.0.0+ | `node --version` |
| curl | any | `curl --version` |
| git | any | `git --version` |
| jq (optional) | any | `jq --version` |

## Install Node.js 22+

### Option A: Homebrew (recommended)

```sh
brew install node@22
```

### Option B: nvm

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22
nvm use 22
```

### Option C: Official installer

Download from https://nodejs.org/ — pick the LTS 22.x line.

## Network requirements

The ns2jb host script communicates with the Switch 2 over the local network
on **port 39380** (TCP).

### Checklist

- [ ] Mac and Switch 2 on the same Wi-Fi network (or wired LAN).
- [ ] No firewall blocking port 39380 inbound on the Mac.
- [ ] Determine your Mac's local IP:
  ```sh
  ipconfig getifaddr en0    # Wi-Fi
  ipconfig getifaddr en1    # Ethernet (varies)
  ```
- [ ] Verify reachability from another device on the same network if possible.

### macOS firewall

If the built-in firewall is enabled:

```sh
# Check status
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# If blocking, allow Node.js (temporary — revert after)
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add $(which node)
```

## Directory structure

Keep the exploit source in its own directory, separate from this workspace:

```
~/Documents/
├── switch2jailbreak/       ← this repo (prep + monitoring)
└── ns2jb/                  ← upstream source (when available)
```

Do not run `npm install` or execute scripts from untrusted sources in the
upstream directory without reading them first.
