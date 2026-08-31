# Preparación para Screen Audit — proyección

**Solo análisis. No se implementa nada de FASE 9 en esta fase.**

Basado en las cifras medidas de FASE 8.5.6 en MacBook Air M4 / 24 GB.

---

## Proyección secuencial

Un Screen Audit ingenuo analizaría cada capa de texto una tras otra. Con las
latencias medidas:

| Textos | Solo cortos | Mezcla realista | Con 20 % de regeneración |
|---:|---:|---:|---:|
| 5 | 24 s | 33 s | 40 s |
| 10 | 49 s | 66 s | 80 s |
| 15 | 73 s | 1,7 min | 2,0 min |
| 20 | 1,6 min | 2,2 min | **2,7 min** |

- «Solo cortos» usa la p50 de textos cortos (4,899 s). Es el mejor caso y
  **no** representa una pantalla real.
- «Mezcla realista» usa la p50 del soak (6,612 s), que combina cortos, medios
  y largos. Es la cifra que hay que mirar.
- La última columna supone que uno de cada cinco textos dispara regeneración
  semántica, a 13,429 s.

---

## El cuello de botella

**No es el runtime.** El motor determinista, el enrutamiento y la comprobación
de salud suman milisegundos: el enrutamiento se midió en 1,2 ms y el arranque
del proceso en 0,22 s.

**Es la inferencia, y es secuencial por diseño.** Cada análisis ocupa el modelo
durante 5–8 segundos, y la regeneración semántica puede duplicarlo. Ese coste
no se reduce optimizando código del producto.

## Por qué un Screen Audit secuencial no basta

1. **La espera es inaceptable.** Dos minutos y medio mirando una barra de
   progreso, sin poder trabajar, no es una experiencia utilizable. El umbral
   de tolerancia está mucho más abajo.

2. **La regeneración es impredecible.** No se sabe de antemano qué textos la
   dispararán, así que ni siquiera se puede estimar honestamente cuánto
   tardará. Una barra de progreso mentiría.

3. **El coste crece linealmente y las pantallas reales son grandes.** Una
   pantalla de producto financiero pasa fácilmente de 20 capas de texto.

4. **Muchos textos no necesitan al modelo.** Un `Continuar` ya correcto
   consume los mismos 5 segundos que uno problemático. Se está pagando
   inferencia para confirmar que no hay nada que arreglar.

---

## Recomendación para FASE 9 — qué investigar primero

Por orden de relación entre beneficio y riesgo. **Son recomendaciones; no se
implementa ninguna aquí.**

**1. Invocación selectiva del modelo.** La palanca con diferencia más grande.
Las capas deterministas —ortografía, glosario, contenido protegido— ya
detectan buena parte de los problemas sin tocar el modelo. Un texto corto,
limpio y sin términos de glosario podría resolverse sin inferencia. En una
pantalla típica esto podría eliminar la mayoría de las llamadas.

Riesgo: decidir mal a quién se le salta el modelo. Debería medirse contra el
banco de 62 casos antes de confiar en ello.

**2. Resultados progresivos.** No cambia el tiempo total, cambia la
experiencia: mostrar cada hallazgo en cuanto está listo, en vez de esperar al
final. Barato de implementar y con impacto inmediato en la percepción.

**3. Caché por texto.** Con temperatura 0 y semilla fija, el mismo texto con el
mismo contexto produce el mismo resultado. Las pantallas repiten mucho
contenido entre iteraciones de diseño. Requiere una clave de invalidación
honesta.

**4. Cola de un solo elemento con cancelación.** Ordena el trabajo y permite
abandonar sin dejar inferencias huérfanas. Es infraestructura, no velocidad.

**5. Experimento de mini-lote.** Agrupar varios textos en una llamada. Lo más
prometedor en papel y lo más peligroso: mezclar textos en un mismo prompt
invita a que el modelo confunda contenidos entre ellos, que es justo la clase
de fallo que la capa semántica existe para evitar. **Solo debería explorarse
con el banco de 62 casos como red de seguridad, y descartarse sin
contemplaciones si aparece una sola contaminación entre textos.**

---

## Lo que NO se recomienda

**Análisis en paralelo.** Ollama sirve las peticiones de una en una con un
modelo cargado; lanzar varias en paralelo las encola, sin ganancia real, y
multiplica la presión de memoria. En un equipo de 8 GB —que no se ha medido—
podría forzar descargas del modelo y empeorar el resultado.

**Cambiar a un modelo menor por velocidad.** Ya se evaluó en FASE 8.5.2: la
seguridad del producto la sostiene la capa determinista, no el modelo, y bajar
de tamaño no compraría tiempo suficiente para justificar el riesgo.
