const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { execFileSync, spawnSync } = require('node:child_process');
const os = require('node:os');

test('suite runner exits nonzero for reported failures', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'compatibility-runner-'));
  try {
    fs.mkdirSync(path.join(directory, 'tests'));
    fs.mkdirSync(path.join(directory, 'bin'));
    fs.copyFileSync(path.join(__dirname, 'run-all.sh'), path.join(directory, 'tests/run-all.sh'));
    fs.writeFileSync(path.join(directory, 'bin/node'), '#!/bin/sh\nprintf \'%s\\n\' \'{"summary":{"total":1,"passed":0,"failed":1,"skipped":0,"errors":0},"results":[{"test_id":"fixture","name":"reported failure","status":"fail"}]}\'\n', { mode: 0o755 });
    const result = spawnSync('bash', [path.join(directory, 'tests/run-all.sh')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${path.join(directory, 'bin')}${path.delimiter}${process.env.PATH}` },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Failed:  3/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Node baseline skips only browser-specific isolation observations', () => {
  const output = JSON.parse(execFileSync(process.execPath, [
    path.join(__dirname, 'isolation/sandbox-detect.js'),
  ], { encoding: 'utf8' }));
  const expectedSkipped = [
    'iso-003', 'iso-004', 'iso-005', 'iso-006', 'iso-007', 'iso-008',
    'iso-010', 'iso-011', 'iso-012', 'iso-013', 'iso-014', 'iso-015',
    'iso-016', 'iso-017',
  ];
  assert.deepEqual(output.results.filter(result => result.status === 'skip')
    .map(result => result.test_id), expectedSkipped);
  assert.equal(output.summary.skipped, 14);
  assert.equal(output.summary.total, 20);
  for (const result of output.results.filter(result => result.status === 'skip')) {
    assert.equal(result.actual, 'not run');
    assert.ok(result.notes.includes('not applicable'));
  }
});

test('missing browser APIs remain failed observations in a browser context', () => {
  const context = vm.createContext({ navigator: { userAgent: 'test', platform: 'test' } });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'isolation/sandbox-detect.js'), 'utf8'), context);
  assert.equal(context.__isolationResults.summary.skipped, 0);
  assert.equal(context.__isolationResults.results.find(result => result.test_id === 'iso-003').status, 'fail');
  assert.equal(context.__isolationResults.results.find(result => result.test_id === 'iso-013').status, 'fail');
});

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
