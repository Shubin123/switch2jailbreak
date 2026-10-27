const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { inventory } = require('../scripts/native-coverage.cjs');

test('coverage inventories pinned blobs without executing source or trusting working-tree edits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-coverage-'));
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const commit = () => {
    git(['add', '.']);
    git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture']);
    return git(['rev-parse', 'HEAD']);
  };
  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    fs.writeFileSync(path.join(root, 'reviewed.cjs'), 'throw new Error("must not execute");\n');
    fs.writeFileSync(path.join(root, 'pending.json'), '{}\n');
    const revision = commit();
    const report = inventory(root, revision, ['reviewed.cjs']);
    assert.deepEqual(report.counts, { total_files: 2, recorded_review_files: 1, remaining_files: 1 });
    assert.equal(report.files.find(file => file.path === 'pending.json').coverage, 'not-in-recorded-review');
    assert.equal(report.browser_entry.transferable_native_chain, false);
    assert.equal(report.browser_entry.phase_4_complete, false);
    fs.writeFileSync(path.join(root, 'reviewed.cjs'), 'changed');
    assert.deepEqual(inventory(root, revision, ['reviewed.cjs']), report);
    assert.throws(() => inventory(root, 'f'.repeat(40), []), /Wrong upstream revision/);
    assert.throws(() => inventory(root, revision, ['absent']), /Missing reviewed source/);
    fs.symlinkSync('pending.json', path.join(root, 'link'));
    assert.throws(() => inventory(root, commit(), []), /Unsupported source entry/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
