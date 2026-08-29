# FASE 8.5.3 — Paridad del contrato HTTP

Verifica que la respuesta del runtime local respeta el mismo contrato que el
plugin de Figma ya espera. **El plugin no se modificó ni se conectó.**

Fuente de verdad del plugin (solo lectura):
`ux-writing-intelligence/src/analyze-contracts.ts`

---

## Ruta

| | Nube (producción, intacta) | Local (esta fase) |
|---|---|---|
| Endpoint | `https://writing.productdesign.mx/v1/analyze/text` | `http://127.0.0.1:8787/v1/analyze/text` |
| Método | `POST` | `POST` |
| Ruta | `/v1/analyze/text` | **idéntica** |

---

## Petición

El plugin envía `AnalyzeRequest`:

```ts
interface AnalyzeRequest { text: string; context: string; locale: 'es-MX'; }
```

El runtime acepta exactamente esos tres campos y **rechaza campos
desconocidos** (`extra="forbid"`). Compatible.

---

## Respuesta

`AnalyzeResponse` del plugin contra lo que emite el runtime:

| Campo | Tipo esperado por el plugin | Runtime | ✔ |
|---|---|---|---|
| `text` | `string` | `string` — **siempre igual a `request.text`** | ✅ |
| `locale` | `string` | `string` | ✅ |
| `score` | `number` 0..100 | `number` 0..100 | ✅ |
| `severity` | `'low'\|'medium'\|'high'` | idem | ✅ |
| `clarity` | `number` 1..5 | `number` 1..5 | ✅ |
| `concision` | `number` 1..5 | `number` 1..5 | ✅ |
| `utility` | `number` 1..5 | `number` 1..5 | ✅ |
| `jargon` | `boolean` | `boolean` | ✅ |
| `predictability` | `number` 1..5 | `number` 1..5 | ✅ |
| `orthography` | `number` 1..5 | `number` 1..5 | ✅ |
| `issues` | `AnalyzeIssue[]` | idem | ✅ |
| `reason` | `string` | `string` | ✅ |
| `suggestion` | `string` | `string` | ✅ |

`AnalyzeIssue`:

| Campo | Plugin | Runtime | ✔ |
|---|---|---|---|
| `category` | `string` | `string` | ✅ |
| `severity` | `'low'\|'medium'\|'high'` | idem | ✅ |
| `term` | `string \| null` | `string \| null` | ✅ |
| `reason` | `string` | `string` | ✅ |

El validador del plugin, `isAnalyzeResponse()`, comprueba exactamente estos
tipos y rangos. **Las 62 respuestas del banco pasaron la verificación de
contrato: 62/62.**

---

## Diferencias intencionales

### 1. Sin `X-API-Key` en local

| | Nube | Local |
|---|---|---|
| Autenticación | `X-API-Key` obligatoria | **ninguna** |
| Aislamiento | TLS + clave | binding a `127.0.0.1` |

El modelo de seguridad local es el loopback (STEP 4/29). Enviar el encabezado
`X-API-Key` al runtime local no cambia nada: se ignora y la petición se
atiende igual. Verificado en `tests/test_api.py::test_api_key_no_cambia_nada`.

**La clave de la nube no se tocó**, ni en el plugin ni en `clientStorage`.

### 2. Sin TLS en local

`http://` contra `https://`. Aceptable porque el tráfico nunca sale de la
interfaz de loopback.

### 3. Códigos de error

El runtime local emite códigos propios de servicio local:

| Runtime local | HTTP | `AnalyzeErrorCode` del plugin más cercano |
|---|---:|---|
| `OLLAMA_UNAVAILABLE` | 503 | `SERVICE_UNAVAILABLE` |
| `MODEL_NOT_AVAILABLE` | 503 | `SERVICE_UNAVAILABLE` |
| `MODEL_TIMEOUT` | 504 | `NETWORK_ERROR` |
| `INVALID_MODEL_RESPONSE` | 502 | `INVALID_RESPONSE` |
| `ANALYSIS_FAILED` | 400/500 | `UNKNOWN_ERROR` |

**Esta es la única incompatibilidad real y está sin resolver a propósito.** El
plugin espera su propio conjunto cerrado de códigos (`MISSING_API_KEY`,
`UNAUTHORIZED`, `RATE_LIMITED`, …). El mapeo definitivo pertenece a FASE 8.5.4,
donde se decide si traduce el runtime o el cliente del plugin. En esta fase el
plugin no consume el runtime, así que la diferencia no rompe nada.

Los códigos `MISSING_API_KEY`, `UNAUTHORIZED` y `RATE_LIMITED` **no tienen
equivalente local** y no deberían producirse nunca: no hay clave, no hay
autenticación y no hay límite de tasa en loopback.

### 4. CORS

No se habilita ningún origen (`CORS_ALLOW_ORIGINS = []`). El plugin no está
conectado. El comportamiento de Origin para Figma se define en 8.5.4.

---

## Qué NO se modificó

| Elemento | Estado |
|---|---|
| `manifest.json` | intacto — `networkAccess.allowedDomains` sigue siendo solo `https://writing.productdesign.mx` |
| Plugin ID | `1674592820827897160`, sin cambios |
| `ANALYZE_ENDPOINT` | sigue apuntando a la nube |
| API Key | sin tocar |
| `clientStorage` | sin tocar |
| Backend de producción | sin tocar, sin SSH |

Evidencia: el archivo más reciente del plugin es del **28 ago 18:47:43**; el
primer artefacto de esta fase es del **29 ago 02:18:45**.
