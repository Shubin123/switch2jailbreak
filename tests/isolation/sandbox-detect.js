/*
 * Browser isolation and sandbox detection tests.
 * Probes for security-relevant APIs and sandbox boundaries.
 * All tests are non-exploitative — they detect whether APIs exist
 * and what their default posture is, not attempt to bypass them.
 *
 * In Node.js, browser-only APIs will report as absent (expected).
 * The interesting results come from running this in a browser context.
 *
 * Usage (Node.js): node sandbox-detect.js
 * Usage (browser): load via <script>, read window.__isolationResults
 */

const tests = [
  {
    test_id: "iso-001",
    name: "WebAssembly available",
    category: "isolation",
    run: () => typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function",
  },
  {
    test_id: "iso-002",
    name: "WebAssembly.compile works",
    category: "isolation",
    run: () => {
      if (typeof WebAssembly === "undefined") return false;
      try {
        const minimal = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
        const module = new WebAssembly.Module(minimal);
        return module instanceof WebAssembly.Module;
      } catch {
        return false;
      }
    },
  },
  {
    test_id: "iso-003",
    name: "Service Worker API available",
    category: "isolation",
    run: () => typeof navigator !== "undefined" && "serviceWorker" in navigator,
  },
  {
    test_id: "iso-004",
    name: "Web Worker API available",
    category: "isolation",
    run: () => typeof Worker === "function",
  },
  {
    test_id: "iso-005",
    name: "localStorage available",
    category: "isolation",
    run: () => {
      try {
        return typeof localStorage !== "undefined" && typeof localStorage.setItem === "function";
      } catch {
        return false;
      }
    },
  },
  {
    test_id: "iso-006",
    name: "IndexedDB available",
    category: "isolation",
    run: () => {
      try {
        return typeof indexedDB !== "undefined";
      } catch {
        return false;
      }
    },
  },
  {
    test_id: "iso-007",
    name: "document.cookie accessible",
    category: "isolation",
    run: () => {
      try {
        return typeof document !== "undefined" && typeof document.cookie === "string";
      } catch {
        return false;
      }
    },
  },
  {
    test_id: "iso-008",
    name: "XMLHttpRequest available",
    category: "isolation",
    run: () => typeof XMLHttpRequest === "function",
  },
  {
    test_id: "iso-009",
    name: "WebSocket API available",
    category: "isolation",
    run: () => typeof WebSocket === "function",
  },
  {
    test_id: "iso-010",
    name: "Geolocation API available",
    category: "isolation",
    run: () =>
      typeof navigator !== "undefined" && "geolocation" in navigator,
  },
  {
    test_id: "iso-011",
    name: "Notification API available",
    category: "isolation",
    run: () => typeof Notification === "function",
  },
  {
    test_id: "iso-012",
    name: "Clipboard API available",
    category: "isolation",
    run: () =>
      typeof navigator !== "undefined" &&
      "clipboard" in navigator &&
      typeof navigator.clipboard.readText === "function",
  },
  {
    test_id: "iso-013",
    name: "Cross-origin isolation (COOP/COEP)",
    category: "isolation",
    run: () => {
      if (typeof self === "undefined") return false;
      return typeof self.crossOriginIsolated === "boolean"
        ? self.crossOriginIsolated
        : false;
    },
  },
  {
    test_id: "iso-014",
    name: "Permissions API available",
    category: "isolation",
    run: () =>
      typeof navigator !== "undefined" &&
      "permissions" in navigator &&
      typeof navigator.permissions.query === "function",
  },
  {
    test_id: "iso-015",
    name: "Content Security Policy meta detectable",
    category: "isolation",
    run: () => {
      if (typeof document === "undefined") return false;
      const metas = document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
      return metas.length > 0;
    },
  },
  {
    test_id: "iso-016",
    name: "window.open available",
    category: "isolation",
    run: () => typeof window !== "undefined" && typeof window.open === "function",
  },
  {
    test_id: "iso-017",
    name: "history.pushState available",
    category: "isolation",
    run: () =>
      typeof history !== "undefined" && typeof history.pushState === "function",
  },
  {
    test_id: "iso-018",
    name: "Blob URL creation",
    category: "isolation",
    run: () => {
      try {
        if (typeof Blob === "undefined" || typeof URL === "undefined") return false;
        const blob = new Blob(["test"], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        URL.revokeObjectURL(url);
        return typeof url === "string" && url.startsWith("blob:");
      } catch {
        return false;
      }
    },
  },
  {
    test_id: "iso-019",
    name: "Performance.now high resolution",
    category: "isolation",
    run: () => {
      if (typeof performance === "undefined") return false;
      if (typeof performance.now !== "function") return false;
      const t1 = performance.now();
      const t2 = performance.now();
      return typeof t1 === "number" && t2 >= t1;
    },
  },
  {
    test_id: "iso-020",
    name: "ArrayBuffer transfer (structured clone)",
    category: "isolation",
    run: () => {
      try {
        const buf = new ArrayBuffer(8);
        const view = new Uint8Array(buf);
        view[0] = 42;
        if (typeof structuredClone === "function") {
          const cloned = structuredClone(buf, { transfer: [buf] });
          return buf.byteLength === 0 && cloned.byteLength === 8;
        }
        return false;
      } catch {
        return false;
      }
    },
  },
];

function runTests() {
  const env = {};
  if (typeof process !== "undefined" && process.version) {
    env.os = process.platform;
    env.node_version = process.version;
  }
  if (typeof navigator !== "undefined") {
    env.browser_ua = navigator.userAgent;
    env.os = navigator.platform;
  }

  const results = tests.map((t) => {
    const start = Date.now();
    let status, actual, error_message;
    try {
      const passed = t.run();
      status = passed ? "pass" : "fail";
      actual = String(passed);
    } catch (e) {
      status = "error";
      error_message = String(e);
      actual = "threw";
    }
    return {
      test_id: t.test_id,
      category: t.category,
      name: t.name,
      status,
      expected: "true",
      actual,
      ...(error_message && { error_message }),
      duration_ms: Date.now() - start,
    };
  });

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    skipped: results.filter((r) => r.status === "skip").length,
    errors: results.filter((r) => r.status === "error").length,
  };

  return {
    schema_version: "1.0.0",
    run_id: `${new Date().toISOString().replace(/[:.]/g, "-")}-iso`,
    timestamp: new Date().toISOString(),
    target_id: "local-baseline",
    environment: env,
    results,
    summary,
  };
}

if (typeof module !== "undefined" && module.exports) {
  const output = runTests();
  console.log(JSON.stringify(output, null, 2));
} else if (typeof window !== "undefined") {
  window.__isolationResults = runTests();
}
