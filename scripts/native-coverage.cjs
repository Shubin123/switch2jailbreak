const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sourceFiles } = require('./review-native.cjs');

const reviewedRevision = '95f5525089273c5fce0b95047f3600f8442e96ae';

function inventory(root, revision = reviewedRevision, reviewed = sourceFiles) {
  assert.match(revision, /^[0-9a-f]{40}$/);
  const git = args => execFileSync('git', ['-C', root, ...args], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), revision, 'Wrong upstream revision');
  const entries = git(['ls-tree', '-rz', '--full-tree', revision]).toString().split('\0').filter(Boolean);
  const files = entries.map(entry => {
    const separator = entry.indexOf('\t');
    const [mode, type, object] = entry.slice(0, separator).split(' ');
    const filename = entry.slice(separator + 1);
    assert.ok(type === 'blob' && ['100644', '100755'].includes(mode), `Unsupported source entry: ${filename}`);
    const bytes = git(['cat-file', 'blob', object]);
    return {
      path: filename,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      coverage: reviewed.includes(filename) ? 'recorded-static-review' : 'not-in-recorded-review',
    };
  });
  for (const filename of reviewed) assert.ok(files.some(file => file.path === filename), `Missing reviewed source: ${filename}`);
  const reviewedCount = files.filter(file => file.coverage === 'recorded-static-review').length;
  return {
    report_type: 'native-source-coverage-inventory',
    schema_version: '1.0.0',
    upstream_revision: revision,
    source_basis: 'Git blobs at the pinned revision; working-tree files are not read or executed',
    scope: 'File-level inventory, not branch, instruction, dependency or runtime coverage; recorded review is not rerun',
    counts: { total_files: files.length, recorded_review_files: reviewedCount, remaining_files: files.length - reviewedCount },
    browser_entry: {
      navigation: 'unverified',
      target_capability_capture: 'missing',
      native_execution: 'not-established',
      independent_recovery: 'missing',
      transferable_native_chain: false,
      phase_4_complete: false,
    },
    files,
  };
}

module.exports = { inventory };

if (require.main === module) {
  const [root, output] = process.argv.slice(2);
  if (!root || !output) {
    console.error('Usage: node scripts/native-coverage.cjs <pinned-upstream-checkout> <output.json>');
    process.exitCode = 1;
  } else {
    try {
      const report = inventory(root);
      fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
      console.log(JSON.stringify(report.counts));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
