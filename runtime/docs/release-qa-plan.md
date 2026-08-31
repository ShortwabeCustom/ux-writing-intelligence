# Plan de QA de release — FASE 8.5.6

Alcance: cierre de la migración de inferencia a un motor local, con la nube
como respaldo controlado. **No se añade funcionalidad de producto.**

---

## 1. Entornos

| Componente | Valor |
|---|---|
| Equipo | MacBook Air Mac16,13 · Apple M4 (4P + 6E) · 24 GB · arm64 |
| Sistema | macOS 26.5.2 (25F84) |
| Inferencia | Ollama 0.33.0 en `127.0.0.1:11434` |
| Modelo | `qwen3.5:4b`, `keep_alive: 30m`, `num_ctx: 4096`, temperatura 0, semilla 42 |
| Runtime local | FastAPI + uvicorn en `127.0.0.1:8787` |
| Nube | `https://writing.productdesign.mx` |
| Cliente | Figma Desktop · plugin ID `1674592820827897160` |

**Un solo equipo medido.** Nada de lo aquí publicado se generaliza a otras
configuraciones de Apple Silicon ni a otras cantidades de memoria.

---

## 2. Definiciones

**FRÍO** — el modelo no está residente en memoria (`ollama stop`, que **no**
lo desinstala) y el proceso del runtime acaba de arrancar. No se toca ninguna
otra caché del sistema.

**CALIENTE** — runtime en marcha, modelo residente, `keep_alive` vigente. Es
el escenario de uso repetido y el que representa la experiencia real.

**REGENERACIÓN** — la capa semántica rechaza la primera sugerencia del modelo
y fuerza una segunda llamada. Se mide y se publica **por separado**: mezclarla
con el caso común falsearía la mediana.

---

## 3. Casos y criterios

### Rendimiento

| Caso | Muestra | Criterio |
|---|---|---|
| Análisis en frío | 5 corridas genuinamente frías | caracterizar, sin umbral |
| Caliente corto | 20 textos distintos | p50 ≤ 8 s; p95 ≤ 10 s deseable |
| Caliente medio | 10 textos distintos | caracterizar |
| Caliente largo | 5 textos multilínea | caracterizar |
| Regeneración | 5 casos | caracterizar; puede superar el umbral |
| Arranque del runtime | 5 arranques | rápido y determinista |

Textos **distintos** en cada muestra: repetirlos mediría la caché de prompt
del modelo, no el sistema. Con n < 20 no se publica p95: sería ruido con
apariencia de dato.

### Fiabilidad

| Caso | Criterio |
|---|---|
| Soak de 50 análisis | 0 fallos; sin crecimiento sostenido de memoria |
| Parada / arranque repetidos | puerto liberado, sin procesos huérfanos |
| Colisión de puerto | fallo con mensaje claro; sin cambiar de puerto en silencio |
| Ollama caído | runtime degradado, sin caída del proceso |
| Servicio ajeno en 11434 | nunca produce `runtime: ready` |

### Privacidad — bloqueantes

| Caso | Criterio |
|---|---|
| Solo local | **0** peticiones a la nube, con API Key configurada |
| AUTO + local listo | 10 análisis locales, **0** a la nube |
| Fallo local tras el POST | **0** peticiones automáticas a la nube |
| Retry explícito | exactamente **1** petición a la nube |
| API Key hacia localhost | **0**, siempre |
| Plugin → Ollama directo | **0**; solo el runtime habla con Ollama |
| Registros | sin texto, sugerencia, prompt, salida cruda ni claves |

### Seguridad

| Caso | Criterio |
|---|---|
| Sockets | solo `127.0.0.1`; **0** en `0.0.0.0`; sin LAN |
| Manifest | solo los dos dominios necesarios; sin comodines; ID intacto |
| Bundle | sin puerto 11434, sin secretos, sin URLs de prueba |

---

## 4. Bloqueantes de release

Cualquiera de estos convierte la fase en NO-GO:

- fallo crítico FINAL > 0 en el banco de 62 casos;
- Solo local alcanza la nube;
- fallback a la nube después de iniciado el POST local;
- la API Key llega a localhost;
- el plugin llama a Ollama directamente;
- mutación de placeholders;
- Apply sobre el nodo equivocado;
- una respuesta obsoleta sobrescribe la selección actual;
- el indicador de motor miente;
- un validador descarta un mensaje válido;
- runtime u Ollama escuchando en `0.0.0.0`;
- pruebas o build en rojo;
- smoke manual en Figma Desktop en rojo;
- secretos en fuente o build.

---

## 5. Qué NO cubre este plan

- Otras máquinas, otros modelos, otros sistemas operativos.
- Figma Web.
- Distribución e instalación del runtime.
- Rendimiento de la nube, que es respaldo y no objetivo.
- Screen Audit y cualquier trabajo de FASE 9.
