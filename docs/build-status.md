# Build Status Report — Phase 2

**Date**: 2026-10-27
**Upstream commit**: `95f55250` (Oct 22, 2026)
**Verification host**: macOS Darwin 27.0.0 arm64, Node.js v26.12.0

## Dependency matrix

### Runtime dependencies

| Dependency | Type | Required version | Installed | Status |
|-----------|------|-----------------|-----------|--------|
| Node.js | Runtime | >= 22.0.0 | v26.12.0 | OK |
| `node:fs/promises` | Built-in | — | Present | OK |
| `node:net` | Built-in | — | Present | OK |
| `node:crypto` | Built-in | — | Present | OK |
| `node:child_process` | Built-in | — | Present | OK |
| `node:readline` | Built-in | — | Present | OK |
| `node:readline/promises` | Built-in | — | Present | OK |
| `node:test` | Built-in | — | Present | OK |
| `node:assert/strict` | Built-in | — | Present | OK |
| `node:buffer` | Built-in | — | Present | OK |
| `node:os` | Built-in | — | Present | OK |
| `node:path` | Built-in | — | Present | OK |
| `node:events` | Built-in | — | Present | OK |
| npm packages | External | None | N/A | OK (zero external deps) |

### Build dependencies (payload only)

| Dependency | Type | Required version | Installed | Status |
|-----------|------|-----------------|-----------|--------|
| Zig | Compiler | 0.15.2 | Not installed | MISSING |

**Note**: Zig is only needed to rebuild the native payload from source (`engine/switch2/ro/payload/`).
The pre-built payload binary (`engine/switch2/ro/payload/main`) is included and its SHA256 matches.
Running the exploit does not require Zig.

### Console-side dependencies

| Dependency | Required version | Status |
|-----------|-----------------|--------|
| System firmware | 23.0.1 | Cannot verify without hardware |
| SmileBASIC | 4.4.9 | Delisted from eShop |
| Free save space | >= 20 MiB | Cannot verify without hardware |
| Network (LAN) | Port 39380 TCP | Host-side reachable |

## Upstream test results

```
node --test test.cjs
11 tests, 11 pass, 0 fail (194ms)
```

| Test | Result |
|------|--------|
| fragmented and coalesced TCP records preserve every byte | PASS |
| a timeout permanently closes the connection | PASS |
| a disconnect cannot turn a partial record into a reply | PASS |
| pairing binds the fresh token, platform and bootstrap layout | PASS |
| native records preserve all 64 bits and reject malformed arguments | PASS |
| unused cache entries accept only zero fill or the known pathname fill | PASS |
| signed prefixes satisfy encoding, bucket and address constraints | PASS |
| payloads have their declared hashes and contain NSO images | PASS |
| one host address and one BASIC command select the fixed Switch 2 path | PASS |
| a stop prevents the next operation but still permits restoration | PASS |
| the engine has only local or Node dependencies, all present in the package | PASS |

## SHA256 verification

- **93 of 94 files**: checksums match
- **README.md**: FAILED — the `clarify` commit (95f5525) modified README.md after SHA256SUMS was generated. This is a documentation-only change and does not affect executable code.

## Repository structure analysis

```
ns2jb/
├── run.cjs                  ← Host entrypoint (no npm install)
├── test.cjs                 ← Host-side test suite (node:test)
├── bootstrap.bas            ← SmileBASIC program (entered on console)
├── SHA256SUMS               ← Integrity checksums for all files
└── engine/
    ├── build-payload.cjs    ← Payload build script (requires Zig 0.15.2)
    ├── lib/                 ← Core networking (connection, bridge, native)
    ├── shared/              ← Protocol definitions (frames, IPC, RPC, stages)
    └── switch2/
        ├── pipeline.cjs     ← Main launch sequence
        ├── acquire.cjs      ← Resource acquisition
        ├── cleanup-scratch.cjs
        ├── app/             ← Application-level logic (filesystem, sessions, workers)
        ├── memory/          ← Memory management (cache, sessions, probing)
        ├── process/         ← FS execution and test functions
        ├── retained/        ← Retained memory handling
        ├── ro/              ← Read-only process and payload
        └── tools/           ← Utility endpoints
```

**Total files**: 94 (93 source/data + 1 pre-built binary)
**External dependencies**: 0 (all imports are `node:` built-in modules)
**Package manager**: None (no package.json, no node_modules)

## Build reproducibility

| Aspect | Status |
|--------|--------|
| Clone and run tests | Reproducible |
| Clone and execute (with hardware) | Not yet tested |
| Rebuild payload from source | Blocked (Zig 0.15.2 not installed) |
| Verify pre-built payload integrity | SHA256 matches manifest |

## Findings

1. **Zero external dependencies** — the upstream's own test confirms all `require()` calls resolve to `node:` built-ins or local files. This eliminates supply chain risk from npm.
2. **README checksum mismatch is benign** — only documentation was changed after SHA256SUMS was written. All executable files pass.
3. **Zig optional** — the pre-built payload passes its SHA256 and NSO header checks. Zig is only needed for auditing/rebuilding the native binary from source.
4. **Node.js version margin** — v26.12.0 exceeds the 22+ requirement with no compatibility issues in test results.
5. **Console-side deps cannot be verified remotely** — firmware version, SmileBASIC availability, and save space require physical hardware access.
