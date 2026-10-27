# Phase 4 — Native payload and interface review

Reviewed October 27, 2026 against upstream revision
`95f5525089273c5fce0b95047f3600f8442e96ae`.

This is a static walkthrough of the core native payload and selected host
interfaces, with executable host-side rejection checks. It is not a complete
review of every native-code generator in the chain, formal verification,
proof of console compatibility, or independent hardware reproduction.

## Coverage and source identity

The walkthrough covered these 20 complete text files (1,946 lines including
comments and manifest data). The audit report records each file's SHA256 and
line count. These identify the reviewed sources, not the correctness of them.

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

The report contains 23 separately accounted checks:

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
23. Zig 0.15.2 assembly of the test fixture matching its shipped bytes.

Local run: **23 pass, zero failures, zero skips/errors**. Four additional
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

The generated instruction JSON assets, retained-memory/cache orchestration,
loader/session operations and their complete transitive protocol paths are not
claimed as comprehensively reviewed by this subset. They remain in Phase 4's
review scope. The code above assumes a particular system-call ABI; examining
register moves or reproducing bytes is not execution on that ABI.

Independent target-browser access/capture, console execution and recovery
validation also remain open. Consequently Phase 4 and the overall goal remain
incomplete. See `phase-status.md`; no unchecked requirement was removed to
declare completion.
