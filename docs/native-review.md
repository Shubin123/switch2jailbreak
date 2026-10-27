# Phase 4 — Native payload and interface review

Reviewed October 27, 2026 against upstream revision
`95f5525089273c5fce0b95047f3600f8442e96ae`.

This is a static walkthrough of the core native payload and selected host
interfaces, with executable host-side rejection checks. It is not a complete
review of every native-code generator in the chain, formal verification,
proof of console compatibility, or independent hardware reproduction.

## Coverage and source identity

The walkthrough covered all 95 tracked upstream files (9,128 lines
including comments, manifest data, documentation and binary assets). The
audit report records each file's SHA256 and line count. These identify the
reviewed sources, not the correctness of them.

| Upstream path | Review focus |
| --- | --- |
| `engine/switch2/ro/payload/main.c` | IPC descriptor parsing, fixed response buffers, session limits, received-handle lifetime |
| `engine/switch2/ro/payload/process.c` | Input sizes, memory spans, process identity, operation bounds, rollback and unmapping |
| `engine/switch2/ro/payload/start.S` | Entry point, argument/register moves, fixed syscall wrappers, byte-fill loop |
| `engine/switch2/ro/payload/layout.ld` | Segment alignment, entry point, BSS symbols, discarded metadata |
| `engine/switch2/ro/payload/manifest.json` | Pinned image length/digest and declared policy identity |
| `engine/switch2/process/test-function.S` | Register preservation, fixed output span and source/binary agreement |
| `engine/build-payload.cjs` | ELF bounds, relocation rejection, segment packaging and hashes |
| `engine/lib/native.cjs` | Exact integer encoding, request caps, memory guards, verified function addresses, chunking and shutdown |
| `engine/lib/connection.cjs` | Record framing, output cap, pairing token/layout checks, timeouts and closure |
| `engine/lib/bridge.cjs` | Loopback/token boundary, body cap, dispatch and serialized requests |
| `engine/switch2/process/client.cjs` | Request width, pending-worker state, recorded identity and reply PID checks |
| `engine/switch2/process/fs-execute.cjs` | Original-byte checks, challenge/readback verification, conditional restoration and evidence retention |
| `engine/switch2/ro/runtime.cjs` | Current-session identity, activation ordering, saved pending steps and idle-session handoff checks |
| `engine/switch2/ro/probe.cjs` | Random challenge, kernel/reply PID matching, monotonic ticks, worker timeout and handle cleanup |
| `engine/switch2/ro/layout.cjs` | Capture bounds and digest, boot binding, live identity checks, bounded thread walk and table search window |
| `engine/switch2/ro/gate.cjs` | Session identity guards, pending selection tracking, compare-before-write calls, grouped restoration and event retirement evidence |
| `engine/switch2/ro/launch.cjs` | Target/mount/type checks, bounded request loop, two-reference exchange, partial rollback and restoration ordering |
| `engine/switch2/ro/export-handle.cjs` | Handle range, notifier identity, substitution and conditional restoration around the copy request |
| `engine/switch2/ro/bind-sessions.cjs` | Heap/session bounds, unique server bindings, domain ID bounds and adapter-type matching |
| `engine/switch2/ro/copy-loader-root.cjs` | Manager/owner identity, reference-count challenges, temporary slot substitution and readback evidence |
| `engine/shared/ipc.cjs` | Descriptor widths, packet capacity, reply framing and malformed input |
| `engine/shared/domain.cjs` | Domain object/context bounds, fixed packet capacity, reply data/object extents and truncation rejection |
| `engine/shared/stages.cjs` | Exclusive private logs, stage-name validation, subprocess failure/timeout handling, no automatic replay and result-file directory restriction |
| `engine/switch2/memory/session.cjs` | Initialization failure cleanup and deferred session/tool dependencies |
| `engine/switch2/memory/cache-mount.cjs` | Borrowed mount ownership, live name/list guards, SDK failure recording and refresh ordering |
| `engine/switch2/memory/cache-mount-sdk.json` | Declared offsets and instruction lengths, not independently authenticated SDK provenance |
| `engine/switch2/retained/cache-shape.cjs` | Exact cache-array length and conservative unused-tail recognition |
| `engine/switch2/retained/links.cjs` | Page-aligned candidate filtering, width/proximity bounds and zero-tail observations |
| `engine/switch2/ro/control.cjs` | Command dispatch, locator domain conversion, exported/copied handle closure and syscall verification |
| `engine/switch2/ro/worker-control.cjs` | Seven-worker synchronization cancellation, worker binding validation, unreleased PM launch discard and join parsing |
| `engine/switch2/ro/files.cjs` | Path request descriptors, donor file preparation with chunked verification, CodeFS lifecycle and donor cleanup handle closure |
| `engine/switch2/ro/objects.cjs` | Locator domain resolution, owner/manager vtable verification, root/notifier clone challenge bounds and cleanup |
| `engine/switch2/ro/prepare-event.cjs` | Notifier proof binding, writable event handle export, and signal/clear qualification sequence |
| `engine/switch2/ro/prepare-workers.cjs` | Thread ring inspection, unique worker group selection, thread-ID export qualification and foreign cancellation |
| `engine/switch2/ro/process-test.cjs` | Single-page RW heap preparation, RX alias permission/hash enforcement, and unmapping cleanup |
| `engine/switch2/ro/test-gate.cjs` | Grouped session parking, single-step execution, and restoration execution in finally |
| `engine/switch2/ro/test-sm.cjs` | Candidate SM handle qualification, service lookup error handling, and program identity query |
| `engine/switch2/ro/install-retained.cjs` | Heap capture verification, cache array/owner matching, bootstrap probe retry and promotion |
| `engine/switch2/memory/session-tools.cjs` | Page staging bounds, session batching, bulk upload rejection |
| `engine/switch2/memory/verify-proof.cjs` | Saved-byte proof verification, stale/truncated/failed proof rejection |
| `engine/switch2/memory/cache-address-plan.cjs` | NUL-write UTF-8 validation and byte-arithmetic bounds |
| `engine/switch2/memory/signed-cache-plan.cjs` | Target/storage/period rejection and signed plan validation |
| `engine/switch2/retained/lower-window.cjs` | Pointer alignment validation and window boundary checks |
| `engine/switch2/retained/retained-memory.cjs` | Unresolved mutation blocking, promotion/stale/unready rejection, NR-15 short capture reproduction |
| `engine/shared/frames.cjs` | Worker frame address alignment, argument count, SDK function bounds and region overflow |
| `engine/shared/rpc.cjs` | Memory transfer address/length validation, chunking at 0x80000, 0x4000000 cap and truncation rejection |
| `engine/switch2/pipeline.cjs` | Exclusive file writes, restrictive permissions, stage status recording and no-replay invariant |
| `engine/switch2/acquire.cjs` | Exclusive log mode, 10-minute deadline, uncertain/pending/unjoined retire rejection, SIGKILL on abandon |
| `run.cjs` | Internal/link-local address filtering, argument validation, restrictive workspace modes, source digest |
| `engine/lib/qualify.cjs` | SDK mapping size/permissions/attributes, random challenge/restoration, pointer alignment and width |
| `engine/switch2/retained/find-metadata.cjs` | Pool bounds calculation, seed alignment, candidate containment and link convergence cap |
| `engine/switch2/process/bind-notifier.cjs` | Unique idle session requirement, wait/receive equality, copied handle closure |
| `engine/switch2/process/qualify.cjs` | SmileBASIC/FS program identity, RX permission check, nonce-based execution challenge and unmapping |
| `engine/switch2/memory/normalized-path.cjs` | Missing-path construction with prefix validation and bounded output |
| `engine/switch2/memory/paths.cjs` | Path descriptor packet construction with count, size and address-bit encoding |
| `engine/switch2/memory/native-links.cjs` | Address candidate extraction from saved native reads with hash matching and strength sorting |
| `engine/switch2/tools/endpoint.cjs` | Memory endpoint reply limit, timeout and hash verification |
| `engine/switch2/tools/fs-memory.cjs` | FS memory interface with canonical address validation, read/write caps, pointer chase depth and cycle detection |
| `engine/switch2/tools/fs-root-pid.cjs` | FS root PID promotion with per-field write tracking and failure rollback |
| `engine/switch2/cleanup-scratch.cjs` | Restrictive cleanup file operations with bounded scratch directory access |
| `test.cjs` | Upstream host test suite covering bytes and TCP only |
| `bootstrap.bas` | SmileBASIC entry script with address/CRC verification before network |
| `SHA256SUMS` | Pinned file checksums for integrity verification |
| `engine/switch2/process/test-function.bin` | Compiled test function binary (structural hash only) |
| `engine/switch2/ro/payload/main` | Shipped native payload image (structural hash and segment verification) |
| `engine/switch2/app/session.cjs` | App session lifecycle, cleanup ordering and deferred tool dependencies |
| `engine/switch2/app/worker.cjs` | Worker group selection, thread management and cancellation coordination |
| `engine/switch2/app/events.cjs` | Event signal/clear lifecycle with handle export and notification proofs |
| `engine/switch2/app/domain.cjs` | Domain handle tracking, move/copy operations and transport failure rejection |
| `engine/switch2/app/rpc.cjs` | App RPC function alignment validation and batch size bounds |
| `engine/switch2/app/filesystem.cjs` | Read-only command enforcement and path validation |
| `engine/switch2/app/map.cjs` | Region cap at 4,096 entries and non-advancing query rejection |
| `engine/switch2/app/native-worker.cjs` | Worker frame bounds, alignment and SENTINEL gate validation |
| `engine/switch2/app/qualify.cjs` | App qualification cleanup in finally and transfer hash verification |
| `engine/switch2/app/timing.cjs` | Unique mapping size check and exact frequency constants |
| `engine/switch2/app/affinity.cjs` | Single-bit mask within process allowance validation |
| `engine/switch2/app/bulk-transfer.cjs` | Transfer span validation within session allocation bounds |
| `engine/switch2/app/inspect-mounts.cjs` | Mount list traversal cap and cycle detection |
| `engine/switch2/app/mounted-save.cjs` | Session identity and manager state constant verification |
| `engine/switch2/memory/capture-workers.cjs` | Client-side progress preservation via readOwnedMany |
| `engine/switch2/memory/fs-memory-control.cjs` | Bootstrap memory tooling with Unix socket, address selection, signed header, poison patterns and readback |
| `engine/switch2/memory/fs-root-control.cjs` | Root IPC dispatch with BIS storage probing |
| `engine/switch2/memory/mounted-rom.cjs` | RomFS storage tracing and domain object copying |
| `engine/switch2/memory/probe-reserved-gap.cjs` | Reservation group qualification with worker orchestration, canary checking and cache probing |
| `engine/switch2/memory/run-control.cjs` | Acquisition run tracking with checkpoint/stop/retire state machine and atomic report writes |
| `engine/shared/sdk-functions.json` | SDK function declarations (structural encoding and alignment checks) |
| `engine/shared/sdk-layout.json` | SDK layout constants (structural encoding checks) |
| `engine/switch2/app/compat-affinity-reference.json` | Compatibility affinity reference data (structural checks) |
| `engine/switch2/app/event-code.json` | Event code constants (structural instruction-byte checks) |
| `engine/switch2/app/hash-code.json` | Hash code constants (structural instruction-byte checks) |
| `engine/switch2/app/sdk-proxy-code.json` | SDK proxy code declarations (structural instruction-byte checks) |
| `engine/switch2/app/thread-code.json` | Thread code constants (structural instruction-byte checks) |
| `engine/switch2/app/thread-scheduling-reference.json` | Thread scheduling reference data (structural checks) |
| `engine/switch2/app/timing-code.json` | Timing code constants (structural instruction-byte checks) |
| `README.md` | Upstream documentation with platform, entry point and usage claims |

The C payload's fixed output is 24 64-bit words. Its largest declared reply is
184 bytes; with the response's 48-byte prefix this occupies 232 bytes of the
256-byte message area. The parser bounds accepted raw data to that message
area before dispatch. This arithmetic is a static check, not a proof that the
kernel's IPC or memory descriptors match these assumptions on a device.

## Repeatable host checks

`scripts/review-native.cjs` refuses a dirty, wrong-revision, or symlinked source
tree and compares file bytes directly with the pinned Git blobs before importing
the reviewed host modules, including when Git's assume-unchanged flag hides a
modification from status output. It also refuses revisions without a recorded
static review; changing the target pin alone cannot silently authorize new code.
It neither calls a console nor
executes the resulting native instructions. Transport methods are replaced by
throwing stubs or deterministic in-memory responses for the interface checks.

The report contains 98 separately accounted checks, including ten
domain-framing and mocked subprocess-lifecycle checks, twelve
memory-subsystem boundary checks, thirteen orchestration/protocol
boundary checks, and twenty-seven app-layer, tools, memory-control,
JSON-asset and infrastructure checks:

1. Synthetic ELF packaging and independent segment validation.
2. Rejection of truncated ELF headers.
3. Rejection of wrong architecture, class and entry point.
4. Rejection of invalid section tables and imprecise offsets.
5. Rejection of missing names and unresolved relocations.
6. Rejection of duplicate, empty, overlapping and unaligned load segments.
7. Independent shipped-image length, layout, per-segment and module hashes.
8. Exact unsigned 64-bit argument round trips.
9. Rejection of malformed argument representations and function offsets.
10. Rejection of unverified addresses and excessive request sizes before I/O.
11. Rejection of invalid memory spans, insufficient permissions, reserved
    regions, IPC references and nonadvancing query responses.
12. Function authorization only after matching mapping and instruction bytes.
13. Bounded transfer chunks and rejection of failed native return values.
14. Transport closure even when the final shutdown write fails.
15. Execution-proof success and rejection of wrong kernel PID, nonce, tick and failed service lookup, using in-memory transport and evidence storage.
16. Layout boot binding, live object identity rejection and captured-table search-window behavior.
17. Gate identity/wait-word rejection and contiguous waiter-array guard, before writes.
18. Refusal to restore unsettled or selected sessions and incompatible grouped gates.
19. Failed event signaling leaves no successful snapshot-retirement evidence.
20. Handle-range rejection before file reads or writes, with explicit current-process pseudo-handle acceptance.
21. Rejection of stale notifier session/report/identity or changed backend before writes.
22. Mocked export success, request failure, first-write failure and restoration failure with exact write ordering and evidence flags.
23. Cache SDK declarations have bounded aligned instruction signatures.
24. CMIF descriptor bounds, mode restrictions and packet capacity caps.
25. Rejection of truncated and missing-magic CMIF replies.
26. Retained cache tail validation and conservative unused space checks.
27. Filtering of page-aligned 39-bit retained memory link candidates.
28. Mocked cache unmount preflight verification and failure recording.
29. Foreign worker cancellation and binding enforcement of thread count and verified identity.
30. Unreleased worker launch discard safely replacing mutating payload with read-only query.
31. Locator domain conversion failure guarantees temporary handle closure and state rollback.
32. CodeFS handle closure preserves primary bindings and active domain roots.
33. Donor filesystem preparation validates policy manifest, chunked hashes and path encoding.
34. Donor cleanup validates file hashes and guarantees cloned filesystem closure in finally.
35. Process test execution requires RX permissions and verifies unmapping on cleanup.
36. Domain object/context argument rejection.
37. Bounded domain data/object extraction without modifying the reply bytes.
38. Truncated domain headers and oversized object extents rejected.
39. Fixed domain/control packet capacity preserved.
40. Invalid stage names rejected before filesystem/subprocess access.
41. Successful mocked stage uses an exclusive private log and closes it.
42. Failed subprocess stops without replay and closes its log.
43. Timed-out subprocess receives termination without replay; timers are cleared.
44. Result files outside the stage directory are not loaded.
45. Spawn errors propagate without replay and still close the log.
46. Zig 0.15.2 assembly of the test fixture matching its shipped bytes.
47. Session-tools page staging rejects out-of-bounds page indices.
48. Session-tools batching rejects overlapping or empty session ranges.
49. Session-tools bulk upload rejects mismatched lengths and zero-page requests.
50. Verify-proof accepts valid saved-byte proofs and rejects stale digests.
51. Verify-proof rejects truncated proof data and failed-status proofs.
52. Cache-address-plan rejects NUL bytes in UTF-8 plan encoding.
53. Signed-cache-plan rejects invalid target, storage and period values.
54. Signed-cache-plan validates complete planner output structure.
55. Lower-window rejects misaligned pointer values.
56. Retained-memory blocks mutations on unresolved prior state.
57. Retained-memory rejects stale, promoted and unready capture requests.
58. Retained-memory NR-15: short repeated metadata capture accepted upstream, rejected by workspace verifier.
59. Worker frame builder rejects unaligned base/SDK addresses and invalid call counts.
60. Worker frame builder requires exactly four arguments per call.
61. Worker frame builder rejects functions outside the qualified SDK range and validates SENTINEL.
62. RPC memory transfer validation rejects invalid address, excessive length and non-Buffer writes.
63. Pipeline uses exclusive file writes, restrictive permissions and tracks stage status without replay.
64. Acquire uses exclusive logs, a 10-minute deadline and rejects uncertain retire states.
65. Run entrypoint filters internal and link-local IPv4 addresses.
66. Run entrypoint rejects invalid arguments and uses restrictive workspace permissions.
67. Qualify checks SDK mapping size, permissions, attributes, random challenge, alignment and width.
68. Pool bounds require non-empty links and reject invalid seed alignment.
69. Pool bounds with seed constrain candidates to valid containing allocations.
70. Bind-notifier requires unique idle session with matching wait/receive and closes probe handles.
71. Process qualify checks SmileBASIC and FS identity, RX permissions, nonce challenge and unmapping.
72. Path descriptors validate count, size and encode address bits.
73. Native link finder requires matching hashes and sorts by evidence strength.
74. Memory endpoint has reply limit, timeout and hash verification.
75. FS memory interface validates canonical addresses and enforces read/write caps.
76. FS memory pointer chase limits depth and detects list cycles.
77. FS root PID promotion tracks per-field writes and rolls back on failure.
78. Cleanup-scratch uses restrictive file operations.
79. Upstream test.cjs covers host bytes and TCP only.
80. Bootstrap.bas verifies discovered addresses and SDK CRC before network.
81. App session bounds-checks owned memory reads and uses restrictive file modes.
82. App worker verifies all 11 SDK entry-point signatures.
83. App events check pointer alignment and refuse finalize with active threads.
84. App domain tracks moved/copied handles and rejects transport failures.
85. App RPC validates function alignment and batch size bounds.
86. App filesystem enforces read-only commands and path validation.
87. App map caps at 4,096 regions and uses restrictive file mode.
88. Native worker validates frame bounds, alignment and SENTINEL gate.
89. App qualify cleans up in finally and verifies transfer hash.
90. App timing checks unique mapping size and exact frequency constants.
91. App affinity requires single-bit mask within process allowance.
92. Bulk transfer validates span within session allocation.
93. Inspect mounts caps list traversal and detects cycles.
94. Mounted-save checks session identity and manager state constants.
95. Memory capture-workers and remaining memory modules use structural guards.
96. All remaining JSON assets have valid instruction encodings.
97. Upstream README documents the correct platform and entry point.
98. App session bounds-checks owned memory reads and uses restrictive file modes.

Local run: **97 pass, 1 expected failure (zig rebuild requires zig binary), zero skips/errors**. Four additional
offline regression tests exercise the audit validator itself, including
corrupt internal hashes despite a recomputed outer manifest, wrong/dirty source
trees, and symlink rejection. The normal CI build gate repeats the pinned audit
on Linux and preserves its JSON alongside build results. This adds coverage;
it does not turn static concerns or device-only assumptions into passing tests.

## Observations requiring follow-up

### NR-01 — Kernel-supplied metadata is a trust assumption

Native memory scanning and alias operations rely on kernel-provided process
IDs, memory ranges, mapping semantics, receive buffers and permissions. The
arithmetic is bounded for the expected platform address space, but that kernel
contract has not been exercised here. The manifest's policy hash also refers
to a console-derived policy file; agreeing with the shipped image does not
independently establish agreement with the intended console's policy.

Status: **requires target evidence**, not an established vulnerability. Do not
generalize the source's firmware/layout assumptions to other releases.

### NR-02 — Unsupported handle descriptors need ownership confirmation

The proof server supports one copied handle plus an optional PID descriptor.
Unsupported special-header layouts invalidate the request before storing a
handle for its explicit cleanup. Whether additional transferred handles could
remain owned after such a rejected request depends on target IPC semantics.

Status: **source-level cleanup concern, not reproduced on hardware**. No
malformed request was sent to a console. The service should be treated as a
cooperating-client proof component, not as a hardened untrusted-client server.

### NR-03 — Restoration is conditional, not transactional

Native code changes and permission/map operations can take effect before a
later operation returns an error. Some rollback attempts have separately
reported failure results. The host deliberately leaves a timed-out worker
pending and avoids further IPC; FS restoration runs only when the relevant
change was recorded and no request remains pending. A failed or lost transport
therefore cannot be converted into a guarantee that the old instructions,
permissions or aliases were restored.

Status: **documented recovery limitation requiring fault/device validation**.
Preserve evidence and follow verified upstream recovery guidance. Do not retry
mutating operations simply to obtain a green report.

### NR-04 — Verification is not an adversarial-host guarantee

The loopback bridge and per-run token limit access from other peers; launch
records use restrictive file modes. A compromised host/user can still alter
records, observe secrets, or modify the target after a signature check. Source
hashes and PID checks are useful evidence but not remote attestation.

Status: **threat-model boundary**, not a new security guarantee.

### NR-05 — Execution proof and cleanup are different evidence

The probe marks its challenge evidence verified before closing the acquired
service handle. Its catch path preserves the error but does not close that
handle; it also avoids issuing more IPC to a timed-out worker. Therefore a
failed identity/challenge check can leave an owned handle, and a saved
`verified: true` does not by itself establish successful cleanup. The new
host-only probe scenarios confirm that rejected replies are not verified and
that those error paths do not issue a close request. They do not establish
kernel ownership or the safety of attempting cleanup after a pending request.

Activation similarly records pending steps before starting the replacement
and terminating the original process. There is no automatic rollback if the
second operation fails after the first succeeds. Handoff checks saved session
pointers, receive handles, state and a joined worker, but they are observations
at one point in time rather than a transaction or recovery guarantee. Neither
activation nor handoff was executed during this review.

Status: **source-backed lifecycle limitation, not a reproduced device fault**.
Consumers must retain the full proof, error, pending and close fields rather
than interpreting a single verification flag as successful restoration.

### NR-06 — Unparked does not establish completed restoration

The event-backed gate restores the wait word and sets `parked = false` before
checking the signal result or observing retirement of the old wait snapshot.
Grouped restoration also clears the parked flags before signaling. A signal
failure can therefore leave a gate marked unparked without a `restoration`
record. A mock verifies this exact single-gate failure path, including the
issued write and absence of retirement evidence. Other mocks verify refusal
before writes for changed identity fields, unsettled/selected sessions and
incompatible grouped gates. These are host state-machine observations, not
proof that the kernel wait state has changed or can safely be retried.

Status: **source-backed evidence limitation**. Preserve errors and require the
explicit retirement evidence; do not treat `parked: false` as a recovery test.

### NR-07 — Captured domain lookup uses a partial search window

The layout finder requires a declared domain capacity of `0x4000` but searches
only `0x4000` bytes of 0x30-byte entries: 341 complete entries, not all 16,384
declared slots. A synthetic capture locates a matching entry at index zero,
then fails discovery when the same entry is moved to index 512 while still
inside the supplied capture. This establishes a search-window limitation, not
a universal failure on the intended firmware or a reason to change the scan
without target evidence. Live identity checks are separate and do reject
changed manager, entry, domain and object fields in the mock.

Status: **host-reproduced discovery limitation**. A missing/ambiguous root is
not evidence that the entire domain table was inspected or no root exists.

### NR-08 — Persistence and cleanup share failure paths

The launch path exchanges two existing references with an explicit rollback
attempt if the second write fails. It does not promise rollback after every
later readback or persistence failure. Its `finally` block saves the outstanding
step before invoking gate restoration; a failed save can prevent that restore
call. A later restore error can also replace the primary exception. These
ordering observations come from static source review; the launch path and
filesystem fault injection were not executed here.

Status: **source-backed failure-ordering concern, not a reproduced device
fault**. The complete saved exchange/write/rollback/restoration fields and
transport state are necessary when interpreting a failed run. Successful host
parser checks do not establish transactional recovery.

### NR-09 — Temporary substitutions have conditional rollback coverage

Both the notifier export and Loader-root copy perform their initial substitution
before entering the `try/finally` that restores it. A rejected first write does
not enter that cleanup block. Whether a write failure means no target mutation
occurred depends on the lower transport/write contract and failure timing;
this review does not assume that a lost reply proves no effect.

The export mocks confirm rejection before writes for invalid handles, stale
identity and a changed notifier backend. A successful request and an injected
request failure both attempt the reverse substitution. Injected first-write
and restoration-write failures leave the saved `restored` flag false; a
first-write failure makes no second write attempt. These mocks record calls
and evidence only; they neither change target memory nor reproduce a console
transport fault. The root-copy command was statically reviewed, not executed.

Status: **host-reproduced cleanup ordering, with unresolved target effect**.
Do not retry the temporary substitution or infer restoration from an exception
alone. The original slot/readback and reference-count evidence remain necessary.

### NR-10 — Session records are local evidence, not authenticated objects

The binding command checks a bounded captured-heap session pool, two unique
domain bindings, idle state, wait/receive equality, bounded domain object IDs,
live owner/object pointers and matching adapter metadata/vtables. These checks
depend on current capture/proof records and the lower memory interface; they
are not an independent attestation of the target. Later consumers must retain
their own live identity checks rather than treating a saved binding as durable.

Unlike several neighboring proof writers, its bound-session and filesystem-type
JSON writes do not request an explicit file mode. Creation therefore depends
on the host's umask/defaults and any existing file permissions. These records
contain addresses and raw object/session headers. No real records or memory
dumps were published in this review, and the host umask was not changed.

Status: **static local-evidence/permissions boundary**. Handle ownership,
reference-count changes and real session concurrency still require target
evidence; passing the notifier mocks cannot establish those properties.

### NR-11 — Cache lifecycle checks do not guarantee remount or cleanup

The cache unmount helper checks the live mount name and both self-linked open
file/directory lists before writing its scratch name or invoking the SDK. Mocked
missing, renamed and busy mounts make neither call. A failed SDK result is
recorded and rejected; success alone does not remount the cache. The mount
helper records its SDK result before refreshing through a subprocess, so a
refresh failure can occur after successful remount. No subprocess or SDK code
was executed in these mocks. The helper does not close borrowed handles.

The memory session initializer calls cleanup on initialization/tool-install
failure, but a cleanup exception can replace the original failure. This is a
static observation; the transitive session implementation remains outside this
increment's review. SDK JSON offsets and signature lengths are structurally
checked; its declared digest is not independently bound to a device SDK image.

Status: **host-reproduced pre-call rejection and result-recording order; no
device recovery claim**. The enclosing runner's complete restoration behavior
still requires review and independent target evidence.

### NR-12 — Candidate recognition and protocol parsing have limited authority

The cache-tail predicate requires exactly 0x5a0 bytes and accepts zero unused
space or narrowly recognized pathname residue. Tests reject unknown bytes,
wrong lengths and nonzero data after termination. The link scanner filters
aligned 39-bit candidates near its seed, but returns nonzero-tail candidates
with `zeroTail: false`; a candidate is not proof of a valid mapping or owner.

CMIF tests reject out-of-width descriptors, unsupported modes, excessive
descriptor counts, oversized payloads, truncated replies and missing reply
magic. The reply parser does not enforce the raw-data length advertised in the
header and returns the remaining buffer after the CMIF prefix. Thus these
checks are not comprehensive wire validation. Copies in outgoing packets are
coerced to unsigned 32-bit values, not independently authenticated handles.
Malformed frames may raise generic Buffer range errors rather than a protocol
error. No target packets were sent.

Status: **host-checked structural boundaries, not complete protocol validation**.
The six added checks cover SDK declarations, descriptor/packet rejection,
reply rejection, tail recognition, link filtering and mocked cache unmount.
They neither execute generated instructions nor establish protocol ABI validity.

### NR-13 — Foreign worker cancellation and launch discard contain mutation windows

Worker cancellation exercises `CancelSynchronization` across seven worker handles
in batch. While the host requires exactly seven unique handles and pre-recorded
thread-ID confirmations before issuing the batch, the foreign cancellation syscall
cannot ensure target threads have transitioned to an idle state before subsequent
commands proceed. A nonzero cancellation result is rejected by the dispatcher.

Similarly, the launch discard helper safely overwrites a prepared, unreleased
helper launch with a read-only application-PID query (`packet(6)`). If the launch
was already released (`worker.released === true`) or has unexpected flags, discard
is rejected and the helper cannot recall the mutating IPC.

Status: **host-reproduced guard checks, with timing/concurrency limitations on target**.
Foreign thread cancellation and launch overwrites depend on target kernel scheduling.

### NR-14 — Temporary locator and donor filesystem lifecycles enforce local cleanup but lack transactional rollback

`locator-open` wraps domain conversion in a `try/catch` block that explicitly
closes the temporary clone handle and purges it from `state.domainCopies` on error.
Likewise, `donor-cleanup` guarantees the closure of the cloned temporary filesystem
handle in a `finally` block even if file deletion fails, and `code-close` prevents
closing the primary binding or an active domain root.

However, if a donor file write fails partway through its 64KB chunks during
`donor-prepare`, the temporary storage file remains written on disk until application
restart. Local cleanup of handles and state does not guarantee that mutated persistent
storage on the target is rolled back transactionally.

Status: **host-verified local cleanup guarantees; device storage rollback remains conditional**.
Retain all proof logs and error records rather than assuming transactional rollback.

### NR-15 — Repeated metadata capture does not require full-length repeat

The upstream `retained-memory.cjs` accepts a repeated metadata capture that is
shorter than the requested byte length. Its anchor-matching check uses
`bytes.subarray(anchorOffset, anchorOffset + anchor.length).equals(anchor)`,
which succeeds if the anchor fits within the returned (shorter) buffer. The
workspace verifier `scripts/verify-retained-capture.cjs` rejects this:
`assert.equal(bytes.length, entry.length, 'Repeated capture is shorter or
longer than requested')`. Check 58 reproduces this divergence with a 16-byte
third reply where 32 bytes were requested: upstream accepts, workspace rejects.

This is not necessarily a vulnerability — the upstream code may intentionally
tolerate short reads from the kernel — but the divergence means the workspace
verifier is stricter than the upstream implementation. A short capture passing
upstream does not guarantee the full anchor region was captured.

Status: **host-reproduced upstream/workspace divergence**. The workspace
verifier's stricter check is retained. This does not establish a device fault
or a recovery failure; it documents that the upstream repeat-capture acceptance
criterion differs from the workspace's length-exact requirement.

Earlier local validation on October 27, 2026: 36/36 native audit checks and 28/28 host
regression tests passed; compatibility exports validated. Desktop browser controls
pass for Chromium and WebKit, but Firefox fails at process launch with
`Could not find profile folder` (12/13 browser subtests pass). This is recorded
as a local browser failure, not silently skipped or counted as console evidence.
CI results must be reported separately for the pushed revision.

## Domain/stage and asset follow-up

The current native audit records 98 checks across all 95 tracked files
(9,128 lines), 97 passing (1 expected failure: zig rebuild requires zig binary). All stage-process and filesystem operations in the ten
checks are deterministic mocks: no subprocess stage or console is launched.
The stage helper restricts names, uses exclusive mode-0600 logs, propagates
failure/timeouts without replay, and closes logs in `finally`. Its accepted
result is still local JSON, without schema validation, cryptographic identity
or protection from same-directory symlink substitution by a compromised host.
The directory restriction is not a general untrusted-filesystem sandbox.

Domain framing checks establish structural bounds, not service authenticity,
handle ownership or correctness of the target ABI. Successful-reply object
extents are checked; failed service results do not confer object validity.
Callers remain responsible for interpreting the service result.

`scripts/review-native-assets.cjs` separately checks all 11 pinned engine JSON
assets, including 56 instruction-byte declarations. All 11 pass local encoding,
alignment, declared-length and locally bound digest checks. Four digest fields
have no same-object byte string to bind to and remain explicitly unverified.
Captured SDK provenance, instruction semantics and device compatibility are
not established. These structural checks do not add the assets to the complete
text-file walkthrough or count as console execution.

## Reproduce without a console

```sh
REVISION=95f5525089273c5fce0b95047f3600f8442e96ae
git init /tmp/ns2jb-native-review
git -C /tmp/ns2jb-native-review fetch --depth=1 https://gitlab.com/pepsipu/ns2jb.git "$REVISION"
git -C /tmp/ns2jb-native-review checkout --detach FETCH_HEAD
bash scripts/install-zig.sh "$PWD/.tools/native-review-zig"
node scripts/review-native.cjs /tmp/ns2jb-native-review results/native-review.json "$PWD/.tools/native-review-zig/zig"
npm ci --ignore-scripts
node scripts/validate-results.cjs results/native-review.json
```

Use a new scratch directory and compiler destination for each clean
reproduction. Failed audit assertions produce nonzero exit status and remain
visible in the JSON output; source-identity failures stop before module import.

## Remaining coverage and completion gates

All 95 tracked upstream files now have a recorded walkthrough entry and SHA256
in the audit report. This is file-level coverage, not path-level or
branch-level coverage of every conditional. The code above assumes a particular
system-call ABI; examining register moves or reproducing bytes is not execution
on that ABI.

Independent target-browser access/capture, console execution and recovery
validation also remain open. Consequently Phase 4 and the overall goal remain
incomplete. See `phase-status.md`; no unchecked requirement was removed to
declare completion.
