const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const revision = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

async function collectState(config, request = fetch) {
  const target = config.targets.find(target => target.id === 'ns2jb-smilebasic');
  assert.ok(target, 'Missing upstream target');
  const upstream = new URL(target.upstream.url);
  assert.equal(upstream.origin, 'https://gitlab.com');
  const project = encodeURIComponent(upstream.pathname.slice(1));
  const api = `https://gitlab.com/api/v4/projects/${project}`;
  async function get(url) {
    const response = await request(url, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json', 'User-Agent': 'switch2jailbreak-verifier' },
    });
    assert.ok(response.ok, `Source check failed: ${url} (HTTP ${response.status})`);
    return response;
  }
  async function pages(endpoint) {
    const entries = [];
    let page = 1;
    for (let count = 0; count < 100; count += 1) {
      const response = await get(`${api}/repository/${endpoint}?per_page=100&page=${page}`);
      const data = await response.json();
      assert.ok(Array.isArray(data), `Invalid ${endpoint} response`);
      for (const entry of data) {
        assert.ok(typeof entry.name === 'string' && revision(entry.commit?.id), `Invalid ${endpoint} entry`);
        entries.push({ name: entry.name, commit: entry.commit.id });
      }
      const next = response.headers.get('x-next-page');
      if (!next) return entries.sort((first, second) => first.name.localeCompare(second.name));
      assert.ok(/^\d+$/.test(next) && Number(next) > page, 'Invalid pagination sequence');
      page = Number(next);
    }
    throw new Error('Pagination exceeded 100 pages; inspection incomplete');
  }
  const commit = await (await get(`${api}/repository/commits/${encodeURIComponent(target.upstream.branch)}`)).json();
  assert.ok(revision(commit.id), 'Invalid upstream commit response');
  const branches = await pages('branches');
  const tags = await pages('tags');
  const readme = await (await get(`${target.upstream.url}/-/raw/${commit.id}/README.md`)).text();
  assert.ok(readme.trim(), 'Empty upstream README');
  const gist = await (await get(`https://api.github.com/gists/${config.gist.id}`)).json();
  assert.ok(typeof gist.updated_at === 'string' && !Number.isNaN(Date.parse(gist.updated_at)), 'Invalid Gist metadata');
  const blog = await (await get(config.references.blog)).text();
  assert.ok(blog.trim(), 'Empty author blog response');
  return {
    gitlab_commit: commit.id,
    gitlab_branches: branches,
    gitlab_tags: tags,
    readme_sha256: digest(readme),
    gist_updated_at: gist.updated_at,
    blog_sha256: digest(blog),
  };
}

async function updateState(config, stateFile, request = fetch) {
  const previous = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
  const state = await collectState(config, request);
  const changes = previous ? Object.keys(state).filter(key =>
    JSON.stringify(state[key]) !== JSON.stringify(previous[key])) : [];
  state.last_checked = new Date().toISOString();
  const temporary = `${stateFile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, stateFile);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return { state, changes, initial: !previous };
}

module.exports = { collectState, updateState };

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config/targets.json'), 'utf8'));
  updateState(config, path.join(root, '.upstream-state.json')).then(({ state, changes, initial }) => {
    console.log(JSON.stringify({ ...state, changes, initial }, null, 2));
    console.log(initial ? 'Initial evidence recorded.' : changes.length ? 'Changes detected; review required.' : 'All checked sources unchanged.');
    console.log('Source availability and names are not proof of a WebKit release.');
  }).catch(error => {
    console.error(`Upstream inspection incomplete; previous state retained: ${error.message}`);
    process.exitCode = 1;
  });
}
