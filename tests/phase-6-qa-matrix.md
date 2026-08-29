# FASE 6 — Manual QA Matrix

## Selection

| Trigger | Expected copy/state | CTA | Location | Retryable | State cleared by |
|---|---|---|---|---|---|
| Nothing selected | “Selecciona un texto” | None | Selection area | No | Selecting one TextNode |
| Multiple layers | “Selecciona una sola capa” | None | Selection area | No | Selecting one TextNode |
| Frame/non-text node | “Esta capa no contiene texto” | None | Selection area | No | Selecting one TextNode |
| Empty TextNode | “Este texto está vacío” / “Agrega contenido…” | None | Selection area | No | Adding non-whitespace text |
| Whitespace-only TextNode | Same as empty TextNode | None | Selection area | No | Adding non-whitespace text |
| Very long TextNode | Ready; content wraps/truncates safely without horizontal overflow | Analyze | Selection/results area | Yes | New selection |
| Rapid TextNode changes | Latest selection only; stale analysis/result is discarded | Analyze | Selection/results area | Yes | Stable latest selection |

## Settings

| Trigger | Expected copy | CTA | Location | Retryable | State cleared by |
|---|---|---|---|---|---|
| Empty API Key submit | “Ingresa una API Key para continuar.” | Save after editing | API Key field | After correction | Valid input/save |
| Storage read failure | “No pudimos leer la configuración” | Volver a intentar | Settings | Yes; repeats read | Successful read or close/reopen |
| Storage save failure | “No pudimos guardar la configuración” | Intentar nuevamente | Settings | Yes; repeats same pending save | Successful save or close |
| Storage delete failure | “No pudimos eliminar la clave” | Intentar nuevamente | Settings | Yes; repeats delete | Successful delete or close |
| Saving/deleting double click | One operation only; controls disabled with normal cursor | None while busy | Settings | N/A | Operation completes |

## Analyze

| Trigger | Expected copy | CTA | Location | Retryable | State cleared by |
|---|---|---|---|---|---|
| Missing API Key | “Configura tu API Key” / “Necesitas una API Key…” | Configurar | Results area | After settings | Valid key or selection change |
| Unauthorized | “Revisa tu API Key” / “La API Key no es válida…” | Abrir Configuración | Results area | After settings | Valid key or selection change |
| Rate limited | “Has realizado varios análisis” | Intentar nuevamente | Results area | Yes, manual | New request/success/selection |
| Rate limited with Retry-After | Adds “Podrás volver a intentarlo en aproximadamente {n} s.” | Intentar nuevamente | Results area | Yes, manual | New request/success/selection |
| Service unavailable | “El servicio no está disponible” | Intentar nuevamente | Results area | Yes | New request/success/selection |
| Network error | “No pudimos conectar” | Intentar nuevamente | Results area | Yes | New request/success/selection |
| Invalid response | “No pudimos procesar la respuesta” | Intentar nuevamente | Results area | Yes | New request/success/selection |
| Stale selection | “El texto cambió” / selection guidance | Intentar nuevamente when latest selection is valid | Results area | After revalidation | Retry/new selection |
| Invalid selection | “Selecciona una capa de texto” | None | Results area | After selection | Valid TextNode selection |
| Unknown error | “No pudimos completar el análisis” | Intentar nuevamente | Results area | Yes | New request/success/selection |
| Analyze double click | One request only; Analyze controls disabled while loading | None while busy | Analyze action | N/A | Request completes |

## Apply

| Trigger | Expected copy | CTA/state | Location | Retryable | State cleared by |
|---|---|---|---|---|---|
| No active/stale analysis | Analysis is no longer current | Analyze again | Local/fallback Apply context | Requires new analysis | New analysis/selection |
| Node deleted | “El texto ya no está disponible.” / “Selecciona otra capa…” | None | Apply fallback | After selection | New selection |
| Selection changed | “La selección cambió” | None | Apply fallback | After selection | New selection |
| Text changed | “El texto cambió” | Analyze again | Local/fallback Apply context | Requires new analysis | New analysis |
| Empty suggestion | Suggestion cannot be applied | Analyze again | Local Apply context | Requires new analysis | New analysis |
| Missing font | “Hay una fuente no disponible” | Apply disabled | Local Suggestion section | No until font resolved | Selection/new analysis |
| Font load failed | “No pudimos cargar la fuente” | Apply remains available | Local Suggestion section | Yes | Retry/success/new analysis |
| Mixed styles | “Este texto usa estilos mixtos” | Apply disabled | Local Suggestion section only | No; manual application | Selection/new analysis |
| Edit failed | “No pudimos actualizar el texto” | Apply remains available | Local Suggestion section | Yes | Retry/success/new analysis |
| Unknown Apply error | “No pudimos aplicar la sugerencia” | Apply remains available | Local Suggestion section | Yes | Retry/success/new analysis |
| Apply double click | One APPLY_SUGGESTION only; CTA disabled while applying | None while busy | Suggestion section | N/A | Apply completes |

## Cross-cutting checks

- No HTTP codes, stack traces, exception messages, JSON/schema/contract terminology, backend names, or model names are visible.
- Only one alert region announces each error.
- Disabled controls use the default cursor, not a prohibited cursor.
- New success and selection states clear obsolete errors.
- Light and dark Figma themes retain readable borders, text, and actions.
