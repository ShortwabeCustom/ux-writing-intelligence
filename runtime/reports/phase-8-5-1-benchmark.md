# FASE 8.5.1 — Benchmark de inferencia local (Apple Silicon)

Corrida: **2026-08-29**
Resultados crudos: `results/2026-08-29/`
Pregunta que responde este documento: *¿conviene mover la inferencia de UX
Writing Intelligence del VPS a un runtime local antes de implementar Screen Audit?*

---

## Hardware

| Campo | Valor |
|---|---|
| Equipo | MacBook Air, `Mac16,13` |
| Chip | **Apple M4** |
| CPU | 10 núcleos (4P + 6E) |
| GPU | no reportado por `system_profiler`; **no se infiere** |
| Memoria unificada | **24 GB** (25 769 803 776 bytes) |
| Arquitectura | `arm64` |
| macOS | 26.5.2 (25F84) |
| Disco libre | 102 GiB tras descargar los modelos (11 GB consumidos) |
| Clasificación del spike | **ADVANCED** → se benchmarkean 4B y 9B; no 14B |

## Ollama

| Campo | Valor |
|---|---|
| Estado inicial | **ausente** |
| Instalación | Homebrew (ya presente en el sistema) |
| Versión | **0.33.0** |
| Endpoint | `http://127.0.0.1:11434` — responde `{"version":"0.33.0"}` |
| Binding | `TCP 127.0.0.1:11434 (LISTEN)` |
| Listeners en `0.0.0.0:11434` | **0** |
| Servicio persistente | **no** — `brew services list` reporta `ollama none` |

Se lanzó manualmente con `OLLAMA_HOST=127.0.0.1:11434 ollama serve`, deliberadamente
**sin** `brew services start`, para no dejar un daemon al login sin decisión explícita.
No se modificó firewall ni configuración de red.

**Modelo de seguridad: cumplido. El endpoint no es alcanzable desde LAN ni internet.**

## Modelos

| Modelo | Tamaño en disco | Pull | Carga | Rol |
|---|---|---|---|---|
| `qwen3.5:4b` | 3.4 GB | ✅ | ✅ | candidato |
| `qwen3.5:9b` | 6.6 GB | ✅ | ✅ | candidato |
| `qwen3:1.7b` | 1.4 GB | ✅ | ✅ | referencia (modelo de producción) |

Nota sobre nombres: `qwen3.5:4b` y `qwen3.5:9b` **sí existen** en el registry de
Ollama (manifest HTTP 200). `qwen3.5:8b` no existe (404).

`qwen3:1.7b` **no estaba presente localmente** — la instalación de Ollama era
nueva. Se descargó como referencia. **No se borró ningún modelo.**

## Dataset

16 casos (`benchmarks/cases.json`) cubriendo las 8 categorías de riesgo:
alta calidad (2), ortografía (4), glosario (2), contenido protegido (2),
multilínea (1), fidelidad semántica (2), frontera de origen (1), contenido largo (2).

5 casos marcados como representativos para cold: `A1, B1, D1, E1, H1`.

Parámetros idénticos para los 3 modelos: `temperature=0`, `seed=42`,
`num_ctx=2048`, `stream=false`, `think=false`, **mismo system prompt sin optimizar por modelo**.

**No se forzó `format:"json"`** — habría garantizado JSON válido artificialmente y
borrado la señal que STEP 18 pide medir.

Muestra: cold = 5 casos × 1 corrida × 3 modelos. Warm = 16 casos × 3 corridas × 3 modelos
(**48 requests por modelo**, 144 en total). **0 errores de request en las 159 llamadas.**

---

## Cold Performance

| Modelo | Wall p50 | Wall min–max | `load_duration` p50 | JSON válido | Checks |
|---|---|---|---|---|---|
| `qwen3.5:4b` | **8.24 s** | 4.32–14.72 s | 1.85 s | 5/5 | 27/28 |
| `qwen3.5:9b` | **14.61 s** | 8.20–26.34 s | 3.88 s | 5/5 | 27/28 |
| `qwen3:1.7b` | 3.01 s | 1.60–5.55 s | 0.55 s | 5/5 | 25/28 |

## Warm Performance

n = 48 por modelo, por lo que **p95 sí es un percentil empírico real**, no una estimación.

| Modelo | p50 | p95 | media | min–max | tok/s (p50) |
|---|---|---|---|---|---|
| `qwen3.5:4b` | **4.97 s** | **9.13 s** | 5.31 s | 2.81–9.82 s | 25.5 |
| `qwen3.5:9b` | **9.28 s** | **15.24 s** | 9.82 s | 5.21–19.38 s | 13.3 |
| `qwen3:1.7b` | 1.62 s | 4.17 s | 2.03 s | 0.99–5.10 s | 49.8 |

### Cold vs Warm (STEP 22)

Comparación sobre **los mismos 5 casos**, para que el delta sea legítimo:

| Modelo | Cold p50 | Load p50 | Warm p50 (mismos casos) | Delta |
|---|---|---|---|---|
| `qwen3.5:4b` | 8.24 s | 1.85 s | 4.43 s | **+3.80 s** |
| `qwen3.5:9b` | 14.61 s | 3.88 s | 9.41 s | **+5.20 s** |
| `qwen3:1.7b` | 3.01 s | 0.55 s | 2.05 s | +0.95 s |

Para `qwen3.5:4b` el arranque en frío **cuesta +86 % sobre la latencia warm**.
Mantener el modelo residente no es una optimización marginal: es la diferencia
entre 4.4 s y 8.2 s percibidos.

### Contra la referencia de producción

El VPS observa ~12–15 s en textos cortos. El 4B local warm da **p50 4.97 s**.
**Esto NO es una comparación controlada** — distinto hardware, distinto modelo,
distinto prompt, distinta carga de red. Se reporta como orden de magnitud, no como
equivalencia.

---

## Quality

Tasa de checks aprobados (warm, 48 corridas × checks aplicables):

| Modelo | Checks OK | Corridas 100 % limpias |
|---|---|---|
| `qwen3.5:4b` | **225/231 (97 %)** | **42/48 (88 %)** |
| `qwen3.5:9b` | 222/231 (96 %) | 39/48 (81 %) |
| `qwen3:1.7b` | 213/231 (92 %) | 33/48 (69 %) |

Detalle por invariante:

| Check | 4B | 9B | 1.7B |
|---|---|---|---|
| `JSON_VALID` | 48/48 | 48/48 | 48/48 |
| `SPANISH_OUTPUT` | 48/48 | 48/48 | 48/48 |
| `NO_EMPTY_SUGGESTION` | 48/48 | 48/48 | 48/48 |
| `NO_INVENTED_ACTION` | 24/24 | 24/24 | 24/24 |
| `PROTECTED_PLACEHOLDERS_PRESERVED` | 9/9 | 9/9 | **6/9** |
| `MULTILINE_SAFE` | 9/9 | 9/9 | **3/9** |
| `NO_APPBANCO` / `NO_NOFUE` / `NO_HAYERRORES` | 6/6, 9/9, 6/6 | 6/6, 9/9, 6/6 | 6/6, 9/9, 6/6 |
| `GOOD_TEXT_NO_UNNECESSARY_CHANGE` | 6/6 | 6/6 | 6/6 |
| `ORTHOGRAPHY_COMO` | 3/3 | 3/3 | 3/3 |
| `ORTHOGRAPHY_DOUBLE_SPACE` | 3/3 | 3/3 | 3/3 |
| `ORTHOGRAPHY_COMMA_SPACING` | 3/3 | 3/3 | **0/3** |
| `ORTHOGRAPHY_PRESTAMO` | **0/3** | **0/3** | **0/3** |
| `GLOSSARY_CREDENCIALES` | **0/3** | **0/3** | **0/3** |
| `GLOSSARY_ORIGINACION` | 3/3 | **0/3** | 3/3 |

### Ortografía

- ✅ `¿Como funciona?` → `¿Cómo funciona?` — los 3 modelos, 3/3.
- ✅ `no  fue posible` → doble espacio corregido — los 3, 3/3.
- ✅ `hola ,María` → `Hola, María` — 4B y 9B 3/3. **1.7B devolvió el texto sin tocar.**
- ❌ **`prestamo` → los 3 modelos lo devolvieron sin tilde, con `issues: []`.**

El fallo de `prestamo` es **real, no un artefacto del validador**: los tres modelos
declaran explícitamente que no hay problema. Una palabra suelta sin contexto de
frase no dispara la corrección ortográfica. Es un riesgo de producción concreto,
porque muchos textos de UI en Figma son etiquetas de una sola palabra.

### Glosario

- ❌ `credenciales` → ningún modelo lo cambió a "datos de acceso" (0/3 en los tres).
- `originación` → 9B lo dejó intacto; 4B y 1.7B lo cambiaron, pero **mal** (ver abajo).

**Lectura honesta:** el system prompt del benchmark **no contiene un glosario de
producto**. Pedirle a un modelo que adivine que "credenciales" debe ser "datos de
acceso" sin darle la regla es pedirle telepatía. Esto **no descalifica a ningún
modelo**; señala que el glosario debe vivir en el runtime local (como ya define
`docs/architecture.md`), no en los pesos del modelo.

### Fidelidad semántica — hallazgo que el validador NO capturó

`qwen3.5:4b` en el caso C2:

```
origen:     "Proceder con la originación"
4B sugiere: "Proceder con la origen"      <- concordancia rota Y significado destruido
```

El validador lo marcó **PASS** en `GLOSSARY_ORIGINACION` (la jerga desapareció) y
en `NO_INVENTED_ACTION` (no inventó una acción). Pero es un defecto de fidelidad
semántica: "origen" no significa "originación", y "la origen" es agramatical.
`qwen3.5:9b` fue el único que se abstuvo de romper el significado.

**Limitación reconocida del validador:** detecta acciones inventadas, no
degradación de significado. Cerrar ese hueco es trabajo de una fase posterior.

### Contaminación de tokens de control — `qwen3:1.7b`

El modelo de producción filtró literalmente su token de control a la salida:

```
"suggestion": "Ingresa tus credenciales /no_think"
"suggestion": "hola ,María /no_think"
```

Y en los textos largos devolvió **meta-comentario en lugar del texto corregido**:

```
"suggestion": "El texto está bien escrito y cumple con los criterios de
               claridad, concisión, utilidad y predictibilidad."
```

Eso es lo que produce sus 3 fallos de `PROTECTED_PLACEHOLDERS_PRESERVED` y
6 de `MULTILINE_SAFE`: no perdió los placeholders al reescribir, **nunca devolvió
el texto**. Es una violación del contrato de salida.

**Advertencia de alcance:** esto se midió con el system prompt del benchmark, **no**
con el prompt de producción. No se puede concluir que producción tenga este defecto
hoy. Sí justifica revisarlo cuando la fase lo permita.

---

## Critical Failures

| Check crítico | 4B | 9B | 1.7B |
|---|---|---|---|
| `JSON_VALID` | 0 | 0 | 0 |
| `SPANISH_OUTPUT` | 0 | 0 | 0 |
| `NO_EMPTY_SUGGESTION` | 0 | 0 | 0 |
| `NO_INVENTED_ACTION` | 0 | 0 | 0 |
| `PROTECTED_PLACEHOLDERS_PRESERVED` | 0 | 0 | **3** |
| `NO_APPBANCO` / `NO_NOFUE` / `NO_HAYERRORES` | 0 | 0 | 0 |
| **Total** | **0** | **0** | **3** |

Resultados por categoría de STEP 18, sobre 144 corridas:

- JSON inválido repetido: **0**. Los 3 modelos produjeron JSON parseable y con el
  contrato de tipos correcto en **144/144** corridas, sin gramática forzada.
- Placeholders perdidos: **0** en 4B y 9B; **3** en 1.7B.
- Acciones de producto inventadas: **0** en los 3 modelos.
- Contaminación en inglés: **0** en los 3.
- Fronteras de token corrompidas (`AppBanco`, `nofue`, `hayerrores`): **0** en los 3.
- Sugerencias vacías: **0** en los 3.
- Funcionalidad alucinada: **0** detectada.

---

## Memory

Medido con `ollama ps`, `vm_stat`, `sysctl vm.swapusage` y RSS agregado de los
procesos de Ollama. No se desactivó swap, no se cerraron aplicaciones, no se
cambió configuración de memoria.

| Modelo | `ollama ps` | RSS agregado | Ubicación | Swap durante la corrida |
|---|---|---|---|---|
| `qwen3.5:4b` | 3.1 GB | 4.70 → 4.75 GB | **100 % GPU** | 507 MB usados, sin variación |
| `qwen3.5:9b` | 5.4 GB | 6.38 → 6.44 GB | **100 % GPU** | 499 MB usados, sin variación |
| `qwen3:1.7b` | 1.6 GB | ver nota | **100 % GPU** | 499 MB usados, sin variación |

Los tres modelos cargaron **enteramente en GPU**, sin offload a CPU. El uso de swap
**no cambió** en ninguna corrida: sobre 24 GB no hubo presión de memoria.
Ni siquiera el 9B, el más pesado, se acercó a un límite.

**Caveat de medición:** durante la corrida de `qwen3:1.7b`, `qwen3.5:9b` seguía
residente por su `keep_alive` de 10 min. Su RSS agregado (8.02 GB) refleja
**ambos modelos**. La cifra limpia y atribuible al 1.7B es la de `ollama ps`: **1.6 GB**.
Las mediciones de 4B y 9B no están contaminadas.

---

## Screen Audit Projection

Proyección **aritmética simple** sobre el p50 warm: `n × p50`. Secuencial, sin batching.

| Modelo | p50 | 5 textos | 10 textos | 15 textos | 20 textos |
|---|---|---|---|---|---|
| `qwen3.5:4b` | 4.97 s | **25 s** | **50 s** | **74 s** | **99 s** |
| `qwen3.5:9b` | 9.28 s | 46 s | 93 s | 139 s | 186 s |
| `qwen3:1.7b` | 1.62 s | 8 s | 16 s | 24 s | 32 s |

**Esto no es rendimiento de Screen Audit.** Es una multiplicación. No modela
batching, ni paralelismo, ni reutilización de contexto, ni el costo del propio
runtime, ni la latencia de Figma. La concurrencia no se probó (STEP 21) y el
batching cambiaría estas cifras sustancialmente. Úsese solo como cota superior
burda del caso secuencial.

---

## Comparación final

| Modelo | Warm p50 | Warm p95 | Quality pass | Fallos críticos | Memoria | Recomendación |
|---|---|---|---|---|---|---|
| `qwen3.5:4b` | 4.97 s | 9.13 s | 225/231 (97 %) | **0** | 3.1 GB, 100 % GPU | ✅ **default** |
| `qwen3.5:9b` | 9.28 s | 15.24 s | 222/231 (96 %) | **0** | 5.4 GB, 100 % GPU | ❌ no justifica su costo |
| `qwen3:1.7b` | 1.62 s | 4.17 s | 213/231 (92 %) | 3 | 1.6 GB, 100 % GPU | ⚠️ solo referencia |

---

## Recomendación

### Modelo: opción **A — `qwen3.5:4b` como default**

No "adaptativo por memoria". La decisión no la manda la RAM, la mandan los datos:

**Latencia.** 4.97 s p50 cumple el objetivo deseable (≤ 8 s) y también el objetivo
mejor (≤ 5 s). El 9B, con 9.28 s p50, **falla incluso el objetivo laxo**.

**Calidad.** El 9B **no compra calidad con su latencia**: 96 % contra 97 %. Es más
lento y no es mejor. En el único caso donde el 9B fue superior (C2, no destruir
"originación") lo fue por abstenerse, no por resolver. Esa ventaja aislada no
paga 2× de latencia en toda la superficie del producto.

**Memoria.** 3.1 GB contra 5.4 GB, ambos íntegramente en GPU y sin presión sobre
24 GB. Pero el 4B es el que hace viable la máquina de 16 GB, donde el 9B sería
apretado. Elegir 4B mantiene una sola configuración en toda la flota — lo que
elimina la necesidad de una política adaptativa y su complejidad.

**Invariantes críticos.** 4B y 9B empatan en **0 fallos críticos** sobre 48 corridas
cada uno: placeholders intactos, sin acciones inventadas, sin inglés, sin fronteras
de token rotas, JSON válido 48/48. El invariante más caro del producto —
`{{Jueves 10 de abril de 2026}}` byte por byte — se sostuvo perfecto en ambos.

**Screen Audit.** Con 4B, 10 textos proyectan ~50 s secuenciales y 20 textos ~99 s.
Es un punto de partida trabajable para optimizar con batching. Con 9B, 20 textos
son ~186 s: eso ya no es una pantalla de carga, es abandonar la tarea.

### `keep_alive` recomendado: **`30m`**

El arranque en frío del 4B cuesta **+3.80 s**, un +86 % sobre la latencia warm.
Con `10m` (lo usado en el benchmark) un usuario que analiza textos de forma
intermitente paga ese costo repetidamente. `30m` cubre una sesión de diseño real
por 3.1 GB de residencia — barato en una máquina de 16 GB o más.

Para Screen Audit específicamente, conviene precalentar el modelo **al abrir el
plugin**, no al disparar la auditoría: mueve los 3.8 s fuera del camino crítico.

### Condiciones que la recomendación NO cubre

Tres defectos son **del sistema, no del modelo**, y ninguno se arregla eligiendo
pesos distintos — los tres modelos fallaron igual:

1. **`prestamo` sin tilde no se corrige** (0/3 en los tres modelos). Necesita una
   capa ortográfica determinista en el runtime local, no un LLM.
2. **`credenciales` no se traduce a lenguaje de usuario** (0/3 en los tres). Necesita
   el glosario de producto en el prompt del runtime.
3. **El 4B puede degradar significado** ("originación" → "la origen"). Necesita un
   validador de fidelidad semántica que hoy no existe.

Los tres ya están asignados al runtime local en `docs/architecture.md`. Ninguno
bloquea esta fase, pero **los tres deben resolverse antes de que lo local reemplace
a producción**.

---

## Veredicto

**El experimento respalda mover la inferencia a local.** En esta M4 de 24 GB, el
4B local warm responde en ~5 s contra los ~12–15 s observados en el VPS, con cero
fallos críticos, sin presión de memoria y sin salir de la máquina. Pero la decisión
de reemplazar producción **no se toma con este documento**: requiere que las tres
condiciones de arriba estén resueltas y que se valide en hardware de 8 y 16 GB,
que no se probó aquí.

- **FASE 8.5.0 — GO**
- **FASE 8.5.1 — GO**

**No se avanza automáticamente a FASE 8.5.2.**
