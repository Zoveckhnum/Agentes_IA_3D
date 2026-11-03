import React, { useState } from 'react'
import { useApp } from '../App.jsx'
import { db } from '../firebase.js'
import { doc, setDoc } from '../data/firestore.js'

export default function ClientsAdmin() {
  const { clients, tasks, users, showToast } = useApp()

  const tsToMs = (ts) => ts ? (ts.toMillis ? ts.toMillis() : ts.seconds * 1000) : 0

  // Informe por cliente: tareas, horas, equipo asignado, antigüedad y estado
  const clientStats = clients.map(c => {
    const clientTasks = tasks.filter(t => t.cliente === c)
    const done = clientTasks.filter(t => t.estado === 'completada')
    const seconds = clientTasks.reduce((a, t) => a + (t.totalTimeSeconds || 0), 0)

    // Empleados que trabajan (o trabajaron) en este cliente
    const workerUids = [...new Set(clientTasks.map(t => t.asignado).filter(Boolean))]
    const workers = workerUids.map(uid => users.find(u => u.uid === uid)).filter(Boolean)

    // Antigüedad: primera tarea registrada del cliente
    const firstMs = Math.min(...clientTasks.map(t => tsToMs(t.createdAt)).filter(Boolean), Infinity)
    const since = firstMs !== Infinity ? new Date(firstMs) : null

    // Estado: activo si tiene tareas abiertas o actividad en los últimos 30 días
    const hasOpen = clientTasks.some(t => t.estado !== 'completada')
    const lastMs = Math.max(...clientTasks.map(t => tsToMs(t.lastEditedAt) || tsToMs(t.createdAt)), 0)
    const active = hasOpen || (Date.now() - lastMs < 30 * 24 * 3600 * 1000)

    return { name: c, total: clientTasks.length, done: done.length, hours: seconds / 3600, workers, since, active }
  }).filter(s => s.total > 0).sort((a, b) => b.hours - a.hours)
  const maxHours = Math.max(...clientStats.map(s => s.hours), 0.1)

  const fmtSince = (d) => d ? d.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }) : 'Sin datos'
  const [newClient, setNewClient] = useState('')
  const [editIdx, setEditIdx] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [saving, setSaving] = useState(false)

  const saveClients = async (list) => {
    setSaving(true)
    await setDoc(doc(db, 'config', 'clients'), { list })
    setSaving(false)
  }

  const handleAdd = async () => {
    const name = newClient.trim()
    if (!name) return
    if (clients.includes(name)) { showToast('Ese cliente ya existe', 'error'); return }
    await saveClients([...clients, name])
    setNewClient('')
    showToast(`Cliente "${name}" agregado`)
  }

  const handleDelete = async (client) => {
    if (!confirm(`¿Eliminar "${client}" de la lista?`)) return
    await saveClients(clients.filter(c => c !== client))
    showToast(`"${client}" eliminado`, 'info')
  }

  const handleEdit = async (idx) => {
    const name = editVal.trim()
    if (!name) return
    if (clients.includes(name) && clients[idx] !== name) { showToast('Ese nombre ya existe', 'error'); return }
    const updated = [...clients]
    updated[idx] = name
    await saveClients(updated)
    setEditIdx(null)
    showToast('Cliente actualizado')
  }

  const handleMoveUp = async (idx) => {
    if (idx === 0) return
    const updated = [...clients]
    ;[updated[idx - 1], updated[idx]] = [updated[idx], updated[idx - 1]]
    await saveClients(updated)
  }

  const handleMoveDown = async (idx) => {
    if (idx === clients.length - 1) return
    const updated = [...clients]
    ;[updated[idx], updated[idx + 1]] = [updated[idx + 1], updated[idx]]
    await saveClients(updated)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Administración</span>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">Lista de clientes a la izquierda · métricas de cada cliente a la derecha</p>
        </div>
      </div>

      <div className="clients-layout">

      {/* ===== Columna derecha: informe por cliente ===== */}
      <div className="card clients-report">
        <p className="section-title">Tiempo y tareas por cliente</p>
        {clientStats.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Aún no hay tareas registradas con cliente</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {clientStats.map(s => (
              <div key={s.name} style={{ padding: '12px 14px', background: 'var(--bg-2)', borderRadius: 10 }}>
                {/* Fila 1: nombre + estado + antigüedad + métricas */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{s.name}</span>
                  <span className="badge" style={{
                    fontSize: 10,
                    background: s.active ? 'rgba(34,197,94,0.12)' : 'rgba(144,144,184,0.15)',
                    color: s.active ? 'var(--success)' : 'var(--text-3)',
                  }}>
                    {s.active ? 'Activo' : 'Inactivo'}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    Cliente desde {fmtSince(s.since)}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, fontFamily: 'Space Mono', color: 'var(--purple)', fontWeight: 700 }}>
                    {s.hours.toFixed(1)}h
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {s.done}/{s.total} completadas
                  </span>
                </div>
                {/* Fila 2: barra de horas */}
                <div className="bar-track" style={{ marginBottom: 8 }}>
                  <div className="bar-fill" style={{ width: `${Math.round((s.hours / maxHours) * 100)}%` }} />
                </div>
                {/* Fila 3: equipo que trabaja en el cliente */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' }}>
                    Equipo:
                  </span>
                  {s.workers.length === 0 && <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Sin asignaciones</span>}
                  {s.workers.map(w => (
                    <span key={w.uid} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      background: 'var(--card)', border: '1px solid var(--border)',
                      borderRadius: 99, padding: '2px 9px 2px 3px', fontSize: 11.5
                    }}>
                      {w.photo
                        ? <img src={w.photo} alt="" style={{ width: 18, height: 18, borderRadius: '50%' }} />
                        : <span style={{
                            width: 18, height: 18, borderRadius: '50%', background: w.color || '#4700E0',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 9, fontWeight: 700, color: '#fff'
                          }}>{(w.name || '?')[0].toUpperCase()}</span>
                      }
                      {w.name?.split(' ')[0]}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Columna izquierda: gestión de la lista ===== */}
      <div className="clients-left">

      {/* Add new */}
      <div className="card" style={{ marginBottom: 18 }}>
        <p className="section-title">Agregar cliente</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            className="form-input"
            value={newClient}
            onChange={e => setNewClient(e.target.value)}
            placeholder="Nombre del cliente..."
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button className="btn btn-primary" onClick={handleAdd} disabled={saving || !newClient.trim()}>
            + Agregar
          </button>
        </div>
      </div>

      {/* Client list */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--card-2)' }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)' }}>
            {clients.length} clientes
          </span>
        </div>
        {clients.map((client, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
            borderBottom: '1px solid var(--border)', transition: 'background 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--card-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {/* Order arrows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <button className="btn btn-ghost" style={{ padding: '1px 4px', fontSize: 10, lineHeight: 1 }}
                onClick={() => handleMoveUp(idx)} disabled={idx === 0 || saving}>▲</button>
              <button className="btn btn-ghost" style={{ padding: '1px 4px', fontSize: 10, lineHeight: 1 }}
                onClick={() => handleMoveDown(idx)} disabled={idx === clients.length - 1 || saving}>▼</button>
            </div>

            {editIdx === idx ? (
              <input
                className="form-input"
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleEdit(idx); if (e.key === 'Escape') setEditIdx(null) }}
                autoFocus
                style={{ flex: 1, padding: '5px 8px' }}
              />
            ) : (
              <span style={{ flex: 1, fontSize: 14 }}>{client}</span>
            )}

            <div style={{ display: 'flex', gap: 4 }}>
              {editIdx === idx ? (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => handleEdit(idx)} disabled={saving}>✓</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditIdx(null)}>✕</button>
                </>
              ) : (
                <>
                  <button className="btn btn-ghost btn-sm btn-icon" title="Editar"
                    onClick={() => { setEditIdx(idx); setEditVal(client) }}>✎</button>
                  <button className="btn btn-ghost btn-sm btn-icon" style={{ color: 'var(--danger)' }}
                    title="Eliminar" onClick={() => handleDelete(client)} disabled={saving}>🗑</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      </div>{/* /clients-left */}
      </div>{/* /clients-layout */}
    </div>
  )
}
