import React, { useState, useMemo } from 'react'
import { useApp } from '../App.jsx'
import { db } from '../firebase.js'
import { doc, updateDoc, deleteDoc } from '../data/firestore.js'
import Icon from '../components/Icons.jsx'
import AgentModal, { AgentAvatar } from '../components/AgentModal.jsx'

// Super Admin: administra todos los agentes de IA (foto, nombre, descripción, misión, personaje 3D)
export default function AgentsAdmin() {
  const { agents, tasks, user, showToast } = useApp()
  const [editing, setEditing] = useState(null) // null | 'new' | agente
  const [filter, setFilter] = useState('todos')

  const stats = useMemo(() => {
    const m = {}
    for (const t of tasks) {
      if (!t.asignado) continue
      const s = (m[t.asignado] ||= { abiertas: 0, espera: 0, hechas: 0 })
      if (t.estado === 'completada') s.hechas++
      else if (t.estado === 'en_espera') s.espera++
      else s.abiertas++
    }
    return m
  }, [tasks])

  const list = [...agents]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter(a => filter === 'todos' || (filter === 'activos' ? a.active !== false : a.active === false))

  const toggle = async (a) => {
    try {
      await updateDoc(doc(db, 'agents', a.id), { active: a.active === false })
      showToast(a.active === false ? `${a.name} está activo` : `${a.name} pasó a reserva`)
    } catch { showToast('No se pudo cambiar el estado', 'error') }
  }

  const remove = async (a) => {
    const open = stats[a.id]?.abiertas || 0
    if (!confirm(`¿Eliminar a ${a.name}?${open ? ` Tiene ${open} tareas abiertas que quedarán sin asignar.` : ''} Esta acción no se puede deshacer.`)) return
    try {
      await deleteDoc(doc(db, 'agents', a.id))
      showToast(`${a.name} fue eliminado`)
    } catch { showToast('No se pudo eliminar', 'error') }
  }

  const activeCount = agents.filter(a => a.active !== false).length

  return (
    <div>
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Super Admin</span>
          <h1 className="page-title">Agentes de IA</h1>
          <p className="page-subtitle">{agents.length} agentes · {activeCount} activos · edita su foto, nombre, descripción y misión</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          <Icon name="plus" size={13} /> Nuevo agente
        </button>
      </div>

      <div className="agents-filter">
        {[['todos', 'Todos'], ['activos', 'Activos'], ['reserva', 'En reserva']].map(([id, label]) => (
          <button key={id} className={`btn btn-sm ${filter === id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
          No hay agentes en esta vista.
        </div>
      ) : (
        <div className="agents-grid">
          {list.map(a => {
            const s = stats[a.id] || { abiertas: 0, espera: 0, hechas: 0 }
            const on = a.active !== false
            return (
              <div key={a.id} className={`agent-card ${on ? '' : 'is-off'}`}>
                <div className="agent-card-head">
                  <AgentAvatar agent={a} size={56} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="agent-card-name">{a.name}</div>
                    <div className="agent-card-role">{a.role}</div>
                  </div>
                  <span className={`agent-pill ${on ? 'on' : ''}`}>{on ? 'Activo' : 'En reserva'}</span>
                </div>
                <p className="agent-card-bio">{a.bio || <span style={{ color: 'var(--text-3)' }}>Sin descripción corta</span>}</p>
                <div className="agent-card-stats">
                  <span><b>{s.abiertas}</b> abiertas</span>
                  <span><b>{s.espera}</b> por aprobar</span>
                  <span><b>{s.hechas}</b> completadas</span>
                </div>
                <div className="agent-card-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(a)}>
                    <Icon name="edit" size={12} /> Editar
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => toggle(a)}>
                    <Icon name={on ? 'pause' : 'play'} size={12} /> {on ? 'Pasar a reserva' : 'Activar'}
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)', marginLeft: 'auto' }} onClick={() => remove(a)} title="Eliminar agente">
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <AgentModal
          agent={editing === 'new' ? null : editing}
          nextOrder={agents.length}
          onClose={() => setEditing(null)}
          showToast={showToast}
          userEmail={user.email}
        />
      )}
    </div>
  )
}
