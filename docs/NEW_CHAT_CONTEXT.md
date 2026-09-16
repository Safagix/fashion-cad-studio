# NEW CHAT CONTEXT — Fashion CAD Studio

## Prompt para un chat nuevo

```text
Continuá Fashion CAD Studio en D:\Digital Lab\FashionCAD. Leé primero docs\NEW_CHAT_CONTEXT.md y seguí sus instrucciones. Trabajá autónomamente dentro de esa raíz; no toques proyectos vecinos. Antes de editar, revisá git status y verificá el estado de API, índice semántico y procesos. Mantené el enfoque local-first: libros, modelos, SQLite, LanceDB y artefactos quedan en D: y no se publican ni se envían a cloud sin consentimiento por activo. No afirmes que una función existe sin evidencia. Al cerrar un hito, actualizá este contexto y docs\IMPLEMENTATION_STATUS.md.
```

## Objetivo y límites no negociables

- MVP: camiseta unisex regular (`upper_garment`) y bolso/funda laptop (`laptop_bag`) desde un `DesignDocument` versionado a mockup GLB, patrón 1:1 y Tech Pack PDF/XLSX.
- Para bolso exigir ancho, alto y espesor reales en mm; nunca inferirlos desde pulgadas, foto o boceto.
- Local sigue operativo sin Internet. Cloud es opt-in por activo, proveedor, propósito y coste; no hay proveedor/clave/túnel configurado.
- No usar ni modificar ningún proyecto vecino de `D:\Digital Lab`.
- No hacer `reset`, `clean`, `checkout` destructivo ni forzar pushes.
- La biblioteca privada y todos los modelos quedan fuera de GitHub y Vercel.

## Estado al cierre de este hito

- Producción GitHub: `https://github.com/Safagix/fashion-cad-studio`, rama `main`, publicada desde la rama local `fashion-cad-studio`. `Safagix/ai-projects:fashion-cad-studio` queda como historial; no mezclarlo con su `main` ajeno.
- Antes de editar, revisar `git status --short` y `git log -3 --oneline`. Hay cambios de usuario sin confirmar en `mockups.py`, `patterns.py` y `tests/test_api.py`: preservarlos y no incluirlos en un commit ajeno.
- La UI ya no es decorativa: el chat local transforma órdenes conocidas en operaciones/revisiones persistentes. QA de navegador verificado: crear bolso con “bolsillo, cierre, correa; nylon reciclado; 355 × 245 × 25 mm” creó revisión 8 y habilitó exportaciones; cambiar a Híbrido creó revisión 9.
- El selector de modo se persiste. Híbrido/cloud no envían activos ni simulan una IA remota; conservan la barrera de consentimiento.
- `GET /` responde salud/info de API (el 404 de la captura era raíz API sin endpoint, no un fallo de Uvicorn). `scripts\run-api.ps1` ahora arranca sin watcher pesado; para recarga usar `-Reload`. Usar una segunda terminal para `scripts\run-web.ps1`.
- Verificación completa aprobada después de este hito: **21 passed**, build MCP, build Studio y dos rebuilds BGE aislados. Los siete warnings de Starlette/httpx son deprecaciones upstream, no fallos.

## Arquitectura relevante

```text
apps/api/fashion_cad_api/    FastAPI, SQLite, asistente local, RAG, BGE/LanceDB, exportadores
apps/api/tests/              pruebas API
apps/studio-web/             React/Vite/Three.js
apps/mcp-server/             MCP stdio TypeScript cerrado
mcp-configs/                 plantilla de conexión MCP local por usuario
supabase/migrations/         esquema remoto versionado, sin secretos
scripts/                     arranque, importación, benchmark y verificación
KNOWLEDGE_BASE_STUDIO/       biblioteca privada (ignorada por Git)
data/sqlite + data/lancedb/  estado local del usuario (ignorado por Git)
models/embeddings/bge-m3/    BGE-M3 local verificado (ignorado por Git)
```

Piezas clave:

- `assistant.py`: intérprete determinista español para componentes, materiales, medidas y chat; no finge un LLM.
- `repository.py`: diseños/revisiones, FTS, metadata de página/confianza OCR, trabajos y puntero atómico del índice semántico.
- `ingestion.py`: sólo lee paths relativos confinados a `KNOWLEDGE_BASE_STUDIO`; TXT/MD/PDF hasta 200 MB, 1.500 páginas y 8M caracteres. OCR sólo bajo solicitud explícita.
- `knowledge_cli.py` y `scripts\import-knowledge-base.ps1`: importación local repetible, reemplaza la fuente previa y evita duplicados.
- `vector_store.py`: BGE-M3 CPU + LanceDB, reconstrucción temporal y swap atómico; procesa 4 fragmentos por lote, cancelable entre lotes.
- `scripts\run-mcp.ps1` + `mcp-configs\fashion-cad.local.mcp.json`: arranque y plantilla para clientes MCP locales; `docs\MCP_CONNECT.md` separa el conector local del remoto autenticado.

## Biblioteca privada y contexto IA

Se renombró/organizó la antigua `general info` como:

```text
KNOWLEDGE_BASE_STUDIO/
  01_THEORY_BOOKS/
  02_TECH_PACKS_REALES/
  03_SUSTAINABLE_MATERIALS/
  04_PATTERN_VECTOR/
  05_VISUAL_DICTIONARY/
  06_SIZE_CHARTS/
```

- Es privada, ignorada mediante `.gitignore`; comprobar con `git check-ignore` antes de cualquier `git add`.
- Fuentes textuales ya importadas: `Fashion Bags`, `Reinvention Sewing`, `The Fashion Design Toolkit`, `Computer-aided pattern design`, `Sustainable Fashion and Textiles` y documentación interna. La cuenta actual es **2.029 fragmentos FTS de 14 fuentes**; tres PDFs escaneados continúan pendientes de OCR explícito.
- RapidOCR 3.9.2 + ONNX Runtime + PyMuPDF quedaron instalados en `environments\api-venv`, con sus modelos dentro de `D:`. Un render de las primeras páginas de los dos scans produjo texto. El intento de OCR completo de `Bag Design` fue cancelado sin escribir fragmentos al superar 15 minutos; no confundir la prueba de página con una indexación completa.
- `Bag Design...pdf` tiene 126 páginas y `Patternmaking...pdf` 848. OCR exige un máximo explícito (300 por defecto) para no monopolizar CPU/RAM. Para el segundo usar, por ejemplo, `-Ocr -MaxOcrPages 848` sólo cuando haya tiempo y sin BGE activo.
- El plan corregido de licencias/datos/materiales/moldes/fine-tuning está en `docs\KNOWLEDGE_BASE_PLAN.md`. Los libros crean RAG, no “entrenan” un modelo automáticamente. Fine-tuning requiere derechos, pares entrada/salida y evaluación separada.

Comandos:

```powershell
Set-Location 'D:\Digital Lab\FashionCAD'
.\scripts\import-knowledge-base.ps1
.\scripts\import-knowledge-base.ps1 -Ocr -MaxOcrPages 300
```

Luego reconstruir BGE desde Studio o `POST /api/rag/semantic/reindex`. No correr OCR y BGE-M3 en paralelo en este equipo.

## BGE-M3, índice y hardware

- BGE-M3 está en `models\embeddings\bge-m3`; evidencia/hash en `model-provenance.json`.
- Runtime CPU: FlagEmbedding; benchmark previo: carga 3.31 s, consulta 0.69 s, vector 1024, RSS 1.94 GB.
- PC conocida: Ryzen 3 3200G, 16 GB RAM, GTX 1060 6 GB. Reconfirmar con `scripts\benchmark-models.ps1` si cambia la estrategia.
- La reconstrucción anterior de 933 fragmentos con lote 1 fue cancelada correctamente a 26/933 (`b20c4234-b938-4cec-8d6a-86a0fd660ea6`); no publicó una tabla parcial. El código fue actualizado y probado con lotes `[4, 1]` para cinco fragmentos. Una medición real con lote 4 llegó a 12/933 en 63 s (`47b0e7d0-e58c-4d48-b0d7-aa41f68c5804`) y se canceló; el orden de magnitud sigue siendo ~80 min, así que no afirmar que la biblioteca completa quedó semánticamente publicada.
- `POST /api/rag/semantic/reindex` crea job; `GET /api/jobs/{id}` da progreso; `DELETE /api/jobs/{id}` cancela. El índice previo continúa activo hasta el swap completo.

## GitHub y Vercel

- GitHub de producción: `Safagix/fashion-cad-studio:main`. Vercel ya está preparado para importar ese repositorio con nombre `fashion-cad-studio`; no desplegar la vieja importación `ai-projects`.
- Supabase: proyecto Free en São Paulo creado. La migración versionada crea tres tablas privadas por `auth.uid()`, RLS, grants sólo a `authenticated`, RPC invoker para revisión atómica y publicación Realtime. Se verificaron las tres tablas; no se subieron libros ni modelos.
- Studio Web conserva el local si no hay variables Supabase. Con `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (variables públicas, nunca service role) muestra registro email/contraseña, proyectos y revisiones Realtime y búsqueda de `knowledge_packets` aprobados. `apps/studio-web/.env.local` es local/ignorado.
- Antes de publicar: con confirmación inmediata, cargar URL y clave **publicable** en Vercel, pulsar Deploy y después añadir la URL Vercel a Auth Redirect URLs de Supabase. La clave secreta no puede salir del panel de Supabase.
- No desplegar BGE-M3, SQLite local ni `KNOWLEDGE_BASE_STUDIO` a Vercel. El modelo excede funciones Vercel y la biblioteca permanece privada.
- MCP local funciona por stdio. ChatGPT sigue necesitando un MCP remoto Streamable HTTP con OAuth y aislamiento por usuario; el esquema Realtime ya es su destino seguro, pero el endpoint no está implementado ni anunciado.

## Verificación y entrega

```powershell
Set-Location 'D:\Digital Lab\FashionCAD'
git status --short
.\environments\api-venv\Scripts\python.exe -m pytest apps\api\tests -q
npm --prefix apps\mcp-server run build
npm --prefix apps\studio-web run build
.\scripts\verify-mvp.ps1
```

- `verify-mvp.ps1` usa un root temporal bajo `cache\delivery-verification`, no toca la biblioteca del usuario y prueba dos rebuilds BGE reales aislados.
- Si PowerShell queda esperando un build sin proceso `node`/`tsc` hijo, inspeccionar primero con `Get-CimInstance Win32_Process`; no matar procesos del usuario por nombre amplio.
- El operator queda desactivado hasta una prueba física supervisada de foco, banner y `Ctrl+Alt+Pause`.
- Exportar no equivale a patrón industrial validado: imprimir cuadrado 100 ± 1 mm, cortar/coser y obtener revisión de taller/patronista.

## Prioridad siguiente si todo lo anterior está limpio

1. Planificar OCR por libro con progreso/reanudación antes de iniciar `Bag Design` (126 páginas) o `Patternmaking` (848); no usar una importación monolítica en esta CPU.
2. Optimizar el rebuild BGE completo antes de iniciarlo sobre 933+ fragmentos; el job medido es ~80 min. Mantener FTS disponible y registrar una medición real si se cambia batching/modelo/hardware.
3. Revisar que el commit/push de este hito exista y sustituir el hash exacto en esta sección si faltara.
4. Completar el despliegue Vercel con las dos variables públicas Supabase y validar registro → diseño → segunda sesión Realtime. Pedir confirmación inmediata antes de transmitir la clave publicable a Vercel y de pulsar Deploy.
5. Implementar MCP remoto autenticado sólo tras verificar la modalidad de ChatGPT/OAuth; no usar localhost, túnel abierto ni service role.
