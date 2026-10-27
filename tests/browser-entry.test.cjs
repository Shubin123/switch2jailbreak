const assert = require('node:assert/strict');
const test = require('node:test');
const buildReport = require('../site/browser-entry.js');
const validateEntry = require('../scripts/validate-browser-entry.cjs');

const metadata = () => ({ kind: 'desktop-control', firmware: 'unknown', entry_context: 'Direct navigation', notes: '', include_properties: false });
const context = () => ({
  navigator: { userAgent: 'test', platform: 'test' },
  location: { protocol: 'https:', search: '?secret=not-exported', hash: '#private' },
  isSecureContext: true,
});

test('browser entry exports navigation evidence with optional presence checks only', () => {
  const report = buildReport(metadata(), context());
  assert.deepEqual(validateEntry(report), []);
  assert.equal(report.properties, null);
  assert.ok(!JSON.stringify(report).includes('not-exported'));
  assert.deepEqual(Object.values(report.limitations), [false, false, false, false]);
  const environment = context();
  for (const name of ['fetch', 'Worker', 'WebAssembly', 'Blob', 'SharedArrayBuffer']) {
    environment[name] = function () { throw new Error('Must not invoke any API'); };
  }
  const observed = buildReport({ ...metadata(), include_properties: true }, environment);
  assert.deepEqual(validateEntry(observed), []);
  assert.equal(observed.properties.worker, true);
  assert.equal(observed.properties.object_url, false);
});

test('browser entry refuses missing, oversized, or ambiguous metadata', () => {
  for (const change of [
    value => { value.kind = 'verified-console'; },
    value => { value.firmware = ' '; },
    value => { value.entry_context = ''; },
    value => { value.notes = 'x'.repeat(2001); },
    value => { delete value.include_properties; },
  ]) {
    const input = metadata();
    change(input);
    assert.throws(() => buildReport(input, context()));
  }
});

test('entry schema cannot promote self-reported navigation to phase completion', () => {
  for (const change of [
    value => { value.limitations.native_execution_established = true; },
    value => { value.limitations.phase_4_complete = true; },
    value => { delete value.limitations; },
    value => { value.timestamp = 'yesterday'; },
    value => { value.environment.private_token = 'secret'; },
    value => { value.properties = { worker: true }; },
    value => { value.entry_context = ' '; },
  ]) {
    const report = buildReport(metadata(), context());
    change(report);
    assert.ok(validateEntry(report).length);
  }
});
