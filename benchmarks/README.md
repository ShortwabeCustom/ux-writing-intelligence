# Benchmarks — FASE 8.5.1

## Archivos

| Archivo | Rol |
|---|---|
| `cases.json` | Dataset de 16 casos con los riesgos reales de producción (categorías A–H del spike). |
| `benchmark_models.py` | Runner secuencial contra Ollama. Mide latencia + métricas nativas + memoria. |
| `validate_output.py` | Validador determinista de invariantes. Sin juicio subjetivo de calidad. |

## Cómo correr

Requiere Ollama escuchando en `127.0.0.1:11434`:

```bash
OLLAMA_HOST=127.0.0.1:11434 ollama serve
```

Desde `benchmarks/`:

```bash
python3 benchmark_models.py --model qwen3.5:4b --mode cold --out ../results/2026-08-29
python3 benchmark_models.py --model qwen3.5:4b --mode warm --out ../results/2026-08-29
```

- `--mode cold`: descarga el modelo de memoria antes de cada request (`keep_alive=0`),
  1 corrida por caso, solo los casos marcados `"cold": true` (5 casos representativos).
- `--mode warm`: precalienta el modelo, `keep_alive=10m`, 3 corridas × 16 casos.

Sin dependencias externas: solo stdlib de Python 3.

## Decisiones metodológicas

**Mismo prompt para todos los modelos.** `SYSTEM_PROMPT` en `benchmark_models.py`
es único y compartido. No se optimiza por modelo; hacerlo invalidaría la comparación.

**No se fuerza `format: "json"`.** Ollama puede forzar salida JSON a nivel de
gramática. Se decidió NO usarlo: el spike necesita medir la *confiabilidad real*
de cada modelo para producir el contrato JSON siguiendo instrucciones. Forzar la
gramática eliminaría precisamente la señal que STEP 18 pide contar
("invalid JSON repeatedly"). Queda registrado en cada resultado como
`"json_format_forced": false`.

**Parámetros deterministas:** `temperature=0`, `seed=42`, `num_ctx=2048`,
`stream=false`, `think=false` (razonamiento visible desactivado).

**Sin concurrencia.** Todo es secuencial (STEP 21). El batching y la
concurrencia pertenecen a un experimento posterior.

**p95.** Se calcula solo con n ≥ 20 observaciones. Con menos, el campo se
emite como `null` con la razón explícita en `p95_basis`. No se fabrica.

## Invariantes validados

Críticos (un FAIL descalifica al modelo, STEP 17/18):

`JSON_VALID`, `SPANISH_OUTPUT`, `NO_EMPTY_SUGGESTION`,
`PROTECTED_PLACEHOLDERS_PRESERVED`, `NO_INVENTED_ACTION`,
`NO_APPBANCO`, `NO_NOFUE`, `NO_HAYERRORES`

No críticos (calidad, se reportan pero no descalifican):

`ORTHOGRAPHY_PRESTAMO`, `ORTHOGRAPHY_COMO`, `ORTHOGRAPHY_COMMA_SPACING`,
`ORTHOGRAPHY_DOUBLE_SPACE`, `GLOSSARY_CREDENCIALES`, `GLOSSARY_ORIGINACION`,
`GOOD_TEXT_NO_UNNECESSARY_CHANGE`, `MULTILINE_SAFE`

## Límite conocido del validador

`validate_output.py` verifica invariantes de alta confianza, no calidad de UX
Writing en general. Un caso puede pasar los 16 checks y aun así producir una
sugerencia mediocre. La lectura cualitativa de las sugerencias está en el
reporte, no automatizada.
