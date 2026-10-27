/*
 * Runtime error handling tests.
 * Detects how the JS engine handles common error conditions.
 * Useful for fingerprinting engine behavior and identifying crash vectors.
 *
 * Usage (Node.js): node error-handling.js
 * Usage (browser): load via <script>, read window.__errorResults
 */

(function() {
const tests = [
  {
    test_id: "rt-err-001",
    name: "Stack overflow recovery",
    category: "runtime-error",
    run: () => {
      try {
        (function recurse() { recurse(); })();
        return false;
      } catch (e) {
        return e instanceof RangeError || (e instanceof Error && e.name === "InternalError");
      }
    },
  },
  {
    test_id: "rt-err-002",
    name: "Heap allocation limit (large array)",
    category: "runtime-error",
    run: () => {
      try {
        const arr = new Array(2 ** 28);
        arr[0] = 1;
        return true;
      } catch (e) {
        return e instanceof RangeError;
      }
    },
  },
  {
    test_id: "rt-err-003",
    name: "Regex catastrophic backtracking timeout",
    category: "runtime-error",
    run: () => {
      try {
        const start = Date.now();
        "a".repeat(20).match(/^(a+)+$/);
        return Date.now() - start < 5000;
      } catch {
        return true;
      }
    },
  },
  {
    test_id: "rt-err-004",
    name: "TypeError on null property access",
    category: "runtime-error",
    run: () => {
      try {
        const x = null;
        x.property;
        return false;
      } catch (e) {
        return e instanceof TypeError;
      }
    },
  },
  {
    test_id: "rt-err-005",
    name: "SyntaxError from eval",
    category: "runtime-error",
    run: () => {
      try {
        eval("function(");
        return false;
      } catch (e) {
        return e instanceof SyntaxError;
      }
    },
  },
  {
    test_id: "rt-err-006",
    name: "URIError from malformed URI",
    category: "runtime-error",
    run: () => {
      try {
        decodeURIComponent("%");
        return false;
      } catch (e) {
        return e instanceof URIError;
      }
    },
  },
  {
    test_id: "rt-err-007",
    name: "Unhandled promise rejection produces error",
    category: "runtime-error",
    run: () => {
      try {
        const p = Promise.reject(new Error("test"));
        p.catch(() => {});
        return true;
      } catch {
        return false;
      }
    },
  },
  {
    test_id: "rt-err-008",
    name: "ArrayBuffer allocation (64 MiB)",
    category: "runtime-error",
    run: () => {
      try {
        const buf = new ArrayBuffer(64 * 1024 * 1024);
        return buf.byteLength === 64 * 1024 * 1024;
      } catch {
        return false;
      }
    },
  },
  {
    test_id: "rt-err-009",
    name: "SharedArrayBuffer availability",
    category: "runtime-error",
    run: () => {
      try {
        return typeof SharedArrayBuffer === "function";
      } catch {
        return false;
      }
    },
  },
  {
    test_id: "rt-err-010",
    name: "eval() is available",
    category: "runtime-error",
    run: () => {
      try {
        return eval("1 + 1") === 2;
      } catch {
        return false;
      }
    },
  },
  {
    test_id: "rt-err-011",
    name: "Function constructor is available",
    category: "runtime-error",
    run: () => {
      try {
        const fn = new Function("return 42");
        return fn() === 42;
      } catch {
        return false;
      }
    },
  },
  {
    test_id: "rt-err-012",
    name: "Error stack trace available",
    category: "runtime-error",
    run: () => {
      try {
        throw new Error("trace test");
      } catch (e) {
        return typeof e.stack === "string" && e.stack.length > 0;
      }
    },
  },
  {
    test_id: "rt-err-013",
    name: "Proxy and Reflect available",
    category: "runtime-error",
    run: () => {
      try {
        const handler = { get: (t, p) => p === "test" ? 42 : t[p] };
        const proxy = new Proxy({}, handler);
        return proxy.test === 42 && typeof Reflect === "object";
      } catch {
        return false;
      }
    },
  },
  {
    test_id: "rt-err-014",
    name: "Symbol.species customization",
    category: "runtime-error",
    run: () => {
      try {
        class MyArray extends Array {
          static get [Symbol.species]() { return Array; }
        }
        const a = new MyArray(1, 2, 3);
        const mapped = a.map((x) => x * 2);
        return mapped instanceof Array && !(mapped instanceof MyArray);
      } catch {
        return false;
      }
    },
  },
  {
    test_id: "rt-err-015",
    name: "JSON.parse error recovery",
    category: "runtime-error",
    run: () => {
      try {
        JSON.parse("{invalid}");
        return false;
      } catch (e) {
        return e instanceof SyntaxError;
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

  return {
    schema_version: "1.0.0",
    run_id: `${new Date().toISOString().replace(/[:.]/g, "-")}-rterr`,
    timestamp: new Date().toISOString(),
    target_id: typeof window === "undefined" ? "local-baseline" : "browser",
    environment: env,
    results,
    summary,
  };
}

if (typeof module !== "undefined" && module.exports) {
  const output = runTests();
  console.log(JSON.stringify(output, null, 2));
} else if (typeof window !== "undefined") {
  window.__errorResults = runTests();
}
})();
