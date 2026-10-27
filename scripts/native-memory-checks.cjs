const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const verifyRetainedCapture = require('./verify-retained-capture.cjs');

const memorySourceFiles = Object.freeze([
  'engine/switch2/memory/cache-address-plan.cjs',
  'engine/switch2/memory/signed-cache-plan.cjs',
  'engine/switch2/memory/session-tools.cjs',
  'engine/switch2/memory/verify-proof.cjs',
  'engine/switch2/retained/lower-window.cjs',
  'engine/switch2/retained/retained-memory.cjs',
]);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function loadMocked(root, filename, dependencies) {
  const absolute = path.join(root, filename);
  const context = {
    module: { exports: {} }, Buffer, __filename: absolute, __dirname: path.dirname(absolute),
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  };
  vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), context, { filename, timeout: 1000 });
  return context.module.exports;
}

function proofFixture(root) {
  const original = Buffer.alloc(0x4000, 0x31);
  const marker = Buffer.alloc(16, 0x22);
  const changed = Buffer.from(original);
  marker.copy(changed, 64);
  const files = new Map([
    ['original', original], ['repeated', Buffer.from(original)],
    ['ordinary', Buffer.alloc(0x4000, 0x72)], ['changed', changed],
    ['restored', Buffer.from(original)],
  ]);
  const report = { session: 'synthetic-boot', cacheAddress: {
    target: 2 ** 32, readResults: [0, 0], writeResult: 0,
    restoreWriteResult: 0, restoreReadResult: 0, encoding: 'synthetic-host-fixture',
    outputFile: 'original', outputSha256: digest(original),
    repeatOutputFile: 'repeated', repeatSha256: digest(original),
    controlFile: 'ordinary', writeOutputFile: 'changed', writeOutputSha256: digest(changed),
    restoreOutputFile: 'restored', restoreSha256: digest(original),
    writeMarker: marker.toString('hex'), writeAddress: 2 ** 32 + 64,
  } };
  const reads = [];
  const verifier = loadMocked(root, memorySourceFiles[3], {
    'node:crypto': crypto, 'node:assert/strict': assert,
    'node:fs/promises': {
      async readFile(filename, encoding) {
        reads.push(filename);
        const bytes = filename === 'proof' ? Buffer.from(JSON.stringify(report)) : files.get(filename);
        assert.ok(bytes, `Unexpected proof file: ${filename}`);
        return encoding ? bytes.toString(encoding) : bytes;
      },
    },
  });
  return { verifier, report, files, reads };
}

function retainedFixture(root) {
  const filename = memorySourceFiles[5];
  const source = fs.readFileSync(path.join(root, filename));
  const files = new Map();
  const calls = { reads: 0, metadataWrites: 0, saves: 0 };
  const address = 2 ** 32;
  const state = {
    phase: 'bootstrap', ready: false, operations: [], captures: [],
    bootstrapPlan: { target: address, addressBias: address, cycle: 0x28000, header: '00'.repeat(40) },
  };
  const context = {
    label: 'synthetic', storageSize: 0x100000, candidateHandle: 1,
    report: {
      retainedMemory: state, cases: [], memoryControl: { operations: [] },
      cacheAddress: { target: address, outputFile: '/virtual/bootstrap.bin' },
    },
    async save() { calls.saves += 1; },
    async readStorage() { calls.reads += 1; throw Error('Unexpected native read'); },
    async copyField() { calls.metadataWrites += 1; },
  };
  const retained = loadMocked(root, filename, {
    'node:path': path, 'node:crypto': crypto,
    'node:fs': { readFileSync(requested) { assert.equal(requested, path.join(root, filename)); return source; } },
    'node:fs/promises': {
      async writeFile(output, bytes, options) { assert.equal(options.mode, 0o600); files.set(output, Buffer.from(bytes)); },
      async readFile(output) { assert.ok(files.has(output)); return files.get(output); },
    },
    './lower-window.cjs': {
      lowerWindow(target) {
        return { target, addressBias: target, readOffset: 0, bytes: Buffer.alloc(40),
          cycle: 0x28000, base: '0x100000000', entryOffset: '0', encoding: 'synthetic-host-fixture' };
      },
    },
    '../memory/session.cjs': { u64(value) { const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(BigInt(value)); return bytes; } },
  });
  return { retained, context, state, calls, files };
}

async function reviewMemoryBoundaries(root, check) {
  const tools = require(path.join(root, memorySourceFiles[2]));
  await check('Page staging rejects overlapping pages and out-of-range packets', () => {
    const base = 0x10000;
    assert.equal(tools.packPages(base, 4096, [{ address: base, bytes: Buffer.from([1]) }])[0], 1);
    for (const writes of [
      [{ address: base - 4096, bytes: Buffer.from([1]) }],
      [{ address: base + 1, bytes: Buffer.from([1]) }],
      [{ address: base, bytes: Buffer.alloc(4097) }],
      [{ address: base, bytes: Buffer.alloc(0) }],
      [{ address: base, bytes: Buffer.from([1]) }, { address: base, bytes: Buffer.from([2]) }],
    ]) assert.throws(() => tools.packPages(base, 4096, writes));
    assert.throws(() => tools.packPages(base + 1, 4096, []));
  });
  await check('Session batching enforces range counts and owned-read fast-path bounds', async () => {
    const events = [];
    const session = {
      base: 0x10000, bytes: 4096, rpc: { async fail() { throw Error('fixture failure'); } },
      async read(address, bytes) { events.push('checked'); return Buffer.alloc(bytes); },
      async readOwned(address, bytes) { events.push('owned'); return Buffer.alloc(bytes); },
      async write() {}, async record(value) { events.push(value); },
    };
    tools.install(session, {}, {});
    await session.read(session.base, 1);
    await session.read(session.base + 4096, 1);
    assert.deepEqual(events, ['owned', 'checked']);
    for (const ranges of [[], Array(65).fill({ address: session.base, bytes: 1 }), null]) {
      await assert.rejects(session.readOwnedMany(ranges), /1\.\.64/);
    }
    await assert.rejects(session.measure('synthetic', () => session.rpc.fail()), /fixture failure/);
    assert.equal(session.metrics.requests, 1);
    assert.equal(events.at(-1).passed, false);
    assert.equal(tools.install(session, {}, {}), session);
  });
  await check('Bulk uploads stay within owned allocations and preserve scalar fallback', async () => {
    const events = [];
    const session = { base: 0x10000, bytes: 4096, bulkUploads: true, rpc: {},
      async read() {}, async readOwned() {}, async write() { events.push('scalar'); } };
    tools.install(session, {}, { async write() { events.push('bulk'); } });
    await session.write(session.base, Buffer.alloc(512));
    await session.write(session.base, Buffer.alloc(511));
    await session.write(session.base + 4096, Buffer.alloc(512));
    assert.deepEqual(events, ['bulk', 'scalar', 'scalar']);
  });
  await check('Saved-byte proof verifies a synthetic exact write and restoration without claiming restart reliability', async () => {
    const fixture = proofFixture(root);
    const result = await fixture.verifier.verifyProof('proof', 'synthetic-boot');
    assert.equal(result.readWriteRestoreVerified, true);
    assert.equal(result.restartReliabilityVerified, false);
  });
  await check('Saved-byte proof rejects stale sessions, truncated captures and failed native results', async () => {
    const stale = proofFixture(root);
    await assert.rejects(stale.verifier.verifyProof('proof', 'another-boot'), /another boot/);
    assert.deepEqual(stale.reads, ['proof']);
    const truncated = proofFixture(root);
    truncated.files.set('original', Buffer.alloc(16));
    await assert.rejects(truncated.verifier.verifyProof('proof'), /complete proof block/);
    const failed = proofFixture(root);
    failed.report.cacheAddress.restoreReadResult = 1;
    await assert.rejects(failed.verifier.verifyProof('proof'), /restoration read/);
  });
  await check('Saved-byte proof rejects changed neighbors and failed restoration despite recomputed hashes', async () => {
    for (const [filename, digestName, expected] of [
      ['changed', 'writeOutputSha256', /neighboring memory/],
      ['restored', 'restoreSha256', /Restored block/],
      ['repeated', 'repeatSha256', /different output poisons/],
    ]) {
      const fixture = proofFixture(root);
      fixture.files.get(filename)[100] ^= 1;
      fixture.report.cacheAddress[digestName] = digest(fixture.files.get(filename));
      await assert.rejects(fixture.verifier.verifyProof('proof'), expected);
    }
  });
  await check('Cache prefix planner rejects unterminated and invalid UTF-8 data', () => {
    const planner = require(path.join(root, memorySourceFiles[0]));
    assert.throws(() => planner.nulWrites(Buffer.from([65])), /trailing zero/);
    assert.throws(() => planner.nulWrites(Buffer.from([0xff, 0])), /encoding/);
  });
  await check('Signed planner rejects invalid targets, storage sizes and unsupported periods before planning', () => {
    const planner = require(path.join(root, memorySourceFiles[1]));
    for (const target of [-1, 0, 2 ** 39, NaN, Infinity]) assert.throws(() => planner.plan(target, 0x4000), /address width/);
    for (const size of [-1, 0, 1, NaN, Infinity]) assert.throws(() => planner.plan(2 ** 32, size), /storage size/);
    assert.throws(() => planner.plan(2 ** 32, 0x4000, 1), /bucket period/);
  });
  await check('Lower-window hypothesis rejects missing or unaligned observed pointers', () => {
    const planner = require(path.join(root, memorySourceFiles[4]));
    for (const pointers of [[], [1], [2 ** 32 + 1], [2 ** 39], [NaN]]) {
      assert.throws(() => planner.lowerWindow(2 ** 32, 0x100000, 0x28000, pointers));
    }
  });
  await check('Retained dispatcher blocks unresolved mutations before any artifact or native operation', async () => {
    const fixture = retainedFixture(root);
    fixture.state.pending = {};
    await assert.rejects(fixture.retained.dispatch(fixture.context, { command: 'info' }), /unresolved/);
    assert.equal(fixture.calls.reads, 0);
    assert.equal(fixture.calls.metadataWrites, 0);
    assert.equal(fixture.files.size, 0);
  });
  await check('Retained dispatcher rejects legacy movement after promotion and unready or stale state', async () => {
    const promoted = retainedFixture(root);
    promoted.state.promoted = true;
    await assert.rejects(promoted.retained.dispatch(promoted.context, { command: 'retained-bootstrap-move' }), /another path corruption/);
    assert.equal(promoted.calls.reads, 0);
    const stale = retainedFixture(root);
    Object.assign(stale.state, { ready: true, canonical: true, zeroCountVerified: true, corruptionCount: 1 });
    await assert.rejects(stale.retained.dispatch(stale.context, { command: 'retained-read' }), /corruption count changed/);
    assert.equal(stale.calls.reads, 0);
    const unready = retainedFixture(root);
    await assert.rejects(unready.retained.retire(unready.context), /requires recovery/);
    assert.equal(unready.calls.reads, 0);
  });
  let shortRepeat;
  await check('Known limitation: short repeated metadata capture is reproduced and rejected by the workspace verifier', async () => {
    const fixture = retainedFixture(root);
    const replies = [Buffer.alloc(32, 0x11), Buffer.alloc(32, 0x22), Buffer.alloc(16, 0x22)];
    fixture.context.readStorage = async () => { fixture.calls.reads += 1; return { result: 0, bytes: replies.shift() }; };
    const entry = await fixture.retained.dispatch(fixture.context, {
      command: 'retained-bootstrap-move', address: 2 ** 32 + 0x4000,
      length: 32, anchorOffset: 0, anchorHex: '22'.repeat(16),
    });
    assert.equal(entry.verified, true);
    assert.equal(entry.capture.length, 16);
    assert.throws(() => verifyRetainedCapture(entry, fixture.files.get(entry.capture.outputFile)), /shorter or longer/);
    shortRepeat = { id: 'NR-15', status: 'unresolved-upstream',
      title: 'Repeated metadata anchor matching does not require a full-length repeat capture',
      requested_bytes: 32, accepted_bytes: 16,
      evidence: 'Host-only mocked reproduction; workspace capture verifier rejects the incomplete bytes; upstream source is unchanged',
    };
  });
  return shortRepeat ? [shortRepeat] : [];
}

module.exports = { memorySourceFiles, reviewMemoryBoundaries };
