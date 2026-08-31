# UX Writing Local Runtime — FASE 8.5.3

Runtime HTTP local que reproduce los contratos de seguridad de producto de
UX Writing Intelligence sobre inferencia local en Apple Silicon.

**El plugin de Figma NO está conectado a este runtime.** Esta fase termina
cuando el runtime puede probarse de forma independiente por HTTP.

---

## Arquitectura

```
        (aún NO conectado en esta fase)
Figma  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
                                       ▼
                          UX Writing Local Runtime
                              127.0.0.1:8787
                                       │
                      ┌────────────────┴────────────────┐
                      │   MOTOR DETERMINISTA / SEGURIDAD │
                      │   ortografía · glosario          │
                      │   contenido protegido · fronteras│
                      │   fidelidad semántica · locale   │
                      │   meta · scoring · razón         │
                      └────────────────┬────────────────┘
                                       ▼
                                    Ollama
                              127.0.0.1:11434
                                       ▼
                                 qwen3.5:4b
```

### Por qué el motor de seguridad vive aquí y no en el modelo

La evidencia de FASE 8.5.2 es inequívoca: `qwen3.5:4b` alcanza **82.3 %** en
crudo y **100 %** dentro de la arquitectura determinista. El modelo no es la
capa de seguridad. Por eso **nunca** debe existir una ruta `Figma → Ollama`:
saltarse este runtime sería entregar a la persona usuaria la salida cruda de
un modelo que falla uno de cada cinco textos.

---

## Puertos, modelo y parámetros

| Parámetro | Valor | Origen |
|---|---|---|
| Host | `127.0.0.1` (constante, no configurable por entorno) | STEP 3 |
| Puerto | `8787` (`UXW_PORT`) | STEP 5 |
| Ollama | `http://127.0.0.1:11434` | STEP 3 |
| Modelo | **`qwen3.5:4b`** | FASE 8.5.2 |
| `keep_alive` | **`30m`** | FASE 8.5.2 |
| `temperature` / `seed` / `num_ctx` | `0` / `42` / `4096` | configuración de paridad |
| Locale | `es-MX` (único soportado) | STEP 19 |
| Timeout de análisis | `30 s` | p95 medido 8.1 s; ~3× de margen |

`HOST` es una constante del módulo, **no** una variable de entorno. Bindear a
`0.0.0.0` expondría el runtime a la red local, y el modelo de seguridad de
esta fase es precisamente el aislamiento por loopback. Hacerlo imposible por
construcción es más barato que confiar en que nadie exporte la variable
equivocada.

---

## Arranque y apagado

```bash
# Una vez
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# Arrancar
./scripts/run_local.sh          # http://127.0.0.1:8787

# Detener
Ctrl+C     (o SIGTERM al proceso)
```

El lanzador falla de inmediato si el puerto está ocupado, en vez de arrancar
un segundo proceso en la sombra. **No** se instala LaunchAgent, daemon de
login ni servicio de Homebrew: el ciclo de vida persistente pertenece a fases
posteriores.

---

## Contrato HTTP

### `GET /health`

Rápido. No consulta a Ollama ni dispara inferencia.

```json
{"status":"ok","service":"ux-writing-local-runtime","version":"8.5.3","model":"qwen3.5:4b"}
```

No devuelve rutas, variables de entorno, ni estado del sistema anfitrión.

### `GET /v1/runtime/status`

Consulta el catálogo de Ollama (`/api/tags`). **No genera texto.**

```json
{"runtime":"ready","ollama":"ready","model":"qwen3.5:4b","model_available":true}
```

`runtime`: `ready` | `degraded` · `ollama`: `ready` | `unavailable`

Si `qwen3.5:4b` no está instalado, `model_available` es `false` y el análisis
falla de forma segura. **Nunca se sustituye silenciosamente por 9B o 1.7B**:
la selección de modelo es explícita y auditable.

### `POST /v1/analyze/text`

```json
{"text": "...", "context": "...", "locale": "es-MX"}
```

Respuesta: ver `src/models.py`. Idéntica en estructura a `AnalyzeResponse`
del plugin.

**Invariante absoluto: `response.text` es SIEMPRE `request.text`, carácter por
carácter.** El significado pertenece al origen, nunca al modelo.

---

## Capas de seguridad

Se aplican en este orden sobre el candidato que propone el modelo:

| Capa | Módulo | Qué rechaza |
|---|---|---|
| Contenido protegido | `protected_content.py` | pérdida o alteración de `{{...}}`, URLs, correos; placeholders inventados |
| Frontera de origen | `boundary_integrity.py` | fusión de palabras contiguas del origen |
| Meta | `locale_integrity.py` | tokens de control, etiquetas de razonamiento, comentarios del asistente, nombres de campo del esquema |
| Locale | `locale_integrity.py` | contaminación en inglés, relativa al origen |
| Fidelidad semántica | `semantic_fidelity.py` | acciones/causas/rutas de recuperación inventadas, negación perdida, permiso→obligación, opcional→obligatorio, cambio de estado, cifras alteradas, expansión inventada en fragmentos cortos |

Si el candidato sobrevive, se le **reimpone** la autoridad determinista
(ortografía y glosario mandan incluso sobre un candidato válido) y se descarta
si solo aporta un cambio cosmético. Si no sobrevive, gana el piso determinista.

### Autoridad determinista

- **Glosario** (`glossary.py`): `credenciales → datos de acceso`,
  `originación → solicitud`. La sugerencia del modelo nunca gana.
- **Ortografía** (`orthography.py`): tildes inequívocas, espaciado, puntuación,
  interrogativos y `¿` de apertura.

Política conservadora explícita: los pares acentuales ambiguos
(`esta/está`, `mas/más`, `aun/aún`, `si/sí`, `solicito/solicitó`, `el/él`)
quedan **fuera**. Desambiguarlos exige análisis sintáctico, y equivocarse ahí
cambia el significado, que es justo lo que esta capa protege.

### Scoring

| Criterio | Peso | Origen |
|---|---:|---|
| clarity | 25 | modelo |
| utility | 20 | modelo |
| concision | 15 | modelo |
| predictability | 15 | modelo |
| orthography | 15 | **determinista** |
| jargon | 10 | **determinista** (glosario) |

Sin penalizaciones ocultas: el total es exactamente la suma del desglose, y
toda resta tiene un issue visible que la justifica.

### Jerga explicable

`jargon` es `true` **solo** cuando hay evidencia de glosario. La bandera del
modelo no es autoridad. Limitación aceptada: la evidencia está acotada al
glosario, así que un término jergoso fuera de él no marca `jargon`. Preferimos
un falso negativo explicable a un verdadero positivo que no podríamos
justificar ante la persona usuaria.

### No-op de alta calidad

Si `score >= 90` **y** `issues == []` **y** `orthography == 5` **y** no hubo
override de glosario, la sugerencia es el texto original sin tocar.

---

## Presupuesto de llamadas al modelo

**Máximo absoluto: 2 llamadas por petición.**

```
llamada 1   análisis inicial                                (siempre)
llamada 2   UNA de estas dos, nunca ambas:
              · reintento por salida estructurada inválida
              · regeneración por rechazo semántico
```

Un reintento estructurado consume el mismo presupuesto que una regeneración,
así que la secuencia `inicial + estructurado + semántico` es **imposible por
construcción**. No hay bucles recursivos.

Los fallos de transporte (timeout, conexión, error HTTP) **no se reintentan**:
se mapean a errores de servicio.

---

## Errores

| Código | HTTP | Cuándo |
|---|---:|---|
| `OLLAMA_UNAVAILABLE` | 503 | no hay servicio de inferencia local |
| `MODEL_NOT_AVAILABLE` | 503 | el modelo no está instalado |
| `MODEL_TIMEOUT` | 504 | el modelo no respondió en 30 s |
| `INVALID_MODEL_RESPONSE` | 502 | salida fuera de contrato tras el reintento |
| `ANALYSIS_FAILED` | 400/500 | entrada inválida o fallo no clasificado |

La respuesta de error contiene **solo** `code` y `message`. Nunca trazas,
rutas del sistema, el prompt ni la salida cruda del modelo.

---

## Observabilidad

Se registran únicamente métricas y banderas, con lista blanca en
`observability.py`. **Nunca** se registra el texto de origen, la sugerencia,
el contexto, el prompt, la salida cruda ni claves. Cualquier campo fuera de la
lista blanca se descarta y se reporta como `dropped_fields`.

---

## Supuestos de seguridad

1. **El aislamiento es el binding a loopback.** No hay API key local
   (STEP 4/29). La clave de la nube sigue siendo un asunto exclusivo del
   backend remoto y del plugin, que no se tocan en esta fase.
2. **Sin CORS abierto.** El plugin no está conectado, así que no se habilita
   ningún origen. El comportamiento definitivo de Origin/CORS para Figma se
   define en FASE 8.5.4. **CORS nunca es autenticación.**
3. **Ollama permanece en loopback.** El runtime no lo instala, no lo expone y
   no descarga modelos bajo demanda.
4. **Sin arranque automático.** No hay LaunchAgent ni servicio persistente.

---

## Procedimiento de prueba

```bash
.venv/bin/python -m pytest tests/ -q              # unitarias + API
./scripts/run_local.sh &                          # runtime en 127.0.0.1:8787
.venv/bin/python scripts/smoke_local.py           # 10 casos dorados
.venv/bin/python scripts/parity_bank_runtime.py   # banco de 62 casos por HTTP
.venv/bin/python scripts/benchmark_runtime.py     # smoke de rendimiento
```

Los archivos de `benchmarks/` se usan **solo como datos de prueba**. El código
de `src/` no importa nada de ahí; verificado con `grep -rn benchmarks src/`.

---

## Limitaciones conocidas

1. **Los validadores semánticos son heurísticos.** Alta precisión, no alto
   recall. Un rechazo casi siempre señala un defecto real; una aceptación solo
   significa que ninguna regla conocida detectó violación. No prueban que el
   significado se preservó.
2. **La regla de expansión inventada solo cubre fragmentos cortos**
   (≤ 4 palabras de contenido). En textos largos, una frase añadida que no
   dispare ninguna otra regla puede pasar.
3. **El glosario tiene 7 términos.** El glosario real de producto es mayor.
4. **La jerga se detecta solo vía glosario** (ver arriba).
5. **Una sola configuración de hardware medida**: M4 / 24 GB.
6. **La segunda llamada duplica la latencia.** Un texto que dispara
   regeneración semántica cuesta ~2× (12 s observados contra ~6 s).
7. **`num_ctx = 4096` no se ha estresado** con una pantalla completa de Figma.
8. **Sin ruteo local/nube, sin Screen Audit, sin conexión del plugin.** Todo
   eso pertenece a fases posteriores.
