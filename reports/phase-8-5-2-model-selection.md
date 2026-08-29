# FASE 8.5.2 — Selección de modelo con harness de paridad de producción

Corrida: **2026-08-29**
Crudos: `results/2026-08-29-phase-8-5-2/`
Re-evaluación: `results/2026-08-29-phase-8-5-2/phase-8-5-2-final/`
FASE 8.5.1 se conserva intacta en `reports/phase-8-5-1-benchmark.md`.

---

## Executive Decision

**Modelo recomendado: `qwen3.5:4b` como default del futuro Local AI Runtime.**
**`keep_alive` recomendado: `30m`.**
**Confianza: MEDIA.**
**FASE 8.5.2: GO.**

`qwen3.5:4b` supera a `qwen3.5:9b` en **todas** las dimensiones del orden de
prioridad de STEP 19, no solo en latencia. Ambos modelos terminan con **cero
fallos críticos finales**, pero el 4B llega ahí interviniendo menos, inventando
menos y en la mitad del tiempo.

El resultado más importante de esta fase no es cuál modelo gana. Es que **el
modelo en crudo no es seguro y la capa determinista sí lo hace seguro**:
el 4B pasa 82.3 % en RAW y **100 % en FINAL**; el 9B pasa 77.4 % en RAW y
**100 % en FINAL**. La arquitectura es la que aporta la seguridad, no los pesos.

---

## Hardware

| Campo | Valor |
|---|---|
| Equipo | MacBook Air `Mac16,13` |
| Chip | Apple M4, 10 núcleos (4P + 6E) |
| Memoria unificada | 24 GB |
| Arquitectura | `arm64` |
| macOS | 26.5.2 |
| Ollama | 0.33.0 |

### Limitación de hardware (STEP 25)

**Medido:** M4 / 24 GB, una sola configuración.

**NO medido:** 8 GB, 16 GB, M1, M2, M3, M4 Pro/Max.

Cualquier afirmación sobre esas máquinas es **hipótesis, no medición**. En
particular, la viabilidad del 9B en una Mac de 16 GB y la del 4B en una de 8 GB
siguen sin verificarse. Las cifras de latencia de este reporte **no se
generalizan** a otro silicio.

---

## Method

- 2 modelos candidatos. `qwen3:1.7b` queda como **REFERENCIA / NO SELECCIONADO**
  (STEP 20 de 8.5.2), por la menor calidad y la fuga de tokens de control
  (`/no_think`) documentada en 8.5.1. Sigue instalado; no se ejecutó el suite.
- **62 casos** por modelo: 50 de estrés semántico + 12 de contrato.
- **3 repeticiones warm** por caso → 186 llamadas por modelo.
- 10 llamadas cold representativas por modelo.
- **Total: 392 llamadas de inferencia.**
- Mismo prompt, mismo esquema, `temperature=0`, `seed=42`, `num_ctx=4096`,
  `keep_alive=30m`, `think=false`. Sin ajuste por modelo.
- Salida estructurada forzada por esquema JSON de Ollama (STEP 4), a diferencia
  de 8.5.1, donde deliberadamente no se forzó.
- Secuencial. Sin concurrencia.

### Completitud (STEP 1)

| Métrica | `qwen3.5:4b` | `qwen3.5:9b` |
|---|---:|---:|
| Llamadas | 186 | 186 |
| Casos únicos | 62 | 62 |
| Repeticiones por caso | 3.0 | 3.0 |
| Errores de transporte | **0** | **0** |
| Respuestas estructuradas inválidas | **0** | **0** |
| Reintentos consumidos | **0** | **0** |
| Casos omitidos silenciosamente | **0** | **0** |
| Archivos de resultado corruptos | **0** | **0** |

### Re-evaluación offline

Los evaluadores se corrigieron **a mitad de la corrida** (frontera relativa al
origen, `NO_ADDED_CONTENT` restringido, taxonomía, intervenciones). Para que
ambos modelos se juzgaran con criterio idéntico, **no se repitió la inferencia**:
los runs guardan el JSON crudo de cada modelo, y `reevaluate.py` recalculó RAW y
FINAL sobre esas salidas ya capturadas. Los artefactos originales quedan
intactos; lo re-evaluado vive en `phase-8-5-2-final/`.

---

## Validator Limitations

**Esto es lo primero que hay que leer antes de creerle a cualquier porcentaje
semántico de este reporte.**

Los validadores de `semantic_fidelity.py` son **heurísticos**: familias de
expresiones regulares con conciencia de ventana de negación. No son comprensión
semántica. Están calibrados para **alta precisión, no alto recall**.

Por eso la métrica se llama **"detected semantic pass"** y no
"semantic understanding accuracy":

- un **FAIL** significa que se detectó una violación conocida — casi siempre real;
- un **PASS** significa **únicamente** que ninguna regla detectó violación.
  **No prueba que el significado se haya preservado.**

### Un bug del validador falseó el titular, y se corrigió

En la primera pasada, **ambos** modelos mostraban 3 fallos críticos finales por
`FACT:status`. Al ejecutar el control de auto-consistencia (`validate_cases.py`),
que evalúa cada caso **contra su propio texto de origen**, apareció esto:

```
[CASO INCONSISTENTE] status_03
   origen: 'Guardamos tus cambios.'
   FAIL FACT:status: pierde o cambia el estado del origen (status=saved)
```

El lema era `guardad\w+`, que no captura *"Guardamos"*. **El origen fallaba su
propia expectativa**: era un defecto de la regex, no de los modelos. Corregido,
los tres "críticos finales" de ambos modelos desaparecieron.

Control actual: **62/62 casos auto-consistentes**.

La lección importa más que el bug: sin ese control, un error de regex se habría
reportado como fallo semántico de los modelos. Que haya aparecido uno sugiere que
puede haber otros que el control no cubre. Esto es lo que baja la confianza de
ALTA a MEDIA.

### Alcance conservador deliberado de la ortografía (STEP 12)

Quedan **fuera** de las reglas deterministas los pares acentuales ambiguos:

```
esta / está      mas / más      aun / aún
si / sí          solicito / solicitó      el / él
```

Desambiguarlos exige análisis sintáctico. Un corrector que se equivoque ahí
**cambia el significado**, que es justo lo que esta fase intenta proteger. Se
prefiere no corregir a corregir mal.

### Supuestos heurísticos documentados

| Validador | Supuesto | Riesgo |
|---|---|---|
| `_asserts()` | Una negación dentro de los 45 caracteres previos niega la aserción | Negaciones a mayor distancia se escapan |
| `FACT:status` | Cada estado tiene un conjunto cerrado de lemas | Un sinónimo no listado da falso FAIL (fue el bug encontrado) |
| `NO_ADDED_CONTENT` | Solo se aplica con `"strict_content": true` (7 casos de normalización pura) y descuenta los términos que el glosario introduce | Aplicarlo en general rechazaría reescrituras legítimas |
| `SOURCE_BOUNDARY` | Fusionar dos palabras contiguas del origen es corrupción; separarlas es reparación permitida | No detecta fusión de palabras no contiguas |
| `detect_meta` | Lista explícita de patrones de meta/control | Una fuga con redacción nueva se escapa |

---

## Dataset

| Suite | Casos | Cobertura |
|---|---:|---|
| `semantic_stress_cases.json` | **50** | estado de producto (4), condicional (3), negación (3), permiso vs requisito (3), opcional vs obligatorio (3), tiempo (3), estatus (3), acción de usuario (3), dinero/crédito (5), error/fallo (3), glosario (3), contenido largo (5), placeholders (5), fronteras (4) |
| `parity_cases.json` | **12** | ortografía (5), autoridad de glosario (2), contenido protegido (2), no-op de alta calidad (2), frontera (1) |

11 casos marcados `no_op` (texto ya correcto) → 39 corridas para medir
reescritura innecesaria. 7 casos marcados `strict_content`.

---

## RAW vs FINAL Architecture

```
origen
  │
  ├── ortografía determinista ──┐
  │                             ├──> piso determinista  (suelo de seguridad)
  ├── glosario determinista ────┘
  │
  └── sugerencia del modelo ──> guardas ──> ¿segura?
                                             sí → se acepta y se le REIMPONE
                                                  la autoridad determinista
                                             no → se descarta; gana el piso
```

El significado es del origen, nunca del modelo (STEP 3A). El glosario tiene
autoridad sobre la sugerencia del modelo, siempre.

**El resultado de dos niveles es el hallazgo central de la fase:**

| Nivel | `qwen3.5:4b` | `qwen3.5:9b` |
|---|---:|---:|
| RAW success rate (modelo solo) | 82.3 % | 77.4 % |
| **FINAL parity success rate (dentro del producto)** | **100 %** | **100 %** |
| Críticos RAW | 6 | 24 |
| **Críticos FINAL** | **0** | **0** |

Ningún candidato es seguro por sí mismo. Ambos lo son dentro de la arquitectura.

---

## qwen3.5:4b

| Métrica | Valor |
|---|---:|
| RAW success | 82.3 % |
| FINAL parity success | **100 %** |
| Críticos RAW | 6 |
| Críticos FINAL | **0** |
| Salida estructurada | 100 % (186/186) |
| Warm p50 / p95 | **4.861 s / 8.109 s** |
| tok/s (p50) | 21.7 |
| Memoria residente | **3.1 GB, 100 % GPU** |
| Tasa de intervención | 17.7 % |
| Fallback a origen | **3.2 %** |
| Reescritura innecesaria (RAW / FINAL) | **0 % / 0 %** |
| Variabilidad entre 3 reps | **0 %** |

**Único modo de fallo crítico en RAW**, en 2 casos × 3 reps:

```
origen: "no  fue posible"
RAW   : "no fue posible continuar"     ← inventa "continuar" en un fragmento de 3 palabras
FINAL : "no fue posible"
```

---

## qwen3.5:9b

| Métrica | Valor |
|---|---:|
| RAW success | 77.4 % |
| FINAL parity success | **100 %** |
| Críticos RAW | 24 |
| Críticos FINAL | **0** |
| Salida estructurada | 100 % (186/186) |
| Warm p50 / p95 | 10.377 s / 18.233 s |
| tok/s (p50) | 11.1 |
| Memoria residente | 5.5 GB, 100 % GPU |
| Tasa de intervención | 22.6 % |
| Fallback a origen | 9.7 % |
| Reescritura innecesaria (RAW / FINAL) | 7.7 % / 0 % |
| Variabilidad entre 3 reps | 0 % |

**Modo de fallo dominante: inventa rutas de recuperación en mensajes de error.**
Consistente y reproducible en 4 casos distintos:

```
origen: "Hubo un problema al guardar."
RAW   : "Hubo un problema al guardar. Revisa tu conexión a internet e inténtalo de nuevo."

origen: "No pudimos validar tu identificación."
RAW   : "No pudimos validar tu identificación. Revisa que los datos sean correctos e inténtalo de nuevo."

origen: "No fue posible aprobar el incremento."
RAW   : "No fue posible aprobar el incremento. Revisa los datos y vuelve a intentarlo."

origen: "No fue posible completar el registro."
RAW   : "No fue posible completar el registro. Revisa los datos e inténtalo de nuevo."
```

Es exactamente la clase de defecto más peligrosa para este producto: el modelo
promete al usuario una ruta de recuperación que **el producto no ofreció**.
"Revisa tu conexión a internet" es un diagnóstico inventado. En los cuatro casos
la capa determinista lo revirtió al origen, pero el 9B **inventa más que el 4B,
no menos**.

---

## Semantic Stress

| Métrica | `qwen3.5:4b` | `qwen3.5:9b` |
|---|---:|---:|
| **raw detected semantic pass** | **100 %** | 97.9 % |
| **final detected semantic pass** | **100 %** | **100 %** |

Recordatorio metodológico: "detected pass" significa que **ningún validador
heurístico detectó violación**. No es una medida de comprensión semántica.

Los fallos semánticos detectados del 9B (`FACT:recovery_path`, 6 corridas) son
los mensajes de error de arriba.

---

## Critical Failures

### Taxonomía (STEP 7), conteo de corridas

| Categoría | 4B RAW | 4B FINAL | 9B RAW | 9B FINAL |
|---|---:|---:|---:|---:|
| `STRUCTURED_OUTPUT_FAILURE` | 0 | 0 | 0 | 0 |
| `SEMANTIC_STATE_CHANGE` | 0 | 0 | 0 | 0 |
| `NEGATION_LOSS` | 0 | 0 | 0 | 0 |
| `MODALITY_CHANGE` | 0 | 0 | 0 | 0 |
| `INVENTED_ACTION` | 6 | 0 | **18** | 0 |
| `INVENTED_RECOVERY` | 0 | 0 | **6** | 0 |
| `PROTECTED_CONTENT_LOSS` | 0 | 0 | 0 | 0 |
| `SOURCE_BOUNDARY_CORRUPTION` | 0 | 0 | 0 | 0 |
| `META_OUTPUT_LEAKAGE` | 0 | 0 | 0 | 0 |
| `LOCALE_CONTAMINATION` | 0 | 0 | 0 | 0 |
| `EMPTY_OUTPUT` | 0 | 0 | 0 | 0 |
| `UNNECESSARY_REWRITE` | 0 | 0 | 3 | 0 |
| `GLOSSARY_RAW_FAILURE` | 15 | 0 | 15 | 0 |
| `ORTHOGRAPHY_RAW_FAILURE` | 12 | 0 | 9 | 0 |
| `OTHER` | 0 | 0 | 0 | 0 |

### Críticos por tipo

| Fallo crítico | 4B RAW | 9B RAW | 4B FINAL | 9B FINAL |
|---|---:|---:|---:|---:|
| `NO_ADDED_CONTENT` | 6 | 6 | 0 | 0 |
| `NO_INVENTED_ACTION` | 0 | 12 | 0 | 0 |
| `FACT:recovery_path` | 0 | 6 | 0 | 0 |
| **Total** | **6** | **24** | **0** | **0** |

**Ambos modelos: cero fallos críticos finales.** Ambos superan la política de
STEP 8. La diferencia está en cuánto trabajo le cuesta a la capa de seguridad
llegar ahí.

---

## Safety Intervention

| Métrica | `qwen3.5:4b` | `qwen3.5:9b` |
|---|---:|---:|
| Corridas con alguna intervención | 33/186 (**17.7 %**) | 42/186 (22.6 %) |
| Casos con alguna intervención | 11/62 | 14/62 |

Razones (una corrida puede acumular varias):

| Razón | `qwen3.5:4b` | `qwen3.5:9b` |
|---|---:|---:|
| `orthography_override` | 18 | 15 |
| `glossary_override` | 15 | 15 |
| `semantic_fidelity_rejection` | 6 | **18** |
| `fallback_to_source` | 6 | **18** |
| `high_quality_noop` | 0 | 3 |
| `protected_content_rejection` | 0 | 0 |
| `boundary_rejection` | 0 | 0 |
| `locale_rejection` | 0 | 0 |
| `meta_output_rejection` | 0 | 0 |

El 9B depende **tres veces más** del rechazo semántico. Los overrides
deterministas (ortografía, glosario) son casi idénticos entre modelos, lo que
confirma que esos defectos son del sistema y no del modelo.

---

## Fallback Analysis

Casos donde el candidato no fue confiable y el FINAL volvió exactamente al origen.

| Modelo | Conteo | Tasa | Casos |
|---|---:|---:|---|
| `qwen3.5:4b` | 6/186 | **3.2 %** | `bound_04`, `orto_04` |
| `qwen3.5:9b` | 18/186 | 9.7 % | `bound_02`, `bound_04`, `error_01`, `error_02`, `neg_01`, `orto_04` |

Razones del fallback:

| Razón | 4B | 9B |
|---|---:|---:|
| `NO_ADDED_CONTENT` | 6 | 6 |
| `NO_INVENTED_ACTION` | 0 | 12 |
| `FACT:recovery_path` | 0 | 6 |

Un fallback no es un fallo del producto — el usuario recibe el texto original,
que es correcto. Pero **sí es una sugerencia perdida**: el modelo no aportó
valor en ese caso. El 4B desperdicia 3.2 % de sus análisis; el 9B, 9.7 %.

### Deterministic Override Rate (STEP 3)

| Modelo | Corridas | Tasa | Glosario | Ortografía |
|---|---:|---:|---:|---:|
| `qwen3.5:4b` | 33/186 | 17.7 % | 15 | 18 |
| `qwen3.5:9b` | 30/186 | 16.1 % | 15 | 15 |

Estas correcciones **no cuentan como fallo del modelo en la calidad FINAL**, tal
como pide STEP 3, pero **sí quedan registradas en la calidad RAW**
(`GLOSSARY_RAW_FAILURE`, `ORTHOGRAPHY_RAW_FAILURE`).

---

## Orthography

| Nivel | `qwen3.5:4b` | `qwen3.5:9b` |
|---|---:|---:|
| RAW | 93.5 % | 95.2 % |
| **FINAL** | **100 %** | **100 %** |

Los cuatro casos obligatorios convergen al 100 % en FINAL para ambos modelos:

| Origen | FINAL |
|---|---|
| `prestamo` | `préstamo` |
| `¿Como funciona?` | `¿Cómo funciona?` |
| `hola ,María` | `hola, María` |
| `no  fue posible` | `no fue posible` |

Los pares acentuales ambiguos quedan fuera por decisión explícita (ver
*Validator Limitations*).

---

## Glossary

| Nivel | `qwen3.5:4b` | `qwen3.5:9b` |
|---|---:|---:|
| raw_glossary_success_rate | 91.9 % | 91.9 % |
| **final_glossary_success_rate** | **100 %** | **100 %** |

FINAL al 100 % en ambos, como exige STEP 13.

### Regresión obligatoria: originación (STEP 9)

| Modelo | RAW | ¿RAW válido? | ¿Intervención? | FINAL | ¿FINAL válido? |
|---|---|---|---|---|---|
| `qwen3.5:4b` (6/6 corridas) | `Proceder con la originación` | Sí | Sí — `glossary_override` | **`Proceder con la solicitud`** | Sí |
| `qwen3.5:9b` (6/6 corridas) | `Proceder con la originación` | Sí | Sí — `glossary_override` | **`Proceder con la solicitud`** | Sí |

**El defecto de 8.5.1 no se reprodujo.** Ningún modelo produjo
`"Proceder con la origen"` bajo el prompt de paridad. La degradación semántica
que el 4B mostró en 8.5.1 se debía al prompt anterior, que pedía eliminar jerga
sin darle al modelo el término correcto. Con el prompt conservador y el glosario
como autoridad determinista, los dos modelos dejan el término intacto y la capa
de producto hace la sustitución.

FINAL converge a `Proceder con la solicitud` en **12/12 corridas**, como exige el
paso.

---

## Protected Content

| Nivel | `qwen3.5:4b` | `qwen3.5:9b` |
|---|---:|---:|
| RAW | **100 %** | **100 %** |
| FINAL | **100 %** | **100 %** |

Preservación byte por byte en las 372 corridas warm, incluyendo
`{{name}}`, `{{date}}`, `{{time}}`, `{{amount}}`, `{{email}}`,
`{{Jueves 10 de abril de 2026}}`, `{{6:00 p.m.}}`, URLs y correos.
**Cero placeholders perdidos, alterados o inventados.**

---

## Boundary Integrity

| Nivel | `qwen3.5:4b` | `qwen3.5:9b` |
|---|---:|---:|
| RAW | **100 %** | **100 %** |
| FINAL | **100 %** | **100 %** |

`boundary_integrity.py` fue reescrito en esta fase para ser **relativo al
origen, sin lista negra** (STEP 5). Detecta que el candidato fusione palabras
que en el origen iban separadas, y **permite** la reparación inversa
(`tuApp` → `tu App`). Las reglas de espaciado y puntuación se movieron a
ortografía, y los patrones de meta a `production_parity.detect_meta()`: tres
conceptos, tres módulos, categorías de fallo separadas en el reporte.

Verificación del módulo sin lista negra:

| Origen | Candidato | Resultado |
|---|---|---|
| `App Banco Azteca no fue` | `AppBanco Azteca nofue` | FAIL (detecta ambas) |
| `Revisa tu App Banco porque hay errores` | `…porque hayerrores` | FAIL |
| `tuApp Banco` | `tu App Banco` | PASS (reparación permitida) |

**Meta leakage FINAL: 0 en ambos modelos.** Tampoco hubo fuga en RAW —
la contaminación por `/no_think` de 8.5.1 fue exclusiva de `qwen3:1.7b`.

---

## Structured Output

Mismo esquema, prompt, `temperature=0`, `seed=42`, `num_ctx=4096`,
`keep_alive=30m` para ambos.

| Métrica | `qwen3.5:4b` | `qwen3.5:9b` |
|---|---:|---:|
| structured_output_success_rate | **100 %** (186/186) | **100 %** (186/186) |
| Respuestas inválidas | 0 | 0 |
| Reintentos consumidos | 0 | 0 |
| Fallos persistentes | 0 | 0 |

Forzar el esquema JSON de Ollama eliminó por completo la variable de
confiabilidad de formato. En 8.5.1, sin esquema forzado, ambos modelos ya daban
JSON válido 48/48; con esquema, 186/186. **No es un criterio diferenciador.**

---

## Performance

Warm, configuración de paridad, n = 186 por modelo.

| Métrica | `qwen3.5:4b` | `qwen3.5:9b` |
|---|---:|---:|
| media | 5.303 s | 11.140 s |
| **p50** | **4.861 s** | 10.377 s |
| **p95** | **8.109 s** | 18.233 s |
| min | 3.481 s | 6.011 s |
| max | 9.833 s | 21.235 s |
| tok/s (p50) | 21.71 | 11.12 |
| n | 186 | 186 |

p95 es percentil empírico real (n = 186 ≫ 20), no estimado.

### Cold (10 corridas representativas por modelo)

| Modelo | Cold p50 | `load_duration` p50 | Warm p50 | Delta |
|---|---:|---:|---:|---:|
| `qwen3.5:4b` | 7.362 s | 1.597 s | 4.861 s | **+2.50 s** |
| `qwen3.5:9b` | 18.587 s | 4.022 s | 10.377 s | **+8.21 s** |

### Variabilidad (STEP 11)

**0 % en ambos modelos**: 0/62 casos produjeron salidas distintas entre las 3
repeticiones. Con `temperature=0` y `seed=42`, ambos son completamente
deterministas. Esto refuerza la comparación: las diferencias observadas son del
modelo, no ruido de muestreo.

---

## Memory

Medición **fresca y aislada**, un modelo residente a la vez, corrigiendo la
contaminación que afectó a 8.5.1.

| Modelo | Memoria residente (`ollama ps`) | Procesador | Delta RSS de Ollama |
|---|---:|---|---:|
| `qwen3.5:4b` | **3.1 GB** | 100 % GPU | +4.63 GB |
| `qwen3.5:9b` | **5.5 GB** | 100 % GPU | +6.78 GB |

Evidencia:

```
qwen3.5:4b  2a654d98e6fb  3.1 GB  100% GPU  4096
qwen3.5:9b  6488c96fa5fa  5.5 GB  100% GPU  4096
```

**Estado del sistema** (NO es memoria del modelo): swap 959 MB usados de 2048 MB,
**sin variación** durante ninguna corrida. Ni el 9B generó presión de memoria en
24 GB. Los dos cargan íntegramente en GPU, sin offload a CPU.

La distinción importa: el delta de RSS del proceso (4.63 / 6.78 GB) incluye
buffers y overhead del runtime; **la cifra atribuible al modelo es la de
`ollama ps`**: 3.1 GB y 5.5 GB.

---

## Screen Audit Projection

**PROYECCIÓN SECUENCIAL SIMPLE — NO es rendimiento real de Screen Audit.**

Fórmula: `textos × warm p50`. Sin batching, sin paralelismo, sin caché, sin
prefiltrado determinista, sin el costo del runtime ni la latencia de Figma.

| Modelo | p50 | 5 textos | 10 textos | 15 textos | 20 textos |
|---|---:|---:|---:|---:|---:|
| `qwen3.5:4b` | 4.861 s | **24 s** | **49 s** | **73 s** | **97 s** |
| `qwen3.5:9b` | 10.377 s | 52 s | 104 s | 156 s | 208 s |

**La inferencia local por sí sola NO resuelve la latencia de Screen Audit.**
Con el modelo recomendado, 10 textos son ~49 s secuenciales. Eso no es una
espera aceptable en una herramienta de diseño.

Las fases posteriores necesitarán alguna combinación de: prefiltrado
determinista (muchos textos no necesitan LLM en absoluto — la ortografía y el
glosario ya se resuelven sin modelo), caché por texto, modelo caliente,
mini-batching, y experimentos de paralelismo. **Nada de eso se implementa aquí.**

---

## Decision Matrix

| Metric | `qwen3.5:4b` | `qwen3.5:9b` |
|---|---:|---:|
| Warm p50 | **4.861 s** | 10.377 s |
| Warm p95 | **8.109 s** | 18.233 s |
| Tokens/sec | **21.71** | 11.12 |
| Resident memory | **3.1 GB** | 5.5 GB |
| Structured success | 100 % | 100 % |
| Raw detected semantic pass | **100 %** | 97.9 % |
| Final detected semantic pass | 100 % | 100 % |
| Raw critical failures | **6** | 24 |
| **Final critical failures** | **0** | **0** |
| Protected FINAL pass | 100 % | 100 % |
| Glossary FINAL pass | 100 % | 100 % |
| Orthography FINAL pass | 100 % | 100 % |
| Boundary FINAL pass | 100 % | 100 % |
| Meta leakage FINAL | **0** | **0** |
| Safety intervention rate | **17.7 %** | 22.6 % |
| Fallback-to-source rate | **3.2 %** | 9.7 % |
| Deterministic override rate | 17.7 % | 16.1 % |
| Unnecessary rewrite FINAL | 0 % | 0 % |
| Unnecessary rewrite RAW | **0 %** | 7.7 % |

---

## Recommendation

### Opción A — `qwen3.5:4b` como DEFAULT

Compuerta de STEP 20, verificada punto por punto:

| Requisito | Exigido | Medido | ✔ |
|---|---|---|---|
| Fallos críticos finales | 0 | **0** | ✅ |
| Protected FINAL | 100 % | **100 %** | ✅ |
| Glossary FINAL | 100 % | **100 %** | ✅ |
| Orthography FINAL | 100 % en casos soportados | **100 %** | ✅ |
| Meta leakage FINAL | 0 | **0** | ✅ |
| Confiabilidad estructurada | aceptable | **100 %** | ✅ |
| Fallback-to-source | aceptablemente bajo | **3.2 %** | ✅ |
| Ventaja material de latencia sobre 9B | sí | **2.13× más rápido** | ✅ |

**Las ocho compuertas se cumplen.**

### Por qué no el 9B (STEP 21)

La compuerta del 9B exige que muestre **mejor preservación semántica, menor
intervención, menor fallback y menos reescritura**. Los datos dicen lo
contrario en las cuatro:

| Dimensión | 4B | 9B | Gana |
|---|---:|---:|---|
| Preservación semántica (raw detected) | 100 % | 97.9 % | 4B |
| Intervención de seguridad | 17.7 % | 22.6 % | 4B |
| Fallback a origen | 3.2 % | 9.7 % | 4B |
| Reescritura innecesaria RAW | 0 % | 7.7 % | 4B |

El 9B no es "el modelo de calidad" que se esperaba: es el que **inventa rutas de
recuperación en mensajes de error**, el defecto más peligroso del catálogo para
un producto financiero. Cuesta 2.1× en latencia, 1.8× en memoria, y entrega peor
fidelidad.

### Por qué no una estrategia adaptativa (STEP 22)

Una estrategia adaptativa `4B rápido / 9B calidad` **requeriría que el 9B fuera
el modo de calidad**. La evidencia lo contradice: el 9B es más lento *y* menos
fiel. Recomendarlo como "modo calidad" sería vender como mejora algo que los
datos muestran peor. **No se recomienda ruteo adaptativo, ni se implementa.**

### Por qué no hizo falta desempate (STEP 23)

El 4B gana o empata en **todas** las dimensiones del orden de prioridad de
STEP 19. No hay ambigüedad que desempatar, así que no se ejecutó un benchmark
adicional.

### `keep_alive` recomendado: `30m`

| Evidencia | Valor |
|---|---|
| Penalización de arranque en frío (4B) | **+2.50 s** sobre la latencia warm (+51 %) |
| `load_duration` (4B) | 1.60 s |
| Costo de residencia | 3.1 GB, 100 % GPU |
| Presión de memoria observada | **ninguna**; swap sin variación en 24 GB |

`30m` cubre una sesión de diseño real. El costo son 3.1 GB residentes en una
máquina que no mostró presión ni con el 9B. Se usó `30m` en todo este benchmark
y es el valor que respaldan los datos.

Para Screen Audit convendrá precalentar al abrir el plugin, no al disparar la
auditoría, para sacar los 2.5 s del camino crítico. **No se implementa aquí.**

---

## Confidence

### MEDIA

**Lo que la sostiene:**

- 372 llamadas warm, 62 casos, 3 repeticiones, **0 errores de transporte**;
- **0 % de variabilidad** entre repeticiones — ambos modelos completamente
  deterministas, así que las diferencias no son ruido;
- **0 fallos críticos finales** en ambos, verificados con taxonomía explícita;
- el 4B gana en **todas** las dimensiones prioritarias, no por un margen estrecho
  en una sola métrica;
- control de auto-consistencia del banco de pruebas: 62/62.

**Lo que la limita:**

- **Los validadores son heurísticos.** Un PASS no prueba preservación de
  significado, solo ausencia de violación detectada;
- **se encontró un bug real de validador** (`FACT:status`) que producía 3 falsos
  críticos finales por modelo. Se corrigió y se añadió el control que lo detectó,
  pero su existencia sugiere que puede haber otros que el control no cubra;
- **una sola configuración de hardware**: M4 / 24 GB;
- 62 casos son una muestra razonable, no exhaustiva, del espacio de textos de UI;
- no se midió calidad de UX Writing de forma cualitativa por un humano; solo
  ausencia de violaciones.

**Desglose honesto:** la confianza en la **comparación relativa** (4B ≥ 9B en
este harness) es **alta** — es consistente, determinista y unánime entre
dimensiones. La confianza en la afirmación **absoluta** de que el 4B es seguro
para producción es **media**, y depende de la capa determinista, no del modelo.
El agregado es MEDIA.

---

## Remaining Risks

1. **La seguridad la aporta la arquitectura, no el modelo.** El 4B falla 17.7 %
   de las veces en crudo. Si el runtime local se implementa sin la capa
   determinista completa, **el producto empeora respecto del estado actual**.
   Esta es la conclusión más importante del reporte.
2. **Los validadores heurísticos pueden tener más huecos.** Se encontró y corrigió
   uno. `validate_cases.py` debe correr en cada cambio del banco de pruebas.
3. **Hardware no medido.** 8 GB, 16 GB, M1/M2/M3 y variantes Pro/Max siguen sin
   datos. El 4B en 8 GB es plausible pero no está verificado.
4. **Screen Audit sigue sin resolverse.** 10 textos ≈ 49 s secuenciales con el
   modelo recomendado. La inferencia local es condición necesaria, no suficiente.
5. **`num_ctx=4096` no se estresó.** Los textos largos del banco caben cómodamente.
   Una pantalla completa de Figma podría no caber.
6. **El glosario tiene 7 términos.** El glosario real de producto es mayor;
   la tasa de `glossary_override` (15 corridas) crecerá con él.
7. **`qwen3:1.7b` sigue siendo el modelo de producción** y no se evaluó bajo
   este harness. Su fuga de `/no_think` documentada en 8.5.1 no se ha
   caracterizado con el prompt de producción real.

---

## Next Phase

**FASE 8.5.2: GO.**

**NO se avanza a FASE 8.5.3.** El Local Runtime `127.0.0.1:8787` **no se
implementa** hasta que haya aprobación humana explícita.

Cuando se implemente, el orden que la evidencia sugiere es: primero la capa
determinista completa (es la que aporta la seguridad), después el transporte a
Ollama, y solo entonces el transporte desde Figma.

---

## Verificaciones finales

| Verificación | Evidencia | Estado |
|---|---|---|
| Ollama solo en loopback | `TCP 127.0.0.1:11434 (LISTEN)`; listeners en `0.0.0.0:11434` = **0** | ✅ |
| Sin servicio persistente | `brew services list` → `ollama none` | ✅ |
| Plugin sin modificar | archivo más reciente **28 ago 18:47:43**; primer artefacto 8.5.2 **29 ago 01:20:41** | ✅ |
| Plugin ID intacto | `1674592820827897160` | ✅ |
| Producción sin tocar | sin SSH al VPS, sin cambios en `writing.productdesign.mx`, sin rotar API keys | ✅ |
| Modelos conservados | `qwen3:1.7b`, `qwen3.5:4b`, `qwen3.5:9b` — ninguno borrado | ✅ |
| 8.5.1 preservado | `reports/phase-8-5-1-benchmark.md` y `results/2026-08-29/` intactos | ✅ |
| Banco de pruebas auto-consistente | `validate_cases.py` → 62/62 | ✅ |
