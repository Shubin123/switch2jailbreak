const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const validateResult = require('../scripts/validate-results.cjs');

function baseline() {
  return JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'javascript-features/feature-detect.js')], { encoding: 'utf8' }));
}

test('result validator accepts a full baseline and preserves Node identity', () => {
  const output = baseline();
  assert.deepEqual(validateResult(output, 20), []);
  assert.equal(output.environment.os, process.platform);
  assert.equal(output.environment.browser_ua, undefined);
});

test('result validator rejects invalid schemas, dates, incomplete runs and count mismatches', () => {
  for (const change of [
    output => { delete output.environment; },
    output => { delete output.summary; },
    output => { output.timestamp = 'not a date'; },
    output => { output.complete = false; },
    output => { output.summary.passed += 1; },
    output => { output.results[1].test_id = output.results[0].test_id; },
    output => { output.results[0].status = 'unknown'; },
  ]) {
    const output = baseline();
    change(output);
    assert.ok(validateResult(output, 20).length);
  }
});

test('result validator does not hide validly reported negative observations', () => {
  const output = baseline();
  output.results[0].status = 'fail';
  output.summary.passed -= 1;
  output.summary.failed += 1;
  assert.deepEqual(validateResult(output, 20), []);
});
