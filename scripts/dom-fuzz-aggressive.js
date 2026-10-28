// Aggressive DOM/SVG/CSS fuzzing — targeting memory corruption bugs
// Each test is isolated in a try/catch. Tests are designed to stress
// specific WebKit code paths known to have had bugs.
(function() {
'use strict';
var results = [];
var survived = 0;

function test(name, fn) {
  try {
    fn();
    survived++;
    results.push({ name: name, result: 'survived' });
  } catch(e) {
    results.push({ name: name, error: e.message.substring(0, 60) });
  }
}

// First: check if COOP/COEP enabled SharedArrayBuffer
results.push({
  name: 'sab_check',
  SAB: typeof SharedArrayBuffer,
  crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : 'undef'
});

// Test 1: SVG <use> with deeply nested references
test('svg_use_deep', function() {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '100'); svg.setAttribute('height', '100');
  svg.style.position = 'absolute'; svg.style.left = '-9999px';
  var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

  // Create chain: g1 uses g2, g2 uses g3, ... g19 uses g20
  for (var i = 1; i <= 20; i++) {
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = 'g' + i;
    if (i < 20) {
      var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#g' + (i + 1));
      g.appendChild(use);
    } else {
      var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', '10'); rect.setAttribute('height', '10');
      g.appendChild(rect);
    }
    defs.appendChild(g);
  }
  svg.appendChild(defs);
  var topUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  topUse.setAttribute('href', '#g1');
  svg.appendChild(topUse);
  document.body.appendChild(svg);
  svg.getBBox();
  // Now remove middle elements while use chain is live
  for (var i = 10; i <= 15; i++) {
    var el = svg.querySelector('#g' + i);
    if (el) el.remove();
  }
  svg.getBBox();
  svg.remove();
});

// Test 2: SVG <use> circular reference
test('svg_use_circular', function() {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = 'position:absolute;left:-9999px;width:100px;height:100px';
  var g1 = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g1.id = 'circ1';
  var use1 = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use1.setAttribute('href', '#circ2');
  g1.appendChild(use1);
  var g2 = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g2.id = 'circ2';
  var use2 = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use2.setAttribute('href', '#circ1');
  g2.appendChild(use2);
  svg.appendChild(g1); svg.appendChild(g2);
  document.body.appendChild(svg);
  try { svg.getBBox(); } catch(e) {}
  svg.remove();
});

// Test 3: CSS counter with extreme values
test('css_counter_overflow', function() {
  var style = document.createElement('style');
  style.textContent = [
    '.ctr { counter-reset: c 2147483647; }',
    '.ctr::before { counter-increment: c 1; content: counter(c); }',
    '.ctr2 { counter-reset: c -2147483648; }',
    '.ctr2::before { counter-increment: c -1; content: counter(c); }'
  ].join('\n');
  document.head.appendChild(style);
  var d1 = document.createElement('div'); d1.className = 'ctr';
  var d2 = document.createElement('div'); d2.className = 'ctr2';
  document.body.appendChild(d1); document.body.appendChild(d2);
  d1.offsetWidth; d2.offsetWidth;
  d1.remove(); d2.remove(); style.remove();
});

// Test 4: CSS Grid with extreme track counts/sizes
test('css_grid_extreme', function() {
  var d = document.createElement('div');
  d.style.cssText = 'display:grid;grid-template-columns:repeat(1000, 1fr);width:100px;position:absolute;left:-9999px';
  for (var i = 0; i < 100; i++) {
    var child = document.createElement('div');
    child.style.gridColumn = 'span ' + Math.min(i + 1, 50);
    child.textContent = 'x';
    d.appendChild(child);
  }
  document.body.appendChild(d);
  d.offsetWidth;
  // Rapidly change grid definition
  d.style.gridTemplateColumns = 'repeat(500, minmax(0, 1fr))';
  d.offsetWidth;
  d.style.gridTemplateColumns = 'repeat(auto-fill, minmax(1px, 1fr))';
  d.offsetWidth;
  d.remove();
});

// Test 5: CSS Flexbox with extreme values
test('css_flex_extreme', function() {
  var d = document.createElement('div');
  d.style.cssText = 'display:flex;flex-wrap:wrap;width:10px;position:absolute;left:-9999px';
  for (var i = 0; i < 200; i++) {
    var child = document.createElement('div');
    child.style.cssText = 'flex:' + (i % 3 === 0 ? '999999' : '1') + ' ' + (i % 2 === 0 ? '0' : '999999') + ' ' + (i % 4 === 0 ? '0px' : '99999px');
    child.textContent = 'x';
    d.appendChild(child);
  }
  document.body.appendChild(d);
  d.offsetWidth;
  for (var i = 0; i < 20; i++) {
    d.style.width = (i * 5 + 1) + 'px';
    d.offsetWidth;
  }
  d.remove();
});

// Test 6: Range manipulation across node boundaries
test('range_crossboundary', function() {
  var container = document.createElement('div');
  container.innerHTML = '<p id="rp1">Hello <b>bold <i>italic</i></b> world</p><p id="rp2">Second <a href="#">link <span>span</span></a> end</p>';
  document.body.appendChild(container);

  var range = document.createRange();
  // Set range across different node types
  range.setStart(container.querySelector('#rp1').firstChild, 3); // "lo " in "Hello "
  range.setEnd(container.querySelector('#rp2 span').firstChild, 2); // "sp" in "span"

  // Extract and reinsert
  var frag = range.extractContents();
  container.querySelector('#rp1').appendChild(frag);
  container.offsetWidth;

  // Collapse and delete
  range.selectNodeContents(container);
  range.deleteContents();
  container.offsetWidth;
  container.remove();
});

// Test 7: Shadow DOM with slotted content + rapid mutation
test('shadow_dom_mutation', function() {
  var host = document.createElement('div');
  var shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>::slotted(span){color:red}</style><slot name="s1"></slot><slot></slot>';

  for (var i = 0; i < 20; i++) {
    var s = document.createElement('span');
    s.slot = i % 3 === 0 ? 's1' : '';
    s.textContent = 'slot' + i;
    host.appendChild(s);
  }
  document.body.appendChild(host);
  host.offsetWidth;

  // Rapidly reassign slots
  for (var i = 0; i < 50; i++) {
    var children = host.children;
    for (var j = 0; j < children.length; j++) {
      children[j].slot = i % 2 === 0 ? 's1' : '';
    }
    host.offsetWidth;
    if (i === 25) {
      // Remove shadow content while slots are active
      shadow.innerHTML = '<slot></slot>';
    }
  }
  host.remove();
});

// Test 8: requestAnimationFrame + DOM mutation
test('raf_mutation', function() {
  return new Promise(function(resolve) {
    var div = document.createElement('div');
    div.style.cssText = 'width:100px;height:100px;transition:width 0.01s';
    document.body.appendChild(div);

    var count = 0;
    function frame() {
      count++;
      div.style.width = (100 + count) + 'px';
      // Add/remove children during animation frame
      var child = document.createElement('span');
      child.style.cssText = 'display:block;height:10px;background:red';
      div.appendChild(child);
      if (div.children.length > 5) div.firstChild.remove();
      div.offsetWidth; // force layout

      if (count < 30) {
        requestAnimationFrame(frame);
      } else {
        div.remove();
        resolve();
      }
    }
    requestAnimationFrame(frame);
    setTimeout(function() { div.remove(); resolve(); }, 3000);
  });
});

// Test 9: Table layout with extreme colspan/rowspan
test('table_extreme', function() {
  var table = document.createElement('table');
  table.style.cssText = 'width:100px;position:absolute;left:-9999px;table-layout:fixed';
  for (var r = 0; r < 20; r++) {
    var tr = document.createElement('tr');
    for (var c = 0; c < 10; c++) {
      var td = document.createElement('td');
      td.colSpan = (r * c % 5) + 1;
      td.rowSpan = (r + c) % 4 + 1;
      td.textContent = r + ',' + c;
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  document.body.appendChild(table);
  table.offsetWidth;
  // Mutate while rendered
  for (var i = 0; i < table.rows.length; i += 2) {
    table.deleteRow(i);
  }
  table.offsetWidth;
  table.remove();
});

// Test 10: CSS clip-path + will-change + removal during animation
test('clippath_anim', function() {
  var style = document.createElement('style');
  style.textContent = '@keyframes morph{0%{clip-path:circle(50%)}50%{clip-path:polygon(0 0,100% 0,100% 100%)}100%{clip-path:circle(50%)}} .morph{animation:morph .01s linear infinite;will-change:clip-path}';
  document.head.appendChild(style);

  var els = [];
  for (var i = 0; i < 30; i++) {
    var d = document.createElement('div');
    d.className = 'morph';
    d.style.cssText = 'width:50px;height:50px;position:absolute;background:blue';
    document.body.appendChild(d);
    els.push(d);
  }
  document.body.offsetWidth;

  // Remove in random order
  for (var i = els.length - 1; i >= 0; i -= 2) {
    els[i].remove();
  }
  document.body.offsetWidth;
  for (var i = 0; i < els.length; i += 2) {
    if (els[i].parentNode) els[i].remove();
  }
  style.remove();
});

// Test 11: iframe srcdoc with script + removal
test('iframe_srcdoc', function() {
  return new Promise(function(resolve) {
    var iframe = document.createElement('iframe');
    iframe.srcdoc = '<html><body><script>parent.postMessage("loaded","*");<\/script></body></html>';
    iframe.sandbox = 'allow-scripts allow-same-origin';
    document.body.appendChild(iframe);

    window.addEventListener('message', function handler(e) {
      if (e.data === 'loaded') {
        window.removeEventListener('message', handler);
        // Remove iframe while its script might still be running
        iframe.remove();
        // Allocate to reclaim memory
        var spray = [];
        for (var i = 0; i < 50; i++) spray.push(new ArrayBuffer(256));
        resolve();
      }
    });

    setTimeout(function() { iframe.remove(); resolve(); }, 2000);
  });
});

// Test 12: CSS variable recursion
test('css_var_recursive', function() {
  var style = document.createElement('style');
  style.textContent = ':root{--a:var(--b);--b:var(--c);--c:var(--d);--d:var(--e);--e:var(--f);--f:var(--g);--g:var(--h);--h:var(--i);--i:var(--j);--j:10px} .vartest{width:var(--a);height:var(--a)}';
  document.head.appendChild(style);
  var d = document.createElement('div');
  d.className = 'vartest';
  document.body.appendChild(d);
  d.offsetWidth;
  // Make it circular
  style.textContent = ':root{--a:var(--b);--b:var(--a)} .vartest{width:var(--a)}';
  d.offsetWidth;
  d.remove(); style.remove();
});

// Test 13: Selection API manipulation during contenteditable
test('selection_contenteditable', function() {
  var d = document.createElement('div');
  d.contentEditable = 'true';
  d.innerHTML = '<p>Line 1</p><p>Line 2</p><p>Line 3</p>';
  document.body.appendChild(d);

  var sel = window.getSelection();
  var range = document.createRange();
  range.selectNodeContents(d);
  sel.removeAllRanges();
  sel.addRange(range);

  // Execute editing commands during selection
  try { document.execCommand('bold'); } catch(e) {}
  try { document.execCommand('italic'); } catch(e) {}
  try { document.execCommand('insertHTML', false, '<table><tr><td>cell</td></tr></table>'); } catch(e) {}
  try { document.execCommand('delete'); } catch(e) {}
  try { document.execCommand('undo'); } catch(e) {}
  try { document.execCommand('redo'); } catch(e) {}

  d.offsetWidth;
  d.remove();
});

// Test 14: Canvas drawImage with SVG source
test('canvas_svg_draw', function() {
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><foreignObject width="100" height="100"><body xmlns="http://www.w3.org/1999/xhtml"><div style="width:100px;height:100px;background:red">test</div></body></foreignObject></svg>';
  var blob = new Blob([svg], { type: 'image/svg+xml' });
  var url = URL.createObjectURL(blob);
  var img = new Image();
  img.src = url;
  // Don't wait for load - just test the path
  var canvas = document.createElement('canvas');
  canvas.width = 100; canvas.height = 100;
  var ctx = canvas.getContext('2d');
  try { ctx.drawImage(img, 0, 0); } catch(e) {} // may fail since not loaded
  URL.revokeObjectURL(url);
});

// Test 15: CSS @font-face with data: URI + rapid style changes
test('fontface_rapid', function() {
  var style = document.createElement('style');
  // Minimal invalid font data to trigger parser
  style.textContent = '@font-face{font-family:"Fuzz";src:url(data:font/woff2;base64,d09GMgABAAAAAAQEAA0AAAAAB) format("woff2")} .fuzz{font-family:"Fuzz",sans-serif;font-size:20px}';
  document.head.appendChild(style);
  var d = document.createElement('div');
  d.className = 'fuzz';
  d.textContent = 'Font fuzz test ABCDEFGHIJKLMNOP';
  document.body.appendChild(d);
  d.offsetWidth;
  // Rapid font-size changes
  for (var i = 0; i < 50; i++) {
    d.style.fontSize = (10 + i) + 'px';
    d.offsetWidth;
  }
  d.remove(); style.remove();
});

// Test 16: MutationObserver flood
test('mutation_flood', function() {
  var container = document.createElement('div');
  document.body.appendChild(container);
  var mutations = 0;

  var obs = new MutationObserver(function(recs) {
    mutations += recs.length;
    // Mutate during observer callback
    if (mutations < 100) {
      var d = document.createElement('div');
      container.appendChild(d);
    }
  });
  obs.observe(container, { childList: true, subtree: true });

  // Trigger cascade
  for (var i = 0; i < 50; i++) {
    var d = document.createElement('div');
    d.innerHTML = '<span><b>deep</b></span>';
    container.appendChild(d);
  }
  container.offsetWidth;
  obs.disconnect();
  container.remove();
});

// Test 17: ResizeObserver + style recalc loop
test('resize_observer_loop', function() {
  return new Promise(function(resolve) {
    var d = document.createElement('div');
    d.style.cssText = 'width:100px;height:100px';
    document.body.appendChild(d);

    var count = 0;
    var ro = new ResizeObserver(function(entries) {
      count++;
      if (count < 20) {
        // Resize in callback causes re-observation
        d.style.width = (100 + count * 5) + 'px';
      } else {
        ro.disconnect();
        d.remove();
        resolve();
      }
    });
    ro.observe(d);
    d.style.width = '101px'; // trigger initial observation
    setTimeout(function() { ro.disconnect(); d.remove(); resolve(); }, 3000);
  });
});

// Test 18: Nested iframes with document.write
test('nested_iframe_write', function() {
  var iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  try {
    var doc = iframe.contentDocument;
    doc.open();
    doc.write('<html><body><div id="target">test</div></body></html>');
    doc.close();
    // Access and modify
    var target = doc.getElementById('target');
    if (target) {
      target.innerHTML = '<p>modified</p>';
      target.offsetWidth;
    }
    // Write again (replaces document)
    doc.open();
    doc.write('<html><body>rewritten</body></html>');
    doc.close();
  } catch(e) {}
  iframe.remove();
});

return new Promise(function(resolve) {
  setTimeout(function() {
    resolve(JSON.stringify(results));
  }, 4000);
});
})();
