/*
 * Benign JavaScript feature-detection tests.
 * Run in a browser context to determine engine capabilities.
 * Outputs JSON matching results/schema.json.
 *
 * Usage (Node.js, for baseline):  node feature-detect.js
 * Usage (browser):                load via <script>, read window.__testResults
 */

(function() {
const tests = [
  {
    test_id: "js-feat-001",
    name: "ES2020: optional chaining",
    category: "javascript-feature",
    run: () => {
      const obj = { a: { b: 1 } };
      return obj?.a?.b === 1 && obj?.c?.d === undefined;
    },
  },
  {
    test_id: "js-feat-002",
    name: "ES2020: nullish coalescing",
    category: "javascript-feature",
    run: () => {
      const val = null ?? "default";
      return val === "default" && (0 ?? "default") === 0;
    },
  },
  {
    test_id: "js-feat-003",
    name: "ES2020: BigInt",
    category: "javascript-feature",
    run: () => typeof BigInt(9007199254740991n) === "bigint",
  },
  {
    test_id: "js-feat-004",
    name: "ES2020: Promise.allSettled",
    category: "javascript-feature",
    run: () => typeof Promise.allSettled === "function",
  },
  {
    test_id: "js-feat-005",
    name: "ES2020: globalThis",
    category: "javascript-feature",
    run: () => typeof globalThis !== "undefined",
  },
  {
    test_id: "js-feat-006",
    name: "ES2021: String.prototype.replaceAll",
    category: "javascript-feature",
    run: () => typeof String.prototype.replaceAll === "function",
  },
  {
    test_id: "js-feat-007",
    name: "ES2021: Promise.any",
    category: "javascript-feature",
    run: () => typeof Promise.any === "function",
  },
  {
    test_id: "js-feat-008",
    name: "ES2021: WeakRef",
    category: "javascript-feature",
    run: () => typeof WeakRef === "function",
  },
  {
    test_id: "js-feat-009",
    name: "ES2022: Array.prototype.at",
    category: "javascript-feature",
    run: () => typeof Array.prototype.at === "function" && [1, 2, 3].at(-1) === 3,
  },
  {
    test_id: "js-feat-010",
    name: "ES2022: Object.hasOwn",
    category: "javascript-feature",
    run: () => typeof Object.hasOwn === "function",
  },
  {
    test_id: "js-feat-011",
    name: "ES2022: Error.cause",
    category: "javascript-feature",
    run: () => {
      const err = new Error("test", { cause: "root" });
      return err.cause === "root";
    },
  },
  {
    test_id: "js-feat-012",
    name: "ES2023: Array.prototype.findLast",
    category: "javascript-feature",
    run: () => typeof Array.prototype.findLast === "function",
  },
  {
    test_id: "js-feat-013",
    name: "ES2023: Array.prototype.toSorted",
    category: "javascript-feature",
    run: () => typeof Array.prototype.toSorted === "function",
  },
  {
    test_id: "js-feat-014",
    name: "ES2024: Promise.withResolvers",
    category: "javascript-feature",
    run: () => typeof Promise.withResolvers === "function",
  },
  {
    test_id: "js-feat-015",
    name: "ES2024: Object.groupBy",
    category: "javascript-feature",
    run: () => typeof Object.groupBy === "function",
  },
  {
    test_id: "js-feat-016",
    name: "WebAPI: fetch",
    category: "javascript-feature",
    run: () => typeof fetch === "function",
  },
  {
    test_id: "js-feat-017",
    name: "WebAPI: TextEncoder / TextDecoder",
    category: "javascript-feature",
    run: () =>
      typeof TextEncoder === "function" && typeof TextDecoder === "function",
  },
  {
    test_id: "js-feat-018",
    name: "WebAPI: structuredClone",
    category: "javascript-feature",
    run: () => typeof structuredClone === "function",
  },
  {
    test_id: "js-feat-019",
    name: "WebAPI: AbortController",
    category: "javascript-feature",
    run: () => typeof AbortController === "function",
  },
  {
    test_id: "js-feat-020",
    name: "WebAPI: crypto.getRandomValues",
    category: "javascript-feature",
    run: () => {
      if (typeof crypto === "undefined") return false;
      return typeof crypto.getRandomValues === "function";
    },
  },
];

function runTests() {
  const env = {};
  if (typeof process !== "undefined" && process.version) {
    env.os = process.platform;
    env.node_version = process.version;
  }
  if (typeof window !== "undefined" && typeof navigator !== "undefined") {
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

  const output = {
    schema_version: "1.0.0",
    run_id: `${new Date().toISOString().replace(/[:.]/g, "-")}-feat`,
    timestamp: new Date().toISOString(),
    target_id: typeof window === "undefined" ? "local-baseline" : "browser",
    environment: env,
    results,
    summary,
  };

  return output;
}

if (typeof module !== "undefined" && module.exports) {
  const output = runTests();
  console.log(JSON.stringify(output, null, 2));
} else if (typeof window !== "undefined") {
  window.__testResults = runTests();
}
})();
