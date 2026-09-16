# Estado de implementación — 2026-09-16

## Entregado localmente

- Studio desktop React/Vite/Three.js conectado a FastAPI local: crear/seleccionar proyecto, analizar brief, cambios rápidos, modo persistente, chat local de operaciones, búsqueda RAG y exportaciones.
- Chat local determinista y auditable: reconoce componentes, materiales y medidas de laptop; convierte cada cambio en una revisión. No representa un proveedor cloud ni transmite activos.
- Dos familias: camiseta unisex y bolso laptop. El bolso bloquea GLB, patrón y Tech Pack hasta tener ancho, alto y espesor físicos.
- Exportadores locales: mockup GLB técnico, SVG/PDF A4 tiled/PDF A0 con control de 100 mm y Tech Pack PDF/XLSX. Son borradores técnicos: faltan prueba física y revisión de taller.
- SQLite FTS y LanceDB/BGE-M3 local con rebuild atómico, cancelable y sin duplicados. El índice previo se mantiene activo hasta el swap completo.
- La reconstrucción semántica fue corregida para procesar cuatro fragmentos por lote; una prueba verifica secuencia `[4, 1]`.
- Biblioteca privada organizada como `KNOWLEDGE_BASE_STUDIO\00…06`, ignorada por Git/Vercel. Catorce fuentes textuales quedaron importadas en FTS (2.029 fragmentos); tres PDF escaneados permanecen pendientes de OCR explícito.
- RapidOCR + ONNX Runtime + PyMuPDF están instalados dentro del entorno de FashionCAD. La importación OCR es explícita, local y registra página/confianza por fragmento; máximo 300 páginas por defecto. La corrida integral de 126 páginas se canceló sin escritura tras más de 15 min; no se declara indexada.
- Operator cerrado y deshabilitado por defecto; su prueba automática no sustituye validación física de banner, foco y `Ctrl+Alt+Pause`.
- GitHub: el repositorio de producción es `https://github.com/Safagix/fashion-cad-studio` (rama `main`). La rama histórica aislada sigue en `Safagix/ai-projects` y no debe mezclarse con la producción.
- Conector MCP local preparado para clientes compatibles: plantilla por usuario, script de arranque, chat local, cambios auditables, RAG y exportaciones. Un MCP remoto para ChatGPT queda bloqueado correctamente hasta tener identidad, backend persistente y autorización por usuario.

## Espacio web remoto — preparado, sin publicar todavía

- Hito de código publicado: `7fafc40 feat: add realtime Supabase design workspace` en `Safagix/fashion-cad-studio:main`.
- Se creó el proyecto Supabase `fashion-cad-studio` en plan Free, región São Paulo. No se copiaron libros, OCR, LanceDB, SQLite ni modelos locales.
- La migración `supabase/migrations/20260915164824_fashion_cad_realtime_workspace.sql` crea `design_projects`, `design_revisions` y `knowledge_packets`; RLS está habilitado y las tres tablas se verificaron presentes en la base remota.
- Las tablas no se exponen automáticamente; sólo el rol autenticado tiene permisos explícitos. Las revisiones se incrementan mediante `apply_design_revision`, y `design_projects`/`design_revisions` están en la publicación Realtime.
- Studio Web selecciona su modo remoto sólo si existen `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Sin esas dos variables conserva íntegramente el Studio local FastAPI. La clave de servicio no figura en el código, el repo ni el navegador.
- El modo remoto incorpora registro/inicio de sesión, proyectos sincronizados, chat determinista con revisiones, suscripción Realtime y búsqueda sobre `knowledge_packets`. Esos paquetes son notas que el usuario autoriza expresamente, no una copia automática de los libros locales.

## Evidencia vigente

- Última verificación tras agregar el espacio remoto: **21 passed** en `apps/api/tests`, build MCP y build Studio aprobados. Siguen siete warnings de deprecación upstream y un warning no bloqueante del chunk Three.js de 925.28 kB.
- QA remoto sin identidad: el navegador local muestra correctamente el portal de sesión, sin llamadas a la API local. Falta una cuenta real de prueba para comprobar el ciclo completo registro → diseño → Realtime desde una segunda sesión.
- QA del navegador: chat local creó un bolso con medidas/componentes/material y habilitó exportación; el modo híbrido persistió como nueva revisión.
- BGE-M3 previo: carga 3.31 s, consulta 0.69 s, vector 1024, RSS 1.94 GB.
- RapidOCR verificó extracción local de primera página de los PDF escaneados; la importación completa debe comprobarse por fuente/fragmento/confianza antes de declararla terminada.

## Operación

```powershell
Set-Location 'D:\Digital Lab\FashionCAD'
.\scripts\run-api.ps1          # terminal 1
.\scripts\run-web.ps1          # terminal 2
```

Para recarga de API: `./scripts/run-api.ps1 -Reload`.

```powershell
.\scripts\import-knowledge-base.ps1
.\scripts\import-knowledge-base.ps1 -Ocr -MaxOcrPages 300
.\scripts\verify-mvp.ps1
```

No correr OCR y BGE-M3 simultáneamente en esta PC de 16 GB RAM.

## Pendiente o requiere decisión externa

| Tema | Estado real | Próximo paso seguro |
|---|---|---|
| OCR de `Bag Design` | La corrida integral de 126 páginas se canceló sin fragmentos tras más de 15 min. | Agregar progreso/reanudación; no iniciar `Patternmaking` (848 páginas) sin reservar tiempo y límite explícito. |
| Rebuild BGE completo | Lote 4 llegó a 12/933 en 63 s y fue cancelado, ~80 min estimados. | Optimizar/medir antes de un rebuild completo; FTS sigue disponible. |
| Vercel público | Repositorio de producción y backend Supabase ya existen; falta cargar las dos variables públicas, publicar y definir URL de redirección de Auth. API local, BGE y biblioteca privada no se despliegan. | Pedir confirmación inmediata antes de transmitir la clave publicable a Vercel y pulsar Deploy; probar alta/inicio de sesión. |
| MCP remoto | El MCP stdio local está listo; el workspace remoto ya ofrece persistencia y Realtime. ChatGPT aún no tiene endpoint MCP remoto. | Implementar Streamable HTTP con OAuth/identidad por usuario; nunca un relay anónimo ni una clave de servicio en ChatGPT. |
| Qwen-VL/SigLIP2/voz/Blender | No instalados ni simulados. | Preflight de licencia, espacio, RAM/VRAM y benchmark en `D:`. |
| Producción industrial | No validada físicamente. | Imprimir control 100 ± 1 mm, cortar/coser y corregir con patronista/taller. |

## Cierre requerido de este hito

1. Agregar progreso/reanudación si se decide OCR integral; mantener la importación explícita y auditable.
2. Optimizar el rebuild BGE completo antes de consumir ~80 min de CPU.
3. Confirmar que el commit más reciente esté enviado a `Safagix/fashion-cad-studio:main` antes de publicar.
