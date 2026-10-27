const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

  assert.equal(results.length, 15, 'Native audit case coverage is incomplete');
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
