# FASE 9.2A — Banco de estrategias de Screen Audit

**Fecha:** 29 de agosto de 2026
**Equipo:** MacBook Air M4 · 24 GB · macOS 26.5.2
**Modelo:** `qwen3.5:4b` · temperatura 0 · semilla 42 · `num_ctx` 4096 · `keep_alive` 30m
**Identidad de análisis:** `qwen3.5:4b|single-v1|v2|8.5.6`

Ninguna medición modifica producción. El runtime se usó tal cual está
publicado en `cf9cbcc`.

---

## 1. Metodología

**Fixture:** pantalla sintética de **20 candidatos** listos, con catorce
categorías (encabezado, cuerpo, CTA, CTA secundario, etiqueta de campo, ayuda,
confirmación, error, navegación, pregunta, respuesta corta, informativo, texto
largo multilínea, texto personalizado con marcador). Contenido inventado y
saneado: no procede de ningún archivo real.

Incluye a propósito material adverso: falta de tilde (`prestamo`,
`identificacion`, `codigo`, `esta`), jerga de glosario (`credenciales`),
interrogativo sin tilde (`¿Como funciona?`), marcadores `{{ }}`, un texto
multilínea, una respuesta de dos caracteres (`Sí`) y **un CTA duplicado
exacto** en dos contenedores distintos.

**Reproducción:**

```
./scripts/run_local.sh
.venv/bin/python scripts/phase_9_2a_bench.py
.venv/bin/python scripts/phase_9_2a_control.py
```

Salidas: `reports/phase-9-2a-raw.json` y `reports/phase-9-2a-control.json`.

---

## 2. Control de reproducibilidad

**Esto se midió primero, y condiciona la lectura de todo lo demás.**

Se ejecutó la línea base secuencial **dos veces** y se compararon los
resultados individuales entre sí, con el mismo comparador que se usa contra el
lote:

| Métrica | Individual A contra individual B |
|---|---|
| Candidatos comparados | 20 |
| Fallos críticos | **0** |
| Acuerdo en no-op | **20/20** |
| Acuerdo en ortografía | **20/20** |
| Delta de puntuación medio | **0,0** |
| Delta de puntuación máximo | **0,0** |

El análisis individual es **perfectamente reproducible**. Con temperatura 0 y
semilla fija, dos corridas dan resultados idénticos.

**Consecuencia:** toda divergencia observada en modo lote es atribuible **al
lote**, no a la variabilidad del modelo. Sin este control, cualquier
conclusión sobre calidad del lote habría sido un error de atribución.

---

## 3. S0 — Línea base secuencial

Una petición de producción por candidato, contra `/v1/analyze/text`.

| Candidatos | Total | TTFR | 25 % | 50 % | Llamadas | Textos/s |
|---:|---:|---:|---:|---:|---:|---:|
| 5 | 27,13 s | 5,12 s | 5,12 s | 10,4 s | 5 | 0,184 |
| 10 | 51,97 s | 5,12 s | 12,9 s | 25,9 s | 10 | 0,192 |
| 15 | 76,90 s | 5,12 s | 20,0 s | 38,7 s | 15 | 0,195 |
| **20** | **104,03 s** | **5,12 s** | 27,1 s | 52,0 s | 20 | 0,192 |

Promedio por candidato: **5,20 s**. Cero fallos. RSS del runtime estable.

---

## 4. S1 — Secuencial progresiva

S0 y S1 ejecutan **exactamente las mismas llamadas**. La diferencia no está en
cuánto se calcula sino en cuándo se muestra, así que se midieron juntas y se
derivan de la misma corrida.

| | S0 (todo al final) | S1 (progresiva) |
|---|---:|---:|
| Primer resultado útil | 104,03 s | **5,12 s** |
| Cadencia | — | un resultado cada ~5,2 s |
| Llamadas | 20 | 20 |
| Total | 104,03 s | 104,03 s |

**Sin reducir una sola llamada, el primer resultado útil llega 20 veces
antes.** Es la mejora más grande medida en toda la fase, y no cuesta ninguna
concesión de seguridad.

---

## 5. S2 — Reutilización exacta y segura

Identidad conservadora: texto exacto + contexto exacto + locale + versión de
análisis. Sin recorte, sin minúsculas, sin similitud semántica.

| Métrica | Valor |
|---|---:|
| Candidatos | 20 |
| Textos distintos | 19 |
| **Textos exactamente duplicados** | **1** |
| Combinaciones texto + contexto distintas | 20 |
| **Reutilizables dentro de la pantalla** | **0** |
| **Ratio de reutilización** | **0,0** |

La pantalla contiene «Confirmar visita» **dos veces**: una en `Footer` y otra
en `Modal`. El texto es idéntico; el contexto no. La identidad conservadora se
niega a reutilizar, y hace bien: el mismo rótulo en un pie de pantalla y en un
modal de confirmación no son necesariamente el mismo problema de UX Writing.

**Conclusión honesta: la reutilización exacta no aporta nada a la primera
corrida de una pantalla.** Podría aportar entre corridas repetidas del mismo
archivo, que es un escenario real durante el diseño, pero eso no se ha medido
y no se afirma.

---

## 6. S3 — Mini-lotes

| Lote | Total | contra S0 | Llamadas | **TTFR** | Latencia p50 | **Elementos perdidos** |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 129,00 s | **+24,0 %** | 20 | 6,50 s | 6,25 s | 0 |
| 2 | 107,92 s | **+3,7 %** | 10 | 11,45 s | 11,22 s | **1** |
| 4 | 85,50 s | **−17,8 %** | 5 | 20,49 s | 19,71 s | **3** |
| 6 | 96,72 s | **−7,0 %** | 4 | 28,55 s | 28,57 s | 0 |

### 6.1 Pérdida silenciosa de elementos

**El hallazgo decisivo.** Con lotes de 2 y 4, el modelo devolvió **menos
elementos de los que recibió**:

- lote de 2: se perdió `c08` («Ingresa tus credenciales»);
- lote de 4: se perdieron `c10`, `c11` y `c12` — dos mensajes de error y una
  pregunta de ayuda.

Cuatro de veinte candidatos desaparecieron. El validador de aislamiento lo
detectó, así que no habría corrupción silenciosa, pero la consecuencia de
producto es grave: **textos de la pantalla que simplemente no se auditan**, y
la persona no tendría forma de saber cuáles.

Que el lote de 6 no perdiera ninguno no lo rehabilita: es una sola corrida de
cuatro llamadas, y el formato ya demostró que puede omitir elementos.

### 6.2 Contaminación entre elementos

Cero migración de marcadores, de sugerencias y de razones entre elementos, en
todos los tamaños. Los problemas registrados fueron **exclusivamente de
conteo**, no de mezcla de contenidos.

### 6.3 Calidad, individual contra lote

En los elementos que el lote **sí** devolvió:

| Lote | Comparados | Críticos | Ortografía | Jerga | Categorías | **No-op** | Δ puntuación medio |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 20 | **0** | 20/20 | 20/20 | 20/20 | **17/20** | 3,60 |
| 2 | 19 | **0** | 19/19 | 19/19 | 19/19 | **16/19** | 4,26 |
| 4 | 17 | **0** | 17/17 | 17/17 | 17/17 | **14/17** | 1,24 |
| 6 | 20 | **0** | 20/20 | 20/20 | 20/20 | **15/20** | 1,40 |

**Cero fallos críticos de seguridad en todos los tamaños.** Ortografía, jerga
y categorías de hallazgo coinciden al 100 %, porque las produce la capa
determinista y esa capa no depende del formato de la llamada. Es, una vez más,
la misma lección de 8.5.2: **el modelo no es la capa de seguridad**.

Pero el **no-op discrepa en 3 a 5 elementos de cada 20**. Dado que el control
demostró reproducibilidad perfecta, esa discrepancia es enteramente del
formato de lote: el modelo cambia su veredicto sobre si un texto ya está bien
según con qué otros textos venga acompañado. Para una herramienta cuyo valor
es decir «esto ya está bien» o «esto se puede mejorar», es una inconsistencia
de fondo, no un detalle.

Nótese que **el lote de 1 también discrepa** (17/20). Ese tamaño no lleva
ningún otro texto: lo único que cambia frente a producción es el prompt. Es
decir, parte de la divergencia no viene de agrupar sino de haber reformulado
la instrucción, y eso acota cuánto puede atribuirse al agrupamiento en sí.

---

## 7. Concurrencia controlada

Seis candidatos, uno contra dos trabajadores simultáneos:

| Trabajadores | Total | Textos/s | RSS |
|---:|---:|---:|---:|
| 1 | 28,32 s | 0,212 | 42,9 MB |
| 2 | 28,54 s | 0,210 | 43,0 MB |

**Ningún beneficio.** Dos peticiones simultáneas tardan lo mismo que en serie,
o marginalmente más. Ollama sirve un modelo cargado de una en una y encola
internamente; el paralelismo del cliente no compra tiempo, solo lo reparte.

Esto cierra la vía: no hay que implementar ejecución paralela.

---

## 8. Caracterización de fallos de lote

Se sometió el validador de aislamiento a salidas deliberadamente rotas:

| Fallo | ¿Detectado? |
|---|---|
| Elemento ausente | **Sí** |
| Identificador duplicado | **Sí** |
| Identificador inventado | **Sí** |
| Elemento de más | **Sí** |
| Sugerencia migrada de otro elemento | **Sí** |

Los cinco se detectan. Un elemento malformado **no puede corromper en
silencio** al resto del lote.

**Política recomendada si algún día se adoptara el lote:** fallo **por
elemento**, no de todo el lote. Perder veinte análisis por un identificador
mal escrito sería desproporcionado. Pero eso implica reanalizar
individualmente cada elemento perdido, lo que erosiona precisamente el ahorro
que justificaba el lote.

---

## 9. Regresión

| Suite | Resultado |
|---|---|
| Runtime | **236/236** |
| Banco canónico de 62 casos | **62/62**, 0 críticos FINAL |
| Plugin unitarias | **289/289** |
| Playwright | **46/46** |
| Typecheck · Build | **PASS** |

Ninguna expectativa del banco canónico se modificó. Ningún comportamiento de
producción cambió.

---

## 10. Limitaciones

1. **Un solo equipo y un solo modelo.** M4 / 24 GB con `qwen3.5:4b`.
2. **Una pantalla sintética de 20 candidatos.** Representativa por
   construcción, no por muestreo de archivos reales.
3. **Una corrida por tamaño de lote.** Suficiente para descartar por pérdida
   de elementos y por TTFR, no para caracterizar finamente la varianza del
   formato.
4. **El lote de 1 no es un control puro del agrupamiento**: cambia el prompt.
   Aísla el efecto del prompt, no el de agrupar.
5. **La reutilización entre corridas no se midió.** Solo se midió dentro de una
   pantalla, donde es cero.
6. **No se probó `num_ctx` mayor.** Los lotes grandes podrían estar limitados
   por ventana de contexto; ampliarla cambiaría memoria y latencia, y habría
   que volver a medir todo.
