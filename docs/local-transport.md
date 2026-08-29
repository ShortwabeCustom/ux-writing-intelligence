# Transporte local del plugin — FASE 8.5.4

Conecta el flujo de Text Audit del plugin de Figma al runtime local.

---

## Arquitectura

```
Figma (plugin, hilo principal)
        │  http://localhost:8787/v1/analyze/text
        ▼
UX Writing Local Runtime      ← único endpoint de análisis local
        │
        ▼
Motor determinista / seguridad
        │
        ▼
Ollama 127.0.0.1:11434 → qwen3.5:4b
```

**El plugin nunca habla con Ollama.** No existe ninguna ruta `Figma → Ollama`,
ni el bundle contiene el puerto 11434. El runtime es el único que puede
invocar inferencia, porque es quien aplica la seguridad de producto.

---

## Separación de transportes

`src/analysis-transport.ts` concentra la decisión local/nube en un solo lugar.
Sin esta abstracción, los condicionales de localhost se habrían esparcido por
el pipeline y cada rama (Analizar, Analizar de nuevo, ortografía, texto largo)
habría podido divergir.

| | Local | Nube |
|---|---|---|
| Endpoint | `http://localhost:8787/v1/analyze/text` | `https://writing.productdesign.mx/v1/analyze/text` |
| Encabezados | `Content-Type` **y nada más** | `Content-Type` + `X-API-Key` |
| API Key | **nunca se lee ni se envía** | se lee de `clientStorage` |
| Implementación | propia | delega en `analyzeText`, la que ya existía |

La nube **no se reimplementó**: el transporte de nube delega en `analyzeText`,
de modo que hay una sola implementación y no pueden divergir.

### Política de transporte de esta fase

`ACTIVE_TRANSPORT_KIND = 'local'`.

La nube queda compilada y probada, pero **no se invoca automáticamente cuando
el local falla**. No hay fallback. Es deliberado: durante QA necesitamos ver
los fallos locales, no esconderlos tras la nube. La política de fallback
pertenece a FASE 8.5.5.

---

## Manifest

```json
"networkAccess": {
  "allowedDomains": [
    "https://writing.productdesign.mx",
    "http://localhost:8787"
  ],
  "reasoning": "…motor local opcional que se ejecuta en la computadora de la persona usuaria…"
}
```

- Sin comodines. Sin `0.0.0.0`. Sin rangos de LAN. Sin otros puertos de localhost.
- El dominio de la nube **se conserva**.
- Plugin ID intacto: `1674592820827897160`.

Nueve pruebas en `tests/manifest.test.mjs` fijan estas condiciones.

---

## Sin API Key en local

El transporte local envía **exclusivamente** `Content-Type: application/json`.

`code.ts` ni siquiera lee la clave cuando el transporte activo es local:
`transportRequiresApiKey('local') === false`, así que `getApiKey()` no se
invoca. La clave no puede filtrarse porque nunca entra al camino local.

Pruebas de regresión bloqueantes en `tests/transport.test.mjs`:

- la petición local no lleva `X-API-Key`;
- la petición local no lleva `Authorization`;
- el transporte local solo envía **un** encabezado;
- se pasa un secreto a `selectAnalysisTransport` y se verifica que **no aparece
  en ninguna parte** de la petición serializada.

La clave de la nube sigue guardada en `clientStorage` sin cambios, y la UI de
ajustes sigue intacta. La nube **no** está obsoleta.

---

## Salud del motor local

`GET /v1/runtime/status`. **No dispara inferencia**: el runtime responde con el
catálogo de modelos.

Estados: `checking` · `ready` · `unavailable` · `model_missing` · `degraded`.

Se consulta en momentos puntuales — al abrir el plugin y al pulsar Reintentar —
**nunca** en cada cambio de selección ni en cada tecla.

La UI muestra una fila compacta y no expone infraestructura: no aparecen host,
puerto, nombres de servicios ni trazas. El modelo se presenta como «Qwen 3.5»,
no como `qwen3.5:4b`.

---

## Errores

| Runtime local | Código del plugin | Título para la persona |
|---|---|---|
| conexión rechazada | `LOCAL_RUNTIME_UNAVAILABLE` | Motor local no disponible |
| `OLLAMA_UNAVAILABLE` | `LOCAL_RUNTIME_UNAVAILABLE` | Motor local no disponible |
| `MODEL_NOT_AVAILABLE` | `LOCAL_MODEL_NOT_AVAILABLE` | Modelo local no disponible |
| `MODEL_TIMEOUT` | `LOCAL_ANALYSIS_TIMEOUT` | El análisis está tardando demasiado |
| `INVALID_MODEL_RESPONSE` | `INVALID_RESPONSE` | (mensaje existente) |

Cada fallo tiene su propio código: **no se colapsan** en un genérico
«No pudimos conectar». Hay una prueba que verifica que cuatro fallos distintos
producen cuatro códigos distintos.

Ninguno de los mensajes pide correr comandos de terminal. La UX de instalación
y ciclo de vida pertenece a fases posteriores.

---

## Fuente de la verdad

El transporte local **rechaza** cualquier respuesta cuyo `text` no sea idéntico
al texto enviado. El plugin no normaliza espacios, saltos de línea,
placeholders ni Unicode en ningún punto del camino.

Esta comprobación es exclusiva del transporte local; la nube conserva su
comportamiento actual sin modificaciones.

---

## Lo que NO cambió

`Apply`, las guardas de obsolescencia y el feedback de carga **no se tocaron**.
El transporte se eligió por debajo del pipeline compartido, así que:

- `Apply` usa exactamente la ruta existente. No se creó `applyLocalSuggestion()`.
- `loadFontAsync`, bloqueo por estilos mixtos, `selectionRevision`, `requestId`,
  revalidación del `TextNode`, protección contra respuestas obsoletas, Undo
  nativo y la regla de que MAIN es dueño de la mutación siguen igual.
- El feedback de carga conserva sus umbrales: «Analizando contenido…» y, a
  partir de 8 s, «El análisis está tomando un poco más de lo habitual…». Sigue
  siendo el mensaje correcto: el p50 local ronda 5 s, el contenido largo ~6.4 s
  y una regeneración semántica puede superar los 12 s.
- La generación de contexto es idéntica a la de la nube. Se valida paridad de
  transporte, no un rediseño de prompt.

---

## Seguridad

| | Valor |
|---|---|
| Runtime | `127.0.0.1:8787` |
| Ollama | `127.0.0.1:11434` |
| Listeners en `0.0.0.0` | **0** |

El plugin usa `localhost` en la URL; el runtime sigue bindeado a `127.0.0.1`.

### CORS

Orígenes permitidos: `null`, `https://www.figma.com`, `https://figma.com`.
Sin `*`. Sin credenciales (`allow_credentials=False`), porque activarlas
prohibiría el origen `null` que envía el iframe con sandbox de Figma.

**CORS no es autenticación.** Es una política del navegador, no un control de
acceso. Lo que realmente aísla este runtime es el binding a loopback: ningún
equipo de la red puede alcanzarlo, con o sin CORS.

**Riesgo residual documentado:** una página abierta en el navegador de la
persona usuaria cuyo origen esté en la lista podría enviar peticiones al
runtime y consumir CPU local. No hay fuga de datos —quien atacara solo
analizaría su propio texto—, pero el consumo de recursos es real. Se acepta
para esta fase; `UXW_CORS_ORIGINS` permite restringir aún más sin recompilar.

Bajo ninguna circunstancia se resuelve un problema de conectividad exponiendo
el runtime a la LAN.

---

## Entorno soportado

**Figma Desktop en la misma computadora** es el objetivo de esta fase.

Figma Web puede estar bloqueado por las restricciones de red privada del
navegador (Private Network Access), que impiden que una página pública abra
conexiones a `localhost`. Si ocurre, **no se debilita la seguridad local**: no
se bindea a la LAN ni se abre el puerto. Figma Web quedaría sin motor local y
seguiría usando la nube cuando exista política de transporte (FASE 8.5.5).

---

## Limitaciones conocidas

1. **Sin fallback a la nube.** Si el motor local está apagado, el análisis
   falla y se muestra el error. Es intencional en esta fase.
2. **Sin selector Local/Nube en la interfaz.** Pertenece a FASE 8.5.5.
3. **El ciclo de vida del runtime es manual.** Hay que arrancarlo con
   `./scripts/run_local.sh`. No hay arranque al iniciar sesión.
4. **`AbortController` no se integró.** Las guardas de `requestId` y
   `selectionRevision` siguen descartando respuestas obsoletas, que es lo que
   protege la corrección. Pero abortar el HTTP **no cancelaría** una inferencia
   ya en curso dentro de Ollama: el modelo seguiría generando hasta terminar y
   solo se liberaría el hueco de cómputo al acabar. Integrarlo ahorraría
   cómputo, no corrección.
5. **Los códigos de error locales no están en el conjunto cerrado**
   `AnalyzeErrorCode` original del plugin: se añadieron tres nuevos. Cualquier
   consumidor externo del contrato debería contemplarlos.
