# FASE 10A.3B — Expert study instrument

Protocol version: `expert-study-protocol-v1`

## Primary condition

`SCREEN_ONLY`.

Show the anonymized screen image and a short neutral task/context brief only when the screen cannot be interpreted without it. The brief describes what the screen permits, not what is wrong. Do not show contextual scores, Screen Score, lambda, thresholds, formula, means, minima, candidate status, rankings, or model-generated numbers.

Recommended neutral brief example:

> Esta pantalla permite a la persona seleccionar desde qué cuenta desea realizar una operación.

The brief is optional per screen and must be marked in the asset manifest. The primary condition remains the screen itself plus neutral context when necessary for ecological validity.

## Reviewer instructions

> Evalúa únicamente la calidad del contenido UX Writing de esta pantalla.
>
> Considera si los textos permiten comprender qué está ocurriendo, qué debe hacer la persona, qué puede esperar y cómo continuar. Considera claridad, utilidad, concisión, predictibilidad, corrección y adecuación al contexto.
>
> No evalúes la estética visual, accesibilidad, facilidad general de uso, atractivo de la interfaz, viabilidad técnica ni conversión.

Read once before each block, not repeated in a way that anchors each screen.

## Per-screen unit

```text
SCREEN
[redacted image, fixed viewport/crop]
[optional neutral context]

Q1. Pensando únicamente en el contenido de esta pantalla, ¿en qué estado la clasificarías?
- Buen nivel
- Necesita atención
- Requiere revisión

Q2. En una escala de 0 a 100, ¿qué tan buena consideras la calidad del contenido UX Writing de esta pantalla?
[required integer 0..100]

Q3. ¿Hay algún texto de esta pantalla que limite especialmente la calidad del contenido?
- No
- Sí
If yes: describe or identify it briefly. Do not require a node name.

Q4. ¿Qué tan seguro/a estás de esta evaluación?
1 Muy poco seguro/a
2 Poco seguro/a
3 Moderadamente seguro/a
4 Seguro/a
5 Muy seguro/a

Q5. Si lo consideras necesario, explica brevemente qué influyó más en tu evaluación. [optional]
```

The order is categorical → numeric → weakest risk → confidence → optional rationale. This reduces numeric anchoring before the independent holistic judgment and avoids forcing a defect search before the global judgment. The pilot must verify this ordering.

## Numeric anchors

These are semantic scale anchors, not model thresholds:

- `0`: El contenido impide o dificulta gravemente entender qué ocurre o cómo continuar.
- `25`: Hay problemas importantes y varios textos requieren revisión.
- `50`: El contenido permite avanzar, pero presenta problemas claros de UX Writing.
- `75`: El contenido funciona bien en general, con oportunidades puntuales.
- `100`: El contenido es excepcionalmente claro, útil, conciso, predecible y adecuado al contexto.

Do not display all anchors on every screen if that creates clutter. Show them in the block instructions or scale help, never alongside model output.

## Qualification and metadata

Minimum exploratory qualification: professional experience in UX Writing, Content Design, or Product Design with substantial content responsibility, plus fluent Spanish/ES-MX comprehension. Preferred: dedicated UX Writer or Content Designer. Do not require one organization or one product domain.

Collect only:

```text
reviewer_id: EXP-###
primary_role
years_experience_band: <2 | 2-5 | 6-10 | 10+
ux_writing_specialist: yes | no
```

Names, emails, contact mappings, and unnecessary demographics remain outside calibration data.

## Pilot

The pilot requires 5 eligible screens and 2 reviewers minimum, preferably 3, with at least one strong UX Writing/Content Design reviewer. Current eligible real corpus is 0, so the pilot cannot begin yet.

Pilot composition:

- one high-quality screen;
- one medium-quality screen;
- one low-quality screen;
- one severe-outlier screen;
- one dense screen.

Pilot success gates:

- instructions understood;
- content, not visual design, drives judgments;
- anchors are understandable;
- three statuses are distinguishable;
- questions are not repetitive;
- review time is acceptable;
- no required field is missing;
- screens render consistently;
- no obvious order anchoring;
- responses export cleanly;
- debrief identifies no material ambiguity.

Pilot responses enter formal calibration only if the protocol remains materially unchanged. Otherwise mark them instrument feedback and review those screens again.

## Blocks and fatigue

Full study: 40 screens in 4 blocks of 10. Target 15–25 minutes per block at 60–90 seconds per screen; complex screens may take up to 2 minutes. Require or suggest a 5-minute break between blocks. Record block and session metadata; do not require a timer.

A duplicated practice screen may be used before the study and must not belong to the calibration corpus. A duplicated calibration screen is not recommended during the pilot unless consistency evidence is needed and the duplicate is excluded from calibration analysis.

## Randomization

Use deterministic stratified ordering. Derive a seed from `reviewer_id + protocol_version`, never source identity. Generate a different order per reviewer while balancing primary archetype, N stratum, quality-pattern metadata, and worst-score stratum across blocks. Store `review_order` and `block`. Do not expose sampling metadata to reviewers.

## Missing and editing policy

Numeric, categorical, confidence, and weakest-risk yes/no are required. Risk detail and rationale are optional. Missing required responses produce `response_complete: false`; never impute them. Reviewers may go backward within the current block, and only the final answer is exported. They never see other reviewers' responses or aggregate feedback.

## Debrief

After the pilot, ask separately from calibration labels:

1. ¿Qué entendiste por “calidad del contenido”?
2. ¿Hubo alguna pregunta confusa?
3. ¿La escala 0–100 fue fácil o difícil?
4. ¿Sentiste que alguna pregunta repetía otra?
5. ¿Qué información te hizo falta?
6. ¿Cuánto esfuerzo te demandó la evaluación?

Inspect numeric-range use, categorical/numeric contradictions, confidence, completion time, and within-reviewer consistency. Do not manually correct responses.

## Blinding audit

Before every pilot run:

```text
BLINDING AUDIT: PASS
```

The asset bundle must contain zero candidate Screen Scores, contextual numeric scores, lambdas, formula text, thresholds, candidate statuses, means, minima, rankings, or model-derived labels. Screenshots may contain only the redacted screen and optional neutral context.

## Study gates

Do not start the full study until all are true:

1. instrument approved;
2. blinding audit passes;
3. five-screen pilot completed;
4. pilot debrief completed;
5. protocol frozen;
6. at least 30 eligible current real screens exist;
7. privacy classification complete;
8. deterministic orders generated;
9. export validated against `expert-review.schema.json`;
10. reviewer panel recruited.
