import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { api, artifactUrl } from './api'
import RemoteStudio from './RemoteStudio'
import { remoteEnabled } from './remote'
import type { Brief, Design, Job, ProductType, RagResult, StudioMode } from './types'

const DesignScene = lazy(() => import('./Scene'))
const modes: Array<{ id: StudioMode; label: string; note: string }> = [
  { id: 'local_private', label: 'LOCAL / PRIVADO', note: 'Sin enviar activos.' },
  { id: 'hybrid', label: 'HÍBRIDO', note: 'Pide permiso cuando mejora el resultado.' },
  { id: 'cloud_creative', label: 'CLOUD / CREATIVO', note: 'Máxima exploración visual.' },
]

function LocalStudio() {
  const [designs, setDesigns] = useState<Design[]>([])
  const [active, setActive] = useState<Design | null>(null)
  const [name, setName] = useState('Bolso laptop — estudio 01')
  const [type, setType] = useState<ProductType>('laptop_bag')
  const [mode, setMode] = useState<StudioMode>('local_private')
  const [prompt, setPrompt] = useState('Bolso urbano, nylon reciclado, bolsillo frontal y cierre negro.')
  const [bagDimensions, setBagDimensions] = useState('')
  const [notice, setNotice] = useState('Sistema local listo. Creá un diseño para empezar.')
  const [search, setSearch] = useState('')
  const [sources, setSources] = useState<RagResult[]>([])
  const [ragEngine, setRagEngine] = useState<'fts' | 'semantic'>('fts')
  const [semanticJob, setSemanticJob] = useState<Job | null>(null)
  const [operatorSession, setOperatorSession] = useState<string | null>(null)
  const [brief, setBrief] = useState<Brief | null>(null)
  const [mockup, setMockup] = useState<{ designId: string; revision: number; url: string } | null>(null)
  const [artifactLinks, setArtifactLinks] = useState<string[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLog, setChatLog] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([])

  const refresh = async () => {
    try {
      const items = await api.listDesigns()
      setDesigns(items)
      setActive(current => current ? items.find(item => item.id === current.id) ?? current : items[0] ?? null)
    } catch {
      setNotice('La API local no está disponible. Ejecutá scripts\\run-api.ps1.')
    }
  }
  useEffect(() => { void refresh() }, [])

  const missingText = useMemo(() => !active ? 'Creá un diseño o escribí una instrucción para empezar.' : active.missing.length ? `Falta confirmar: ${active.missing.join(', ')}` : 'Datos técnicos completos para exportar.', [active])
  const exportedMockupUrl = mockup && active && mockup.designId === active.id && mockup.revision === active.revision ? mockup.url : null
  const bagReadyForExport = active?.product_type !== 'laptop_bag' || active.missing.length === 0

  const parseBagDimensions = () => {
    const matched = bagDimensions.match(/(\d{2,3})\s*[x×]\s*(\d{2,3})\s*[x×]\s*(\d{1,2})\s*(?:mm)?/i)
    if (!matched) return undefined
    const [width, height, depth] = matched.slice(1).map(Number)
    return { laptop_width_mm: width, laptop_height_mm: height, laptop_depth_mm: depth }
  }

  const analyzeBrief = async () => {
    try {
      const result = await api.analyzeBrief({ description: `${prompt} ${bagDimensions}`, product_type: type })
      setBrief(result)
      setNotice(result.next_question ?? 'Brief local analizado; no se inventaron medidas.')
      return result
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo analizar el brief local.')
      return null
    }
  }

  const create = async (): Promise<Design | null> => {
    try {
      const analyzed = await analyzeBrief()
      const created = await api.createDesign({
        name, product_type: type, mode, description: prompt,
        components: analyzed?.confirmed.components,
        materials: analyzed?.confirmed.materials,
        measurements_mm: parseBagDimensions() ?? analyzed?.confirmed.measurements_mm,
      })
      setActive(created)
      setDesigns(items => [created, ...items])
      setMockup(null)
      setArtifactLinks([])
      setNotice(analyzed?.next_question ?? 'Diseño creado desde el brief local. El mockup técnico puede generarse.')
      return created
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo crear el diseño.')
      return null
    }
  }

  const selectMode = async (nextMode: StudioMode) => {
    setMode(nextMode)
    if (!active) {
      setNotice(`Modo ${nextMode === 'local_private' ? 'local' : nextMode === 'hybrid' ? 'híbrido' : 'cloud'} seleccionado para el próximo diseño.`)
      return
    }
    try {
      const changed = await api.operation(active.id, 'set_mode', nextMode)
      setActive(changed)
      setDesigns(items => items.map(item => item.id === changed.id ? changed : item))
      setNotice(nextMode === 'cloud_creative' ? 'Modo cloud seleccionado, pero no se enviará nada hasta que exista consentimiento y proveedor configurado.' : `Modo ${nextMode === 'hybrid' ? 'híbrido' : 'local'} guardado en revisión ${changed.revision}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo guardar el modo.')
    }
  }

  const sendChat = async () => {
    const message = chatInput.trim()
    if (!message) return
    let design = active
    if (!design) design = await create()
    if (!design) return
    setChatInput('')
    setChatLog(items => [...items, { role: 'user', text: message }])
    try {
      const reply = await api.chat(design.id, message)
      setActive(reply.design)
      setDesigns(items => items.map(item => item.id === reply.design.id ? reply.design : item))
      setMockup(null)
      setArtifactLinks([])
      setChatLog(items => [...items, { role: 'assistant', text: reply.message }])
      setNotice(reply.message)
    } catch (error) {
      const text = error instanceof Error ? error.message : 'No se pudo aplicar el cambio local.'
      setChatLog(items => [...items, { role: 'assistant', text }])
      setNotice(text)
    }
  }

  const update = async (kind: string, value: string | string[]) => {
    if (!active) return
    try {
      const changed = await api.operation(active.id, kind, value)
      setActive(changed)
      setDesigns(items => items.map(item => item.id === changed.id ? changed : item))
      setMockup(null)
      setArtifactLinks([])
      setNotice(`Revisión ${changed.revision} creada; el mockup previo ya no corresponde.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo aplicar el cambio.')
    }
  }

  const exportFiles = async (kind: 'mockup' | 'pattern' | 'techpack') => {
    if (!active || !bagReadyForExport) return
    try {
      const result = kind === 'mockup' ? await api.exportMockup(active.id) : kind === 'pattern' ? await api.exportPattern(active.id) : await api.exportTechpack(active.id)
      const links = result.artifacts.map(artifactUrl)
      setArtifactLinks(links)
      const glb = result.artifacts.find(path => path.endsWith('.glb'))
      if (glb) setMockup({ designId: active.id, revision: result.revision, url: artifactUrl(glb) })
      setNotice(kind === 'mockup' ? `Mockup GLB de revisión ${result.revision} cargado en el visor.` : `Exportado: ${result.artifacts.join(' · ')}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'La exportación falló.')
    }
  }

  const lookup = async () => {
    if (!search.trim()) return
    try {
      setSources(ragEngine === 'semantic' ? await api.semanticSearch(search) : await api.ragSearch(search))
    } catch (error) {
      setSources([])
      setNotice(error instanceof Error ? error.message : 'No hay resultados RAG o la API no está disponible.')
    }
  }

  const pollSemanticJob = async (jobId: string) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 500))
      const current = await api.jobStatus(jobId)
      setSemanticJob(current)
      if (current.status === 'completed') {
        setNotice(current.message ?? 'Índice semántico local actualizado.')
        return
      }
      if (current.status === 'failed' || current.status === 'cancelled') {
        setNotice(current.error ?? current.message ?? 'La indexación semántica no terminó.')
        return
      }
    }
    setNotice('La indexación sigue ejecutándose; podés consultar su estado más tarde.')
  }

  const startSemanticReindex = async () => {
    try {
      const job = await api.startSemanticReindex()
      setSemanticJob(job)
      setNotice('Rebuild semántico encolado: BGE-M3 trabaja de forma secuencial.')
      void pollSemanticJob(job.id)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo iniciar la indexación semántica.')
    }
  }

  const cancelSemanticJob = async () => {
    if (!semanticJob || !['queued', 'running'].includes(semanticJob.status)) return
    try {
      const cancelled = await api.cancelJob(semanticJob.id)
      setSemanticJob(cancelled)
      setNotice('Indexación semántica cancelada; el índice activo previo sigue intacto.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo cancelar la indexación.')
    }
  }

  const toggleOperator = async () => {
    try {
      if (operatorSession) {
        await api.stopOperator(operatorSession); setOperatorSession(null); setNotice('Autopiloto detenido.')
      } else {
        const session = await api.startOperator(); setOperatorSession(session.session_id); setNotice(`Autopiloto activo hasta ${new Date(session.expires_at).toLocaleTimeString()}.`)
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo cambiar el Autopiloto.') }
  }

  return <main className="studio-shell">
    <aside className="rail">
      <div className="brand"><span className="brand-mark">F</span><div>FASHION<br /><i>CAD STUDIO</i></div></div>
      <button className="new-design" onClick={() => void create()}>＋ NUEVO DISEÑO</button>
      <div className="project-list"><p>PROYECTOS</p>{designs.map(item => <button key={item.id} className={active?.id === item.id ? 'project active' : 'project'} onClick={() => { setActive(item); setMode(item.mode); setMockup(null); setArtifactLinks([]) }}><span>{item.product_type === 'laptop_bag' ? 'B' : 'T'}</span>{item.name}</button>)}</div>
      <button className={operatorSession ? 'operator on' : 'operator'} onClick={toggleOperator}><span className="pulse" /> AUTOPILOTO: {operatorSession ? 'ACTIVO' : 'APAGADO'}<br /><small>Control de estudio requiere sesión.</small></button>
    </aside>
    <section className="workbench">
      <header><div><p className="eyebrow">LOCAL-FIRST DESIGN ENVIRONMENT</p><h1>{active?.name ?? 'Nuevo estudio'}</h1></div><div className="revision">REV {active?.revision ?? '—'}<br /><small>{active?.confidence ?? 'manual'}</small></div></header>
      <div className="canvas-wrap"><Suspense fallback={<div className="scene-loading">CARGANDO ESTUDIO 3D…</div>}><DesignScene design={active} mockupUrl={exportedMockupUrl} productType={active?.product_type ?? type} /></Suspense><div className="scene-caption">{exportedMockupUrl ? `GLB VERIFICADO · REV ${active?.revision}` : 'VISTA PREVIA · GENERÁ GLB PARA VINCULAR EL ARTEFACTO'} · {(active?.product_type ?? type) === 'laptop_bag' ? 'LAPTOP BAG' : 'UPPER GARMENT'}</div></div>
      <div className="status-line"><span>●</span> {notice}</div>
    </section>
    <aside className="control-panel">
      <section><p className="panel-label">MODO DE INTELIGENCIA</p><div className="mode-grid">{modes.map(item => <button key={item.id} className={mode === item.id ? 'mode active' : 'mode'} onClick={() => void selectMode(item.id)}><b>{item.label}</b><small>{item.note}</small></button>)}</div></section>
      <section><p className="panel-label">BRIEF DEL DISEÑO</p><input value={name} onChange={event => setName(event.target.value)} aria-label="Nombre del diseño" /><div className="segmented"><button className={type === 'laptop_bag' ? 'selected' : ''} onClick={() => setType('laptop_bag')}>BOLSO</button><button className={type === 'upper_garment' ? 'selected' : ''} onClick={() => setType('upper_garment')}>PRENDA</button></div><textarea value={prompt} onChange={event => setPrompt(event.target.value)} aria-label="Descripción del diseño" />{type === 'laptop_bag' && <input className="dimensions" value={bagDimensions} onChange={event => setBagDimensions(event.target.value)} placeholder="Laptop: 355 × 245 × 25 mm" aria-label="Medidas físicas máximas de laptop en milímetros" />}<button className="brief-action" onClick={() => void analyzeBrief()}>ANALIZAR BRIEF LOCAL</button>{brief && <div className="brief-result"><b>{brief.product_type === 'laptop_bag' ? 'BOLSO DETECTADO' : 'PRENDA DETECTADA'}</b><span>{brief.confirmed.components?.join(' · ') || 'Sin componentes confirmados'}</span>{brief.next_question && <p>{brief.next_question}</p>}</div>}</section>
      <section className="design-chat"><p className="panel-label">ASISTENTE LOCAL</p><p>Escribí cambios: “agregá bolsillo y cierre”, “usá RPET” o “355 × 245 × 25 mm”. Crea revisiones reales y no envía activos.</p><div className="chat-log">{chatLog.slice(-4).map((entry, index) => <p key={`${entry.role}-${index}`} className={entry.role}>{entry.text}</p>)}</div><div className="chat-compose"><textarea value={chatInput} onChange={event => setChatInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendChat() } }} placeholder="Describí el cambio…" aria-label="Mensaje para el asistente local" /><button onClick={() => void sendChat()}>APLICAR</button></div></section>
      <section><p className="panel-label">CAMBIOS RÁPIDOS</p><div className="chips"><button onClick={() => update('add_component', 'bolsillo frontal')}>+ BOLSILLO</button><button onClick={() => update('add_component', 'cierre negro')}>+ CIERRE</button><button onClick={() => update('set_materials', ['nylon reciclado'])}>NYLON RECICLADO</button></div><p className="missing">{missingText}</p></section>
      <section className="exports"><p className="panel-label">PRODUCCIÓN</p>{!bagReadyForExport && <p className="export-blocked">Para este bolso confirmá ancho × alto × espesor en mm antes de exportar.</p>}<button disabled={!active || !bagReadyForExport} onClick={() => exportFiles('mockup')}>GENERAR MOCKUP GLB</button><button disabled={!active || !bagReadyForExport} onClick={() => exportFiles('pattern')}>EXPORTAR PATRÓN 1:1</button><button disabled={!active || !bagReadyForExport} onClick={() => exportFiles('techpack')}>GENERAR TECH PACK</button>{artifactLinks.length > 0 && <div className="artifact-links">{artifactLinks.map(link => <a key={link} href={link} target="_blank" rel="noreferrer">DESCARGAR {link.split('/').at(-1)?.toUpperCase()}</a>)}</div>}</section>
      <section className="knowledge"><p className="panel-label">CONOCIMIENTO LOCAL</p><div className="rag-engine"><button className={ragEngine === 'fts' ? 'selected' : ''} onClick={() => setRagEngine('fts')}>FTS</button><button className={ragEngine === 'semantic' ? 'selected' : ''} onClick={() => setRagEngine('semantic')}>BGE-M3</button></div><div><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar material o técnica" /><button onClick={lookup}>BUSCAR</button></div><button className="reindex" disabled={semanticJob?.status === 'queued' || semanticJob?.status === 'running'} onClick={startSemanticReindex}>RECONSTRUIR ÍNDICE SEMÁNTICO</button>{semanticJob && <div className="job-status"><b>{semanticJob.status.toUpperCase()}</b><span>{semanticJob.total ? `${semanticJob.progress}/${semanticJob.total}` : semanticJob.message}</span>{['queued', 'running'].includes(semanticJob.status) && <button onClick={cancelSemanticJob}>CANCELAR</button>}</div>}{sources.map(source => <article key={source.chunk_id ?? `${source.title}-${source.source}`}><b>{source.title}</b><small>{source.source}{source.source_page ? ` · pág. ${source.source_page}` : ''}{source.chunk_number ? ` · frag. ${source.chunk_number}` : ''}</small><p>{source.excerpt}</p></article>)}</section>
    </aside>
  </main>
}

export default function App() {
  return remoteEnabled ? <RemoteStudio /> : <LocalStudio />
}
