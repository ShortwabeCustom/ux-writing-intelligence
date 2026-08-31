# FASE 9.2A — Decisión de arquitectura

**Recomendación: A) SECUENCIAL PROGRESIVA.**

Una petición de producción por candidato, entregando cada resultado en cuanto
está listo. **Sin lotes. Sin paralelismo. Sin caché en esta fase.**

---

## Matriz de decisión

Escala: ●●● bueno · ●●○ aceptable · ●○○ malo · ✗ descalificado.

| | **S1 progresiva** | S0 secuencial | S2 reutilización | S3 lote 2 | S3 lote 4 | S3 lote 6 | Concurrencia 2 |
|---|---|---|---|---|---|---|---|
| Calidad | ●●● | ●●● | ●●● | ●●○ | ●●○ | ●●○ | ●●● |
| Seguridad | ●●● | ●●● | ●●● | **✗** | **✗** | ●●○ | ●●● |
| TTFR | **●●● 5,1 s** | ●○○ 104 s | n/a | ●○○ 11,5 s | ✗ 20,5 s | ✗ 28,5 s | ●●● |
| Latencia total | ●●○ 104 s | ●●○ 104 s | n/a | ●○○ +3,7 % | ●●○ −17,8 % | ●○○ −7,0 % | ●○○ 0 % |
| Reducción de llamadas | ●○○ 0 % | ●○○ 0 % | **●○○ 0 %** | ●●○ 50 % | ●●● 75 % | ●●● 80 % | ●○○ 0 % |
| Memoria | ●●● | ●●● | ●●● | ●●● | ●●● | ●●● | ●●● |
| Complejidad | ●●● baja | ●●● baja | ●●○ media | ●○○ alta | ●○○ alta | ●○○ alta | ●●○ |
| Recuperabilidad | ●●● por texto | ●●● | ●●● | ●○○ | ●○○ | ●○○ | ●●● |
| Privacidad | ●●● | ●●● | ●●○ | ●●● | ●●● | ●●● | ●●● |
| Riesgo de implementación | ●●● bajo | ●●● bajo | ●●○ | ●○○ alto | ●○○ alto | ●○○ alto | ●●○ |

---

## Por qué gana la secuencial progresiva

**Convierte una espera de 104 segundos en un primer resultado a los 5,1.**
Veinte veces antes, sin quitar una sola llamada al modelo y sin tocar ninguna
garantía. Es la mayor mejora medida en toda la fase y la única que no cuesta
nada.

Cumple el objetivo de TTFR con holgura: **5,1 s** frente a un máximo de 10 s y
un preferido de 7 s. Ninguna estrategia de lote lo cumple salvo el lote de 1,
que no es un lote.

Es **perfectamente reproducible** —delta 0,0 entre corridas— y recuperable por
texto: si un candidato falla, se reintenta ese y solo ese.

Y no añade complejidad: es la arquitectura que ya está en producción, probada
por 236 pruebas de runtime y el banco de 62 casos.

---

## Por qué se rechazan las demás

### Lotes de 2 y 4 — descalificados por pérdida de elementos

El modelo devolvió **menos elementos de los que recibió**. Cuatro candidatos de
veinte desaparecieron: `c08` con lote de 2, y `c10`, `c11`, `c12` con lote de
4 — dos mensajes de error y una pregunta de ayuda.

No es un fallo de seguridad de los que sí analizó: es que **no los analizó**.
Para una herramienta de auditoría, omitir textos en silencio es peor que ser
lenta. El validador lo detecta, pero recuperarlos exige reanalizarlos uno a
uno, que es exactamente lo que el lote pretendía evitar.

### Lote de 4 — además, no llega al umbral

Su mejor cifra, **−17,8 %**, queda por debajo del **≥30 %** exigido. Y para
obtenerla empeora el TTFR de 5,1 s a 20,5 s: cuadruplica la espera hasta el
primer resultado a cambio de un ahorro que no alcanza el listón.

### Lote de 6 — no perdió elementos, pero no compensa

Solo **−7,0 %** de mejora total, y un TTFR de **28,5 s**, casi tres veces el
máximo tolerado. Además discrepa del veredicto individual en el no-op de **5
de 20** textos.

### Todos los lotes — inconsistencia de veredicto

El control demostró que el análisis individual es exactamente reproducible.
Por tanto la discrepancia de no-op en 3 a 5 de cada 20 elementos es
**atribuible al formato de lote**: el modelo cambia su juicio sobre si un
texto ya está bien según con qué otros textos venga acompañado.

Para un producto cuyo valor entero es decir «esto ya está bien» o «esto se
puede mejorar», que la respuesta dependa de los vecinos es un defecto de
fondo. No produce fallos críticos —las capas deterministas aguantan— pero sí
resultados que no podríamos defender ante quien los lea.

### Reutilización exacta — no aporta nada todavía

Ratio medido dentro de una pantalla: **0**. El único texto duplicado
(«Confirmar visita») aparece en dos contenedores distintos, y la identidad
conservadora se niega a reutilizar con razón.

No se implementa ahora, y **no se afirmará que una caché mejora la primera
corrida**, porque los datos dicen que no.

### Concurrencia — Ollama encola

Dos peticiones simultáneas tardan lo mismo que en serie: 28,54 s contra
28,32 s. El paralelismo del cliente no compra tiempo. Vía cerrada, con datos.

---

## Lo que esta fase NO hizo, deliberadamente

No se introdujo ninguna clasificación de «no necesita IA». Los resultados
siguen siendo dos: **descartado estructuralmente por el preflight de 9.1**, o
**candidato a análisis semántico**.

Ningún texto se declaró bueno sin analizarlo. `Continuar`, `Sí` y
`¿Cómo funciona?` entran al análisis como cualquier otro, y así debe seguir
siendo: adivinar qué copia de interfaz merece revisión es exactamente el error
que esta arquitectura existe para no cometer.

**Toda la optimización recomendada viene de cuándo se entregan los resultados,
no de cuáles se calculan.**

---

## Qué debería hacer FASE 9.2B

1. **Ejecución secuencial con entrega progresiva.** Un resultado en la lista en
   cuanto llega, en orden visual.
2. **Recuperación por texto.** Un candidato que falla no tumba la auditoría.
3. **Cancelación.** A 5,2 s por texto, una pantalla de 20 son 104 s: hay que
   poder parar. Con la salvedad ya documentada de que cancelar el HTTP no
   cancela la inferencia en curso en Ollama.
4. **No prometer tiempos.** La regeneración semántica puede duplicar la
   latencia de un texto y no se sabe de antemano cuál la disparará. Progreso
   por elementos completados, nunca una estimación temporal.

### Mediciones pendientes, no supuestos

- **Reutilización entre corridas** del mismo archivo durante el diseño. Es el
  único escenario donde la caché podría valer algo, y no está medido.
- **`num_ctx` mayor** para lotes. Podría explicar la pérdida de elementos, pero
  cambia memoria y latencia y obligaría a repetir todo el banco.

Ninguna de las dos se da por buena aquí.

---

## Compuerta

| Criterio | Estado |
|---|---|
| Banco reproducible | **Sí**, dos scripts documentados |
| Línea base secuencial medida | **Sí** |
| Reutilización segura medida | **Sí** (ratio 0) |
| Tamaños de lote caracterizados | **Sí** (1, 2, 4, 6) |
| Calidad comparada | **Sí**, con control de reproducibilidad |
| Fallos críticos en la ruta recomendada | **0** |
| Banco canónico de 62 casos | **62/62** |
| Pruebas del plugin | **289/289** |
| Playwright | **46/46** |
| Inferencia de Screen Audit en producción | **No habilitada** |
| Estrategia defendible para 9.2B | **Sí** |

**FASE 9.2A = GO.**
