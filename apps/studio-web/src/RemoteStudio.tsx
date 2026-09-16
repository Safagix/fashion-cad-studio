import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { remote } from './remote'
import type { Design, ProductType, StudioMode } from './types'

const DesignScene = lazy(() => import('./Scene'))

type CloudDesign = Omit<Design, 'missing'>
type CloudInsert = Omit<CloudDesign, 'id' | 'created_at' | 'updated_at'> & { owner_id: string }
type KnowledgePacket = {
  id: string
  title: string
  body: string
  source_label: string
  source_page: number | null
  tags: string[]
  score: number
}

const modes: Array<{ id: StudioMode; label: string; note: string }> = [
  { id: 'local_private', label: 'LOCAL / PRIVADO', note: 'El origen sigue bajo tu control.' },
  { id: 'hybrid', label: 'HÍBRIDO', note: 'Persistencia segura y revisión humana.' },
  { id: 'cloud_creative', label: 'CLOUD / CREATIVO', note: 'No envía libros privados.' },
]

function missingFor(design: CloudDesign): string[] {
  if (design.product_type !== 'laptop_bag') return []
  const measurements = design.measurements_mm
  return ['laptop_width_mm', 'laptop_height_mm', 'laptop_depth_mm']
    .filter(key => !Number(measurements[key]))
    .map(key => ({ laptop_width_mm: 'ancho', laptop_height_mm: 'alto', laptop_depth_mm: 'espesor' }[key] ?? key))
}

function toDesign(row: CloudDesign): Design {
  return { ...row, missing: missingFor(row) }
}

function cloudError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function planInstruction(design: Design, input: string) {
  const text = input.trim()
  const normalized = text.toLowerCase()
  const next: CloudDesign = { ...design, measurements_mm: { ...design.measurements_mm }, materials: [...design.materials], components: [...design.components] }
  const actions: string[] = []
  const componentRules = [['bolsillo', 'bolsillo frontal'], ['cierre', 'cierre negro'], ['zipper', 'cierre negro'], ['correa', 'correa'], ['asa', 'asa'], ['cuello', 'cuello rib']] as const
  for (const [term, component] of componentRules) {
    if (normalized.includes(term) && !next.components.some(item => item.toLowerCase() === component)) {
      next.components.push(component)
      actions.push(`componente: ${component}`)
    }
  }
  const materialRules = [['nylon reciclado', 'nylon reciclado'], ['rpet', 'RPET'], ['algodón reciclado', 'algodón reciclado'], ['algodon reciclado', 'algodón reciclado'], ['piñatex', 'Piñatex']] as const
  for (const [term, material] of materialRules) {
    if (normalized.includes(term) && !next.materials.includes(material)) {
      next.materials.push(material)
      actions.push(`material: ${material}`)
    }
  }
  const dimensions = normalized.match(/(\d{2,4})\s*[x×]\s*(\d{2,4})\s*[x×]\s*(\d{1,3})\s*(?:mm)?/)
  if (dimensions && next.product_type === 'laptop_bag') {
    const [width, height, depth] = dimensions.slice(1).map(Number)
    next.measurements_mm = { ...next.measurements_mm, laptop_width_mm: width, laptop_height_mm: height, laptop_depth_mm: depth }
    actions.push(`medidas: ${width} × ${height} × ${depth} mm`)
  }
  if (actions.length === 0 && /cambiá|cambia|actualizá|actualiza|rediseñá|rediseña|quiero|hacé|hace/.test(normalized)) {
    next.description = text
    actions.push('dirección de diseño actualizada')
  }
  return { next, actions }
}

function AuthGate({ notice, onNotice }: { notice: string; onNotice: (value: string) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const submit = async (kind: 'sign-in' | 'sign-up') => {
    if (!remote || !email || password.length < 8) {
      onNotice('Ingresá email y una contraseña de al menos 8 caracteres.')
      return
    }
    setPending(true)
    const result = kind === 'sign-in'
      ? await remote.auth.signInWithPassword({ email, password })
      : await remote.auth.signUp({ email, password })
    setPending(false)
    if (result.error) onNotice(result.error.message)
    else if (kind === 'sign-up' && !result.data.session) onNotice('Revisá el correo de confirmación para abrir tu estudio.')
  }
  return <main className="auth-shell"><div className="auth-card"><div className="brand"><span className="brand-mark">F</span><div>FASHION<br /><i>CAD STUDIO</i></div></div><p className="eyebrow">ESPACIO REMOTO PRIVADO</p><h1>Tu estudio sincronizado</h1><p>Los diseños se sincronizan en tiempo real entre tus sesiones. Los libros y modelos locales no se suben.</p><label>Email<input value={email} onChange={event => setEmail(event.target.value)} type="email" autoComplete="email" /></label><label>Contraseña<input value={password} onChange={event => setPassword(event.target.value)} type="password" autoComplete="current-password" /></label><div className="auth-actions"><button disabled={pending} onClick={() => void submit('sign-in')}>ENTRAR</button><button disabled={pending} onClick={() => void submit('sign-up')}>CREAR CUENTA</button></div><p className="auth-notice">{notice}</p></div></main>
}

export default function RemoteStudio() {
  const [session, setSession] = useState<Session | null>(null)
  const [projects, setProjects] = useState<Design[]>([])
  const [active, setActive] = useState<Design | null>(null)
  const [name, setName] = useState('Bolso laptop — estudio remoto')
  const [type, setType] = useState<ProductType>('laptop_bag')
  const [mode, setMode] = useState<StudioMode>('hybrid')
  const [prompt, setPrompt] = useState('Bolso urbano, nylon reciclado, bolsillo frontal y cierre negro.')
  const [chatInput, setChatInput] = useState('')
  const [chatLog, setChatLog] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const [notice, setNotice] = useState('Conectando tu espacio privado…')
  const [knowledgeQuery, setKnowledgeQuery] = useState('')
  const [packets, setPackets] = useState<KnowledgePacket[]>([])
  const [packetTitle, setPacketTitle] = useState('')
  const [packetBody, setPacketBody] = useState('')

  const refresh = async () => {
    if (!remote || !session) return
    const { data, error } = await remote.from('design_projects').select('*').order('updated_at', { ascending: false })
    if (error) { setNotice(error.message); return }
    const listed = (data as CloudDesign[]).map(toDesign)
    setProjects(listed)
    setActive(current => current ? listed.find(item => item.id === current.id) ?? listed[0] ?? null : listed[0] ?? null)
    if (listed.length === 0) setNotice('Creá tu primer diseño remoto. Todo quedará aislado en tu cuenta.')
  }

  useEffect(() => {
    if (!remote) return
    void remote.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = remote.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => { void refresh() }, [session])

  useEffect(() => {
    if (!remote || !session) return
    const client = remote
    const channel = client.channel(`fashion-cad-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'design_projects' }, () => { void refresh() })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [session])

  const missingText = useMemo(() => !active ? 'Creá un diseño o escribí una instrucción para empezar.' : active.missing.length ? `Falta confirmar: ${active.missing.join(', ')}` : 'Datos técnicos completos para exportar en la estación local.', [active])

  const create = async (): Promise<Design | null> => {
    if (!remote || !session) return null
    const initial: CloudInsert = {
      owner_id: session.user.id, name, product_type: type, mode, description: prompt, measurements_mm: {}, materials: [], components: [], revision: 1, approval_state: 'draft', confidence: 'local_assisted',
    }
    const { data, error } = await remote.from('design_projects').insert(initial).select().single()
    if (error) { setNotice(error.message); return null }
    const created = toDesign(data as CloudDesign)
    const { error: revisionError } = await remote.from('design_revisions').insert({ design_id: created.id, owner_id: session.user.id, revision: 1, operation: { kind: 'create' }, snapshot: created })
    if (revisionError) { setNotice(revisionError.message); return null }
    setActive(created); setProjects(items => [created, ...items]); setNotice('Diseño remoto creado y sincronizado.')
    return created
  }

  const saveRevision = async (current: Design, next: CloudDesign, operation: Record<string, unknown>) => {
    if (!remote) return null
    const { data, error } = await remote.rpc('apply_design_revision', { p_design_id: current.id, p_operation: operation, p_snapshot: next }).single()
    if (error) { setNotice(error.message); return null }
    const saved = toDesign(data as CloudDesign)
    setActive(saved); setProjects(items => items.map(item => item.id === saved.id ? saved : item)); return saved
  }

  const selectMode = async (nextMode: StudioMode) => {
    setMode(nextMode)
    if (!active) { setNotice(`Modo ${nextMode === 'local_private' ? 'local' : nextMode === 'hybrid' ? 'híbrido' : 'cloud'} seleccionado para el próximo diseño.`); return }
    await saveRevision(active, { ...active, mode: nextMode }, { kind: 'set_mode', value: nextMode })
    setNotice('Modo guardado y sincronizado en tiempo real.')
  }

  const sendChat = async () => {
    const message = chatInput.trim()
    if (!message) return
    let design = active
    if (!design) design = await create()
    if (!design) return
    setChatInput(''); setChatLog(items => [...items, { role: 'user', text: message }])
    const { next, actions } = planInstruction(design, message)
    const knowledge = await searchKnowledge(message, false)
    if (actions.length === 0) {
      const text = 'No detecté una modificación segura. Probá: “agregá bolsillo y cierre”, “usá RPET” o “355 × 245 × 25 mm”.'
      setChatLog(items => [...items, { role: 'assistant', text }]); setNotice(text); return
    }
    const saved = await saveRevision(design, next, { kind: 'assistant_message', message, actions })
    if (!saved) return
    const context = knowledge.length ? ` Consulté tu base aprobada: ${knowledge.map(item => item.title).join(' · ')}.` : ' No hubo un paquete aprobado coincidente.'
    const text = `Apliqué ${actions.join(', ')} en revisión ${saved.revision}.${context}`
    setChatLog(items => [...items, { role: 'assistant', text }]); setNotice(text)
  }

  const quickChange = async (component: string) => {
    if (!active) { setNotice('Creá primero un diseño remoto.'); return }
    if (active.components.includes(component)) { setNotice(`${component} ya está presente.`); return }
    const saved = await saveRevision(active, { ...active, components: [...active.components, component] }, { kind: 'add_component', value: component })
    if (saved) setNotice(`Revisión ${saved.revision} sincronizada.`)
  }

  const searchKnowledge = async (query: string, updateVisible = true) => {
    if (!remote || !query.trim()) return []
    const { data, error } = await remote.rpc('search_knowledge_packets', { p_query: query })
    if (error) { if (updateVisible) setNotice(error.message); return [] }
    const results = (data ?? []) as KnowledgePacket[]
    if (updateVisible) { setPackets(results); setNotice(results.length ? `${results.length} paquete(s) de conocimiento aprobado encontrado(s).` : 'No hay paquetes aprobados coincidentes. Tus libros locales siguen privados.') }
    return results
  }

  const addPacket = async () => {
    if (!remote || !session || packetTitle.trim().length < 2 || packetBody.trim().length < 1) { setNotice('Completá título y contenido de la nota aprobada.'); return }
    const { error } = await remote.from('knowledge_packets').insert({ owner_id: session.user.id, title: packetTitle.trim(), body: packetBody.trim(), source_label: 'Nota aprobada por el usuario', tags: [] })
    if (error) { setNotice(error.message); return }
    setPacketTitle(''); setPacketBody(''); setNotice('Paquete aprobado guardado. Sólo esta nota, no tus libros privados, quedó disponible en la web.')
  }

  if (!session) return <AuthGate notice={notice} onNotice={setNotice} />

  return <main className="studio-shell">
    <aside className="rail"><div className="brand"><span className="brand-mark">F</span><div>FASHION<br /><i>CAD STUDIO</i></div></div><button className="new-design" onClick={() => void create()}>＋ NUEVO DISEÑO</button><div className="project-list"><p>PROYECTOS SINCRONIZADOS</p>{projects.map(item => <button key={item.id} className={active?.id === item.id ? 'project active' : 'project'} onClick={() => { setActive(item); setMode(item.mode) }}><span>{item.product_type === 'laptop_bag' ? 'B' : 'T'}</span>{item.name}</button>)}</div><button className="operator" onClick={() => void remote?.auth.signOut()}><span className="pulse" /> SESIÓN PRIVADA<br /><small>Cerrar sesión</small></button></aside>
    <section className="workbench"><header><div><p className="eyebrow">REALTIME PRIVATE WORKSPACE</p><h1>{active?.name ?? 'Nuevo estudio'}</h1></div><div className="revision">REV {active?.revision ?? '—'}<br /><small>sincronizada</small></div></header><div className="canvas-wrap"><Suspense fallback={<div className="scene-loading">CARGANDO ESTUDIO 3D…</div>}><DesignScene design={active} mockupUrl={null} productType={active?.product_type ?? type} /></Suspense><div className="scene-caption">VISTA EN VIVO · LOS CAMBIOS REMOTOS APARECEN AQUÍ</div></div><div className="status-line"><span>●</span> {notice}</div></section>
    <aside className="control-panel">
      <section><p className="panel-label">MODO DE INTELIGENCIA</p><div className="mode-grid">{modes.map(item => <button key={item.id} className={mode === item.id ? 'mode active' : 'mode'} onClick={() => void selectMode(item.id)}><b>{item.label}</b><small>{item.note}</small></button>)}</div></section>
      <section><p className="panel-label">BRIEF DEL DISEÑO</p><input value={name} onChange={event => setName(event.target.value)} aria-label="Nombre del diseño" /><div className="segmented"><button className={type === 'laptop_bag' ? 'selected' : ''} onClick={() => setType('laptop_bag')}>BOLSO</button><button className={type === 'upper_garment' ? 'selected' : ''} onClick={() => setType('upper_garment')}>PRENDA</button></div><textarea value={prompt} onChange={event => setPrompt(event.target.value)} aria-label="Descripción del diseño" /><button className="brief-action" onClick={() => void create()}>CREAR DISEÑO SINCRONIZADO</button></section>
      <section className="design-chat"><p className="panel-label">ASISTENTE DE ESPACIO</p><p>Escribí cambios. Cada orden crea una revisión y consulta tus paquetes de conocimiento aprobados.</p><div className="chat-log">{chatLog.slice(-4).map((entry, index) => <p key={`${entry.role}-${index}`} className={entry.role}>{entry.text}</p>)}</div><div className="chat-compose"><textarea value={chatInput} onChange={event => setChatInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendChat() } }} placeholder="Describí el cambio…" aria-label="Mensaje para el asistente remoto" /><button onClick={() => void sendChat()}>APLICAR</button></div></section>
      <section><p className="panel-label">CAMBIOS RÁPIDOS</p><div className="chips"><button onClick={() => void quickChange('bolsillo frontal')}>+ BOLSILLO</button><button onClick={() => void quickChange('cierre negro')}>+ CIERRE</button><button onClick={() => void quickChange('correa')}>+ CORREA</button></div><p className="missing">{missingText}</p></section>
      <section className="exports"><p className="panel-label">PRODUCCIÓN</p><button onClick={() => setNotice('La exportación 1:1 se mantiene en la estación local por seguridad. El diseño sincronizado puede abrirse allí mediante el MCP local.')}>VER LÍMITE DE EXPORTACIÓN REMOTA</button></section>
      <section className="knowledge"><p className="panel-label">CONOCIMIENTO APROBADO</p><div><input value={knowledgeQuery} onChange={event => setKnowledgeQuery(event.target.value)} placeholder="Buscar una nota aprobada" /><button onClick={() => void searchKnowledge(knowledgeQuery)}>BUSCAR</button></div><input value={packetTitle} onChange={event => setPacketTitle(event.target.value)} placeholder="Título de nota aprobada" /><textarea value={packetBody} onChange={event => setPacketBody(event.target.value)} placeholder="Pegá sólo una síntesis o dato que autorizás para cloud" /><button className="brief-action" onClick={() => void addPacket()}>GUARDAR NOTA APROBADA</button>{packets.map(packet => <article key={packet.id}><b>{packet.title}</b><small>{packet.source_label}{packet.source_page ? ` · pág. ${packet.source_page}` : ''}</small><p>{packet.body}</p></article>)}</section>
    </aside>
  </main>
}
