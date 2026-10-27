# P3 — Security boundaries and evidence limits

## Scope

This workspace observes documented upstream state and runtime capabilities.
It does not provide a browser exploit, sandbox escape, kernel access, custom
firmware, or persistence. A complete security audit has not been performed.

## Boundaries

| Observation | What it establishes | What it does not establish |
| --- | --- | --- |
| API property exists | A name is exposed in this context | Successful use, permission, or privilege |
| JavaScript or WebAssembly runs | Code executes within the current runtime | Native execution outside the sandbox |
| Storage API exists | Runtime exposes a storage interface | Access to arbitrary files or another origin |
| Cross-origin isolation flag | Reported state of this page | A sandbox escape or vulnerability |
| Host test passes | Expected behavior on that host | Console compatibility or exploit reliability |
| Checksum matches | File agrees with the supplied manifest | Author authenticity or safety of the code |

## Harness limitations

- The synthetic VM regression test verifies shared classic-script loading and
  output accounting only. It is not a browser or WebKit implementation.
- API-presence checks do not test permission prompts, policy enforcement, or
  successful asynchronous operations. No adversarial bypass is attempted.
- Missing browser APIs on Node.js are observations, not security failures.
- Some syntax is parsed before detection runs. Missing exports must remain
  visibly incomplete rather than being silently treated as successful tests.
- The harness uses deliberate recursion and memory allocation; a caught error
  on a desktop host does not guarantee safe behavior on a constrained device.
- Exported user-agent, platform, and manually recorded firmware are descriptive,
  not authenticated device identity. Review exported evidence before sharing.
- Upstream downloads and manifests share a trust source. Review downloaded code
  before execution; successful host tests are not a source-code security audit.

## Next evidence required

Capture a desktop-browser control and, only if browser access is actually
available, a separate target-browser run with exact firmware and page context.
Repeat observations and preserve raw JSON. Review policy enforcement separately
from API exposure. Hardware execution and payload rebuild remain outstanding.
