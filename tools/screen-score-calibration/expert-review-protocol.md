# Expert review instrument protocol

Protocol version: `1`

## Blind condition

Primary condition: `SCREEN_ONLY`.

Reviewers see a redacted screen representation and anonymized `SCR-###`. They do not see contextual numeric scores, Screen Score candidates, lambda, thresholds, formula, or calculated status. A later diagnostic condition may show non-numeric findings only and must be recorded separately as `SCREEN_PLUS_FINDINGS`.

## Response fields

```text
reviewer_id: EXP-###
screen_id: SCR-###
numeric_quality_0_100: 0..100
categorical_status: Buen nivel | Necesita atención | Requiere revisión
weakest_copy_risk: optional short reference
confidence_1_5: 1..5
optional_rationale: optional
```

Do not store reviewer names, emails, or identities with calibration records. Keep any contact mapping outside the dataset.

## Review order and fatigue

Use a deterministic seed per reviewer, with different seeds for each reviewer. Stratify blocks so no reviewer starts with only high or low quality screens. Review 40 screens in two blocks of 20 or four blocks of 10. Target 20–30 minutes per block; pause before 45–60 minutes.

Pilot five screens first: high, medium, low, severe outlier, and dense. Pilot responses remain separate until the protocol is confirmed unchanged.

## Aggregation

Numeric reference: median. Categorical reference: majority. Confidence: median plus distribution. No categorical majority, low confidence, or wide numeric disagreement marks `ambiguous_calibration_case: true`; do not optimize parameters against that case automatically.

## Guard against anchoring

Do not mention the formula, model, score bands, outliers, expected outcomes, or candidate lambdas. Do not include `63/100`, `100/100`, `72/100`, or any other model-generated score in reviewer material.
