import React, { useState, useEffect } from 'react'
import { useApp } from '../App.jsx'
import { db } from '../firebase.js'
import { doc, addDoc, updateDoc, collection, serverTimestamp } from 'firebase/firestore'
import { logWork } from '../utils/worklog.js'
import { sendTaskAssignedEmail } from '../utils/emailNotify.js'
import Icon from './Icons.jsx'

export default function TaskForm() {
  const { user, users, agents, clients, userProfile, editingTask, closeTaskForm, showToast, sendNotification, isAdmin, isSuperAdmin } = useApp()
  const CLIENTES = clients || []
  const isEdit = !!editingTask

  const [form, setForm] = useState({
    tarea: '',
    descripcion: '',
    asignado: user.uid,
    cliente: '',
    projectId: '',
    prioridad: 'media',
    estado: 'pendiente',
    fechaRequerimiento: '',
    fechaVencimiento: '',
    tiempoEstimadoMin: 0,
    links: '',
    linkTerminada: '',
    feedback: '',
    rating: 0,
  })
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Populate form for editing
  useEffect(() => {
    if (editingTask) {
      setForm({
        tarea: editingTask.tarea || '',
        descripcion: editingTask.descripcion || '',
        asignado: editingTask.asignado || user.uid,
        cliente: editingTask.cliente || '',
        projectId: editingTask.projectId || '',
        prioridad: editingTask.prioridad || 'media',
        estado: editingTask.estado || 'pendiente',
        fechaRequerimiento: editingTask.fechaRequerimiento
          ? toDateInputValue(editingTask.fechaRequerimiento)
          : '',
        fechaVencimiento: editingTask.fechaVencimiento
          ? toDateInputValue(editingTask.fechaVencimiento)
          : '',
        tiempoEstimadoMin: editingTask.tiempoEstimadoMin || 0,
        links: editingTask.links || '',
        linkTerminada: editingTask.linkTerminada || '',
        feedback: editingTask.feedback || '',
        rating: editingTask.rating || 0,
      })
    }
  }, [editingTask])

  function toDateInputValue(ts) {
    if (!ts) return ''
    const d = ts.toDate ? ts.toDate() : new Date(ts)
    return d.toISOString().split('T')[0]
  }

  const setField = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    setDirty(true)
  }

  const canChangeStatus = isAdmin || (editingTask?.asignado === user.uid)

  const computeTimerUpdates = (oldTask, newStatus) => {
    const updates = {}
    if (!oldTask) return updates

    // Starting timer
    if (newStatus === 'en_progreso' && oldTask.estado !== 'en_progreso') {
      updates.timerStartedAt = serverTimestamp()
      updates.timerPaused = false
      if (!oldTask.fechaInicio) updates.fechaInicio = serverTimestamp()
    }
    // Stopping timer
    if (oldTask.estado === 'en_progreso' && newStatus !== 'en_progreso') {
      if (oldTask.timerStartedAt && !oldTask.timerPaused) {
        const elapsed = Math.floor(
          (Date.now() - (oldTask.timerStartedAt.toMillis?.() || oldTask.timerStartedAt.seconds * 1000)) / 1000
        )
        updates.totalTimeSeconds = (oldTask.totalTimeSeconds || 0) + elapsed
        logWork(oldTask.asignado, elapsed)
      }
      updates.timerStartedAt = null
      updates.timerPaused = false
    }
    // Completing: marca de quién y cuándo
    if (newStatus === 'completada') {
      updates.fechaEntrega = serverTimestamp()
      updates.completedBy = userProfile?.name || user.email
      updates.completedByEmail = user.email
    }
    // Volver a pendiente: el tiempo trabajado se CONSERVA para seguir
    // acumulando al retomarla; solo se limpian las marcas de entrega
    if (newStatus === 'pendiente') {
      updates.fechaEntrega = null
      updates.timerStartedAt = null
      updates.timerPaused = false
      updates.completedBy = null
      updates.completedByEmail = null
    }
    return updates
  }

  const handleSave = async () => {
    if (!form.tarea.trim()) { showToast('Ingresa el nombre de la tarea', 'error'); return }
    if (form.projectId && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(form.projectId)) { showToast('El ID del proyecto debe usar minúsculas, números, guiones o guiones bajos.', 'error'); return }
    const qualityReady = editingTask?.qualityStatus === 'passed' || (editingTask?.qualityReport === true && editingTask?.qualityStatus === 'report')
    if (form.projectId && form.estado === 'completada' && (!isEdit || !qualityReady)) { showToast('El proyecto necesita una entrega revisada por QA antes de completarse.', 'error'); return }
    const changedInputs = isEdit && ['tarea', 'descripcion', 'feedback', 'links', 'asignado', 'projectId'].some(k => (form[k] || '') !== (editingTask[k] || ''))
    if (isEdit && editingTask.qualityStatus && form.estado === 'completada' && (!qualityReady || changedInputs)) {
      showToast('La entrega necesita una revisión QA aprobada antes de completarse. Envía los cambios a Correcciones.', 'error'); return
    }
    setSaving(true)
    try {
      if (isEdit) {
        const timerUpdates = computeTimerUpdates(editingTask, form.estado)
        const updates = {
          ...form,
          fechaRequerimiento: form.fechaRequerimiento
            ? new Date(form.fechaRequerimiento + 'T12:00:00')
            : null,
          fechaVencimiento: form.fechaVencimiento
            ? new Date(form.fechaVencimiento + 'T23:59:00')
            : null,
          lastEditedBy: user.email,
          lastEditedAt: serverTimestamp(),
          ...timerUpdates,
          ...(editingTask.qualityStatus && changedInputs ? { qualityStatus: 'pending' } : {}),
        }
        await updateDoc(doc(db, 'tasks', editingTask.id), updates)
        showToast('Tarea actualizada')

        // Notify on timer start
        if (form.estado === 'en_progreso' && editingTask.estado !== 'en_progreso') {
          const assignedUser = users.find(u => u.uid === form.asignado)
          if (form.asignado === user.uid) {
            showToast(`⏱️ ¡Timer iniciado para "${form.tarea}"!`, 'info')
            sendNotification('⏱️ ¡El tiempo está corriendo!', `Tarea: "${form.tarea}"`)
          }
        }

        // Notify if newly assigned to someone else
        if (form.asignado !== editingTask.asignado) {
          const assignedUser = users.find(u => u.uid === form.asignado)
          if (assignedUser && form.asignado !== user.uid) {
            sendNotification('📋 Nueva tarea asignada', `"${form.tarea}" fue asignada a ${assignedUser.name}`)
            // Email al asignado (fire-and-forget)
            if (assignedUser.email) {
              sendTaskAssignedEmail({
                toEmail: assignedUser.email,
                toName: assignedUser.name,
                taskName: form.tarea,
                cliente: form.cliente,
                prioridad: form.prioridad,
                vencimiento: form.fechaVencimiento || '',
                assignedBy: userProfile?.name || user.email,
              })
            }
          }
        }
      } else {
        const newTask = {
          ...form,
          fechaRequerimiento: form.fechaRequerimiento
            ? new Date(form.fechaRequerimiento + 'T12:00:00')
            : null,
          fechaVencimiento: form.fechaVencimiento
            ? new Date(form.fechaVencimiento + 'T23:59:00')
            : null,
          fechaInicio: null,
          fechaEntrega: null,
          timerStartedAt: null,
          totalTimeSeconds: 0,
          createdAt: serverTimestamp(),
          createdBy: user.email,
          lastEditedBy: user.email,
          lastEditedAt: serverTimestamp(),
        }
        if (form.estado === 'en_progreso') {
          newTask.timerStartedAt = serverTimestamp()
          newTask.fechaInicio = serverTimestamp()
        }
        await addDoc(collection(db, 'tasks'), newTask)
        showToast('Tarea creada ✓')

        // Email si la tarea es para otra persona
        if (form.asignado !== user.uid) {
          const assignedUser = users.find(u => u.uid === form.asignado)
          if (assignedUser?.email) {
            sendTaskAssignedEmail({
              toEmail: assignedUser.email,
              toName: assignedUser.name,
              taskName: form.tarea,
              cliente: form.cliente,
              prioridad: form.prioridad,
              vencimiento: form.fechaVencimiento || '',
              assignedBy: userProfile?.name || user.email,
            })
          }
        }
      }
      closeTaskForm()
    } catch (e) {
      console.error(e)
      const detail = e?.code === 'permission-denied' ? 'sin permisos' : (e?.code || e?.message || '')
      showToast(`Error al guardar${detail ? ` (${detail})` : ''}`, 'error')
    }
    setSaving(false)
  }

  // Empleados: pueden ver tareas de otros pero no editarlas
  const readOnly = isEdit && !isAdmin && editingTask.asignado !== user.uid

  // Cerrar solo con Cancelar (o la X); si hay cambios sin guardar, confirmar
  const handleCancel = () => {
    if (dirty && !readOnly && !confirm('Tienes cambios sin guardar. ¿Descartarlos y cerrar?')) return
    closeTaskForm()
  }

  // Tiempo trabajado acumulado (incluye la sesión en curso si el timer corre)
  const liveSeconds = (() => {
    if (!isEdit) return 0
    const base = editingTask.totalTimeSeconds || 0
    if (editingTask.estado === 'en_progreso' && editingTask.timerStartedAt && !editingTask.timerPaused) {
      const startMs = editingTask.timerStartedAt.toMillis?.() || editingTask.timerStartedAt.seconds * 1000
      return base + Math.floor((Date.now() - startMs) / 1000)
    }
    return base
  })()
  const fmtWorked = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  return (
    // Clic afuera NO cierra el formulario: evita perder lo que se está escribiendo
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Editar tarea' : 'Nueva tarea'}</h2>
          <button className="icon-btn" onClick={handleCancel} title="Cerrar">✕</button>
        </div>

        {/* Tiempo trabajado acumulado en esta tarea */}
        {isEdit && liveSeconds > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            padding: '10px 14px', borderRadius: 10, marginBottom: 16,
            background: 'var(--purple-light)', border: '1px solid var(--purple-mid)'
          }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Tiempo trabajado acumulado</span>
            <span style={{ fontFamily: 'Space Mono', fontWeight: 700, color: 'var(--purple)' }}>
              {fmtWorked(liveSeconds)}
              {editingTask.tiempoEstimadoMin > 0 && (
                <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> / {fmtWorked(editingTask.tiempoEstimadoMin * 60)} estimado</span>
              )}
            </span>
          </div>
        )}

        {isEdit && <AgentResult task={editingTask} showToast={showToast} />}

        {readOnly ? (
          <ReadOnlyTask task={editingTask} users={users} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Tarea */}
            <div className="form-group">
              <label className="form-label">Nombre de la tarea *</label>
              <input
                className="form-input"
                value={form.tarea}
                onChange={e => setField('tarea', e.target.value)}
                placeholder="¿Qué hay que hacer?"
                autoFocus
              />
            </div>

            {/* Link de la tarea terminada */}
            <div className="form-group">
              <label className="form-label" htmlFor="task-project">Proyecto del repositorio (opcional)</label>
              <input id="task-project" className="form-input" value={form.projectId}
                onChange={e => setField('projectId', e.target.value.trim())}
                placeholder="ID registrado, por ejemplo: demo" autoCapitalize="none" spellCheck={false}
                aria-describedby="task-project-help" maxLength={64} />
              <p id="task-project-help" style={{ fontSize: 13 }}>Indica el ID registrado para que el agente trabaje en ese proyecto. Vacío usa la carpeta habitual de la tarea.</p>
            </div>

            <div className="form-group">
              <label className="form-label">Link de la tarea terminada</label>
              <input
                className="form-input"
                value={form.linkTerminada}
                onChange={e => setField('linkTerminada', e.target.value)}
                placeholder="https://... (entregable final)"
              />
            </div>

            {/* Link de recursos */}
            <div className="form-group">
              <label className="form-label">Link de recursos</label>
              <input
                className="form-input"
                value={form.links}
                onChange={e => setField('links', e.target.value)}
                placeholder="https://... (materiales, referencias)"
              />
            </div>

            {/* Descripción */}
            <div className="form-group">
              <label className="form-label">Descripción</label>
              <textarea
                className="form-textarea"
                value={form.descripcion}
                onChange={e => setField('descripcion', e.target.value)}
                placeholder="Detalles, contexto, instrucciones..."
                rows={3}
              />
            </div>

            <div className="form-row">
              {/* Asignado */}
              <div className="form-group">
                <label className="form-label">Asignado a</label>
                <select
                  className="form-select"
                  value={form.asignado}
                  onChange={e => setField('asignado', e.target.value)}
                  disabled={!isAdmin}
                >
                  <optgroup label="Equipo">
                    {users.filter(u => u.role !== 'pending').map(u => (
                      <option key={u.uid} value={u.uid}>{u.name}</option>
                    ))}
                  </optgroup>
                  {agents.some(a => a.active || a.id === form.asignado) && (
                    <optgroup label="Agentes de IA">
                      {agents.filter(a => a.active || a.id === form.asignado).map(a => (
                        <option key={a.id} value={a.id}>{a.name} · {a.role}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              {/* Cliente */}
              <div className="form-group">
                <label className="form-label">Cliente</label>
                <select
                  className="form-select"
                  value={form.cliente}
                  onChange={e => setField('cliente', e.target.value)}
                >
                  <option value="">— Selecciona —</option>
                  {CLIENTES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="form-row">
              {/* Prioridad */}
              <div className="form-group">
                <label className="form-label">Prioridad</label>
                <select
                  className="form-select"
                  value={form.prioridad}
                  onChange={e => setField('prioridad', e.target.value)}
                >
                  <option value="urgente">🔴 Urgente</option>
                  <option value="alta">🟠 Alta</option>
                  <option value="media">🔵 Media</option>
                  <option value="baja">🟢 Baja</option>
                </select>
              </div>

              {/* Estado */}
              <div className="form-group">
                <label className="form-label">Estado</label>
                <select
                  className="form-select"
                  value={form.estado}
                  onChange={e => setField('estado', e.target.value)}
                  disabled={!canChangeStatus}
                >
                  <option value="pendiente">⏳ Pendiente</option>
                  <option value="en_progreso">⚡ En Progreso</option>
                  <option value="en_espera">🕓 Espera Aprobación</option>
                  <option value="en_revision">🔧 Correcciones</option>
                  <option value="completada">✅ Completada</option>
                </select>
              </div>
            </div>

            {/* Fechas */}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Fecha de requerimiento</label>
                <input
                  className="form-input"
                  type="date"
                  value={form.fechaRequerimiento}
                  onChange={e => setField('fechaRequerimiento', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Fecha de vencimiento</label>
                <input
                  className="form-input"
                  type="date"
                  value={form.fechaVencimiento}
                  onChange={e => setField('fechaVencimiento', e.target.value)}
                />
              </div>
            </div>

            {/* Tiempo estimado de ejecución */}
            <div className="form-group">
              <label className="form-label">Tiempo estimado de ejecución</label>
              <select
                className="form-select"
                value={form.tiempoEstimadoMin || 0}
                onChange={e => setField('tiempoEstimadoMin', Number(e.target.value))}
              >
                <option value={0}>Sin límite definido</option>
                {[15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480].map(m => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} minutos` : `${m / 60} hora${m > 60 ? 's' : ''}${m % 60 ? ` ${m % 60} min` : ''}`}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                Si el empleado supera este tiempo, recibirá un aviso de que está tardando más de lo previsto.
              </span>
            </div>

            {/* Feedback */}
            <div className="form-group">
              <label className="form-label">Feedback / Notas del cliente</label>
              <textarea
                className="form-textarea"
                value={form.feedback}
                onChange={e => setField('feedback', e.target.value)}
                placeholder="Comentarios, observaciones..."
                rows={2}
              />
            </div>

            {/* Calificación (solo tareas completadas; edita solo el Super Admin) */}
            {isEdit && (editingTask.estado === 'completada' || form.estado === 'completada') && (
              <div className="form-group">
                <label className="form-label">Calificación del trabajo</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      type="button"
                      disabled={!isSuperAdmin}
                      onClick={() => isSuperAdmin && setField('rating', form.rating === n ? 0 : n)}
                      style={{
                        background: 'transparent', border: 'none', padding: 2,
                        cursor: isSuperAdmin ? 'pointer' : 'default',
                        color: (form.rating || 0) >= n ? 'var(--warning)' : 'var(--text-3)',
                      }}
                      title={isSuperAdmin ? `Calificar con ${n} estrella${n > 1 ? 's' : ''}` : 'Solo el Super Admin califica'}
                    >
                      <Icon name="star" size={26} filled={(form.rating || 0) >= n} />
                    </button>
                  ))}
                  <span style={{ fontSize: 12.5, color: 'var(--text-3)', marginLeft: 8 }}>
                    {form.rating
                      ? ['', 'Necesita mejorar', 'Regular', 'Bien', 'Muy bien', 'Excelente'][form.rating]
                      : isSuperAdmin ? 'Sin calificar' : 'Aún sin calificación'}
                  </span>
                </div>
                {!isSuperAdmin && (
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    La calificación la asigna la dirección al revisar tu trabajo.
                  </span>
                )}
              </div>
            )}

            {/* Edit info */}
            {isEdit && (
              <div style={{ fontSize: 12, color: 'var(--text-3)', paddingTop: 4, borderTop: '1px solid var(--border)', lineHeight: 1.7 }}>
                {editingTask.createdAt?.toDate && (
                  <div>
                    Creada: {editingTask.createdAt.toDate().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {' a las '}
                    {editingTask.createdAt.toDate().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                    {editingTask.createdBy && <> · por {editingTask.createdBy}</>}
                  </div>
                )}
                {editingTask.lastEditedBy && <div>Última edición: {editingTask.lastEditedBy}</div>}
              </div>
            )}
          </div>
        )}

        {!readOnly && (
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={handleCancel}>Cancelar</button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear tarea'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Trabajo entregado por un agente de IA (lo escribe el motor de agentes desde el PC del dueño)
function AgentResult({ task, showToast }) {
  const status = task.agentStatus
  if (!status && !task.agentOutput) return null
  const info = {
    running: { text: 'El agente está trabajando en esta tarea…', color: 'var(--purple)' },
    reviewing: { text: 'Un revisor independiente está comprobando la entrega…', color: 'var(--purple)' },
    queued: { text: 'En cola: el agente la tomará en cuanto termine lo que está haciendo', color: 'var(--text-3)' },
    needs_info: { text: 'El agente necesita información para continuar', color: 'var(--warning)' },
    error: { text: 'El agente tuvo un problema con esta tarea', color: 'var(--danger)' },
    done: task.qualityReport && task.qualityStatus === 'report'
      ? { text: 'Informe de QA disponible; no aprueba el producto', color: 'var(--info)' }
      : task.qualityStatus && task.qualityStatus !== 'passed'
      ? { text: 'Entrega pendiente de resolver la revisión de calidad', color: 'var(--warning)' }
      : { text: 'Entrega lista para tu aprobación', color: 'var(--success)' },
  }[status] || { text: 'Resultado del agente', color: 'var(--text-2)' }
  const body = status === 'needs_info' ? task.agentQuestion : status === 'error' ? task.agentError : task.agentOutput
  const copy = async () => {
    try { await navigator.clipboard.writeText(body || ''); showToast('Copiado') } catch { showToast('No se pudo copiar', 'error') }
  }
  return (
    <div className="agent-result">
      <div className="agent-result-head">
        <span style={{ color: info.color, fontWeight: 700 }}>{info.text}</span>
        {body && <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>Copiar</button>}
      </div>
      {body && <pre className="agent-result-body">{body}</pre>}
      {task.projectId && <p className="agent-result-hint">
        Proyecto: {task.projectId}{task.projectBranch ? ` · Rama: ${task.projectBranch}` : ''}
        {task.projectSnapshot ? ` · Archivos revisados: ${task.projectSnapshot.slice(0, 12)}` : ''}
      </p>}
      {task.qualityStatus && (
        <div className="agent-result-hint">
          <strong>Calidad: {{ pending: 'pendiente', passed: 'aprobada por QA', failed: 'requiere correcciones', blocked: 'revisión bloqueada', report: 'informe emitido; no aprueba el producto' }[task.qualityStatus] || task.qualityStatus}</strong>
          {(task.qualityReviews || []).map((review, index) => (
            <details key={index}>
              <summary>{review.reviewerName || review.role || 'Revisión'}: {review.summary}</summary>
              <pre className="agent-result-body">{[...(review.evidence || []), ...(review.issues || []).map(s => 'Incidencia: ' + s)].join('\n')}</pre>
            </details>
          ))}
          {task.qualityRevision && <p>Revisión: {task.qualityRevision.slice(0, 12)}</p>}
        </div>
      )}
      {status === 'done' && (
        <p className="agent-result-hint">
          {task.qualityReport && task.qualityStatus === 'report'
            ? 'Este informe sirve como insumo para las siguientes tareas. Completarlo no aprueba el producto; la implementación necesitará una revisión independiente.'
            : task.qualityStatus && task.qualityStatus !== 'passed'
            ? 'Revisa las incidencias o los datos faltantes, escribe indicaciones en Feedback y envía la tarea a Correcciones. Necesita QA aprobado antes de completarse.'
            : 'Si está bien, muévela a Completada. Si necesita cambios, escribe tus comentarios en Feedback y muévela a Correcciones: el agente la rehace.'}
        </p>
      )}
      {status === 'needs_info' && (
        <p className="agent-result-hint">
          Agrega lo que pide en la descripción o en Link de recursos y muévela a Correcciones para que la retome.
        </p>
      )}
    </div>
  )
}

function ReadOnlyTask({ task, users }) {
  const u = users.find(u => u.uid === task.asignado)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ fontSize: 17, fontWeight: 700 }}>{task.tarea}</h3>
      {task.descripcion && <p style={{ fontSize: 14 }}>{task.descripcion}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span className={`badge badge-${task.estado}`}>{task.estado.replace('_', ' ')}</span>
        <span className={`badge badge-${task.prioridad}`}>{task.prioridad}</span>
        {task.cliente && <span className="badge" style={{ background: 'var(--card-2)', color: 'var(--text-2)' }}>{task.cliente}</span>}
      </div>
      {u && (
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
          Asignada a: <strong>{u.name}</strong>
        </div>
      )}
      {task.feedback && (
        <div>
          <p className="form-label">Feedback</p>
          <p style={{ fontSize: 13 }}>{task.feedback}</p>
        </div>
      )}
    </div>
  )
}
