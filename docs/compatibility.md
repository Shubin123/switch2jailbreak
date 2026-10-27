# Compatibility Report

**Date**: 2026-10-27
**Test suite version**: 1.0.0

## Test suites

### 1. JavaScript Features (20 tests)

Detects ES2020–ES2024 language features and Web APIs. Establishes what the
JS engine supports, which constrains what exploit code can use.

| ID | Feature | Node.js v26 | Browser (pending) |
|----|---------|:-----------:|:-----------------:|
| js-feat-001 | ES2020: optional chaining | PASS | — |
| js-feat-002 | ES2020: nullish coalescing | PASS | — |
| js-feat-003 | ES2020: BigInt | PASS | — |
| js-feat-004 | ES2020: Promise.allSettled | PASS | — |
| js-feat-005 | ES2020: globalThis | PASS | — |
| js-feat-006 | ES2021: String.replaceAll | PASS | — |
| js-feat-007 | ES2021: Promise.any | PASS | — |
| js-feat-008 | ES2021: WeakRef | PASS | — |
| js-feat-009 | ES2022: Array.at | PASS | — |
| js-feat-010 | ES2022: Object.hasOwn | PASS | — |
| js-feat-011 | ES2022: Error.cause | PASS | — |
| js-feat-012 | ES2023: Array.findLast | PASS | — |
| js-feat-013 | ES2023: Array.toSorted | PASS | — |
| js-feat-014 | ES2024: Promise.withResolvers | PASS | — |
| js-feat-015 | ES2024: Object.groupBy | PASS | — |
| js-feat-016 | WebAPI: fetch | PASS | — |
| js-feat-017 | WebAPI: TextEncoder/Decoder | PASS | — |
| js-feat-018 | WebAPI: structuredClone | PASS | — |
| js-feat-019 | WebAPI: AbortController | PASS | — |
| js-feat-020 | WebAPI: crypto.getRandomValues | PASS | — |

### 2. Runtime Error Handling (15 tests)

Tests error recovery, memory allocation limits, and dynamic code execution.

| ID | Test | Node.js v26 | Browser (pending) |
|----|------|:-----------:|:-----------------:|
| rt-err-001 | Stack overflow recovery | PASS | — |
| rt-err-002 | Heap allocation (large array) | PASS | — |
| rt-err-003 | Regex backtracking timeout | PASS | — |
| rt-err-004 | TypeError on null access | PASS | — |
| rt-err-005 | SyntaxError from eval | PASS | — |
| rt-err-006 | URIError from malformed URI | PASS | — |
| rt-err-007 | Promise rejection handling | PASS | — |
| rt-err-008 | 64 MiB ArrayBuffer allocation | PASS | — |
| rt-err-009 | SharedArrayBuffer available | PASS | — |
| rt-err-010 | eval() available | PASS | — |
| rt-err-011 | Function constructor available | PASS | — |
| rt-err-012 | Error stack traces | PASS | — |
| rt-err-013 | Proxy and Reflect | PASS | — |
| rt-err-014 | Symbol.species customization | PASS | — |
| rt-err-015 | JSON.parse error recovery | PASS | — |

### 3. Isolation & Sandbox Detection (20 tests)

Detects browser sandbox features. Many will fail in Node.js (expected — they
are browser-only APIs). Meaningful results require running in the target
browser environment.

| ID | Test | Node.js v26 | Browser (pending) |
|----|------|:-----------:|:-----------------:|
| iso-001 | WebAssembly available | PASS | — |
| iso-002 | WebAssembly.compile | PASS | — |
| iso-003 | Service Worker API | FAIL* | — |
| iso-004 | Web Worker API | FAIL* | — |
| iso-005 | localStorage | FAIL* | — |
| iso-006 | IndexedDB | FAIL* | — |
| iso-007 | document.cookie | FAIL* | — |
| iso-008 | XMLHttpRequest | FAIL* | — |
| iso-009 | WebSocket API | PASS | — |
| iso-010 | Geolocation API | FAIL* | — |
| iso-011 | Notification API | FAIL* | — |
| iso-012 | Clipboard API | FAIL* | — |
| iso-013 | Cross-origin isolation | FAIL* | — |
| iso-014 | Permissions API | FAIL* | — |
| iso-015 | CSP meta detectable | FAIL* | — |
| iso-016 | window.open | FAIL* | — |
| iso-017 | history.pushState | FAIL* | — |
| iso-018 | Blob URL creation | PASS | — |
| iso-019 | Performance.now | PASS | — |
| iso-020 | ArrayBuffer transfer | PASS | — |

*FAIL in Node.js is expected — these are browser-only APIs. Browser column
will be populated when tests are run on the target console's browser.

## How to run

```sh
# All suites via Node.js (baseline)
./tests/run-all.sh

# Individual suite
node tests/javascript-features/feature-detect.js
node tests/runtime-errors/error-handling.js
node tests/isolation/sandbox-detect.js

# In a browser: open tests/browser-harness.html
# Click "Export JSON" to extract combined results
```

## Interpreting results

- **Node.js baseline**: establishes that the test code itself is correct.
  All JS feature and runtime tests should pass. Isolation tests targeting
  browser APIs will fail (this is expected and documented).

- **Browser results**: the useful data. When run on the Switch 2 browser,
  differences from the Node.js baseline reveal what the WebKit build
  supports or restricts.

- **Key indicators for exploit viability**:
  - `eval()` and `Function` constructor: required for dynamic code execution
  - `ArrayBuffer` allocation size: constrains payload staging
  - `SharedArrayBuffer`: needed for timing-based techniques
  - `WebAssembly`: alternative code execution path
  - `WebSocket`: potential communication channel back to host

## Output format

All results conform to `results/schema.json`. Each test run produces a
JSON file with the environment, individual test outcomes, and a summary.
