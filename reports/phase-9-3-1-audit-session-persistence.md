# FASE 9.3.1 — Audit Session Persistence

## Resultado

La persistencia de auditorías durante la sesión quedó implementada y cubierta por pruebas automatizadas. El gate permanece en **HOLD** únicamente porque los casos A–G del smoke nativo no pudieron ejecutarse de punta a punta mediante la automatización disponible en este entorno.

## Arquitectura

MAIN posee el `AuditSessionStore` canónico durante la vida de la instancia del plugin. La UI recibe copias serializables y no decide la validez de nodos. La restauración resuelve cada ID nuevamente mediante la API asíncrona de Figma y nunca conserva referencias a `SceneNode`, `TextNode`, `FrameNode`, instancias o componentes.

El módulo dedicado mantiene dos mapas:

- `screenAudits`, con clave `frameId`;
- `textAudits`, con clave `nodeId`.

Cada snapshot contiene únicamente IDs, texto original, resultados, procedencia, timestamps y estado de review necesario. No contiene árboles, imágenes, evidencia binaria ni objetos nativos de Figma.

## Contrato del store

- **Ownership:** MAIN.
- **Save timing, Screen:** solo al completar establemente una auditoría de pantalla.
- **Save timing, Text:** solo después de una respuesta final válida.
- **Restore timing:** al seleccionar el Frame auditado, uno de sus descendientes o el TextNode analizado; también al recibir `UI_READY` mientras MAIN sigue activo.
- **Replacement timing:** una ejecución nueva sustituye el snapshot previo únicamente cuando termina correctamente.
- **Failure behavior:** un error de reauditoría o reanálisis conserva el último snapshot válido.
- **Cleanup:** un Frame confirmado como eliminado elimina su snapshot. Los TextNodes eliminados nunca se restauran sobre otra selección.
- **Selection semantics:** salir de un contexto lo desactiva en UI sin borrar el store; selección vacía tampoco lo borra.

## Persistencia de Screen Audit

Cada Frame conserva su auditoría por identidad de nodo, incluso cuando otro Frame comparte el mismo nombre. Al regresar, MAIN reconstruye el estado de review, filtro y resultado activo sin llamar al motor. Un Frame sin snapshot conserva el preflight normal. La acción `Volver a auditar pantalla` es explícita y ejecuta una auditoría progresiva nueva.

La reauditoría fallida no destruye la auditoría completada anterior. El análisis individual de un texto no modifica ninguna tarjeta ni score históricos de Screen Audit.

## Persistencia de Text Audit

Cada TextNode conserva su último análisis válido por `nodeId`. Si `characters` coincide con el texto analizado, el resultado se restaura como vigente y mantiene las protecciones existentes de Apply. Si cambió, el resultado histórico sigue visible, se marca como desactualizado y se ofrece `Analizar de nuevo`; Apply no se ofrece para el resultado stale.

Screen Audit y Text Audit pueden mostrarse simultáneamente, pero mantienen identidades, scores, procedencia y tiempos independientes.

## Selección y reconciliación

- Salir de un Frame oculta o desactiva el contexto actual, pero conserva el snapshot.
- Volver al Frame o seleccionar un descendiente restaura su auditoría.
- Selección vacía muestra el estado vacío sin limpiar los mapas.
- Un rename de Frame o capa actualiza el nombre mostrado sin invalidar resultados basados en contenido.
- Un candidato cuyo texto cambió se marca `changed_since_audit`; el score histórico no cambia.
- Un candidato eliminado conserva su resultado histórico, muestra que ya no está disponible y queda fuera de navegación.
- Un candidato movido fuera del Frame se trata de forma segura como no disponible dentro de la pantalla auditada.
- Si el resultado activo deja de ser navegable o válido para el filtro, la UI elige determinísticamente el primer resultado navegable sin mover el canvas.

## Red y mutaciones

Las pruebas instrumentadas fijan en **0** las solicitudes de análisis al restaurar:

- Screen A;
- Screen B;
- Text A;
- resultado stale;
- candidato eliminado.

Cambiar filtro, Previous, Next, `Ver en pantalla`, seleccionar dentro del Frame o restaurar resultados no inicia análisis. La procedencia original Local/Nube se copia desde el snapshot; no se deriva de la salud actual del runtime.

El store y la restauración realizan **0 mutaciones del documento**. La única ruta que puede modificar texto sigue siendo Apply explícito, con sus guards existentes.

## QA automatizado

- Unit: **357/357 PASS**.
- Typecheck: **PASS**.
- Build: **PASS**.
- Playwright: **81/81 PASS**.
- `git diff --check`: **PASS**.

La cobertura añadida incluye mapas múltiples, nombres de Frame duplicados, replacement seguro, selección vacía/fuera, rename, cambios, eliminación, movimiento, restauración en `UI_READY`, filtro/activo, procedencia, independencia Screen/Text y assertions duras de cero requests.

## Smoke nativo de Figma

Setup observado:

- Figma Desktop cargó el plugin de desarrollo con el build actual.
- La selección del Frame produjo el preflight nativo esperado.
- El runtime congelado respondió saludable en `127.0.0.1:8787`.

Resultado de los casos obligatorios:

- Screen Persistence: **NOT EXECUTED**.
- Multiple Frames: **NOT EXECUTED**.
- Text Persistence: **NOT EXECUTED**.
- Changed Screen Candidate: **NOT EXECUTED**.
- Deleted Screen Candidate: **NOT EXECUTED**.
- Screen/Text Independence: **NOT EXECUTED**.
- Zero-network Restore: **NOT EXECUTED**.

Bloqueo de evidencia: el iframe del plugin ignoró los eventos automatizados de puntero, que atravesaron al canvas de Figma, y sus controles internos no aparecieron en el árbol de Accessibility aun con el proceso autorizado. Por ello no se declara PASS nativo sin observación real. Los mismos contratos sí están cubiertos mediante integración MAIN y Playwright con contadores de requests.

## Integridad y alcance

- Runtime source: no modificado; baseline `a87c73e`. El archivo no rastreado preexistente en su carpeta de reportes quedó intacto.
- Backend: no modificado.
- Manifest: no modificado.
- Plugin ID: `1674592820827897160`, sin cambios.
- No se escriben snapshots en `clientStorage`, IndexedDB, backend, archivos locales ni logs.
- No se incluyó contenido UX de archivos reales en este reporte.
- FASE 10 no se inició.

## Limitaciones conocidas

La persistencia termina con la instancia actual del plugin. No sobrevive al cierre o reload del plugin, reinicio de Figma, reapertura del archivo ni reinicio de la computadora. No existe sincronización entre equipos o sesiones.

## Commit

Commit solicitado: `feat: persist audit results during plugin session`.

Gate: **HOLD — falta ejecutar y observar el smoke nativo A–G en un host que permita interactuar con el iframe del plugin.**
