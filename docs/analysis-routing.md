# Enrutamiento del análisis — FASE 8.5.5

Cómo el plugin decide **dónde** se procesa el contenido, y qué garantías se
derivan de esa decisión.

---

## 1. Modos

| Modo | Nombre en producto | Significado |
|---|---|---|
| `auto` | Automático | Local primero; la nube solo si el motor local no está disponible **antes** de iniciar. |
| `local` | Solo local | El contenido se procesa únicamente en esta Mac. Nunca la nube. |
| `cloud` | Solo nube | El contenido se envía al servicio en la nube. |

Se guarda en `figma.clientStorage` bajo `ux-writing-analysis-mode`. Clave
propia: **no** comparte almacenamiento con la API Key
(`ux-writing-api-key`), porque borrar una no debe destruir la otra.

### Valor por defecto y migración

El valor por defecto es **`auto`**. Si no hay modo guardado —o si el valor
almacenado no es reconocible— se usa `auto` **sin escribir nada**.

Se eligió `auto` porque preserva la continuidad para quien ya tenía API Key
configurada, prioriza lo local cuando existe y no obliga a nadie a
reconfigurar. `local` por defecto dejaría sin servicio a quien no tiene el
runtime; `cloud` por defecto enviaría contenido fuera del equipo sin
necesidad.

---

## 2. Arquitectura

```
                       ANALIZAR
                          |
                          v
               resolveAnalysisTransport()   <-- función pura, sin red
                          |
              +-----------+-----------+
              |                       |
           LOCAL                    NUBE
              |                       |
   localhost:8787            writing.productdesign.mx
              |
              v
      Runtime de seguridad
              |
              v
      Ollama qwen3.5:4b
```

`resolveAnalysisTransport` es una función pura: no hace red, no lee
almacenamiento y **no conoce la API Key**. Recibe `{mode, localRuntimeState,
cloudConfigured}` y devuelve una ruta tipada.

La política vive **por debajo** del pipeline compartido de Text Audit.
Analizar, Analizar de nuevo, Aplicar, la carga, las guardas de obsolescencia
y el renderizado del resultado no se duplican por transporte: existe un solo
`handleAnalyzeRequest`, y el transporte se construye al final.

---

## 3. Tabla de enrutamiento

| Modo | Estado local | Nube configurada | Resultado | Razón |
|---|---|---|---|---|
| auto | ready | — | **LOCAL** | `AUTO_LOCAL_READY` |
| auto | unavailable | sí | **NUBE** | `AUTO_LOCAL_UNAVAILABLE_CLOUD` |
| auto | model_missing | sí | **NUBE** | `AUTO_MODEL_MISSING_CLOUD` |
| auto | degraded | sí | **NUBE** | `AUTO_DEGRADED_CLOUD` |
| auto | no ready | no | **BLOQUEADO** | `NO_LOCAL_NO_CLOUD` |
| auto | checking | — | **BLOQUEADO** | `LOCAL_STATUS_UNKNOWN` |
| local | ready | — | **LOCAL** | `LOCAL_ONLY` |
| local | model_missing | — | **BLOQUEADO** | `LOCAL_ONLY_MODEL_MISSING` |
| local | cualquier otro | — | **BLOQUEADO** | `LOCAL_ONLY_UNAVAILABLE` |
| cloud | *no se consulta* | sí | **NUBE** | `CLOUD_ONLY` |
| cloud | *no se consulta* | no | **BLOQUEADO** | `CLOUD_NOT_CONFIGURED` |

En `local`, la columna «Nube configurada» es irrelevante **por diseño**: la
función no devuelve `cloud` en ese modo bajo ninguna entrada posible.

---

## 4. Política de privacidad

> La nube solo puede elegirse automáticamente **antes** de que el texto salga
> del plugin.

Esta es la regla central, y la razón de que exista la separación entre
«fallback previo al envío» y «fallo posterior al envío».

### Fallback previo al envío (permitido)

En `auto`, si la comprobación de salud dice que el motor local no está
disponible, la nube se elige **sin haber enviado nada a ningún sitio**. El
motor resultante se muestra en la pantalla principal antes de pulsar
«Analizar texto», de modo que el uso de la nube nunca es invisible.

### Fallo posterior al envío (prohibido)

Una vez que `LocalAnalysisTransport.analyze()` fue invocado, el contenido ya
salió hacia el motor local. A partir de ahí **ningún fallo reencamina a la
nube automáticamente**: hacerlo enviaría a un servicio remoto un contenido
que la persona pidió procesar localmente, sin que se enterara.

Aplica a: `LOCAL_ANALYSIS_TIMEOUT`, `INVALID_RESPONSE`,
`LOCAL_RUNTIME_UNAVAILABLE` cuando el POST ya había comenzado,
`LOCAL_MODEL_NOT_AVAILABLE`, `UNKNOWN_ERROR` y cualquier otro fallo del
transporte local.

---

## 5. Matriz de errores

| Fallo | ¿Nube automática? | ¿Acción explícita de nube? |
|---|---|---|
| Local no disponible antes del POST | **SÍ** | N/A |
| Modelo local ausente antes del POST | **SÍ** | N/A |
| Local degradado antes del POST | **SÍ** | N/A |
| Timeout local tras el POST | **NO** | **SÍ** |
| Respuesta local inválida | **NO** | **SÍ** |
| Fallo semántico o del runtime local | **NO** | **SÍ** |
| La conexión local cae durante el POST | **NO** | **SÍ** |
| Nube sin configurar | NO | NO |
| Modo Solo local | **NUNCA** | **NUNCA** |

---

## 6. Acción explícita hacia la nube

Tras un fallo posterior al POST, y solo si la nube es una opción legítima, la
interfaz ofrece:

```
No pudimos completar el análisis local

[Intentar nuevamente]  [Usar análisis en la nube]

El contenido se enviará al servicio en la nube para realizar el análisis.
```

`USE_CLOUD_FOR_CURRENT_ANALYSIS` reutiliza el mismo `handleAnalyzeRequest`,
así que hereda **todas** las guardas: revalida la revisión de selección,
verifica que el nodo siga siendo el mismo y que el texto no haya cambiado,
acuña un `requestId` nuevo y conserva el contexto y el locale. No muta el
texto ni reutiliza un resultado obsoleto.

En modo `local` esta acción se rechaza en el hilo principal aunque llegue el
mensaje: la garantía no depende de que la interfaz oculte el botón.

---

## 7. Aislamiento de la API Key

- El transporte local envía **únicamente** `Content-Type: application/json`.
- La API Key se lee del almacenamiento **solo** cuando la ruta resuelta es
  `cloud` (`transportRequiresApiKey`).
- En `auto` + local listo no se toca siquiera el almacenamiento de la clave.
- Prueba bloqueante: se serializa la petición local completa y se verifica
  que el secreto no aparece en ninguna parte de ella.

---

## 8. Máquina de estados

```
UNKNOWN
   |
   v
CHECKING  ---------------------------+
   |                                 |
   v                                 |
READY / UNAVAILABLE / MODEL_MISSING / DEGRADED
   |
   v
RESOLUCIÓN DE RUTA        <-- último punto donde la nube puede elegirse sola
   |
   +--> LOCAL ---+
   +--> NUBE ----+---> ANALIZANDO ---> ÉXITO
   +--> BLOQUEADO                |
                                 v
                              FALLO
                                 |
                    +------------+------------+
                    |                         |
             REINTENTAR LOCAL        NUBE EXPLÍCITA
                                   (solo por acción humana)

No existe arista automática de FALLO a NUBE.
```

Un análisis local exitoso fija el estado del motor en `ready`: responder
correctamente es la prueba más fuerte de disponibilidad que existe.

---

## 9. Frescura del estado

El resultado de `/v1/runtime/status` se reutiliza durante **30 s**. Se
consulta al abrir el plugin, al abrir Ajustes, al pulsar «Comprobar de nuevo»
y al enrutar si el dato está vencido. No se consulta en cada cambio de
selección, ni en cada render, ni en cada tecla.

Coste medido de una comprobación: **1.2 ms** (p50, 10 muestras).

---

## 10. Limitaciones conocidas

1. **Carrera de salud.** «Listo» a las 12:00:00 no garantiza que el runtime
   siga vivo a las 12:00:01. Si el POST falla después, se trata como fallo
   posterior al POST: sin nube automática. Esto es deliberado y prioriza la
   privacidad sobre la comodidad.
2. **La ventana de frescura puede mostrar un estado vencido** hasta 30 s.
   Afecta a la etiqueta del motor, nunca al destino real: el hilo principal
   resuelve la ruta de nuevo antes de enviar.
3. **Sin `AbortController`.** Cancelar el HTTP no cancelaría la inferencia ya
   en curso en Ollama; ahorraría cómputo, no corrección. Las guardas de
   `requestId` ya protegen la corrección.
4. **La ruta que calcula la interfaz es orientativa.** La vinculante se
   resuelve en el hilo principal. Ambas usan la misma función pura, así que
   solo pueden diferir por la antigüedad del estado, nunca por política.
5. **La nube no se optimiza en esta fase.** Es respaldo, no objetivo de
   rendimiento.
6. **Sin arranque automático del runtime.** Si el motor local está apagado,
   `auto` usará la nube (si está configurada) y `local` bloqueará. El plugin
   no instala ni levanta nada.
