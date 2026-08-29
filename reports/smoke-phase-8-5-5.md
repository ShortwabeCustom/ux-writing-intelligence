# Smoke manual FASE 8.5.5 — escenarios C, D, E, F

**Fecha:** 29 de agosto de 2026
**Equipo:** MacBook Air M4, 24 GB, macOS 26.5.2
**Plugin ID:** 1674592820827897160
**Runtime local:** `127.0.0.1:8787` · **Ollama:** `127.0.0.1:11434` · **Modelo:** `qwen3.5:4b`
**Nube:** `writing.productdesign.mx` (`46.225.236.4`)
**Ejecutado en:** Figma Desktop, evidencia por captura de pantalla.

> Los escenarios A y B no se ejecutaron en esta sesión.

---

## Resumen

| | Escenario | Resultado |
|---|---|---|
| C | AUTO + motor local caído → Nube (previo al envío) | **PASS** |
| D | Fallo local **después** del POST → sin nube automática | **PASS** |
| E | Retry explícito hacia la nube | **NO CONFIRMADO** |
| F | Solo local + runtime caído → cero nube | **PASS** |

Tres de cuatro pasan. E no se pudo observar de forma fiable por un defecto
en la propia interfaz de recuperación (ver «Defectos abiertos»).

---

## C — AUTO + motor local caído → Nube

**Condiciones:** modo Automático · API Key configurada · runtime detenido antes de analizar.

**Observado**

1. Antes de pulsar nada, la fila mostraba `● Nube / El motor local no está
   disponible.`, con la nota «Listo para analizar en la nube».
2. Durante la carga: «Analizando contenido… / Procesando en la nube».
3. Resultado 100/100, Ortografía 5/5, sin cambios propuestos.

**Veredicto: PASS.** La condición real de esta prueba no es que la nube
funcione, sino que **el cambio de motor sea visible antes de que el texto
salga del equipo**. Se cumplió: el destino se anunció en la pantalla previa,
no después.

**Extra observado:** la fila pasó sola de `Local` a `Nube` al refrescarse el
estado, sin intervención. El texto largo con placeholders volvió íntegro.

---

## D — Fallo local después del POST ⚠️ crítico

**Condiciones:** modo Automático · API Key configurada · runtime vivo al iniciar.

**Procedimiento**

1. Analizar el texto largo (279 caracteres) con el motor local.
2. Congelar el proceso con `kill -STOP` durante la petición.
3. Terminarlo con `kill -KILL`, cortando la conexión ya establecida.

**Observado**

1. Carga inicial: «Analizando contenido… / Procesando en esta Mac».
2. A los ~8 s el mensaje cambió solo a «El análisis está tomando un poco más
   de lo habitual…», conservando «Procesando en esta Mac».
3. Al cortar la conexión apareció:

```
!  Motor local no disponible
   No pudimos iniciar el análisis local.
   [Reintentar]  [Usar análisis en la nube]
   El contenido se enviará al servicio en la nube para realizar el análisis.
```

4. **No apareció ningún resultado.**

**Veredicto: PASS.** Es el escenario que puede tumbar el release por sí solo.
La señal es inequívoca: un fallback silencioso habría pintado métricas; aquí
se pintó un error y el contenido se quedó quieto.

**Cobertura adicional:** confirma también el temporizador de carga extendida
(0–8 s / 8 s+) sin porcentajes falsos ni cuenta atrás.

---

## E — Retry explícito hacia la nube

**Veredicto: NO CONFIRMADO.**

La ejecución registrada mostró, durante la carga en la nube, la fila del motor
en `● Nube / El motor local no está disponible.`

Una sonda sobre el código compilado demuestra que el botón «Usar análisis en
la nube» **no emite ningún aviso de estado del motor**: fuerza el transporte
sin volver a consultar la salud local, de modo que la fila permanecería en
`Local`.

```
fila tras el fallo local:  ready
retry explícito → motor: cloud | avisos de estado nuevos: 0 | fila: ready
```

Por tanto lo observado corresponde a una **re-resolución de ruta** —«Reintentar»
o «Comprobar de nuevo» seguido de «Analizar texto»—, no a la acción explícita.
La evidencia no distingue E de C, así que E queda sin probar.

No es un error de ejecución: los botones de ese panel no son distinguibles por
pantalla en su estado actual. E no podrá observarse de forma fiable hasta
corregir el defecto 2.

---

## F — Solo local + runtime caído

**Condiciones:** modo Solo local · **API Key configurada** · runtime detenido.

Que la clave esté configurada es esencial: sin ella la prueba no demostraría
nada. Lo que se afirma es que **tener clave no abre ninguna puerta**.

**Observado**

*Ajustes:* «Solo local» seleccionado · «Motor local: No disponible» · «Clave
configurada» intacta.

*Pantalla principal:*

```
● Sin motor disponible        (indicador rojo)
  Motor local no disponible.

[ Analizar texto ]            ← deshabilitado
  Motor local no disponible.
```

**Veredicto: PASS.** Cero ofrecimiento de nube: ni botón, ni sugerencia, ni
ruta. El bloqueo ocurre en la resolución de ruta, antes de enviar nada.

**Extra observado**

- **No aparece la fila de API Key.** En Solo local la clave es irrelevante y
  la UI ya no la presenta como requisito.
- **Sin detalles de infraestructura**: ni `127.0.0.1`, ni puerto, ni «Ollama»,
  ni «uvicorn». El bloqueo se explica en lenguaje de producto.
- El modo persistió entre cambios sin destruir la API Key.

---

## Evidencia instrumental

Registro del runtime durante el análisis local de D:

```json
{"event": "analysis_ok", "analysis_duration_ms": 7904.0,
 "high_quality_noop": true, "issue_count": 0, "score": 100.0,
 "ollama_call_count": 1, "semantic_regeneration_used": false,
 "structured_retry_used": false, "text_length": 279}
```

**Privacidad de registros:** búsqueda de «visita», «confirmada», «domicilio»,
«María» y «Jueves» sobre el registro completo → **0 coincidencias**. Se
registra la longitud del texto (279), nunca su contenido, ni la sugerencia,
ni el prompt.

**Sockets** durante toda la sesión: `127.0.0.1:8787` y `127.0.0.1:11434`;
**0 listeners en `0.0.0.0`**.

**Coincidencia útil:** el mismo texto obtuvo 100/100 por motor local (D) y por
nube (C). El resultado no depende del motor.

---

## Defectos abiertos

Ambos en el panel de recuperación tras un fallo local. Ninguno viola la regla
dura de la fase —la ruta siempre se decide antes de enviar— pero los dos
rompen la correspondencia entre el motor mostrado y el motor usado (STEP 38 y
39).

### 1. «Reintentar» puede derivar a la nube

El estado de salud se reutiliza 30 s. Pasada esa ventana, «Reintentar»
re-resuelve la ruta y, en modo Automático con clave configurada, envía el
texto a la nube. En el instante del clic la fila todavía decía `Local`.

Verificado sobre el código compilado:

```
estado inicial:            ready
1er intento →              local
«Reintentar» tras 31 s →   cloud   (1 petición a la nube)
```

Agravante: el comportamiento depende del reloj. La misma acción hace dos cosas
distintas según cuánto se tardó en pulsarla. Además anula el diseño de dos
botones: si «Reintentar» a veces significa nube, la acción explícita deja de
significar algo.

Origen: el spec de 8.5.5 (STEP 29) pedía un botón «Reintentar local»; se
implementó como «Reintentar» conectado al flujo genérico, que reenruta.

### 2. El retry explícito muestra el motor equivocado

«Usar análisis en la nube» fuerza el transporte sin refrescar la salud local,
así que la fila sigue diciendo `Local` mientras el contenido se procesa en la
nube.

| Acción | Fila del motor | Destino real | |
|---|---|---|---|
| «Reintentar» tras 30 s | `Local` | nube | ✗ |
| «Usar análisis en la nube» | `Local` | nube | ✗ |

---

## Corrección propuesta

1. «Reintentar» fuerza transporte **local** y se renombra **«Reintentar
   local»**: no podrá derivar a la nube en ninguna circunstancia.
2. El retry explícito publica el motor real, para que la fila diga `Nube`
   cuando se procesa en la nube.
3. Pruebas de regresión para ambos.

**Impacto en lo ya probado:** ninguno sobre C, D y F. C es enrutamiento previo
al envío, D termina en el panel de error sin pulsarlo y F bloquea antes.
Solo habría que ejecutar **D → E** una vez más.

---

## Pendiente para cerrar el gate

- **A** — AUTO + local listo → `prestamo` → `préstamo`
- **B** — Solo local → `¿Como funciona?` → `¿Cómo funciona?` con Ortografía 4
- **E** — tras corregir el defecto 2

---

# Corrección y revalidación — FASE 8.5.5.2

**Fecha:** 29 de agosto de 2026

Las observaciones anteriores se conservan tal cual. Esta sección documenta la
corrección de los tres defectos y el estado de la revalidación.

---

## Defecto 1 — «Reintentar» podía acabar en la nube

### Causa raíz

El botón de recuperación estaba conectado a `requestAnalysis`, el flujo
genérico de análisis, que **vuelve a resolver la ruta**. Como el estado de
salud local se reutiliza 30 s, al caducar esa ventana la resolución encontraba
el motor caído y —en Automático con nube configurada— elegía la nube.

Ningún transporte quedaba fijado por la acción: lo decidía la política general
en el momento del clic. De ahí que el comportamiento dependiera del reloj.

Origen: el spec de FASE 8.5.5 (STEP 29) pedía «Reintentar local»; se
implementó como «Reintentar» reutilizando el flujo genérico.

### Corrección

- Nuevo intento tipado **`RETRY_LOCAL_ANALYSIS`**, con transporte **fijo**.
- En el hilo principal la rama `forcedTransport === 'local'` **no consulta la
  política de AUTO**: asigna `transport: 'local'` incondicionalmente. Ni el
  modo, ni la antigüedad de la caché, ni tener API Key configurada pueden
  cambiar ese destino.
- La salud local se refresca **solo para el indicador**; ese dato no participa
  en la elección de transporte.
- Si el motor sigue caído, el resultado correcto es **otro error local**.
- La API Key no se lee: `transportRequiresApiKey('local') === false`.
- Copia del botón: **«Reintentar local»** (STEP 7). Comunica la consecuencia
  de transporte, no es cosmética.

---

## Defecto 2 — El retry explícito mostraba el motor equivocado

### Causa raíz

La fila del motor se derivaba de `currentRoute()`, que a su vez depende de
`localRuntimeState`. Pero **el estado del motor local y el transporte en uso
son cosas distintas**: con el motor caído y un retry explícito a la nube, el
motor activo es la nube aunque la salud local diga «no disponible».

`USE_CLOUD_FOR_CURRENT_ANALYSIS` fuerza el transporte sin refrescar la salud,
así que no se emitía ningún aviso de estado y la fila permanecía en `Local`.

Verificado sobre el código compilado antes de corregir:

```
fila tras el fallo local:  ready
retry explícito → motor: cloud | avisos de estado nuevos: 0 | fila: ready
```

### Corrección

- Nuevo módulo **`src/engine-display.ts`** con `resolveEngineDisplay`, función
  pura que decide la etiqueta. **El transporte real tiene prioridad** sobre la
  ruta prospectiva.
- La interfaz fija el transporte **desde el clic**, no al recibir respuesta:
  ambos botones de recuperación llaman a `startAnalysis(mensaje, transporte)`.
  Así la fila y la etiqueta de carga dicen la verdad antes de que salga la
  petición.
- Se extrajo la lógica a un módulo puro precisamente para poder probarla: no
  hay arnés de DOM en el proyecto, y una prueba por `grep` sobre el fuente no
  habría demostrado nada.

---

## Defecto 3 — Contraste ilegible en tema oscuro

### Causa raíz

Todo el plugin usa los tokens que Figma inyecta con `themeColors`
(`--figma-color-text`, `--figma-color-text-secondary`, …). En FASE 8.5.5 se
introdujeron en el bloque nuevo `--text-primary` y `--text-secondary`, **que no
existen en ninguna parte del proyecto**. Cada regla caía a su literal de
reserva —`#1a1a1a` casi negro y `#6b6b6b` gris oscuro— sobre la superficie
oscura de Figma.

Afectaba a: opciones de modo y sus descripciones, «MOTOR LOCAL», el estado del
runtime, y las etiquetas y detalles del motor activo.

### Corrección

- Todo el bloque reescrito con los tokens reales del resto del plugin.
- Puntos de estado por token semántico: `--figma-color-icon-success`,
  `--figma-color-icon-brand`, `--figma-color-icon-danger`,
  `--figma-color-icon-warning`.
- **Una opción no seleccionada no se dibuja como deshabilitada**: mismo color
  de texto que la seleccionada; la selección se distingue por borde y fondo.
- No se rediseñó nada: solo se sustituyeron los colores por tokens.

---

## Pruebas añadidas

| Prueba | Verifica |
|---|---|
| «Reintentar local» a 0 s / 31 s / 60 s | 1 intento local, **0 a la nube**, en las tres |
| «Reintentar local» + API Key configurada | el secreto no aparece en la petición |
| «Reintentar local» con el motor recuperado | reintenta en local y tiene éxito |
| Retry explícito | **exactamente 1** petición a la nube, 0 reintentos locales extra |
| Retry explícito | `X-API-Key` solo a la nube |
| Retry explícito | anuncia la nube **antes** del resultado |
| Motor anunciado vs transporte real | coinciden en AUTO→Local, AUTO→Nube, Solo local, Solo nube |
| `resolveEngineDisplay` | el transporte real manda sobre la ruta (18 combinaciones) |
| Motivos de bloqueo | copia distinta por motivo, sin infraestructura |

Las aserciones a cero no son vacías: el mismo arnés detecta correctamente la
petición real en el test del retry explícito.

**Totales:** plugin **193/193** (era 177) · typecheck **PASS** · build **PASS**.
Runtime **160/160**, sin cambios (STEP 10), por lo que no se repitieron
benchmarks del modelo.

---

## Revalidación manual

| | Escenario | Resultado |
|---|---|---|
| A | AUTO + local listo → `préstamo` | pendiente |
| B | Solo local → `¿Cómo funciona?`, Ortografía 4 | pendiente |
| C | AUTO + local caído → Nube | PASS (sesión anterior) |
| D | Fallo local tras POST → sin nube automática | pendiente de repetir |
| E | Retry explícito a la nube | pendiente |
| F | Solo local + runtime caído → cero nube | PASS (sesión anterior) |
| — | «Reintentar local» con panel abierto >30 s | pendiente |
| — | Contraste legible en Ajustes | pendiente |

C y F no requieren repetición: C es enrutamiento previo al envío y F bloquea
antes de enviar; ninguno pasa por el panel de recuperación que cambió.

---

## Estado del gate

**FASE 8.5.5 = NO-GO.** Los tres defectos están corregidos y cubiertos por
pruebas, pero el gate exige evidencia manual en Figma Desktop real, y A, B, D,
E y las dos comprobaciones nuevas siguen sin ejecutarse.

---

# Procedencia explícita — FASE 8.5.5.3

**Fecha:** 29 de agosto de 2026

Observado en Figma Desktop real durante un retry explícito: la copia de carga
decía «Procesando en la nube», pero la tarjeta de motor seguía diciendo
«Local / Procesado en esta Mac», y el resultado se atribuía al motor local.

## Causa raíz

En FASE 8.5.5.2 la **decisión** de la etiqueta ya era correcta —el transporte
real tenía prioridad sobre la ruta prospectiva— pero faltaba el **repintado**:

`renderAnalysis()` no llamaba a `renderEngineRow()`. La tarjeta solo se
repintaba desde `renderApiKeyIndicator`, que se dispara por cambio de
selección, aviso de estado del runtime o cambio de modo. Ninguno de los tres
ocurre durante un retry explícito, así que la copia de carga se actualizaba
—se pinta en `renderAnalysis`— y la tarjeta quedaba congelada.

Dos defectos distintos con el mismo síntoma: 8.5.5.2 arregló *qué decidir*,
8.5.5.3 arregla *cuándo repintar*.

## Corrección

**1. La procedencia vive dentro del estado.** `AnalysisUiState` lleva ahora un
campo `transport` en `loading`, `success` y `error`. El estado de éxito lo
**hereda** de la carga que lo originó; no se recalcula en ningún punto. Un
resultado de la nube sigue siendo de la nube aunque el motor local vuelva a
estar listo mientras se mira en pantalla.

**2. Se eliminó la variable mutable `activeAnalysisTransport`.** Era una
segunda fuente de verdad que podía desincronizarse de lo que se pintaba.

**3. `renderAnalysis()` repinta la tarjeta.** Carga, tarjeta y resultado leen
ahora la misma procedencia.

**4. El hilo principal manda.** La interfaz fija el transporte de forma
optimista al pulsar —para que la tarjeta diga «Nube» desde el clic— y
`ANALYSIS_STARTED` lo corrige si el hilo principal enrutó de otro modo.

### Conceptos que ya no se confunden

| Concepto | Significado |
|---|---|
| `localRuntimeState` | si el motor local existe y está sano |
| `analysisMode` | preferencia de la persona |
| ruta resuelta | motor de la **siguiente** petición |
| `transport` en el estado | motor que procesó **esta** petición |

La pantalla de resultado usa el último, nunca el primero.

## Pruebas añadidas

| Prueba | Verifica |
|---|---|
| Resultado local | procedencia local |
| Resultado Solo nube | procedencia nube |
| Enrutamiento previo a nube | procedencia nube |
| Retry explícito tras fallo local | procedencia nube, ya en la carga |
| **Motor local vuelve a listo con resultado de nube visible** | la procedencia sigue siendo nube |
| Carga y resultado | coinciden con el transporte, incluso con la ruta prospectiva contraria |
| Transporte optimista erróneo | el hilo principal lo corrige |
| Fallo local | conserva su procedencia |
| Nueva petición | no hereda la procedencia anterior |
| Guardas de cableado | `renderAnalysis` repinta; no reaparece la variable suelta |

Las dos últimas leen el fuente en vez de ejecutar la interfaz. Son débiles y
están aisladas y etiquetadas como tales: no hay arnés de DOM en el proyecto, y
el fallo de 8.5.5.3 fue precisamente de cableado, que las pruebas puras no
pueden detectar. Es la limitación más relevante de esta suite.

**Totales:** plugin **204/204** (eran 193) · typecheck **PASS** · build **PASS**.
Runtime **160/160**, sin cambios.

## Revalidación manual

Solo **D → E**. Los tres estados deben decir Nube:

1. tarjeta al pulsar «Usar análisis en la nube»;
2. copia de carga;
3. pantalla de resultado.

| | Escenario | Resultado |
|---|---|---|
| D | Fallo local tras POST | pendiente |
| E | Retry explícito, procedencia nube en los 3 estados | pendiente |

A, B, C y F no requieren repetición: no cambió el enrutamiento, solo la
procedencia mostrada.

**FASE 8.5.5 = NO-GO** hasta esa evidencia.

---

# Validación manual final — FASE 8.5.5

**Fecha:** 29 de agosto de 2026 · Figma Desktop real, MacBook Air M4 / 24 GB.

## Escenarios

| | Escenario | Resultado |
|---|---|---|
| A | AUTO + motor local listo | **PASS** |
| B | Solo local sin API Key de nube | **PASS** |
| C | AUTO + local caído antes del envío → Nube | **PASS** |
| D | Fallo local tras el POST → sin nube automática | **PASS** |
| E | «Usar análisis en la nube» explícito | **PASS** |
| F | Solo local + runtime caído → cero nube | **PASS** |

## Corrección de la recuperación

| Comprobación | Resultado |
|---|---|
| «Reintentar local» → solo local | **PASS** |
| Retry explícito → la tarjeta muestra Nube de inmediato | **PASS** |
| Carga → «Procesando en la nube» | **PASS** |
| Procedencia del resultado → sigue siendo Nube | **PASS** |
| Contraste en tema oscuro | **PASS** |

## Corroboración instrumental

El registro del runtime documenta A y B de forma independiente:

```json
{"text_length": 8,  "orthography_override_used": true, "issue_count": 1,
 "score": 97.0, "ollama_call_count": 1, "analysis_duration_ms": 5002.9}

{"text_length": 15, "orthography_override_used": true, "issue_count": 1,
 "score": 97.0, "ollama_call_count": 2, "analysis_duration_ms": 10704.0,
 "semantic_regeneration_used": true, "semantic_rejection_used": true}
```

`prestamo` son 8 caracteres; `¿Como funciona?`, 15. En ambos actuó la
corrección ortográfica determinista.

**B disparó regeneración semántica:** la primera sugerencia del modelo fue
rechazada por la capa semántica y se regeneró, con dos llamadas al modelo y
10,7 s frente a los 5,0 s de A. Es la capa de seguridad funcionando, y duplica
la latencia. Queda como caso de referencia para caracterizar la regeneración.

**Colisión de puerto observada de paso:** un segundo arranque del runtime con
el puerto ocupado falló con mensaje claro, sin matar el proceso existente y sin
cambiar de puerto en silencio.

## Base automatizada

Plugin **204/204** · typecheck **PASS** · build **PASS**
Runtime **160/160**, sin modificar.

---

# FASE 8.5.5 = GO
