# Matriz de soporte

Solo se declara lo que se ha medido. Nada se extrapola.

---

## Cliente

| Entorno | Estado |
|---|---|
| Figma Desktop (macOS) | **SOPORTADO** — smoke manual completo, FASE 8.5.5 |
| Figma Web | **NO PROBADO** |

Sobre Figma Web: no se ha ejecutado. Existe la sospecha razonable de que las
restricciones de red privada del navegador bloqueen `localhost` desde una
página pública, pero **no se ha verificado y no se afirma**. Si resultara
bloqueado, no se debilitará la seguridad local ni se expondrá el runtime a la
red: Figma Desktop seguiría siendo el objetivo soportado.

---

## Hardware

| Configuración | Estado |
|---|---|
| Apple M4 · 24 GB | **MEDIDO** — todas las cifras de este release |
| Apple M1 / M2 / M3 | **NO MEDIDO** |
| Apple Silicon · 8 GB | **NO MEDIDO** |
| Apple Silicon · 16 GB | **NO MEDIDO** |
| Intel | **NO MEDIDO** |

El modelo ocupa 3,1 GB residentes y se ejecuta al 100 % en GPU en el equipo
medido. En 8 GB compartidos el comportamiento podría ser sustancialmente
distinto —presión de memoria, descargas del modelo, reparto CPU/GPU— y no hay
datos para afirmar nada.

---

## Sistema

| Componente | Versión probada |
|---|---|
| macOS | 26.5.2 (25F84) |
| Ollama | 0.33.0 |
| Modelo | `qwen3.5:4b` |
| Python | entorno virtual del runtime |

Otras versiones de Ollama no se han probado. El contrato usado —salida
estructurada por esquema JSON y `/api/tags` para el catálogo— es estable, pero
eso es una expectativa, no una medición.

---

## Modos de análisis

| Modo | Requisitos | Estado |
|---|---|---|
| Automático | runtime local **o** API Key | **SOPORTADO** |
| Solo local | runtime local + `qwen3.5:4b` | **SOPORTADO** |
| Solo nube | API Key | **SOPORTADO** |

---

## Idioma

| Locale | Estado |
|---|---|
| `es-MX` | **SOPORTADO** — único locale probado y admitido |

Cualquier otro locale se rechaza en el runtime.
