const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

test('classic browser scripts coexist and export all 55 observations', () => {
  const context = vm.createContext({
    navigator: { userAgent: 'synthetic-loading-check', platform: 'test-host' },
  });
  context.window = context;
  const suites = [
    ['javascript-features/feature-detect.js', '__testResults', 20],
    ['runtime-errors/error-handling.js', '__errorResults', 15],
    ['isolation/sandbox-detect.js', '__isolationResults', 20],
  ];
  const identifiers = new Set();
  for (const [filename, exportName, expectedCount] of suites) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, filename), 'utf8'), context, {
      filename,
      timeout: 10000,
    });
    const output = context[exportName];
    assert.ok(output, `${filename} did not export results`);
    assert.equal(output.results.length, expectedCount);
    assert.equal(output.summary.total, expectedCount);
    assert.equal(output.environment.browser_ua, 'synthetic-loading-check');
    const counts = { pass: 0, fail: 0, skip: 0, error: 0 };
    for (const result of output.results) {
      assert.ok(Object.hasOwn(counts, result.status));
      assert.ok(!identifiers.has(result.test_id), 'duplicate test identifier');
      identifiers.add(result.test_id);
      counts[result.status] += 1;
    }
    assert.equal(output.summary.passed, counts.pass);
    assert.equal(output.summary.failed, counts.fail);
    assert.equal(output.summary.skipped, counts.skip);
    assert.equal(output.summary.errors, counts.error);
  }
  assert.equal(identifiers.size, 55);
});
