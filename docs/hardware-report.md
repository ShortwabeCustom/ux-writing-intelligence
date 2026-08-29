# Hardware Report — FASE 8.5.0

Fecha de captura: 2026-08-28 / 2026-08-29
Host: MacBook Air (uso personal del autor). Auditoría no destructiva.

## Máquina detectada

| Campo | Valor |
|---|---|
| Model Name | MacBook Air |
| Model Identifier | Mac16,13 |
| Chip | **Apple M4** |
| CPU cores | 10 (4 performance + 6 efficiency) |
| GPU cores | No expuesto por `SPHardwareDataType` (ver nota) |
| Arquitectura | `arm64` |
| Memoria unificada | **24 GB** (`hw.memsize` = 25769803776 bytes) |
| macOS | 26.5.2 (build 25F84) |
| Disco disponible | 114 GiB (`/System/Volumes/Data`, 460 GiB totales, 74% usado) |

Nota sobre GPU: `system_profiler SPHardwareDataType` no reporta conteo de núcleos
GPU en esta versión de macOS. No se infiere el dato. El M4 base de MacBook Air
se comercializa en variantes de 8 y 10 núcleos GPU; **no se afirma cuál es esta
máquina** porque no fue medido.

## Toolchain

| Herramienta | Estado |
|---|---|
| Homebrew | 6.0.19 (presente antes de esta fase) |
| Python | 3.14.3 |
| Ollama | **Ausente al inicio** → instalado en esta fase vía Homebrew → 0.33.0 |

## Clasificación de hardware para el experimento

Categorías del spike:

- 8 GB → ENTRY
- 16 GB → STANDARD
- 24 GB → **ADVANCED**
- 32 GB+ → HIGH_CAPACITY

**Esta máquina: `ADVANCED` (24 GB).**

Consecuencia para STEP 6: se benchmarkean **4B y 9B**. No se benchmarkea 14B.

Esto NO es una política de hardware de producto. Solo decide qué modelos son
razonables de correr en esta Mac.

## Comandos usados

```
uname -m
sw_vers
system_profiler SPHardwareDataType
sysctl -n hw.memsize
df -h /System/Volumes/Data
brew --version
python3 --version
ollama --version
```
