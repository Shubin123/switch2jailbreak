# WebKit 613.0 Attack Surface Analysis — Switch 2 WifiWebAuthApplet

Research date: 2026-10-27. Based on live debug bridge probing of physical
Switch 2 (firmware 23.0.1) and CVE research.

## Target profile

| Property | Value |
|---|---|
| UA | Mozilla/5.0 (Nintendo Switch; WifiWebAuthApplet) AppleWebKit/613.0 (KHTML, like Gecko) NF/7.0.3.12.11 NintendoBrowser/5.2.0.55481 |
| Engine | WebKit 613.0 / WKC 3.12.11 (ACCESS NetFront Browser NX) |
| WebKit era | Safari 16.0–16.5 (Sep 2022 – Jul 2023) |
| Arch | ARM64 (Cortex-A78AE, 4 cores reported) |
| Applet | WifiWebAuthApplet (captive portal sandbox) |

## Available JS primitives for exploitation

| Feature | Available | Exploitation use |
|---|---|---|
| BigInt | Yes | Pointer arithmetic without float precision loss |
| Proxy | Yes | JIT deoptimization triggers, type confusion setups |
| WeakRef | Yes | GC timing, heap grooming |
| FinalizationRegistry | Yes | GC callback exploitation |
| Workers | Yes | Race conditions, heap spray from parallel threads |
| Fetch / XHR | Yes | Data exfiltration to debug host |
| ArrayBuffer / DataView | Yes | Arbitrary R/W once primitives obtained |
| Blob | Yes | Heap spray vehicle |
| async/await | Yes | Microtask timing |
| Generators | Yes | Stack frame manipulation |
| structuredClone | Yes | Object serialization for heap layout probing |
| IndexedDB | Yes | Persistent storage for multi-stage payloads |

## Unavailable (mitigations / compile-time exclusions)

| Feature | Status | Impact on exploitation |
|---|---|---|
| WebAssembly | Compile-time disabled (ENABLE_WEBGL 0) | No WASM RWX pages for shellcode staging |
| SharedArrayBuffer | Not available | No shared memory for Spectre/race attacks |
| Atomics | Not available | No atomic operations for timing |
| WebGL/WebGL2 | Compile-time disabled | No GPU shader exploitation |
| WebGPU | Not available | No compute shader exploitation |
| ServiceWorker | Not available | No persistent interception |
| performance.now() | Clamped to 1ms | Spectre-class timing attacks mitigated |

## CVE candidates affecting WebKit 613.0

### CVE-2023-37450 — HIGHEST PRIORITY

- **Type**: JIT compiler vulnerability (likely DFG/FTL)
- **Fix**: Safari 16.5.2 / iOS 16.5.1 / macOS 13.4.1 (July 2023)
- **WebKit 613.0 status**: LIKELY VULNERABLE — fix postdates the 613.0 base
- **Public exploit**: wh1te4ever/WebKit-Bug-256172 — full RCE on macOS 13.3.1
- **Technique**: addrof/fakeobj → arbitrary R/W → JIT page overwrite
- **Limitation**: Hardcoded offsets for macOS x86_64; needs adaptation for ARM64/Switch
- **No WebAssembly dependency**: Exploit uses pure JSC JIT primitives

### CVE-2023-41993

- **Type**: JSC type confusion (Symbol.m_privateName / GetterSetter.m_getter)
- **Fix**: iOS 17.0.1 / Safari 17.0.1 (Sep 2023)
- **WebKit 613.0 status**: UNCERTAIN — bug may have been introduced in 614.x
- **Public PoC**: po6ix — addrof/fakeobj only (no full chain)
- **Note**: Affects iOS 17.0 / macOS 14.0, which use WebKit 615.x. May not
  apply to 613.0 unless the vulnerable code was backported.

### CVE-2023-32435 (Operation Triangulation)

- **Type**: Memory corruption in JSC
- **Fix**: iOS 16.5.1 (June 2023)
- **WebKit 613.0 status**: POSSIBLY VULNERABLE
- **Public info**: Kaspersky documented the chain but exploit details are limited
- **Note**: Used in a sophisticated state-sponsored attack chain

### CVE-2024-44308

- **Type**: DFG register corruption
- **Fix**: iOS 17.7.2 / macOS 15.1.1 (Nov 2024)
- **WebKit 613.0 status**: UNKNOWN — bug found in DFG, unclear when introduced
- **Public info**: Exodus Intelligence described the root cause; no public PoC
- **Note**: Originally found Feb 2023, patched Nov 2024. Long dwell time
  suggests the vulnerable code may be old enough to exist in 613.0.

## Exploitation strategy (without WebAssembly)

### Classical JSC JIT chain

1. **Trigger**: JIT type confusion or bounds check elimination bug
2. **addrof primitive**: Leak JSC object addresses (pure JS)
3. **fakeobj primitive**: Create fake object at controlled address (pure JS)
4. **Arbitrary R/W**: Fake a Float64Array or ArrayBuffer with controlled
   backing store pointer → read/write arbitrary memory
5. **StructureID bypass**: JSC randomizes StructureIDs since ~2020. Need to
   either brute-force (feasible on 32-bit ID space) or leak from a known
   object (Project Zero technique)
6. **Code execution**: Without WASM RWX pages, options are:
   - JIT code overwrite (if JIT pages are RWX — possible on Switch)
   - ROP chain through JIT-compiled code gadgets
   - JIT spraying (spray known instruction patterns via JS compilation)
7. **Payload**: Bridge to ns2jb host runner protocol

### Key unknowns requiring device-level work

- ASLR slide / base addresses of JSC heap, JIT pages, dyld
- JIT page permissions (RWX vs RX with separate RW mapping)
- StructureID randomization state and seed
- PAC (Pointer Authentication) status on Switch 2 ARM64
- Exact binary layout of WKC 3.12.11 (differs from upstream WebKit)
- Sandbox policy of WifiWebAuthApplet

## Debug bridge testing plan

The live debug bridge can test for specific vulnerable behaviors without
requiring binary analysis:

1. **JIT warmup confirmation**: Run tight loops, measure timing changes
2. **CVE-2023-37450 trigger**: Send the known trigger pattern, check for crash
3. **Type confusion probing**: Test JSC type handling edge cases
4. **Heap layout exploration**: Use structured allocation patterns to infer
   JSC heap behavior
5. **StructureID probing**: Allocate many object shapes, observe IDs

## Sources

- [wh1te4ever/WebKit-Bug-256172](https://github.com/wh1te4ever/WebKit-Bug-256172)
- [CVE-2023-41993 PoC](https://github.com/0x06060606/CVE-2023-41993)
- [Exodus Intelligence - Safari integer overflow](https://blog.exodusintel.com/2023/07/20/shifting-boundaries-exploiting-an-integer-overflow-in-apple-safari/)
- [Project Zero - JITSploitation II](https://projectzero.google/2020/09/jitsploitation-two.html)
- [ret2 - Pwn2Own 2018 JSC](https://blog.ret2.io/2018/07/11/pwn2own-2018-jsc-exploit/)
- [PS4 WebKit Bugs wiki](https://www.psdevwiki.com/ps4/WebKit_Bugs)
- [Synacktiv - WebKit 0-day in PS4](https://www.synacktiv.com/sites/default/files/2021-05/eu-20-Meffre-This-Is-For-The-Pwners-Exploiting-A-Webkit-0day-In-Playstation4.pdf)
- [Gezine Switch 2 offline exploit report](https://www.tweaktown.com/news/112732/developer-cracks-universal-offline-exploit-for-nintendo-switch-and-switch-2/index.html)

## Limitations

This analysis identifies likely-vulnerable CVEs and exploitation strategies.
It does not constitute a working exploit. Developing a functional chain
requires binary analysis of WKC 3.12.11 on the Switch 2, which requires
either dumping the binary from the device or obtaining it through other means.
The debug bridge can test for the presence of vulnerabilities but cannot
determine binary-level details (offsets, gadgets, ASLR layout) needed for
a reliable exploit.
