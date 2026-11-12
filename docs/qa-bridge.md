# QA bridge — evaluable contract (disabled, not injected)

Status: **proposal only**. Nothing is registered in the daemon, in the agent
tool catalog, or in the UI. The bridge is disabled by default and no QA plugin
is loaded, imported, installed or called.

## Purpose

The assistant already has browser, profile, connector and approval paths. The
QA Reproduction Assistant adds the missing QA workflow: cycle → candidates →
ordered steps → duplicate check → evidence → draft. This contract defines the
smallest read-only seam that can be reviewed before any of that is exposed.

## Scope of this change

- `packages/daemon/src/qa-bridge.ts`: five read-only tools (`qa_estado`,
  `qa_scan`, `qa_disponibles`, `qa_duplicados`, `qa_pasos`), an injectable
  backend and an off-by-default config object.
- `packages/daemon/test/qa-bridge.test.ts`: disabled, passive-only, forbidden
  tool, missing backend and invalid-result cases.
- `docs/qa-bridge.md`: this document.

The module is **not imported by the daemon**. There is no tool registration,
no config parser change and no UI change in this step.

## Deliberately out of scope

- `reserve_bug`, `release_bug`, `browser_action`, `draft_bug_report` and any
  submission;
- reading SQLite, CDP, Test IO/uTest, evidence files or the QA plugin;
- opening a socket, spawning a child process or contacting the network;
- enabling the bridge or installing the QA Reproduction Assistant.

## Security

- `activa` must be exactly `true`; otherwise every call fails with
  `UNAVAILABLE` before the backend is touched.
- `modo` must be `passive`; `guided` and `full` are rejected in this phase.
- The backend is chosen by configuration, never by model text.
- A backend result must be a plain object; arrays and raw HTML are rejected.
- The existing native approval path remains the only route for side effects.

## Acceptance criteria

1. The default state is inactive and the backend is never called.
2. Active + passive calls the matching backend method exactly once.
3. `qa_estado` works without a backend.
4. Write, navigation and submission tools return `DENIED` without a backend call.
5. `modo: "full"` returns `DENIED`.
6. Missing backend returns `UNAVAILABLE`; a non-object result returns
   `INVALID_INPUT`.
7. The daemon does not register any of these tools in this change.

## Evaluation questions

- Is the five-tool read-only seam enough for the first integration?
- Should the real backend be a loopback JSON-RPC service, a child process or a
  connector?
- Where should drafts live: the assistant data directory or the QA assistant's?
- May `qa_scan` touch the network, or only read a previously stored snapshot?

## Phase 2 — read-only JSON adapter

`packages/daemon/src/qa-bridge-readonly.ts` implements the contract's backend
against one local JSON snapshot chosen by the caller:

- `qa_scan` returns the snapshot's cycle, bugs and generation time.
- `qa_disponibles` returns its `available` candidates.
- `qa_duplicados` ranks local title similarity with a deterministic Jaccard
  score; it never decides that something is a duplicate.
- `qa_pasos` returns the stored steps, actual and expected result for one bug.

It reads only that file. It does not open SQLite, CDP, Test IO/uTest, the QA
plugin, profiles or the network, and it never writes. The module is still not
imported by the daemon and the bridge remains off by default. The sample is
`packages/daemon/test/fixtures/qa-bridge-sample.json`; tests use a temporary
malformed file to prove errors are not returned as data.

## Next phases (only after approval)

1. Review this adapter and decide the real read-only source.
2. Local drafts with the existing approval dialog; no submission.
3. Browser/reservation actions one at a time, each with its own scope and tests.
