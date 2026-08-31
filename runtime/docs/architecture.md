# Arquitectura objetivo — UX Writing Local Runtime

Estado: **documento de diseño**. Nada de esto está implementado en FASE 8.5.0 / 8.5.1.

## 1. Arquitectura actual (producción, CERRADA y ESTABLE)

```
Figma Plugin (ID 1674592820827897160)
      |
      | HTTPS
      v
https://writing.productdesign.mx        (VPS)
      |
      v
Ollama remoto  ->  qwen3:1.7b
```

Esta ruta **no se toca** en esta fase. Sigue siendo el camino de producción.

## 2. Arquitectura objetivo (futura)

```
Figma Plugin
      |
      | localhost
      v
UX Writing Local Runtime
127.0.0.1:8787                <-- NO implementado (FASE 8.5.3)
      |
      v
Ollama
127.0.0.1:11434               <-- validado en FASE 8.5.1
      |
      v
Apple Silicon (memoria unificada)
```

## 3. Frontera de responsabilidades del futuro runtime local

El runtime local `127.0.0.1:8787` eventualmente será dueño de:

- reglas de UX Writing
- scoring (claridad, concisión, utilidad, predictibilidad)
- ortografía
- glosario / terminología de producto
- fidelidad semántica
- integridad de contenido protegido (`{{...}}`, URLs, emails)
- integridad de fronteras de origen (no fusionar tokens)
- transporte hacia Ollama

Ollama **no** es dueño de ninguna de esas reglas. Ollama es solo inferencia.

Lo que queda **fuera** del runtime local: la UI del plugin, `clientStorage`,
el manifest y el ID del plugin. Todo eso permanece intacto.

## 4. Modelo de seguridad

- Ollama debe escuchar **exclusivamente** en `127.0.0.1:11434`.
- Prohibido bind a `0.0.0.0`.
- Prohibido exponer el endpoint a LAN o internet.
- El futuro runtime `:8787` debe seguir la misma regla: solo loopback.
- No se modifica configuración de firewall ni de red para este spike.

Verificación aplicada en esta fase (STEP 5):

```
lsof -nP -iTCP -sTCP:LISTEN | grep 11434
ollama  62796  alexisvaldez  4u  IPv4  TCP 127.0.0.1:11434 (LISTEN)
```

Resultado: **loopback-only. No hay listener en 0.0.0.0 ni en la IP de LAN.**

Nota operativa: Ollama se lanzó manualmente con `OLLAMA_HOST=127.0.0.1:11434`,
**no** con `brew services start ollama`, para evitar dejar un servicio
persistente al login sin decisión explícita del usuario.

## 5. Fallback

El backend cloud `writing.productdesign.mx` **permanece disponible** como
fallback en la arquitectura objetivo. La migración a local nunca implica
eliminar el cloud:

```
Figma Plugin
   |-- 1º intenta --> 127.0.0.1:8787   (si el runtime local está vivo)
   |-- si falla   --> writing.productdesign.mx
```

La estrategia de detección/failover **no se diseña ni se implementa aquí**.
Pertenece a una fase posterior.

## 6. Qué NO se implementa en 8.5.0 / 8.5.1

- ❌ servidor HTTP `127.0.0.1:8787`
- ❌ transporte localhost desde el plugin de Figma
- ❌ Screen Audit
- ❌ batching / concurrencia
- ❌ reemplazo de producción
- ❌ borrado del backend cloud
