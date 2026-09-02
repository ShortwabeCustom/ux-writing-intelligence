# FASE 10A.3A — Real calibration corpus preparation

## Status

`screen-score-calibration-exploratory-v1` is a preparation contract, not a gold set, production dataset, or final corpus. The repository currently contains no eligible real Screen Audit export. Therefore the committed manifest records `0` eligible screens and does not fabricate records or scores.

The target is 40 screens, with an acceptable exploratory range of 30–50.

## Source and privacy rules

Preferred sources are private Figma research/design files or explicitly exported complete Screen Audit sessions. Do not scrape unrelated customer data. Each candidate is classified before inclusion:

- `SAFE`: no PII, secrets, financial identifiers, or private operational data.
- `REDACTION_REQUIRED`: useful after removing identifying content; only the redacted artifact may enter the study.
- `EXCLUDE`: cannot be safely redacted.

Source-to-`SCR-###` mapping stays outside Git and outside both datasets. Raw copy is not required for mathematical calibration. Expert review material may contain a redacted screenshot or equivalent visual context, but never model scores, lambda, threshold, or formula.

## Sampling plan

Primary archetype is exactly one per screen, even when other characteristics overlap.

| Primary archetype | Target |
|---|---:|
| form | 6 |
| onboarding / setup | 5 |
| transactional | 6 |
| confirmation / success | 4 |
| errors / blockers | 4 |
| empty states | 3 |
| informational | 4 |
| decision / selection | 4 |
| dense / complex content | 4 |
| **Total** | **40** |

Text-count targets: `small` 8, `medium` 14, `large` 12, `very_large` 6. Worst-score targets are at least 5 per range (`0–20`, `21–40`, `41–60`, `61–80`, `81–100`) where available. Underfilled strata are reported as `CORPUS COVERAGE GAP`, never fabricated.

Include uniform high, uniform medium, uniform weak, one severe outlier, several moderate outliers, high mean with severe minimum, medium uniform, and low mean with one strong result.

## Eligibility

Only a complete current Screen Audit is eligible:

- `ready_count > 0`;
- `analyzed_success_count == ready_count`;
- no stale result;
- no deleted ready node;
- current Frame and context are still represented;
- compatible scoring contract is recorded.

Historical snapshots are excluded until explicitly re-audited. The mathematical record stores normalized contextual scores and metadata, not customer copy.

## Expert study protocol

Primary condition: **SCREEN ONLY**. Experts judge actual screen content without contextual scores or model-generated numeric values, avoiding anchoring. A secondary `SCREEN_PLUS_FINDINGS` condition may be used diagnostically later, recorded separately, and must hide numeric scores.

Minimum exploratory panel: 3 UX Writing/Content Design experts. Preferred: 5–7. This is product calibration coverage, not statistical proof.

Pilot: 5 screens, including high, medium, low, severe-outlier, and dense. Do not merge pilot responses into the study unless instructions and protocol remain unchanged.

Full study: 40 screens in two blocks of 20 or four blocks of 10. Target 20–30 minutes per block and no session above 45–60 minutes. Each reviewer receives a deterministic different order using a documented seed.

Reviewer instruction:

> Evalúa la calidad del contenido UX Writing de esta pantalla. Considera si los textos son claros, útiles, concisos, predecibles, correctos y coherentes con su contexto. No evalúes diseño visual, accesibilidad, conversión ni usabilidad general. Asigna un valor de 0 a 100, selecciona un estado y marca tu confianza.

Questionnaire fields: `screen_id`, numeric quality `0–100`, categorical status, optional weakest-copy reference, confidence `1–5`, and optional rationale.

## Outputs and version freeze

The harness evaluates all six lambdas and all four threshold pairs. It must not expose them to reviewers or select a winner. Synthetic-only and unlabelled corpus runs remain `INSUFFICIENT EVIDENCE`.

Once accepted, corrections create `screen-score-calibration-exploratory-v1.1` rather than silently modifying v1. Keep a decision record with corpus version, expert panel, metrics, rejected candidates, trade-offs, date, and approver.

Known current gap: no complete, current, privacy-classified real Screen Audit records are available in this repository.
