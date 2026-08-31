# Rendimiento — FASE 8.5.6

**Equipo:** MacBook Air M4 · 24 GB · macOS 26.5.2
**Modelo:** `qwen3.5:4b` · `keep_alive: 30m` · `num_ctx: 4096` · temperatura 0
**Fecha:** 29 de agosto de 2026

Todas las cifras proceden de medición directa. Textos **distintos** en cada
muestra: repetirlos habría medido la caché de prompt del modelo en vez del
sistema.

---

## Tabla de release

| Escenario | n | p50 | p95 | Máx |
|---|---:|---:|---:|---:|
| Análisis en frío | 5 | **6,594 s** | — | 7,749 s |
| Caliente corto | 20 | **4,899 s** | **5,086 s** | 5,270 s |
| Caliente medio | 10 | **5,773 s** | — | 6,287 s |
| Caliente largo | 5 | **7,688 s** | — | 8,106 s |
| Regeneración semántica | 5 | **6,351 s** | — | **13,429 s** |
| Arranque del runtime | 5 | **0,221 s** | — | 0,236 s |

**El p95 solo se publica con n ≥ 20.** Con cinco o diez muestras sería ruido
con apariencia de dato. Se publica el máximo, que sí es informativo.

---

## Compuerta de rendimiento

| Objetivo | Medido | Resultado |
|---|---|---|
| Caliente corto p50 ≤ 8 s | **4,899 s** | **CUMPLE** |
| Caliente corto p95 ≤ 10 s (deseable) | **5,086 s** | **CUMPLE** |

El caso largo (7,7 s) y la regeneración (hasta 13,4 s) superan el objetivo de
los cortos, como el propio plan preveía. No son el camino común y se comunican
con el mensaje de carga extendida a partir de los 8 s.

---

## Frío contra caliente

| | p50 |
|---|---:|
| Frío | 6,594 s |
| Caliente | 4,899 s |
| **Diferencia** | **+1,695 s** |

Cargar 3,1 GB de pesos cuesta menos de dos segundos en este equipo, con el
modelo ejecutándose al 100 % en GPU. El arranque del proceso del runtime
—0,22 s— es despreciable frente a eso.

**Definición de frío:** modelo descargado de memoria con `ollama stop`, que
**no** lo desinstala, más reinicio del proceso del runtime. No se tocó ninguna
otra caché del sistema. Cada corrida verificó con `ollama ps` que el modelo no
estaba residente antes de medir.

---

## Regeneración semántica

Cinco casos con defectos deliberados:

| Latencia | Observación |
|---:|---|
| 5,664 s | sin regeneración |
| **13,429 s** | con regeneración |
| 6,351 s | |
| 6,520 s | |
| 6,216 s | |

Cuando la capa semántica rechaza la primera sugerencia y fuerza una segunda
llamada, la latencia **se duplica**. El caso de 13,4 s corresponde a
`¿Como funciona?`, que también apareció en el smoke manual de FASE 8.5.5 con
10,7 s y `ollama_call_count: 2`.

No es un fallo: es la capa de seguridad rechazando una sugerencia infiel y
pidiendo otra. El coste de esa garantía es tiempo, y se paga.

---

## keep_alive

| Comprobación | Resultado |
|---|---|
| Modelo residente tras analizar | sí |
| Residente tras 20 s de reposo | sí |
| Reanálisis tras el reposo | 4,975 s (sin recarga) |
| Residente tras el reanálisis | sí |
| `ollama ps` | `UNTIL: 29 minutes from now` |

`keep_alive: 30m` se aplica y el contador se renueva con cada análisis. **No
se esperó a que expirara**: habría requerido 30 minutos de inactividad y no
aporta información que cambie ninguna decisión. Lo que sí se verificó es que
descargarlo a mano con `ollama stop` fuerza el camino frío, que ya está medido
arriba.

---

## Memoria y estabilidad

Soak de **50 análisis secuenciales** con textos variados:

| Métrica | Valor |
|---|---|
| Peticiones | 50 |
| Fallos | **0** |
| Latencia p50 | 6,612 s |
| Latencia p95 | 8,660 s |
| Latencia máx | 9,052 s |

RSS del proceso del runtime, muestreado cada 10 análisis:

```
62,1 → 62,3 → 62,4 → 62,4 → 62,4 → 62,4 MB
```

**Crecimiento total: 0,3 MB.** Plano tras las primeras diez peticiones. No hay
indicio de fuga de memoria.

El modelo ocupa **3,1 GB** residentes, al 100 % en GPU, gestionados por Ollama
fuera del proceso del runtime.

La p50 del soak (6,6 s) es superior a la de los cortos (4,9 s) porque la mezcla
incluye textos medios y largos. Es la cifra más representativa de un uso
sostenido y variado.

Se ejecutaron 50 análisis, el mínimo del plan, y no los 100 preferidos: la
serie de RSS ya era plana desde la décima petición y el coste adicional no
habría cambiado la conclusión. **Se declara para que la elección quede a la
vista.**

---

## Ciclo de vida del proceso

| Comprobación | Resultado |
|---|---|
| Arranque → `/health` respondiendo | 0,221 s (p50 de 5 arranques) |
| Tres ciclos parada/arranque | puerto liberado limpiamente |
| Procesos huérfanos | ninguno |
| Servidores duplicados | ninguno |
| Puerto ocupado | falla con mensaje claro, sin cambiar de puerto |

La colisión de puerto se observó de forma no planificada durante la sesión: un
segundo arranque con el 8787 ocupado imprimió qué proceso lo tenía, sugirió
`UXW_PORT` y salió con código 1. No mató el proceso ajeno ni se movió a otro
puerto en silencio.
