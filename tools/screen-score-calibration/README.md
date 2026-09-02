# Screen Score Calibration Harness

## NON-PRODUCTION

This is calibration tooling only. It is **not used by the Figma plugin**, does not modify Screen Audit behavior, and does not expose a Screen Score to users. Parameters are **UNLOCKED**.

## Formula

The candidate V1 family is Mean + Worst:

```text
B = mean(scores)
W = min(scores)
S_raw = (1 - lambda) * B + lambda * W
S = round(clamp(S_raw, 0, 100))
```

The harness accepts only contextual numeric scores from 0 to 100. Severity, issue count, Local/Nube provenance, and text content are not mathematical inputs.

Candidate lambdas: `0.20`, `0.25`, `0.30`, `0.35`, `0.40`, `0.45`.

Candidate status threshold pairs are `80/60`, `85/65`, `85/70`, and `90/70` where the first number is high and the second is low. No candidate is a production default.

## Commands

```bash
npm run screen-score:synthetic
npm run screen-score:invariants
npm run screen-score:calibrate -- --input path/to/corpus.json --output report.json
npm run screen-score:corpus -- --output corpus-manifest.json
```

Synthetic-only output always reports `PARAMETER DECISION: INSUFFICIENT EVIDENCE`.

`screen-score:corpus` validates anonymized current-complete records, derives count/risk strata, reports privacy exclusions and flags repeated score distributions as `POSSIBLE_DUPLICATE`. It does not read Figma files or source mappings.

## Input schema

See `corpus.schema.json`. Minimal input:

```json
{
  "corpus_version": "exploratory-1",
  "screens": [
    {
      "screen_id": "screen-001",
      "screen_archetype": "form",
      "contextual_scores": [100, 94, 63]
    }
  ]
}
```

Expert fields are optional and support numeric ratings, status votes, confidence, disagreement flags, adjudicated status, and notes. The harness does not require raw copy.

## Outputs

Reports include deterministic case results, all lambda candidates, all threshold evaluations, asymptotic rows, duplication analysis, perturbation analysis, and optional expert metrics. Canonical JSON omits timestamps and machine-specific paths. Use a separate externally managed timestamp if needed.

## Limitations

Synthetic cases are behavioral guardrails, not human truth. No production lambda, status band, or severity guardrail is selected here. Rank correlation and adjudication workflows remain calibration-stage work if they are needed after the expert corpus is available.
