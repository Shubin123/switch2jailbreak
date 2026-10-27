const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('summary distinguishes inventory/navigation reports from runtime passes and propagates asset failures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase4-summary-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'results'));
    fs.copyFileSync(path.join(__dirname, '../scripts/summarize-results'), path.join(root, 'scripts/summarize-results'));
    const write = (name, value) => fs.writeFileSync(path.join(root, 'results', name), JSON.stringify(value));
    write('entry.json', { report_type: 'browser-entry-evidence' });
    write('inventory.json', { report_type: 'native-source-coverage-inventory' });
    write('assets.json', { report_type: 'native-asset-structural-review', counts: { failed: 0 } });
    write('host.json', { summary: { total: 1, passed: 1, failed: 0, skipped: 0, errors: 0 }, results: [] });
    const run = () => spawnSync('bash', [path.join(root, 'scripts/summarize-results')], { encoding: 'utf8' });
    const successful = run();
    assert.equal(successful.status, 0, successful.stderr);
    assert.match(successful.stdout, /Grand Total: 1 tests/);
    assert.match(successful.stdout, /not counted as runtime tests/);
    write('assets.json', { report_type: 'native-asset-structural-review', counts: { failed: 1 } });
    assert.equal(run().status, 1);
    write('assets.json', { report_type: 'native-asset-structural-review', counts: { failed: 0 } });
    write('host.json', { report_type: 'browser-entry-evidence', summary: { total: 1, passed: 0, failed: 1, skipped: 0, errors: 0 }, results: [] });
    assert.equal(run().status, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
