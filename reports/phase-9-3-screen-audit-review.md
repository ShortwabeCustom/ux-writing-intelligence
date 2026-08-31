# FASE 9.3 — Screen Audit Review & Navigation

## Architecture

Screen Audit keeps one canonical in-memory session in MAIN. The UI receives
serializable session snapshots and sends `SCREEN_AUDIT_NAVIGATE_TO_ITEM` with
only the session and candidate identifiers. MAIN remains the sole owner of
Figma node lookup, selection, and viewport focus.

Review derivation lives in pure functions in `src/screen-audit-review.ts`.
Counts and filters reuse the existing result severity: `low` is **Buen nivel**;
`medium` and `high` need attention. Unresolved, changed, stale, and unavailable
items also need attention. No screen-level score is calculated.

### Selection contract

- Audited Frame selected: preserve the Screen Audit session.
- Any TextNode or other SceneNode descendant selected: preserve the session.
- Multiple selected descendants of the same audited Frame: preserve the session.
- Different Frame, outside node, or mixed inside/outside selection: invalidate.
- Empty selection: invalidate.
- Page change: invalidates because the current selection no longer belongs to
  the audited Frame.
- Deleted audited Frame: close the MAIN session and disable review navigation
  with a clear unavailable state in the UI.

The policy walks the actual ancestor chain. It does not use an
`ignoreNextSelectionChange` flag.

## Navigation behavior

MAIN validates the active session, re-fetches the Frame and candidate with
`figma.getNodeByIdAsync`, confirms the candidate is a TextNode descendant, then
selects it and calls `figma.viewport.scrollAndZoomIntoView`. It does not load
fonts or mutate the document.

Text equality is revalidated at navigation time. Changed text remains
navigable but is presented as changed since the audit. Missing, deleted,
incompatible, or moved candidates are marked unavailable without invalidating
the other results. Previous and Next operate only on the current filtered set,
do not wrap, and use native disabled buttons at the boundaries.

## Files changed

- `src/code.ts`
- `src/screen-audit-review.ts`
- `src/screen-audit-selection.ts`
- `src/shared/messages.ts`
- `src/shared/main-to-ui.ts`
- `src/ui.ts`
- `ui/ui.html`
- `ui/styles.css`
- `tests/screen-audit-review.test.mjs`
- `tests/screen-audit-execution.test.mjs`
- `tests/message-contracts.test.mjs`
- `tests/e2e/screen-audit.spec.ts`

## Automated QA

- Unit: 339/339 PASS
- Typecheck: PASS
- Build: PASS
- Playwright: 76/76 PASS
- Review navigation analysis requests: 0
- Review navigation provenance mutations: 0
- Document mutations: 0
- Manifest and plugin ID changes: 0
- Backend changes: 0
- Runtime source changes: 0

The MAIN integration harness records calls to the analysis endpoint, selected
nodes, viewport calls, and source characters. The DOM harness runs the real
`dist/ui.html` and verifies summary, filters, active state, navigation message,
Previous/Next, stale/deleted copy, immutable provenance, interrupted-audit
copy, and absence of a global Screen Score.

## Native Figma smoke

Not executed. Figma Desktop and the test Frame were available, but macOS
required an explicit Accessibility/System Events permission before automated
desktop interaction. No system permission was granted automatically.

## Known limitations

- Native Figma tests A–F remain required before the release gate can be GO.
- Review state is intentionally in-memory and scoped to the current plugin
  session.
- Navigation does not wrap from the last item to the first.
- Review never reanalyzes changed or unavailable content automatically.

## Commit

`feat: add screen audit review navigation` (hash recorded in the release
output after the checkpoint is created).
