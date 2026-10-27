const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const sourceFiles = Object.freeze([
  'engine/build-payload.cjs',
  'engine/lib/native.cjs',
  'engine/lib/connection.cjs',
  'engine/lib/bridge.cjs',
  'engine/switch2/ro/payload/main.c',
  'engine/switch2/ro/payload/process.c',
  'engine/switch2/ro/payload/start.S',
  'engine/switch2/ro/payload/layout.ld',
  'engine/switch2/ro/payload/manifest.json',
  'engine/switch2/process/test-function.S',
  'engine/switch2/process/client.cjs',
  'engine/switch2/process/fs-execute.cjs',
  'engine/switch2/ro/runtime.cjs',
  'engine/switch2/ro/probe.cjs',
  'engine/switch2/ro/layout.cjs',
  'engine/switch2/ro/gate.cjs',
  'engine/switch2/ro/launch.cjs',
  'engine/switch2/ro/export-handle.cjs',
  'engine/switch2/ro/bind-sessions.cjs',
  'engine/switch2/ro/copy-loader-root.cjs',
  'engine/shared/ipc.cjs',
  'engine/switch2/memory/session.cjs',
  'engine/switch2/memory/cache-mount.cjs',
  'engine/switch2/memory/cache-mount-sdk.json',
  'engine/switch2/retained/cache-shape.cjs',
  'engine/switch2/retained/links.cjs',
  'engine/switch2/ro/control.cjs',
  'engine/switch2/ro/worker-control.cjs',
  'engine/switch2/ro/files.cjs',
  'engine/switch2/ro/objects.cjs',
  'engine/switch2/ro/prepare-event.cjs',
  'engine/switch2/ro/prepare-workers.cjs',
  'engine/switch2/ro/process-test.cjs',
  'engine/switch2/ro/test-gate.cjs',
  'engine/switch2/ro/test-sm.cjs',
  'engine/switch2/ro/install-retained.cjs',
]);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const reviewedRevision = '95f5525089273c5fce0b95047f3600f8442e96ae';

function elfFixture() {
  const names = Buffer.from('\0.text\0.rodata\0.data\0.shstrtab\0');
  const bytes = Buffer.alloc(64 + 5 * 64 + 12 + names.length);
  bytes.set([127, 69, 76, 70, 2, 1, 1]);
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(183, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(64n, 40);
  bytes.writeUInt16LE(64, 52);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(5, 60);
  bytes.writeUInt16LE(4, 62);
  for (const [index, name] of ['.text', '.rodata', '.data', '.shstrtab'].entries()) {
    const row = 64 + (index + 1) * 64;
    bytes.writeUInt32LE(names.indexOf(name), row);
    bytes.writeUInt32LE(index === 3 ? 3 : 1, row + 4);
    bytes.writeBigUInt64LE(BigInt(index < 3 ? index * 4096 : 0), row + 16);
    bytes.writeBigUInt64LE(BigInt(384 + index * 4), row + 24);
    bytes.writeBigUInt64LE(BigInt(index === 3 ? names.length : 4), row + 32);
    if (index < 3) bytes.fill(index + 1, 384 + index * 4, 388 + index * 4);
  }
  names.copy(bytes, 396);
  return bytes;
}

function validateImage(image, manifest) {
  assert.ok(Buffer.isBuffer(image) && image.length >= 0x110, 'Truncated image');
  assert.equal(image.subarray(0, 4).toString(), 'NSO0', 'Wrong container magic');
  assert.equal(image.readUInt32LE(12), 0x78, 'Unsupported pinned-builder flags');
  assert.equal(image.subarray(0x100, 0x104).toString(), 'main', 'Wrong module name');
  assert.equal(image.length, manifest.payloadBytes, 'Manifest length mismatch');
  assert.equal(hash(image), manifest.payloadSha256, 'Manifest digest mismatch');
  const segments = [];
  let offset = 0x110;
  let memoryEnd = 0;
  for (const [index, name] of ['text', 'rodata', 'data'].entries()) {
    const fileOffset = image.readUInt32LE(0x10 + index * 16);
    const memoryOffset = image.readUInt32LE(0x14 + index * 16);
    const size = image.readUInt32LE(0x18 + index * 16);
    assert.equal(fileOffset, offset, 'Noncontiguous or overlapping segment');
    assert.ok(size > 0 && fileOffset + size <= image.length, 'Segment outside image');
    assert.equal(memoryOffset % 4096, 0, 'Unaligned memory segment');
    assert.ok(memoryOffset >= memoryEnd, 'Overlapping memory segments');
    assert.equal(image.readUInt32LE(0x60 + index * 4), size, 'Stored size mismatch');
    const digest = hash(image.subarray(fileOffset, fileOffset + size));
    assert.equal(image.subarray(0xa0 + index * 32, 0xc0 + index * 32).toString('hex'), digest, 'Segment digest mismatch');
    segments.push({ name, file_offset: fileOffset, memory_offset: memoryOffset, bytes: size, sha256: digest });
    offset += size;
    memoryEnd = memoryOffset + size;
  }
  assert.equal(offset, image.length, 'Trailing image bytes');
  const contents = Buffer.concat(segments.map(segment => image.subarray(segment.file_offset, segment.file_offset + segment.bytes)));
  assert.equal(image.subarray(0x40, 0x60).toString('hex'), hash(contents), 'Module content digest mismatch');
  return segments;
}

function inspectSource(root, expectedRevision) {
  assert.match(expectedRevision, /^[0-9a-f]{40}$/);
  assert.equal(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), expectedRevision, 'Wrong upstream revision');
  assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'Dirty upstream checkout');
  const files = {};
  for (const filename of sourceFiles) {
    const absolute = path.join(root, filename);
    assert.ok(fs.lstatSync(absolute).isFile(), `Not a regular source file: ${filename}`);
    const bytes = fs.readFileSync(absolute);
    const committed = execFileSync('git', ['-C', root, 'cat-file', 'blob', `${expectedRevision}:${filename}`], { maxBuffer: 1024 * 1024 });
    assert.equal(hash(bytes), hash(committed), `Source differs from pinned blob: ${filename}`);
    files[filename] = { sha256: hash(bytes), lines: bytes.toString('utf8').split('\n').length - (bytes.at(-1) === 10 ? 1 : 0) };
  }
  return files;
}

async function reviewNative(root, expectedRevision, zig = 'zig') {
  assert.equal(expectedRevision, reviewedRevision, 'No recorded static review for this revision');
  root = path.resolve(root);
  const inspected = inspectSource(root, expectedRevision);
  const builder = require(path.join(root, 'engine/build-payload.cjs'));
  const { NativeClient, callRecord, OUTPUT_BYTES } = require(path.join(root, 'engine/lib/native.cjs'));
  const results = [];
  let segments;
  async function check(name, run) {
    const started = Date.now();
    let error;
    try { await run(); } catch (failure) { error = failure; }
    results.push({
      test_id: `native-${String(results.length + 1).padStart(3, '0')}`,
      category: 'build', name, status: error ? 'fail' : 'pass',
      expected: 'assertions hold', actual: error ? error.message : 'assertions passed',
      ...(error ? { error_message: String(error) } : {}), duration_ms: Date.now() - started,
    });
  }
  const mutated = change => { const bytes = elfFixture(); change(bytes); return bytes; };
  const client = () => new NativeClient({
    async write() { throw Error('Unexpected transport use'); },
    async read() { throw Error('Unexpected transport use'); },
  }, { scratch: 0x100000, sdk: 0x400000 });

  await check('ELF fixture packages with valid independent segment hashes', () => {
    const image = builder.packageNso(elfFixture());
    validateImage(image, { payloadBytes: image.length, payloadSha256: hash(image) });
  });
  await check('ELF parser rejects truncated headers', () => {
    for (const size of [0, 32, 63]) assert.throws(() => builder.sections(elfFixture().subarray(0, size)));
  });
  await check('ELF parser rejects wrong architecture, class and entrypoint', () => {
    for (const change of [bytes => bytes.writeUInt16LE(62, 18), bytes => { bytes[4] = 1; }, bytes => bytes.writeBigUInt64LE(1n, 24)]) {
      assert.throws(() => builder.sections(mutated(change)));
    }
  });
  await check('ELF parser rejects invalid tables and imprecise offsets', () => {
    for (const change of [bytes => bytes.writeUInt16LE(63, 58), bytes => bytes.writeUInt16LE(0, 60),
      bytes => bytes.writeBigUInt64LE(2n ** 53n, 40), bytes => bytes.writeBigUInt64LE(10000n, 40)]) {
      assert.throws(() => builder.sections(mutated(change)));
    }
  });
  await check('ELF parser rejects missing names and unresolved relocations', () => {
    for (const change of [bytes => bytes.writeUInt16LE(9, 62), bytes => bytes.writeUInt32LE(10000, 128),
      bytes => bytes.writeUInt32LE(4, 132)]) assert.throws(() => builder.sections(mutated(change)));
  });
  await check('Packer rejects duplicated, empty, overlapping and unaligned segments', () => {
    for (const change of [bytes => bytes.writeUInt32LE(1, 192), bytes => bytes.writeBigUInt64LE(0n, 288),
      bytes => bytes.writeBigUInt64LE(0n, 208), bytes => bytes.writeBigUInt64LE(4097n, 208)]) {
      assert.throws(() => builder.packageNso(mutated(change)));
    }
  });
  await check('Shipped container lengths, layout and all segment hashes agree', () => {
    const directory = path.join(root, 'engine/switch2/ro/payload');
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    assert.equal(manifest.platform, 2);
    assert.equal(manifest.programId, '0400000000000037');
    segments = validateImage(fs.readFileSync(path.join(directory, 'main')), manifest);
  });
  await check('Native record preserves exact unsigned 64-bit values', () => {
    const args = [0n, (1n << 64n) - 1n, '9007199254740993', 7];
    const bytes = callRecord(0x400000, 4, args);
    assert.equal(bytes.length, 40);
    assert.equal(bytes.readBigUInt64LE(), 0x400004n);
    args.forEach((value, index) => assert.equal(bytes.readBigUInt64LE(8 + index * 8), BigInt(value)));
  });
  await check('Native record rejects malformed values and function offsets', () => {
    for (const value of [-1, Number.MAX_SAFE_INTEGER + 1, '-1', '01', '1.0', '1e3', 1n << 64n]) {
      assert.throws(() => callRecord(0x400000, 0, [value, 0, 0, 0]));
    }
    for (const offset of [-4, 1, 0x5e1000]) assert.throws(() => callRecord(0x400000, offset, [0, 0, 0, 0]));
    assert.throws(() => callRecord(0x400000, 0, [0]));
  });
  await check('Unverified functions and oversized requests cannot reach transport', async () => {
    const native = client();
    await assert.rejects(async () => native.callAddress(0x400000), /not been verified/);
    await assert.rejects(native.exchange([]), /Invalid native request/);
    await assert.rejects(native.exchange([{}, {}, {}]), /Invalid native request/);
    await assert.rejects(native.exchange([{}], Buffer.alloc(0x8001)), /Invalid native request/);
  });
  await check('Memory guard rejects invalid spans and inaccessible regions', async () => {
    const native = client();
    for (const [address, length] of [[0, 1], [0x1000, 0], [0x1000, -1], [2 ** 39 - 1, 2], [NaN, 1]]) {
      await assert.rejects(native.guard(address, length, 1), /Invalid application memory span/);
    }
    const valid = { address: 0x1000n, size: 0x1000n, permissions: 3, ipcReferences: 0, type: 5 };
    for (const change of [{ permissions: 0 }, { ipcReferences: 1 }, { type: 0 }, { type: 1 }, { type: 16 }, { size: 0n }, { address: 0x2000n }]) {
      native.query = async () => ({ ...valid, ...change });
      await assert.rejects(native.guard(0x1000, 4, 1), /inaccessible or reserved/);
    }
    native.query = async () => valid;
    await native.guard(0x1000, 4, 3);
  });
  await check('Function signatures require matching executable mapping and bytes', async () => {
    const native = client();
    const signature = Buffer.alloc(4, 1);
    const region = { address: 0x1000n, size: 0x1000n, permissions: 5, attributes: 0 };
    native.query = async () => region;
    native.read = async () => Buffer.alloc(4, 2);
    await assert.rejects(native.verifyFunction(0x1000, signature), /mapping or instructions differ/);
    native.read = async () => signature;
    for (const change of [{ permissions: 4 }, { attributes: 1 }, { size: 1n }]) {
      native.query = async () => ({ ...region, ...change });
      await assert.rejects(native.verifyFunction(0x1000, signature), /mapping or instructions differ/);
    }
    native.query = async () => region;
    await native.verifyFunction(0x1000, signature);
    assert.equal(native.functions.has(0x1000), true);
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(5), Buffer.alloc(260)]) {
      await assert.rejects(native.verifyFunction(0x1000, bytes), /Invalid native function signature/);
    }
  });
  await check('Memory transfers are chunked and failed return values are rejected', async () => {
    const native = client();
    native.guard = async () => {};
    const reads = [];
    native.call = async (offset, destination, address, length) => {
      reads.push({ offset, address, length });
      return { result: BigInt(native.output), output: Buffer.alloc(OUTPUT_BYTES, 1) };
    };
    assert.equal((await native.read(0x2000, OUTPUT_BYTES + 17)).length, OUTPUT_BYTES + 17);
    assert.deepEqual(reads.map(read => read.length), [OUTPUT_BYTES, 17]);
    native.call = async () => ({ result: 0n, output: Buffer.alloc(OUTPUT_BYTES) });
    await assert.rejects(native.read(0x2000, 1), /Native memory read failed/);
    const writes = [];
    native.exchange = async (operations, bytes) => {
      writes.push(bytes.length);
      return { result: BigInt(operations[0].args[0]) };
    };
    await native.write(0x2000, Buffer.alloc(OUTPUT_BYTES + 17));
    assert.deepEqual(writes, [OUTPUT_BYTES, 17]);
    native.exchange = async () => ({ result: 0n });
    await assert.rejects(native.write(0x2000, Buffer.alloc(1)), /Native memory write failed/);
  });
  await check('Stop closes transport even when its final write fails', async () => {
    let closed = false;
    const native = client();
    native.connection.write = async () => { throw Error('injected write failure'); };
    native.connection.close = () => { closed = true; };
    await assert.rejects(native.stop(), /injected write failure/);
    assert.equal(closed, true);
  });
  await check('Execution proof rejects wrong identity, challenge, tick and lookup responses', async () => {
    for (const fault of [null, 'pid', 'nonce', 'tick', 'lookup']) {
      const commands = [], records = [];
      let prepared, tick = 0n;
      const memory = {
        info: { session: 'host-fixture' }, reportFile: 'fixture-report',
        async request(request) {
          commands.push(request.command);
          if (request.command === 'root-native-info') return { services: [{ name: 'pm:shell', sm: 7 }] };
          if (request.command === 'root-native-worker-prepare') { prepared = request; return {}; }
          if (request.command === 'root-native-worker-release') return {};
          if (request.command === 'root-native-worker-state') return { finished: true };
          if (request.command === 'root-native-close-handle') return { result: 0 };
          assert.equal(request.command, 'root-native-worker-join');
          if (prepared.kind === 'sm-get') return { responses: [{ transport: 0, result: fault === 'lookup' ? 1 : 0, handle: 9 }] };
          assert.equal(prepared.kind, 'ro-probe');
          const data = Buffer.alloc(48);
          data.writeBigUInt64LE(0x4558454f5232534en);
          data.writeBigUInt64LE(Buffer.from(prepared.hex, 'hex').readBigUInt64LE() ^
            (fault === 'nonce' ? 0n : 0x9d7c3a51e6b2048fn), 8);
          data.writeBigUInt64LE(42n, 16);
          tick += fault === 'tick' ? 0n : 1n;
          data.writeBigUInt64LE(tick, 32);
          return { responses: [{ transport: 0, result: 0, kernelPid: fault === 'pid' ? '43' : '42', data: data.toString('hex') }] };
        },
      };
      const exported = { exports: {} };
      const imports = {
        'node:fs/promises': { async writeFile(filename, contents) { records.push(JSON.parse(contents)); } },
        'node:path': path, 'node:crypto': crypto,
        '../tools/fs-memory.cjs': { async connect() { return memory; } },
      };
      const context = vm.createContext({
        module: exported, __dirname: '/host-fixture', Buffer, setTimeout,
        require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected probe import: ${name}`); return imports[name]; },
      });
      new vm.Script(fs.readFileSync(path.join(root, 'engine/switch2/ro/probe.cjs'), 'utf8')).runInContext(context);
      const proof = exported.exports.main;
      if (fault) {
        await assert.rejects(proof('42'), /service lookup failed|expected kernel PID|payload response differs|tick did not advance/);
        assert.equal(records.at(-1).verified, false);
        assert.equal(typeof records.at(-1).error, 'string');
        assert.equal(commands.includes('root-native-close-handle'), false);
      } else {
        const result = await proof('42');
        assert.equal(result.verified, true);
        assert.equal(result.challenges, 2);
        assert.equal(records.at(-1).challenges.every(row => row.verified), true);
        assert.equal(commands.at(-1), 'root-native-close-handle');
      }
    }
  });
  await check('Layout checks enforce live identity, boot binding and the observed capture window', async () => {
    const exported = { exports: {} };
    const imports = {
      'node:fs/promises': { async writeFile() { throw Error('Unexpected layout persistence'); } },
      'node:path': path, 'node:crypto': crypto,
      '../tools/fs-memory.cjs': { async connect() { throw Error('Unexpected console connection'); } },
    };
    const context = vm.createContext({
      module: exported, __dirname: '/host-fixture', Buffer,
      require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected layout import: ${name}`); return imports[name]; },
    });
    new vm.Script(fs.readFileSync(path.join(root, 'engine/switch2/ro/layout.cjs'), 'utf8')).runInContext(context);
    const memory = {
      reportFile: 'current-report', info: { session: 'current-session' },
      async read() { throw Error('Unexpected memory read'); },
    };
    for (const layout of [
      { report: 'old-report', session: 'current-session' },
      { report: 'current-report', session: 'old-session' },
    ]) await assert.rejects(exported.exports.validate(memory, layout), /another boot/);
    assert.throws(() => exported.exports.capturedLayout(Buffer.alloc(0x100), { address: 0x2000000 }), /not unique/);
    const layout = { report: memory.reportFile, session: memory.info.session, manager: 0x1000,
      count: 0x4000, table: 0x6000, rootVptr: 0x5000,
      target: { entry: 0x2000, domain: 0x3000, object: 0x4000 } };
    const blocks = new Map([[0x1000, Buffer.alloc(0x20)], [0x2000, Buffer.alloc(0x30)],
      [0x3000, Buffer.alloc(0x20)], [0x4000, Buffer.alloc(0x40)]]);
    for (const [address, offset, value] of [[0x1000, 0x18, layout.table],
      [0x2000, 0x18, layout.target.domain], [0x2000, 0x20, layout.target.object],
      [0x2000, 0x28, layout.rootVptr + 0x5880], [0x3000, 0, layout.rootVptr + 0x28e0],
      [0x3000, 8, layout.rootVptr + 0x2938], [0x3000, 0x18, layout.manager],
      [0x4000, 0, layout.rootVptr + 0x1ea0], [0x4000, 0x30, 1]])
      blocks.get(address).writeBigUInt64LE(BigInt(value), offset);
    blocks.get(0x1000).writeUInt32LE(layout.count, 0x10);
    blocks.get(0x4000).writeUInt32LE(2, 0x38);
    memory.read = async (address, length) => {
      assert.ok(blocks.has(address));
      assert.equal(blocks.get(address).length, length);
      return Buffer.from(blocks.get(address));
    };
    await exported.exports.validate(memory, layout);
    for (const [address, offset, message] of [[0x1000, 0x10, /manager changed/],
      [0x2000, 0x20, /entry differs/], [0x3000, 0x18, /domain changed/], [0x4000, 0x30, /object identity differs/]]) {
      const block = blocks.get(address);
      block[offset] ^= 1;
      await assert.rejects(exported.exports.validate(memory, layout), message);
      block[offset] ^= 1;
    }
    const capture = Buffer.alloc(0xd0000), range = { address: 0x2000000 };
    const rootVptr = range.address + 0x500000 - 0xf38be0;
    for (const [offset, value] of [[0x100, rootVptr + 0x28e0], [0x108, rootVptr + 0x2938],
      [0x118, range.address + 0x200], [0x218, range.address + 0x1000],
      [0x1018, range.address + 0x100], [0x1020, range.address + 0x800], [0x1028, rootVptr + 0x5880]])
      capture.writeBigUInt64LE(BigInt(value), offset);
    capture.writeUInt32LE(0x4000, 0x210);
    assert.equal(exported.exports.capturedLayout(capture, range).target.entry, range.address + 0x1000);
    capture.copy(capture, 0x1000 + 512 * 0x30, 0x1000, 0x1030);
    capture.fill(0, 0x1000, 0x1030);
    assert.throws(() => exported.exports.capturedLayout(capture, range), /Loader root is not unique/);
  });
  const { Gate, restoreGates } = require(path.join(root, 'engine/switch2/ro/gate.cjs'));
  const gateFixture = () => {
    const bytes = Buffer.alloc(0x88), writes = [], requests = [];
    const row = { address: 0x1000, domain: 0x2000, metadata: 0x3000, receive: 7, request: 0x4000, wait: 7 };
    const waiters = Array.from({ length: 7 }, (_, index) => 0x5000 + index * 0x110);
    const event = { sourceHandle: 8, read: 9, write: 10 };
    for (const [offset, value] of [[0, 0x6000], [0x28, waiters[0]], [0x60, row.request],
      [0x68, 0x100], [0x70, row.domain], [0x78, row.metadata]]) bytes.writeBigUInt64LE(BigInt(value), offset);
    bytes.writeUInt32LE(event.sourceHandle, 0x30);
    bytes.writeUInt32LE(1, 0x40);
    bytes.writeUInt32LE(row.receive, 0x48);
    row.raw = bytes.toString('hex');
    const memory = {
      async read(address, length) { assert.equal(address, row.address); assert.equal(length, bytes.length); return Buffer.from(bytes); },
      async write(...args) { writes.push(args); },
      async u64() { return 1n; },
      async request(request) { requests.push(request); return { result: 1 }; },
    };
    const gate = new Gate(memory, row, [], waiters, 11, event);
    gate.parked = true;
    return { gate, bytes, writes, requests };
  };
  await check('Gate inspection rejects changed session identity fields before writes', async () => {
    for (const offset of [0, 0x30, 0x48, 0x60, 0x68, 0x70, 0x78]) {
      const fixture = gateFixture();
      fixture.bytes[offset] ^= 1;
      await assert.rejects(fixture.gate.inspect(), /session changed|wait word changed/);
      assert.equal(fixture.writes.length, 0);
      assert.equal(fixture.requests.length, 0);
    }
    const fixture = gateFixture();
    fixture.gate.waiters[1] += 1;
    assert.throws(() => new Gate(fixture.gate.memory, fixture.gate.row, [], fixture.gate.waiters, 11,
      fixture.gate.event), /contiguous native waiter/);
  });
  await check('Gate restoration rejects unsettled, pending and incompatible grouped sessions', async () => {
    const unsettled = gateFixture();
    unsettled.bytes.writeUInt32LE(2, 0x40);
    await assert.rejects(unsettled.gate.restore(), /unsettled session/);
    assert.equal(unsettled.writes.length, 0);
    const pending = gateFixture();
    pending.gate.outstanding = { original: '00000000' };
    pending.gate.selections = async () => [pending.gate.row.address];
    await assert.rejects(pending.gate.restore(), /selection remains pending/);
    assert.equal(pending.writes.length, 0);
    const first = gateFixture(), second = gateFixture();
    await assert.rejects(restoreGates([first.gate, second.gate]), /sharing one parking event/);
    assert.equal(first.writes.length + second.writes.length, 0);
  });
  await check('Failed restoration signal does not create retirement evidence', async () => {
    const fixture = gateFixture();
    await assert.rejects(fixture.gate.restore(), /event did not signal/);
    assert.equal(fixture.writes.length, 1);
    assert.equal(fixture.writes[0][0], fixture.gate.row.address + 0x30);
    assert.equal(fixture.writes[0][1].readUInt32LE(), fixture.gate.event.sourceHandle);
    assert.equal(fixture.writes[0][2].readUInt32LE(), fixture.gate.row.wait);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0].command, 'root-native-event-signal');
    assert.equal(fixture.gate.parked, false);
    assert.equal(fixture.gate.restoration, undefined);
  });
  const exportFixture = (fault = null) => {
    const writes = [], requests = [], records = [];
    let reads = 0;
    const notifier = { session: 'host-fixture', report: 'fixture-report', identityVerified: true,
      E: 0x1000, B: 0x2000, handle: 7, handleField: 0x3000 };
    if (fault === 'session') notifier.session = 'old-session';
    if (fault === 'report') notifier.report = 'old-report';
    if (fault === 'identity') notifier.identityVerified = false;
    const memory = {
      info: { session: 'host-fixture' }, reportFile: 'fixture-report',
      async pointer(address) { assert.equal(address, notifier.E + 8); return fault === 'backend' ? 0 : notifier.B; },
      async write(...args) {
        writes.push(args);
        if (fault === 'first-write' || (fault === 'restore' && writes.length === 2)) throw Error('injected write failure');
      },
      async request(request) {
        requests.push(request);
        assert.equal(request.command, 'root-native-notifier-event');
        if (fault === 'request') throw Error('injected request failure');
        return { handle: 17 };
      },
    };
    const imports = {
      'node:path': path,
      'node:fs/promises': {
        async readFile() { reads += 1; return JSON.stringify(notifier); },
        async writeFile(filename, contents, options) {
          assert.equal(options.mode, 0o600);
          records.push(JSON.parse(contents));
        },
      },
    };
    const exported = { exports: {} };
    const context = vm.createContext({ module: exported, __dirname: '/host-fixture', Buffer,
      require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected export import: ${name}`); return imports[name]; } });
    new vm.Script(fs.readFileSync(path.join(root, 'engine/switch2/ro/export-handle.cjs'), 'utf8')).runInContext(context);
    return { run: handle => exported.exports.exportHandle(memory, handle, 'host-only fixture'),
      writes, requests, records, reads: () => reads };
  };
  await check('Handle export rejects invalid handles before evidence reads or writes', async () => {
    for (const handle of [0, -1, 1.5, NaN, '7', 0x80000000, 0xffffffff]) {
      const fixture = exportFixture();
      await assert.rejects(fixture.run(handle), /existing FS handle/);
      assert.equal(fixture.reads(), 0);
      assert.equal(fixture.writes.length + fixture.requests.length, 0);
    }
    const pseudo = exportFixture();
    assert.equal((await pseudo.run(0xffff8001)).handle, 17);
    assert.equal(pseudo.writes[0][2].readUInt32LE(), 0xffff8001);
  });
  await check('Handle export rejects stale identity and changed notifier before writes', async () => {
    for (const fault of ['session', 'report', 'identity', 'backend']) {
      const fixture = exportFixture(fault);
      await assert.rejects(fixture.run(12), /another endpoint|backend changed/);
      assert.equal(fixture.writes.length + fixture.requests.length, 0);
      assert.equal(fixture.records.length, 0);
    }
  });
  await check('Handle export records conditional cleanup without claiming failed writes restored', async () => {
    for (const fault of [null, 'request', 'first-write', 'restore']) {
      const fixture = exportFixture(fault);
      if (fault) await assert.rejects(fixture.run(12), /injected (request|write) failure/);
      else assert.equal((await fixture.run(12)).handle, 17);
      assert.equal(fixture.writes.length, fault === 'first-write' ? 1 : 2);
      assert.equal(fixture.requests.length, fault === 'first-write' ? 0 : 1);
      assert.equal(fixture.writes[0][0], 0x3000);
      assert.equal(fixture.writes[0][1].readUInt32LE(), 7);
      assert.equal(fixture.writes[0][2].readUInt32LE(), 12);
      if (fixture.writes.length === 2) {
        assert.equal(fixture.writes[1][1].readUInt32LE(), 12);
        assert.equal(fixture.writes[1][2].readUInt32LE(), 7);
      }
      assert.equal(fixture.records.at(-1).restored, fault === null || fault === 'request');
    }
  });
  const ipc = require(path.join(root, 'engine/shared/ipc.cjs'));
  await check('Cache SDK declarations have bounded aligned instruction signatures', () => {
    const sdk = JSON.parse(fs.readFileSync(path.join(root, 'engine/switch2/memory/cache-mount-sdk.json')));
    assert.match(sdk.sha256, /^[0-9a-f]{64}$/);
    for (const entry of Object.values(sdk.functions)) {
      assert.ok(Number.isSafeInteger(entry.offset) && entry.offset >= 0 && entry.offset % 4 === 0);
      assert.match(entry.bytes, /^(?:[0-9a-f]{8})+$/);
      assert.equal(Buffer.from(entry.bytes, 'hex').length, entry.size);
      assert.equal(typeof entry.symbol, 'string');
    }
  });
  await check('CMIF rejects invalid descriptors and oversized packet inputs', () => {
    for (const change of [{address: -1}, {address: 2 ** 39}, {size: -1},
      {size: 2 ** 36}, {mode: 2}]) {
      assert.throws(() => ipc.descriptor({address: 0x1000, size: 16, ...change}), /Invalid map-alias/);
    }
    for (const field of ['copies', 'send', 'receive']) {
      assert.throws(() => ipc.packet(0, Buffer.alloc(0), {[field]: Array(16).fill(0)}), /Too many descriptors/);
    }
    assert.throws(() => ipc.packet(0, Buffer.alloc(241)), /capacity/);
    assert.equal(ipc.packet(0, Buffer.alloc(224)).length, 256);
  });
  await check('CMIF rejects truncated and missing-magic replies', () => {
    for (const length of [0, 4, 8, 16, 20, 256]) assert.throws(() => ipc.response(Buffer.alloc(length)));
    const reply = Buffer.alloc(256);
    reply.write('SFCO', 16);
    assert.equal(ipc.response(reply).result, 0);
    reply.writeUInt32LE(0x80000000, 4);
    reply.writeUInt32LE(31 << 1, 8);
    assert.throws(() => ipc.response(reply));
  });
  await check('Retained cache tail rejects possible live data', () => {
    const {unusedTail} = require(path.join(root, 'engine/switch2/retained/cache-shape.cjs'));
    assert.equal(unusedTail(Buffer.alloc(0x5a0)), true);
    for (const length of [0, 0x59f, 0x5a1]) assert.equal(unusedTail(Buffer.alloc(length)), false);
    const bytes = Buffer.alloc(0x5a0);
    bytes.write('AA/AA', 0x30);
    assert.equal(unusedTail(bytes), true);
    for (const offset of [0x30, 0x35, 0x59f]) {
      const changed = Buffer.from(bytes);
      changed[offset] = 0xff;
      assert.equal(unusedTail(changed), false);
    }
  });
  await check('Retained links exclude unaligned, remote and out-of-width candidates', () => {
    const {linksFrom} = require(path.join(root, 'engine/switch2/retained/links.cjs'));
    const address = 0x100004000, bytes = Buffer.alloc(64);
    for (const value of [0n, 0x100000000n, 1n << 39n, BigInt(address + 1), BigInt(address + 0x2000000)]) {
      bytes.writeBigUInt64LE(value);
      assert.equal(linksFrom(bytes, address, address).length, 0);
    }
    bytes.writeBigUInt64LE(BigInt(address));
    assert.equal(linksFrom(bytes, address, address)[0].zeroTail, true);
    bytes[8] = 1;
    assert.equal(linksFrom(bytes, address, address)[0].zeroTail, false);
  });
  await check('Cache unmount rejects stale or busy mounts and records SDK failures', async () => {
    for (const fault of ['missing', 'name', 'files', 'directories', 'sdk', null]) {
      const calls = [], accessor = 0x2000, bytes = Buffer.alloc(128);
      bytes.write(fault === 'name' ? 'old' : 'tmp', 24);
      for (const offset of [0x30, 0x40]) {
        bytes.writeBigUInt64LE(BigInt(accessor + offset), offset);
        bytes.writeBigUInt64LE(BigInt(accessor + offset), offset + 8);
      }
      if (fault === 'files') bytes[0x30] ^= 1;
      if (fault === 'directories') bytes[0x48] ^= 1;
      const exported = {exports: {}};
      const imports = {
        'node:fs/promises': {async readFile() { return JSON.stringify({mounts: fault === 'missing' ? [] : [{name: 'tmp', accessor}]}); }},
        'node:path': path,
        'node:child_process': {execFile() { throw Error('Unexpected subprocess'); }},
        'node:util': require('node:util'),
        './cache-mount-sdk.json': {functions: {Unmount: {offset: 16}}},
        './session.cjs': {check(ok, message) { if (!ok) throw Error(message); }},
      };
      const context = vm.createContext({module: exported, Buffer, process,
        require(name) { assert.ok(Object.hasOwn(imports, name), `Unexpected cache import: ${name}`); return imports[name]; }});
      new vm.Script(fs.readFileSync(path.join(root, 'engine/switch2/memory/cache-mount.cjs'), 'utf8')).runInContext(context);
      const session = {base: 0x3000,
        async read(location, length) { assert.equal(location, accessor); assert.equal(length, 128); return bytes; },
        async write() { calls.push('write'); },
        rpc: {async call3() { calls.push('sdk'); return fault === 'sdk' ? 1 : 0; }},
        async record() { calls.push('record'); },
      };
      const run = () => exported.exports.unmount(session, {sdk: 0x4000}, '/fixture');
      if (fault) await assert.rejects(run(), /missing|changed|open SDK|unmount failed/);
      else await run();
      assert.deepEqual(calls, ['sdk', null].includes(fault) ? ['write', 'sdk', 'record'] : []);
    }
  });
  await check('Foreign worker cancellation and binding enforce thread count and identity', async () => {
    const workerImports = {
      '../../shared/ipc.cjs': ipc,
      'node:path': path,
      [path.join(root, 'engine/switch2/app/native-worker.cjs')]: {},
      [path.join(root, 'engine/switch2/app/events.cjs')]: {},
      [path.join(root, 'engine/switch2/app/worker.cjs')]: { SENTINEL: 0xdeadbeefn },
    };
    const exported = { exports: {} };
    const context = vm.createContext({
      module: exported, __dirname: path.join(root, 'engine/switch2/ro'), Buffer, process,
      require(name) {
        if (Object.hasOwn(workerImports, name)) return workerImports[name];
        if (name.startsWith('node:')) return require(name);
        throw new Error(`Unexpected import in worker-control: ${name}`);
      }
    });
    new vm.Script(fs.readFileSync(path.join(root, 'engine/switch2/ro/worker-control.cjs'), 'utf8')).runInContext(context);
    const workerControl = exported.exports;

    const s = {
      handles: new Set([10, 11, 12, 13, 14, 15, 16]),
      rpc: { async batch(calls) { return calls.map(() => ({ result: 0 })); } },
      async verifyCode(code) {
        assert.equal(code.offset, 0x158414);
        assert.equal(code.bytes, '210300d4c0035fd6');
      }
    };
    const live = { sdk: 0x400000 };
    const report = {
      nativeRo: {
        apiWorkers: [0, 1, 2, 3, 4, 5, 6].map(id => ({ handle: 10 + id, id }))
      }
    };
    const ctx = { s, live, report, save: async () => {} };

    const replies = await workerControl.cancelWorkers(ctx);
    assert.equal(replies.length, 7);
    assert.ok(replies.every(r => r.result === 0));

    await assert.rejects(workerControl.cancelWorkers({ ...ctx, report: { nativeRo: { apiWorkers: report.nativeRo.apiWorkers.slice(0, 6) } } }), /API-worker copies are missing/);
    await assert.rejects(workerControl.cancelWorkers({ ...ctx, s: { ...s, handles: new Set([10, 11, 12, 13, 14, 15]) } }), /API-worker copies are missing/);

    const rejectingCancel = { ...ctx, s: { ...s, rpc: { async batch(calls) { return calls.map((c, i) => ({ result: i === 0 ? 1 : 0 })); } } } };
    await assert.rejects(workerControl.dispatch(rejectingCancel, { command: 'root-native-worker-cancel' }, report.nativeRo), /Foreign thread cancellation was rejected/);

    const state = {
      events: [0, 1, 2, 3, 4, 5, 6].map(id => ({ handle: 10 + id })),
      calls: [0, 1, 2, 3, 4, 5, 6].map(id => ({ operation: 'thread-id', handle: 10 + id, result: 0, value: String(id) }))
    };
    const bindReq = { command: 'root-native-worker-bind', workers: [0, 1, 2, 3, 4, 5, 6].map(id => ({ handle: 10 + id, id })) };
    const bound = await workerControl.dispatch({ s, live, save: async () => {} }, bindReq, state);
    assert.equal(bound.length, 7);

    await assert.rejects(workerControl.dispatch({ s, live, save: async () => {} }, { command: 'root-native-worker-bind', workers: [0, 1, 2, 3, 4, 5, 0].map((id, i) => ({ handle: 10 + id, id: i })) }, state), /seven different native API-worker copies/);
    await assert.rejects(workerControl.dispatch({ s, live, save: async () => {} }, bindReq, { ...state, calls: [] }), /Worker copies lack their native thread-ID checks/);
  });
  await check('Unreleased worker launch discard safely replaces mutating payload with read-only query', async () => {
    const workerImports = {
      '../../shared/ipc.cjs': ipc,
      'node:path': path,
      [path.join(root, 'engine/switch2/app/native-worker.cjs')]: {},
      [path.join(root, 'engine/switch2/app/events.cjs')]: {},
      [path.join(root, 'engine/switch2/app/worker.cjs')]: { SENTINEL: 0xdeadbeefn },
    };
    const exported = { exports: {} };
    const context = vm.createContext({
      module: exported, __dirname: path.join(root, 'engine/switch2/ro'), Buffer, process,
      require(name) {
        if (Object.hasOwn(workerImports, name)) return workerImports[name];
        if (name.startsWith('node:')) return require(name);
        throw new Error(`Unexpected import in worker-control: ${name}`);
      }
    });
    new vm.Script(fs.readFileSync(path.join(root, 'engine/switch2/ro/worker-control.cjs'), 'utf8')).runInContext(context);
    const workerControl = exported.exports;

    const written = [];
    const s = {
      threads: new Set([99]),
      async readOwned(addr, len) {
        const buf = Buffer.alloc(len);
        buf.writeUInt32LE(4, 0);
        buf.write('SFCI', 16, 'ascii');
        buf.writeUInt32LE(0, 24);
        return buf;
      },
      async write(addr, data) { written.push({ addr, data }); }
    };
    const worker = {
      thread: 99, joined: false, kind: 'pm-launch', launchTitle: '0x0400000000000037',
      launchFlags: 0x10, released: false, area: 0x2100000
    };
    const state = { worker };
    const ctx = { s, live: {}, save: async () => {} };

    const res = await workerControl.dispatch(ctx, { command: 'root-native-worker-discard-unreleased-launch' }, state);
    assert.equal(res.discarded, true);
    assert.equal(written.length, 1);
    assert.equal(written[0].addr, 0x2100000 + 0x1000);
    assert.deepEqual(written[0].data, ipc.packet(6));
    assert.ok(worker.discardedLaunch);

    await assert.rejects(workerControl.dispatch(ctx, { command: 'root-native-worker-discard-unreleased-launch' }, { worker: { ...worker, released: true } }), /Only this unreleased helper launch may be discarded/);
    await assert.rejects(workerControl.dispatch(ctx, { command: 'root-native-worker-discard-unreleased-launch' }, { worker: { ...worker, kind: 'sm-get' } }), /Only this unreleased helper launch may be discarded/);
  });
  await check('Locator domain conversion failure closes temporary handle and rolls back state', async () => {
    const closed = [];
    const s = {
      async ready() { return true; },
      handles: new Set([100]),
      async close(h) { closed.push(h); }
    };
    const live = { session: 'test-session' };
    const controlSha = hash(fs.readFileSync(path.join(root, 'engine/switch2/ro/control.cjs')));
    const report = {
      nativeRo: { session: 'test-session', notifiers: [100], events: [], calls: [], sources: [{ sha256: controlSha }] }
    };

    const domain = {
      wire: { control: id => Buffer.from([id]) },
      async send(s, label, handle, packet) {
        if (label.includes('Clone')) return { moves: [200], copies: [], result: 0 };
        if (label.includes('Convert')) throw new Error('Simulated domain conversion failure');
      },
      oneHandle(reply) { return reply.moves[0]; }
    };

    const imports = {
      '../memory/session.cjs': { check(ok, msg) { if (!ok) throw new Error(msg); } },
      [path.join(root, 'engine/switch2/app/domain.cjs')]: domain,
      './files.cjs': {}, './worker-control.cjs': {}, './process-test.cjs': {}
    };
    const exported = { exports: {} };
    const context = vm.createContext({
      module: exported, __dirname: path.join(root, 'engine/switch2/ro'),
      __filename: path.join(root, 'engine/switch2/ro/control.cjs'),
      Buffer, process,
      require(name) {
        if (Object.hasOwn(imports, name)) return imports[name];
        if (name.startsWith('node:')) return require(name);
        throw new Error(`Unexpected import in control: ${name}`);
      }
    });
    new vm.Script(fs.readFileSync(path.join(root, 'engine/switch2/ro/control.cjs'), 'utf8')).runInContext(context);
    const controlMod = exported.exports;

    await assert.rejects(
      controlMod.dispatch({ s, live, report, save: async () => {} }, { command: 'root-native-locator-open', handle: 100 }),
      /Simulated domain conversion failure/
    );
    assert.deepEqual(closed, [200]);
    assert.equal(report.nativeRo.domainCopies.length, 0);

    domain.send = async (s, label, handle, packet) => {
      if (label.includes('Clone')) return { moves: [201], copies: [], result: 0 };
      const buf = Buffer.alloc(4); buf.writeUInt32LE(0x42);
      return { moves: [], copies: [], result: 0, data: buf };
    };
    const entry = await controlMod.dispatch({ s, live, report, save: async () => {} }, { command: 'root-native-locator-open', handle: 100 });
    assert.equal(entry.handle, 201);
    assert.equal(entry.root, 0x42);
    assert.equal(report.nativeRo.domainCopies.length, 1);

    const closeRes = await controlMod.dispatch({ s, live, report, save: async () => {} }, { command: 'root-native-close-handle', handle: 201 });
    assert.equal(closeRes.closed, 201);
    assert.equal(report.nativeRo.domainCopies.length, 0);
    assert.deepEqual(closed, [200, 201]);

    await assert.rejects(
      controlMod.dispatch({ s, live, report, save: async () => {} }, { command: 'root-native-close-handle', handle: 999 }),
      /Only exported or copied local handles may be closed here/
    );
  });
  await check('CodeFS handle closure preserves primary bindings and active domain roots', async () => {
    const closed = [];
    const s = {
      threads: new Set(),
      handles: new Set([50, 51]),
      async close(h) { closed.push(h); }
    };
    const state = {
      codeFileSystems: [
        { handle: 50, title: 'primary' },
        { handle: 51, title: 'secondary' }
      ]
    };
    const ctx = { s, live: {}, save: async () => {} };

    const filesImports = {
      '../../shared/ipc.cjs': ipc,
      './payload/manifest.json': require(path.join(root, 'engine/switch2/ro/payload/manifest.json')),
      '../app/filesystem.cjs': {}, '../app/mounted-save.cjs': {}
    };
    const exported = { exports: {} };
    const context = vm.createContext({
      module: exported, __dirname: path.join(root, 'engine/switch2/ro'), Buffer, process,
      require(name) {
        if (Object.hasOwn(filesImports, name)) return filesImports[name];
        if (name.startsWith('node:')) return require(name);
        throw new Error(`Unexpected import in files: ${name}`);
      }
    });
    new vm.Script(fs.readFileSync(path.join(root, 'engine/switch2/ro/files.cjs'), 'utf8')).runInContext(context);
    const filesMod = exported.exports;

    await assert.rejects(filesMod.dispatch(ctx, { command: 'root-native-code-close', handle: 50 }, state),
      /Close requires an idle analysis CodeFS; the retained binding is preserved/);

    s.threads.add(1);
    await assert.rejects(filesMod.dispatch(ctx, { command: 'root-native-code-close', handle: 51 }, state),
      /Close requires an idle analysis CodeFS/);
    s.threads.clear();

    state.codeFileSystems[1].domainRoot = 0x10;
    await assert.rejects(filesMod.dispatch(ctx, { command: 'root-native-code-close', handle: 51 }, state),
      /Close requires an idle analysis CodeFS/);
    delete state.codeFileSystems[1].domainRoot;

    const res = await filesMod.dispatch(ctx, { command: 'root-native-code-close', handle: 51 }, state);
    assert.equal(res.closed, true);
    assert.deepEqual(closed, [51]);
    assert.equal(state.codeFileSystems.length, 1);
    assert.equal(state.closedCodeFileSystems.length, 1);
  });
  await check('Donor filesystem preparation validates policy manifest, chunked hashes and path encoding', async () => {
    const filesImports = {
      '../../shared/ipc.cjs': ipc,
      './payload/manifest.json': require(path.join(root, 'engine/switch2/ro/payload/manifest.json')),
      '../app/filesystem.cjs': {}, '../app/mounted-save.cjs': {}
    };
    const exported = { exports: {} };
    const context = vm.createContext({
      module: exported, __dirname: path.join(root, 'engine/switch2/ro'), Buffer, process,
      require(name) {
        if (Object.hasOwn(filesImports, name)) return filesImports[name];
        if (name.startsWith('node:')) return require(name);
        throw new Error(`Unexpected import in files: ${name}`);
      }
    });
    new vm.Script(fs.readFileSync(path.join(root, 'engine/switch2/ro/files.cjs'), 'utf8')).runInContext(context);
    const filesMod = exported.exports;

    const pkt = filesMod.pathRequest(8, Buffer.alloc(4), 0x1234567890, 0x301);
    assert.equal(pkt.readUInt32LE(0), 4 | (1 << 16));
    assert.equal(pkt.readUInt32LE(12), 0x34567890);
    assert.equal(pkt.readUInt32LE(8) >> 16, 0x301);

    const s = { threads: new Set() };
    const live = { platform: 2, session: 'mismatch-test' };
    await assert.rejects(
      filesMod.dispatch({ s, live, save: async () => {} }, { command: 'root-native-donor-prepare' }, {}),
      /ENOENT|unsupported/
    );
  });
  await check('Donor cleanup validates file hashes and guarantees cloned filesystem closure in finally', async () => {
    const closed = [];
    const s = {
      base: 0x100000, bytes: 0x1000000,
      threads: new Set(), pendingIpc: false,
      async close(h) { closed.push(h); },
      async write() {},
      async readOwned(addr, size) { return Buffer.alloc(size); },
      async ipc() { return { result: 0 }; }
    };
    const state = {
      worker: { joined: true },
      donor: {
        ready: true,
        files: [
          { name: 'main', created: true, verified: true, size: 10, sha256: hash(Buffer.alloc(10)) }
        ]
      }
    };
    const filesystem = {
      async openFile(s, handle, name) { return { result: 0, handle: 80 }; },
      async fileSize(s, handle) { return 10n; },
      async readFile(s, handle, offset, size) { return Buffer.alloc(size); },
      async pathMethod(s, handle, cmd, name) { return { canonicalResult: 0x202 }; }
    };
    const domain = { async send() { return { result: 0 }; } };
    const mountedSave = { async cloneMountedFilesystem() { return 70; } };

    const filesImports = {
      '../../shared/ipc.cjs': ipc,
      './payload/manifest.json': require(path.join(root, 'engine/switch2/ro/payload/manifest.json')),
      '../app/filesystem.cjs': filesystem,
      '../app/mounted-save.cjs': mountedSave
    };
    const exported = { exports: {} };
    const context = vm.createContext({
      module: exported, __dirname: path.join(root, 'engine/switch2/ro'), Buffer, process,
      require(name) {
        if (Object.hasOwn(filesImports, name)) return filesImports[name];
        if (name.startsWith('node:')) return require(name);
        throw new Error(`Unexpected import in files: ${name}`);
      }
    });
    new vm.Script(fs.readFileSync(path.join(root, 'engine/switch2/ro/files.cjs'), 'utf8')).runInContext(context);
    const filesMod = exported.exports;

    const res = await filesMod.dispatch({ s, live: {}, save: async () => {} }, { command: 'root-native-donor-cleanup' }, state, domain);
    assert.equal(res.cleanedUp, true);
    assert.deepEqual(closed, [80, 70]);

    state.worker.joined = false;
    state.donor.cleanedUp = false;
    await assert.rejects(
      filesMod.dispatch({ s, live: {}, save: async () => {} }, { command: 'root-native-donor-cleanup' }, state, domain),
      /Donor cleanup requires the completed launch and an idle worker/
    );
  });
  await check('Process test execution requires RX permissions and verifies unmapping on cleanup', async () => {
    const mem = new Map();
    const s = {
      base: 0x1000000, bytes: 0x3000000,
      threads: new Set(), rpc: {},
      async write(addr, data) { mem.set(addr, Buffer.from(data)); },
      async readOwned(addr, size) { return mem.get(addr)?.subarray(0, size) || Buffer.alloc(size); },
      async read(addr, size) {
        const page = Buffer.alloc(size);
        fs.readFileSync(path.join(root, 'engine/switch2/process/test-function.bin')).copy(page);
        return page;
      }
    };
    const live = { session: 'proc-test' };
    const state = {};
    const ctx = { s, live, save: async () => {} };

    const testBin = fs.readFileSync(path.join(root, 'engine/switch2/process/test-function.bin'));
    const pageBuf = Buffer.alloc(0x1000); testBin.copy(pageBuf);
    const pageHash = hash(pageBuf);

    const processTestMod = require(path.join(root, 'engine/switch2/ro/process-test.cjs'));

    s.rpc.query = async () => ({ result: 0, type: 5, permissions: 3, attributes: 0 });
    const prep = await processTestMod.dispatch(ctx, { command: 'root-native-process-test-prepare' }, state);
    assert.equal(prep.pageSha256, pageHash);

    s.rpc.query = async addr => ({ result: 0, type: 5, permissions: 3, attributes: 0, address: addr, size: 0x1000 });
    await assert.rejects(
      processTestMod.dispatch(ctx, { command: 'root-native-process-test-execute', destination: 0x4000000, nonce: 42 }, state),
      /RO did not provide a readable executable alias/
    );

    let verifiedFunc = false;
    s.rpc.query = async addr => ({ result: 0, type: 5, permissions: 5, attributes: 0, address: addr, size: 0x1000 });
    s.rpc.verifyFunction = async () => { verifiedFunc = true; };
    s.rpc.call4 = async () => 0;
    await processTestMod.dispatch(ctx, { command: 'root-native-process-test-execute', destination: 0x4000000, nonce: 42 }, state);
    assert.equal(verifiedFunc, true);

    s.rpc.query = async addr => {
      if (addr === state.processTest.source) return { result: 0, type: 5, permissions: 3, attributes: 0 };
      return { result: 0, type: 1, permissions: 5 };
    };
    await assert.rejects(
      processTestMod.dispatch(ctx, { command: 'root-native-process-test-cleanup', destination: 0x4000000 }, state),
      /The executable alias remains mapped/
    );

    s.rpc.query = async addr => {
      if (addr === state.processTest.source) return { result: 0, type: 5, permissions: 3, attributes: 0 };
      return { result: 0, type: 0, permissions: 0 };
    };
    const cleanRes = await processTestMod.dispatch(ctx, { command: 'root-native-process-test-cleanup', destination: 0x4000000 }, state);
    assert.equal(cleanRes.finished, true);
  });
  await check('Assembly test fixture rebuild matches shipped bytes', () => {
    assert.equal(execFileSync(zig, ['version'], { encoding: 'utf8' }).trim(), '0.15.2');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-assembly-'));
    try {
      const output = path.join(directory, 'test.o');
      execFileSync(zig, ['cc', '-target', 'aarch64-freestanding-none', '-g0', '-c', path.join(root, 'engine/switch2/process/test-function.S'), '-o', output], { stdio: 'pipe' });
      const text = builder.sections(fs.readFileSync(output)).filter(section => section.name === '.text');
      assert.equal(text.length, 1);
      assert.deepEqual(text[0].bytes, fs.readFileSync(path.join(root, 'engine/switch2/process/test-function.bin')));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  assert.equal(results.length, 36, 'Native audit case coverage is incomplete');
  assert.deepEqual(inspectSource(root, expectedRevision), inspected, 'Upstream source changed during audit');
  const count = status => results.filter(result => result.status === status).length;
  return {
    schema_version: '1.0.0', run_id: `${new Date().toISOString().replace(/[:.]/g, '-')}-native-review`,
    timestamp: new Date().toISOString(), target_id: 'ns2jb-smilebasic',
    environment: { os: process.platform, node_version: process.version },
    upstream_revision: expectedRevision,
    reviewer_sha256: hash(fs.readFileSync(__filename)),
    scope: 'Pinned native payload source and host-side parser/guard assertions; no console execution',
    inspected_files: inspected, payload_segments: segments || [], results,
    summary: { total: results.length, passed: count('pass'), failed: count('fail'), skipped: 0, errors: 0 },
  };
}

module.exports = { sourceFiles, elfFixture, validateImage, inspectSource, reviewNative };

if (require.main === module) {
  const [root, output, zig] = process.argv.slice(2);
  if (!root || !output) {
    console.error('Usage: node scripts/review-native.cjs PINNED_CHECKOUT OUTPUT.json [ZIG]');
    process.exitCode = 1;
  } else {
    const config = require('../config/targets.json');
    const revision = config.targets.find(target => target.id === 'ns2jb-smilebasic').upstream.last_known_commit;
    reviewNative(root, revision, zig).then(report => {
      fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
      console.log(JSON.stringify(report.summary));
      if (report.summary.failed) process.exitCode = 1;
    }).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
