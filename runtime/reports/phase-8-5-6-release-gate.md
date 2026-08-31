# FASE 8.5.6 — Compuerta de release

**Fecha:** 29 de agosto de 2026
**Equipo medido:** MacBook Air M4 · 24 GB · macOS 26.5.2
**Plugin ID:** `1674592820827897160` · **Modelo:** `qwen3.5:4b`

---

# Resumen ejecutivo

La migración de inferencia a un motor local está completa y medida. El
producto analiza contenido en la máquina de la persona usuaria, con la nube
como respaldo que **solo puede elegirse antes de enviar el texto**.

Todo lo automatizable está en verde: **222 pruebas** de plugin, **236** de
runtime, banco de 62 casos **62/62 con 0 fallos críticos finales**, y la
compuerta de rendimiento cumplida con holgura (**4,899 s** frente a un
objetivo de 8 s).

El smoke manual está completo, incluidos Apply y estilos mixtos, que eran la
única evidencia que faltaba.

**Veredicto: GO. La migración de IA local queda RELEASED.**

---

# Arquitectura

```
Figma Desktop
      |
      v
Política de enrutamiento          <-- decide ANTES de enviar el texto
      |
   +--+--------------------+
   |                       |
 LOCAL                   NUBE
   |                       |
localhost:8787   writing.productdesign.mx
   |
   v
Runtime de seguridad determinista
   |
   v
Ollama 127.0.0.1:11434 -> qwen3.5:4b
```

El hallazgo que sostiene todo esto viene de FASE 8.5.2 y conviene repetirlo:
**el modelo no es la capa de seguridad.** El 4B puntúa 82,3 % en bruto y
100 % dentro de la arquitectura determinista. Lo que garantiza el producto son
las capas de ortografía, glosario, contenido protegido, integridad de
fronteras y fidelidad semántica, no el criterio del modelo.

---

# Calidad

| | Resultado |
|---|---|
| Pruebas del plugin | **222 / 222** |
| Typecheck | **PASS** |
| Build | **PASS** |
| Pruebas del runtime | **236 / 236** |
| Banco de regresión | **62 / 62** |
| **Fallos críticos FINAL** | **0** |

Detalle del banco:

| Capa | Resultado |
|---|---|
| Salida estructurada válida | 62/62 |
| Contenido protegido | 62/62 |
| Glosario | 62/62 |
| Ortografía | 62/62 |
| Integridad de fronteras | 62/62 |
| Fuga de metatexto | 0 |
| Fallos de locale | 0 |
| Fallos semánticos | 0 |
| Objetivos deterministas esperados | 12/12 |

## Meta-pruebas añadidas en esta fase

Tres defectos de fases previas compartían forma: **una regla que corrige el
texto pero no se contabiliza**, dejando `orthography = 5` junto a un issue
visible. Las pruebas anteriores usaban listas escritas a mano, así que una
regla nueva entraba sin cobertura.

Ahora los casos se **derivan de las propias tablas de reglas**: añadir una
entrada al diccionario la somete automáticamente al contrato. 66 pruebas
nuevas cubren cada tilde de `SAFE_ACCENTS`, cada interrogativo, el sufijo
`-cion` y cada término del glosario.

Otra clase de fallo apareció **tres veces**: un tipo de mensaje declarado en la
unión pero ausente del `switch` del validador, que caía en `default: false` y
se descartaba en silencio. TypeScript no lo detecta. Se extrajo el validador
de `ui.ts` a un módulo propio —antes no se podía probar, porque ese fichero
toca el DOM al importarse— y una meta-prueba enumera los tipos declarados y
exige que cada uno tenga su caso.

---

# Rendimiento

| Escenario | n | p50 | p95 | Máx |
|---|---:|---:|---:|---:|
| Frío | 5 | 6,594 s | — | 7,749 s |
| **Caliente corto** | 20 | **4,899 s** | **5,086 s** | 5,270 s |
| Caliente medio | 10 | 5,773 s | — | 6,287 s |
| Caliente largo | 5 | 7,688 s | — | 8,106 s |
| Regeneración | 5 | 6,351 s | — | **13,429 s** |
| Arranque del runtime | 5 | 0,221 s | — | 0,236 s |

**Compuerta cumplida:** p50 de cortos **4,899 s** frente a un objetivo de 8 s;
p95 **5,086 s** frente a un deseable de 10 s.

El p95 solo se publica con n ≥ 20. Con cinco muestras sería ruido con
apariencia de dato; se publica el máximo, que sí informa.

**Frío contra caliente: +1,695 s.** Cargar 3,1 GB de pesos cuesta menos de dos
segundos con el modelo al 100 % en GPU.

**La regeneración duplica la latencia** (hasta 13,4 s). No es un fallo: es la
capa semántica rechazando una sugerencia infiel y pidiendo otra. Se comunica
con el mensaje de carga extendida a partir de los 8 s, sin porcentajes falsos.

Detalle completo en `phase-8-5-6-performance.md`.

---

# Enrutamiento

| Modo | Estado local | Nube configurada | Ruta |
|---|---|---|---|
| Automático | listo | sí | **Local** |
| Automático | listo | no | **Local** |
| Automático | no disponible | sí | **Nube** |
| Automático | no disponible | no | **Bloqueado** |
| Solo local | listo | cualquiera | **Local** |
| Solo local | no disponible | cualquiera | **Bloqueado** |
| Solo nube | cualquiera | sí | **Nube** |
| Solo nube | cualquiera | no | **Bloqueado** |

La implementación coincide: `resolveAnalysisTransport` es una función pura sin
red ni acceso a la API Key, y las pruebas recorren la matriz completa
comparando el motor anunciado con el transporte realmente invocado.

En Solo local la columna «nube configurada» es irrelevante **por diseño**: la
función no devuelve `cloud` en ese modo con ninguna entrada posible.

---

# Privacidad

| Escenario | ¿Sale texto a la nube? |
|---|---|
| Automático + local listo | **NO** (0 en 10 análisis) |
| Solo local | **NUNCA** (0 en 10 análisis, con clave configurada) |
| Timeout local tras el POST | **NO** |
| Respuesta local inválida | **NO** |
| Conexión caída durante el POST | **NO** |
| Retry explícito de la persona | **SÍ** (exactamente 1) |
| Automático, local caído antes de enviar | **SÍ, si está configurada** |
| Solo nube | **SÍ** |

**La distinción que sostiene todo:** la nube solo puede elegirse
automáticamente **antes** de que el texto salga. Una vez invocado el
transporte local, ningún fallo reencamina: hacerlo enviaría a un servicio
remoto un contenido que la persona pidió procesar localmente, sin que se
enterara.

Otras garantías verificadas contando tráfico real, no intenciones:

- **API Key hacia localhost: 0.** El transporte local envía solo
  `Content-Type`, y la clave ni siquiera se lee cuando la ruta es local.
- **El plugin nunca llama a Ollama.** 0 peticiones al puerto 11434 en los tres
  modos. El bundle compilado no contiene ese puerto.
- **Registros sin contenido.** Lista blanca de campos; lo demás se descarta y
  se reporta como `dropped_fields`. Verificado sobre registros reales de la
  sesión: 0 coincidencias buscando palabras del contenido analizado. Se
  registra `text_length`, nunca el texto.

---

# Seguridad

| Comprobación | Resultado |
|---|---|
| Runtime | `127.0.0.1:8787` |
| Ollama | `127.0.0.1:11434` |
| Listeners en `0.0.0.0` | **0** |
| Bindings a LAN | **0** |
| Dominios del manifest | los dos necesarios, sin comodines |
| ID del plugin | `1674592820827897160`, intacto |
| Secretos en fuente o build | ninguno |
| Puerto de Ollama en el bundle | ausente |
| URLs de prueba o overrides | ninguno |

**Un servicio ajeno en el puerto de Ollama nunca produce `runtime: ready`.**
El sondeo exige el catálogo `/api/tags` con el nombre exacto del modelo, y
`ready` requiere ambas condiciones. Como el plugin solo enruta a local con ese
estado, el texto de la persona no puede llegar a un servicio no verificado.
Cubierto con siete pruebas, incluida una coincidencia parcial de nombre
(`qwen3.5:4b-instruct` no cuenta como `qwen3.5:4b`).

---

# Fiabilidad

**Soak de 50 análisis secuenciales:** 0 fallos. RSS del runtime
`62,1 → 62,4 MB`, **crecimiento total 0,3 MB**, plano desde la décima
petición. Sin indicio de fuga.

Se ejecutaron 50 y no los 100 preferidos: la serie ya era plana y el coste
adicional no habría cambiado la conclusión. **Se declara para que la decisión
quede a la vista, no oculta tras un «cubierto».**

| Comprobación | Resultado |
|---|---|
| Ciclos parada/arranque | puerto liberado, sin huérfanos ni duplicados |
| Colisión de puerto | falla con mensaje claro, sin cambiar de puerto |
| Ollama caído | runtime `degraded`, sin caída del proceso |
| Carrera de salud | tratada como fallo posterior al POST, sin nube automática |
| 12 cambios de selección durante un análisis | resultado descartado |
| Peticiones simultáneas | solo la más nueva entrega resultado |
| Cambio de modo en vuelo | no redirige la petición en curso |

**`keep_alive: 30m` validado:** modelo residente tras analizar y tras el
reposo, reanálisis en 4,975 s sin recarga, `ollama ps` mostrando el contador.
**No se esperó a que expirara:** habría requerido 30 minutos de inactividad y
no cambia ninguna decisión. Lo que sí se verificó es que descargarlo a mano
fuerza el camino frío, ya medido.

---

# Smoke en Figma Desktop

Ejecutado y aprobado en FASE 8.5.5 sobre este mismo código:

| | Escenario | Resultado |
|---|---|---|
| A | AUTO + local listo | PASS |
| B | Solo local sin API Key | PASS |
| C | AUTO + local caído → Nube | PASS |
| D | Fallo local tras POST → sin nube automática | PASS |
| E | Retry explícito a la nube | PASS |
| F | Solo local + runtime caído → cero nube | PASS |
| — | «Reintentar local» → solo local | PASS |
| — | Procedencia de la nube en carga, tarjeta y resultado | PASS |
| — | Contraste en tema oscuro | PASS |

Cubiertos de forma incidental durante ese smoke: no-op de alta calidad
(100/100), integridad de placeholders (`{{Jueves 10 de abril de 2026}}` y
`{{6:00 p.m.}}` intactos, por local **y** por nube), texto largo multilínea, y
el mensaje de carga extendida a los 8 s.

## Apply y estilos mixtos

Ejecutado en Figma Desktop real. Era la única evidencia que faltaba para
cerrar la fase.

| Comprobación | Resultado |
|---|---|
| Apply funciona | **PASS** |
| `prestamo` → la capa dice `préstamo` | **PASS** |
| **Cmd+Z** nativo restaura `prestamo` | **PASS** |
| Sin reanálisis automático tras aplicar | **PASS** |
| Estilos mixtos: el análisis se permite | **PASS** |
| Estilos mixtos: Apply se bloquea | **PASS** |
| Sin corrupción de texto, fuente ni estilo | **PASS** |

El deshacer nativo es lo más significativo: confirma que Apply escribe a
través de la API de Figma como una edición ordinaria, y no por una vía que
dejaría a la persona sin poder revertir su propio documento.

Queda verificado además que **el transporte es irrelevante para Apply**: la
sesión aplicada procede de un análisis local, y el comportamiento es el mismo
que el del MVP.

**Figma Web: NO PROBADO.** Se sospecha que las restricciones de red privada
del navegador bloqueen `localhost`, pero no se ha verificado y no se afirma.
Si estuviera bloqueado, no se debilitará la seguridad local ni se expondrá el
runtime a la red.

---

# Limitaciones conocidas

1. **Requiere runtime local, Ollama y `qwen3.5:4b` instalados.** No hay
   instalador; el ciclo de vida es manual.
2. **Un solo equipo medido.** M4 / 24 GB. M1, M2, M3, 8 GB y 16 GB **no se han
   medido** y nada aquí se extrapola a ellos. Con 3,1 GB residentes, en 8 GB
   el comportamiento podría ser sustancialmente distinto.
3. **La regeneración semántica duplica la latencia**, hasta ~13 s, y no se
   puede predecir de antemano qué texto la disparará.
4. **La ventana de frescura del estado es de 30 s.** Puede mostrar un estado
   vencido; nunca afecta al destino real, que se resuelve de nuevo antes de
   enviar.
5. **Sin `AbortController`.** Cancelar el HTTP no cancelaría la inferencia ya
   en curso; ahorraría cómputo, no corrección.
6. **Compatibilidad con Figma Web sin caracterizar.**
7. **Las guardas de cableado de la interfaz leen el fuente.** No hay arnés de
   DOM en el proyecto, y el defecto de 8.5.5.3 fue precisamente de cableado:
   la decisión era correcta pero no se repintaba. Las pruebas puras no pueden
   detectar esa clase de fallo. **Es la limitación más relevante de la suite.**
8. **La nube no se ha optimizado ni medido a fondo.** Es respaldo.

---

# Preparación para Screen Audit

Proyección secuencial con las latencias medidas:

| Textos | Mezcla realista | Con 20 % de regeneración |
|---:|---:|---:|
| 5 | 33 s | 40 s |
| 10 | 66 s | 80 s |
| 15 | 99 s | 2,0 min |
| 20 | **2,2 min** | **2,7 min** |

**El cuello de botella es la inferencia, no el runtime.** El enrutamiento
cuesta 1,2 ms y el arranque 0,22 s. Cada análisis ocupa el modelo 5–8 s, y la
regeneración lo duplica.

Un Screen Audit secuencial no basta: dos minutos y medio de espera no son
utilizables, la regeneración impide estimar honestamente el tiempo restante, y
muchos textos ya correctos consumen inferencia solo para confirmar que no hay
nada que arreglar.

**Primera línea de investigación recomendada:** invocación selectiva del
modelo, apoyándose en las capas deterministas que ya detectan buena parte de
los problemas sin llamarlo. Detalle y advertencias en
`phase-8-5-6-screen-audit-readiness.md`.

**No se ha implementado nada de FASE 9.**

---

# Decisión de release

## GO — MIGRACIÓN DE IA LOCAL: RELEASED

Cumplen **los 21 criterios** de la compuerta.

Ningún bloqueante está activo: 0 fallos críticos finales, Solo local no
alcanza la nube, no hay fallback tras el POST, la API Key no llega a
localhost, el plugin no llama a Ollama, los placeholders se conservan, Apply
actúa sobre el nodo correcto y es reversible, ninguna respuesta obsoleta
sobrescribe la selección actual, el indicador de motor dice la verdad, los
validadores no descartan mensajes válidos, todo escucha en loopback, las
pruebas y el build están en verde, el smoke manual pasó, y no hay secretos en
fuente ni en build.

### Qué significa exactamente

El análisis de UX Writing se ejecuta en la máquina de la persona usuaria. El
contenido no sale del equipo salvo que la nube se elija **antes** de enviarlo,
y eso se muestra en pantalla por adelantado. En modo Solo local no sale nunca.

### Qué NO significa

No es una afirmación sobre otro hardware. Lo medido es **un** MacBook Air M4
de 24 GB. M1, M2, M3, 8 GB y 16 GB no se han medido, y con 3,1 GB de modelo
residente el comportamiento en 8 GB podría ser sustancialmente distinto.

Tampoco cubre Figma Web, ni la distribución del runtime, que sigue siendo
manual.

### El hallazgo que sostiene el release

**El modelo no es la capa de seguridad.** Se llegó a este punto midiendo: el
4B puntúa 82,3 % en bruto y 100 % dentro de la arquitectura determinista. Si
en el futuro se cambia de modelo, lo que hay que preservar son las capas
deterministas y el banco de 62 casos, no la elección concreta de pesos.
