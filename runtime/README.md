# UX Writing Local Runtime

Workspace **aislado** para el spike de arquitectura e inferencia local de
UX Writing Intelligence sobre Apple Silicon.

## Qué es esto

FASE **8.5.0** (arquitectura local) + **8.5.1** (spike de Ollama y benchmark de
modelos). El objetivo es una sola decisión, con evidencia medida:

> ¿Conviene mover la inferencia de UX Writing Intelligence del VPS remoto a un
> runtime local en Apple Silicon **antes** de implementar Screen Audit?

## Qué NO es esto

Este workspace **no toca producción**. En esta fase no se modificó:

- el backend `https://writing.productdesign.mx`
- el VPS
- el código, el manifest ni el ID del plugin de Figma (`1674592820827897160`)
- la API Key, `clientStorage` ni el comportamiento actual del producto

Tampoco se implementó Screen Audit, ni el transporte localhost desde Figma,
ni el runtime HTTP `127.0.0.1:8787` (eso es FASE 8.5.3).

El MVP en producción está **CERRADO y ESTABLE**.

## Estructura

```
ux-writing-local-runtime/
├── README.md
├── docs/
│   ├── architecture.md          arquitectura objetivo + modelo de seguridad
│   └── hardware-report.md       hardware real detectado en esta Mac
├── benchmarks/
│   ├── cases.json               16 casos de riesgo real de producción
│   ├── benchmark_models.py      runner secuencial contra Ollama
│   ├── validate_output.py       validador determinista de invariantes
│   └── README.md                metodología
├── results/                     resultados crudos, con fecha, nunca sobrescritos
└── reports/
    └── phase-8-5-1-benchmark.md reporte legible + recomendación
```

## Arranque rápido

```bash
OLLAMA_HOST=127.0.0.1:11434 ollama serve      # local-only, nunca 0.0.0.0
cd benchmarks
python3 benchmark_models.py --model qwen3.5:4b --mode warm --out ../results/$(date +%F)
```

Ver `benchmarks/README.md` para la metodología y `reports/` para las conclusiones.
