# Screen Audit — arquitectura (FASE 9.0 + 9.1)

---

## 1. Qué es Screen Audit

Auditar el contenido de una pantalla completa en vez de una capa de texto a la
vez: seleccionar un frame y obtener una revisión de UX Writing de todo lo que
contiene.

## 2. Qué implementan 9.0, 9.1 y 9.2B

**9.0 y 9.1: descubrimiento y preflight determinista.**

1. Contratos tipados de Screen Audit.
2. Reconocimiento de la selección de frame.
3. Descubrimiento recursivo de nodos de texto.
4. Elegibilidad determinista.
5. Orden visual.
6. Mensajes serializables entre hilo principal e interfaz.
7. Interfaz de preflight.
8. Pruebas.

**9.2B: ejecución secuencial progresiva.** «Auditar pantalla» ya funciona.

## 3. Qué NO se implementa, a propósito

Sin lotes. Sin paralelismo. Sin `/v1/analyze/screen`. Sin caché persistente.
Sin puntuación global de pantalla. Sin navegación a nodos. Sin cancelación. Sin
Apply, ni Apply masivo, ni mutación del documento. Sin filtrado de hallazgos.
Sin sesiones persistentes.

---

## 3.1 Estrategia de ejecución, y por qué

FASE 9.2A midió cinco estrategias sobre una pantalla de 20 candidatos. La
decisión no se tomó por intuición.

### Secuencial progresiva — elegida

Un candidato, **una petición de las que ya existen** (`POST /v1/analyze/text`),
y el resultado a la vista en cuanto llega.

| | Medido |
|---|---:|
| Total, 20 candidatos | 104,0 s |
| **Primer resultado útil** | **5,1 s** |
| Reducción de llamadas | 0 % |

No acelera nada. **Convierte una espera de 104 segundos en un primer resultado
a los 5,1**: veinte veces antes, sin tocar ninguna garantía.

### Lotes — rechazados por pérdida de textos

| Lote | Total | vs secuencial | TTFR | Textos perdidos |
|---:|---:|---:|---:|---:|
| 2 | 107,9 s | +3,7 % | 11,5 s | **1 de 20** |
| 4 | 85,5 s | −17,8 % | 20,5 s | **3 de 20** |
| 6 | 96,7 s | −7,0 % | 28,6 s | 0 |

Con lotes de 2 y 4 el modelo **devolvió menos elementos de los que recibió**.
Cuatro candidatos desaparecieron, entre ellos dos mensajes de error.

Para una herramienta de auditoría, **omitir textos en silencio es peor que ser
lenta**. Y el mejor ahorro, un 17,8 %, ni siquiera alcanzaba el 30 % exigido.

Además: un control demostró que el análisis individual es **exactamente
reproducible** (delta 0,0 entre corridas). Por tanto la discrepancia de lote en
el veredicto de «no requiere cambios» —3 a 5 de cada 20— es atribuible al
formato: el modelo cambia su juicio sobre un texto según con qué otros venga
acompañado.

### Concurrencia — rechazada por no aportar nada

Dos peticiones simultáneas: 28,54 s contra 28,32 s en serie. Ollama sirve un
modelo cargado de una en una y encola internamente.

### Reutilización exacta — sin efecto todavía

Ratio medido dentro de una pantalla: **0**. El único texto duplicado aparecía
en dos contenedores distintos, y la identidad conservadora se niega a
reutilizar con razón. **No se afirma que una caché mejore la primera corrida.**

---

## 4. Contrato de selección

| Selección | Comportamiento |
|---|---|
| Exactamente 1 nodo de texto | Text Audit, sin cambios |
| Exactamente 1 **frame** | Preflight de Screen Audit |
| Cualquier otra cosa | Estado de selección no soportada |

### Copia de la raíz no soportada

Corregido en FASE 9.1.1 tras el smoke real. La copia decía:

> Esta capa no contiene texto

Ante una instancia llamada «Input Datepicker» que mostraba «Calle» y «C 27»
visibles dentro, eso era **factualmente falso**. El problema no es el
contenido: es que la raíz seleccionada no está autorizada.

Ahora dice:

> **Esta selección no se puede auditar**
> Selecciona una capa de texto para analizarla o un Frame para revisar su
> contenido.

Se conservan como estados **distintos**, sin colapsar:

| Situación | Copia |
|---|---|
| Raíz no soportada (grupo, instancia, sección, componente) | «Esta selección no se puede auditar» |
| Capa de texto soportada pero vacía | «Este texto está vacío» |
| Frame soportado sin textos dentro | «Esta pantalla no contiene textos.» |

La copia vive en `src/selection-presentation.ts`, un módulo puro. Se extrajo
de `ui.ts` precisamente porque una afirmación falsa había sobrevivido sin que
nadie pudiera comprobarla sin abrir Figma.

**FRAME es la única raíz autorizada** en esta fase. Grupos, secciones,
componentes e instancias no lo son **como raíz**.

Matiz importante: los textos que viven **dentro** de instancias y componentes
anidados bajo el frame seleccionado **sí** se descubren. La restricción es
sobre la raíz, no sobre el subárbol.

---

## 5. Descubrimiento

Recorrido recursivo del subárbol del frame. Solo lectura:

- no muta el documento;
- no carga fuentes;
- no cambia la selección;
- no mueve el viewport.

Trabaja sobre una forma estructural mínima (`ScreenNodeLike`), no sobre tipos
de Figma, para poder probarse sin la aplicación.

---

## 6. Visibilidad efectiva

Un texto no es auditable si él mismo está oculto, o si **cualquier** ancestro
entre él y el frame raíz lo está. Se considera también `opacity === 0`.

Deliberadamente simple: **no** se interpretan recortes, modos de fusión, alfa
de relleno ni renderizado real. Una heurística visual sofisticada sería
imposible de explicar cuando se equivocara, y se equivocaría.

---

## 7. Elegibilidad

Prioridad fija; el primer motivo que aplica gana:

| # | Motivo | Ejemplos |
|---|---|---|
| 1 | `empty` | `""`, `"   "`, `"\n"` |
| 2 | `hidden` | capa oculta o con ancestro oculto |
| 3 | `protected_only` | `{{date}}`, `📅 {{date}}`, una URL sola, un correo solo |
| 4 | `numeric_only` | `97540`, `14/50`, `9:41 p.m.`, `$1,250.00`, `90%` |
| 5 | `non_language` | `---`, `•••`, `→`, `✅`, `???` |
| 6 | `ready` | todo lo demás |

### Contenido protegido

Se retiran temporalmente los segmentos protegidos y se comprueba si queda
lenguaje natural. `{{date}}` se omite; **`Hola {{firstName}}` entra**, porque
«Hola» sobrevive al retirado.

Los placeholders **nunca se mutan ni se normalizan**.

### Unicode

Detección de letras con `\p{L}`, nunca `[A-Za-z]`. `Sí`, `¿Qué pasó?`,
`Contraseña` y `Préstamo` entran sin discusión.

### Sesgo deliberado: alto recall

Ante la duda, **entra**. Un texto de más cuesta una inferencia futura; un texto
de menos desaparece sin que nadie se entere, y ese es el error caro.

Por eso **no** se intenta detectar «datos escritos por la persona usuaria».
`Izamal` podría ser un dato de ejemplo, pero decidirlo exigiría conocimiento
semántico que no tenemos. No se inventan conjeturas del tipo «esto parece una
dirección» o «esto parece un nombre».

---

## 8. Fuente exacta

`candidate.text === node.characters`, punto de código a punto de código.

Sin `trim`, sin minúsculas, sin normalización Unicode, sin limpieza de
puntuación ni de espacios. La clasificación usa cadenas derivadas
**temporales**; la fuente almacenada nunca se toca. El recorte de la vista
previa es **solo visual**.

---

## 9. Orden

Y ascendente, luego X ascendente, y como desempate el orden de descubrimiento.
Los nodos sin geometría van al final conservando ese orden. Una geometría
ausente nunca rompe el preflight.

---

## 10. Privacidad

- No se registra el contenido de ningún texto, ni el contexto preparado.
- No se persiste nada en `clientStorage`: el preflight es estado de sesión.
- No se envían objetos de Figma a la interfaz, solo datos planos.
- El contexto determinista se **prepara** para la fase futura, pero **no viaja
  a ninguna parte**.

---

## 11. Garantía de cero red

Seleccionar un frame y generar el preflight **no dispara ningún análisis**:
cero peticiones a `localhost:8787/v1/analyze/text` y cero a
`writing.productdesign.mx`.

Matiz: la comprobación de salud del motor local al abrir el plugin sigue
existiendo y **no es** una petición de análisis.

El preflight funciona **sin API Key y con el motor local apagado**, porque no
analiza nada.

---

## 12. Lenguaje: qué se puede afirmar y qué no

En esta fase solo se sabe qué es **estructuralmente apto** y qué se descartó
de forma determinista. La calidad de la redacción **no se ha evaluado**.

**Correcto:** «20 detectados · 12 listos para auditar · 8 omitidos».

**Incorrecto:** «12 ya analizados», «12 resueltos localmente», «12 no
necesitan IA».

Esa decisión todavía no se ha tomado, y afirmarla sería mentir.

---

## 13. Frontera con la fase siguiente

**FASE 9.2 — motor de análisis selectivo.** Documentado, no implementado.

Su responsabilidad futura podría incluir decidir cuándo el juicio del modelo
es realmente necesario, reducir invocaciones innecesarias apoyándose en las
capas deterministas del runtime, y decisiones seguras de reutilización.

---

## 13.1 Enrutamiento con alcance de auditoría

La ruta se resuelve **una vez**, al pulsar «Auditar pantalla», con la política
de enrutamiento que ya existe. No hay una segunda política para Screen Audit.

Una vez que empezó la primera petición, **el transporte queda fijo** hasta que
la auditoría termine, se invalide, o la persona elija otra cosa. Cambiar de
modo a mitad de auditoría no la reencamina: afecta a la siguiente.

### Fallo local después del envío

Extiende el principio ya validado para Text Audit. Si un candidato falla tras
haber empezado su POST local:

- **cero peticiones automáticas a la nube**;
- la auditoría **se pausa**, no salta al siguiente;
- se ofrece «Reintentar local» y, si el modo lo permite, «Continuar en la
  nube».

Se pausa en vez de continuar porque en una pantalla larga **un resultado
ausente pasaría inadvertido**. La persona debe ver que la ejecución se detuvo.

En **Solo local** nunca se ofrece la nube, aunque haya clave configurada.

### Procedencia por elemento

Cada resultado guarda el transporte que **de verdad** lo produjo. Si la
auditoría empieza en local y continúa en la nube por decisión explícita, los
resultados ya cerrados **siguen diciendo Local**. Ni la salud del motor ni el
modo de análisis son procedencia.

### Obsolescencia

Una auditoría puede durar más de un minuto y el documento puede cambiar
mientras tanto. Antes de **cada** envío se revalida el nodo: si desapareció o
su texto cambió, no se analiza la fuente vieja ni se toca la nueva. Se marca
como cambiado y se continúa.

Un texto cambiado **no cuenta como analizado**: el resumen dice «14 analizados
· 1 cambió durante la auditoría».

Si la selección cambia, la auditoría se invalida y cualquier respuesta que
llegue después se descarta.

### Progreso verdadero

El progreso es un **conteo de elementos completados**, nunca una estimación
temporal. La regeneración semántica puede duplicar la latencia de un texto y no
se sabe de antemano cuál la disparará: cualquier porcentaje basado en tiempo
sería una invención.

### Sin puntuación global

No se promedia. Promediar textos distintos no significaría nada y requiere su
propia definición de producto.

---

**No hay una sola línea de 9.3 en esta fase.**

---

## 14. Lo que NO se replica aquí

El runtime local sigue siendo la **única autoridad** sobre ortografía,
glosario, fidelidad semántica, integridad de fronteras, integridad de locale,
contenido protegido, puntuación y seguridad de la sugerencia.

Esas reglas **no se recrean en TypeScript**. El preflight del plugin no decide
si una copia es buena o mala: decide si es estructuralmente apropiada para que
alguien —más adelante— la evalúe.

---

## 15. Coste medido

| Nodos | Descubrimiento | Clasificación y orden | Total |
|---:|---:|---:|---:|
| 20 | 0,003 ms | 0,012 ms | **0,015 ms** |
| 50 | 0,001 ms | 0,022 ms | **0,023 ms** |
| 100 | 0,002 ms | 0,037 ms | **0,039 ms** |

Frente a los ~4,9 s de **una sola** llamada al modelo. El preflight es
gratuito; lo caro es la inferencia, y por eso esta fase existe.

Diagnóstico, no un compromiso de servicio. No se muestran estimaciones de
tiempo en la interfaz.


---

## 16. Smoke manual en Figma Desktop

Ejecutado sobre este código.

| Escenario | Resultado |
|---|---|
| Una capa de texto → Text Audit | **PASS** |
| Un frame → preflight de pantalla | **PASS** |
| Clasificación mixta (visible, oculto, números, placeholder, lenguaje + placeholder) | **PASS** |
| Selección múltiple | **PASS** |
| Grupo como raíz | **PASS** |
| Instancia como raíz | **PASS** |
| Motor local apagado y sin API Key | **PASS** |

El último confirma en la aplicación real lo que las pruebas ya contaban: el
preflight no depende de ninguna credencial ni de ningún motor, porque no
analiza nada.

**FASE 9.0 + 9.1 = GO.**
