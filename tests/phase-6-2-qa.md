# FASE 6.2 — QA manual en Figma

## Test A — Analyze Again en un clic

1. Seleccionar el TextNode `Proceder con la originación`.
2. Pulsar **Analizar texto** y esperar el resultado.
3. Pulsar **Analizar de nuevo** una sola vez.
4. Confirmar que aparece inmediatamente **Analizando contenido…**.
5. Confirmar que el resultado anterior desaparece durante loading.
6. Confirmar que llega un resultado nuevo sin mostrar entre ambos la pantalla Ready.
7. Hacer doble clic rápido y confirmar un único request.

## Test B — Selección vigente

1. Analizar TextNode A.
2. Cambiar la selección a TextNode B.
3. Confirmar que desaparece el resultado de A y aparece el estado correspondiente a B.
4. Pulsar **Analizar texto** para B.
5. Confirmar que el resultado pertenece a los `characters` actuales de B y nunca a A.
6. Repetir con ninguna selección, múltiples capas, Frame, texto vacío y whitespace-only; no debe salir ningún request.

## Test C — Mixed styles

1. Seleccionar un TextNode con estilos mixtos.
2. Analizar y esperar el resultado.
3. Confirmar warning local **Este texto usa estilos mixtos**.
4. Confirmar Apply deshabilitado y **Analizar de nuevo** habilitado.
5. Pulsar **Analizar de nuevo** y confirmar loading inmediato y un solo request.

## Test D — Texto actualizado después de Apply

1. Analizar un TextNode homogéneo.
2. Aplicar la sugerencia.
3. Confirmar **Analizar texto actualizado**.
4. Pulsarlo una sola vez.
5. Confirmar loading inmediato y que el nuevo análisis utiliza el texto aplicado.
6. Confirmar que no se ejecuta análisis automático después de Apply.

## HTTP semántico

| Respuesta | Estado esperado | Copy esperado | CTA |
|---|---|---|---|
| 502 | INVALID_RESPONSE | No pudimos procesar la respuesta / El análisis no pudo completarse correctamente. | Intentar nuevamente |
| 503 | SERVICE_UNAVAILABLE | El servicio no está disponible / No pudimos completar el análisis en este momento. | Intentar nuevamente |
| 504 | SERVICE_UNAVAILABLE | El servicio no está disponible / No pudimos completar el análisis en este momento. | Intentar nuevamente |
