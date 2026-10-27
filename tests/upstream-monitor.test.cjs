const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { collectState, updateState } = require('../scripts/check-upstream.cjs');
const config = require('../config/targets.json');
const revision = config.targets[0].upstream.last_known_commit;

function source(url) {
  let data;
  if (url.includes('/commits/')) data = { id: revision };
  else if (url.includes('/branches?')) data = [{ name: 'main', commit: { id: revision } }];
  else if (url.includes('/tags?')) data = [];
  else if (url.includes('api.github.com')) data = { updated_at: '2026-10-27T00:00:00Z' };
  else return new Response('fixture document');
  return new Response(JSON.stringify(data));
}

test('monitor inspects the pinned README and all branch pages', async () => {
  const urls = [];
  const state = await collectState(config, async url => {
    urls.push(url);
    if (url.includes('/branches?')) {
      const secondPage = url.includes('page=2');
      return new Response(JSON.stringify([{ name: secondPage ? 'browser' : 'main', commit: { id: revision } }]), {
        headers: { 'x-next-page': secondPage ? '' : '2' },
      });
    }
    return source(url);
  });
  assert.equal(state.gitlab_branches.length, 2);
  assert.ok(urls.some(url => url.includes(`/-/raw/${revision}/README.md`)));
  assert.equal(state.gitlab_commit, revision);
});

test('monitor rejects unsuccessful HTTP and malformed metadata', async () => {
  await assert.rejects(collectState(config, async () => new Response('offline', { status: 503 })), /HTTP 503/);
  await assert.rejects(collectState(config, async () => new Response('{}')), /Invalid upstream commit/);
});

test('monitor rejects looping pagination', async () => {
  await assert.rejects(collectState(config, async url => url.includes('/branches?')
    ? new Response('[]', { headers: { 'x-next-page': '1' } }) : source(url)), /pagination/);
});

test('monitor preserves last good state on a failed inspection', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-monitor-'));
  const stateFile = path.join(directory, 'state.json');
  try {
    const first = await updateState(config, stateFile, async url => source(url));
    assert.equal(first.initial, true);
    const previous = fs.readFileSync(stateFile, 'utf8');
    await assert.rejects(updateState(config, stateFile, async () => { throw Error('offline'); }), /offline/);
    assert.equal(fs.readFileSync(stateFile, 'utf8'), previous);
    const next = await updateState(config, stateFile, async url => source(url));
    assert.deepEqual(next.changes, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
