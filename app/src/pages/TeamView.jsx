import React, { useState, useEffect } from 'react'
import { useApp } from '../App.jsx'
import { db } from '../firebase.js'
import { collection, query, where, onSnapshot } from '../data/firestore.js'
import { todayKey } from '../utils/worklog.js'

function fmtSeconds(s) {
  if (!s || s <= 0) return null
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':')
}

// Live timer that ticks every second
function LiveTimer({ timerStartedAt, totalTimeSeconds }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!timerStartedAt) { setElapsed(totalTimeSeconds || 0); return }
    const base = totalTimeSeconds || 0
    const startMs = timerStartedAt.toMillis ? timerStartedAt.toMillis() : timerStartedAt.seconds * 1000
    const tick = () => setElapsed(base + Math.floor((Date.now() - startMs) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timerStartedAt, totalTimeSeconds])

  const fmt = fmtSeconds(elapsed)
  if (!fmt) return null
  return (
    <span className="timer-display" style={{ fontSize: 12 }}>
      {timerStartedAt && <span className="timer-dot" />}
      {fmt}
    </span>
  )
}

export default function TeamView() {
  const { users, agents, tasks, isAdmin, isSuperAdmin, openEditTask, user } = useApp()

  // Los agentes de IA se muestran como miembros más del equipo
  const agentMembers = agents
    .slice()
    .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0) || (a.order ?? 0) - (b.order ?? 0))
    .map(a => ({
      uid: a.id, name: a.name, email: '', photo: a.photo || '', color: a.look?.torso,
      position: `Agente de IA · ${a.role}`, role: a.active ? 'agente' : 'agente en reserva',
      lastSeen: a.active ? { toMillis: () => Date.now() } : null,
    }))

  // Horas activas de hoy por usuario — solo el super admin las consulta
  const [todayLogs, setTodayLogs] = useState({})
  useEffect(() => {
    if (!isSuperAdmin) return
    const q = query(collection(db, 'worklog'), where('date', '==', todayKey()))
    const unsub = onSnapshot(q, snap => {
      const logs = {}
      snap.docs.forEach(d => { const v = d.data(); logs[v.uid] = v })
      setTodayLogs(logs)
    })
    return unsub
  }, [isSuperAdmin])

  // Sort: active first, then by name
  const sortedUsers = [...users].sort((a, b) => {
    const aActive = tasks.some(t => t.asignado === a.uid && t.estado === 'en_progreso')
    const bActive = tasks.some(t => t.asignado === b.uid && t.estado === 'en_progreso')
    if (aActive && !bActive) return -1
    if (!aActive && bActive) return 1
    return (a.name || '').localeCompare(b.name || '')
  })

  const getTasksFor = (uid) => tasks.filter(t => t.asignado === uid)

  return (
    <div>
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Colaboración</span>
          <h1 className="page-title">Equipo</h1>
          <p className="page-subtitle">
            {isAdmin
              ? 'Vista completa del equipo con estadísticas y timers'
              : 'Ve en qué está trabajando tu equipo'}
          </p>
        </div>
        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
          {users.length} personas · {agents.length} agentes
        </span>
      </div>

      <div className="team-grid">
        {sortedUsers.map(member => (
          <MemberCard
            key={member.uid}
            member={member}
            memberTasks={getTasksFor(member.uid)}
            isAdmin={isAdmin}
            onEditTask={openEditTask}
            isMe={member.uid === user.uid}
            todayLog={isSuperAdmin ? todayLogs[member.uid] : null}
          />
        ))}
      </div>

      {agentMembers.length > 0 && (
        <>
          <p className="section-title" style={{ marginTop: 28 }}>Agentes de IA ({agentMembers.length})</p>
          <div className="team-grid">
            {agentMembers.map(member => (
              <MemberCard
                key={member.uid}
                member={member}
                memberTasks={getTasksFor(member.uid)}
                isAdmin={isAdmin}
                onEditTask={openEditTask}
                isMe={false}
                todayLog={null}
              />
            ))}
          </div>
        </>
      )}

      {users.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">👥</div>
          <h3>Sin miembros aún</h3>
          <p>Los usuarios aparecen aquí al registrarse con Google</p>
        </div>
      )}
    </div>
  )
}

function MemberCard({ member, memberTasks, isAdmin, onEditTask, isMe, onChat, todayLog }) {
  const activeTask = memberTasks.find(t => t.estado === 'en_progreso')
  const pending = memberTasks.filter(t => t.estado === 'pendiente').length
  const inReview = memberTasks.filter(t => t.estado === 'en_revision').length
  const done = memberTasks.filter(t => t.estado === 'completada').length
  // En línea real: última actividad hace menos de 5 minutos
  const isOnline = member.lastSeen &&
    (Date.now() - (member.lastSeen.toMillis?.() || member.lastSeen.seconds * 1000)) < 5 * 60 * 1000

  // Avg time (admin only)
  const completedWithTime = memberTasks.filter(t => t.estado === 'completada' && t.totalTimeSeconds > 0)
  const avgHours = completedWithTime.length > 0
    ? (completedWithTime.reduce((a, t) => a + t.totalTimeSeconds, 0) / completedWithTime.length / 3600).toFixed(1)
    : null

  return (
    <div className="team-card">
      <div className="team-card-top">
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {member.photo
            ? <img src={member.photo} alt="" className="team-avatar" />
            : <div
                className="team-avatar-placeholder"
                style={{ background: member.color || '#4700E0' }}
              >
                {(member.name || '?')[0].toUpperCase()}
              </div>
          }
          {/* Online dot */}
          <div style={{
            position: 'absolute', bottom: 1, right: 1,
            width: 11, height: 11, borderRadius: '50%',
            background: isOnline ? 'var(--success)' : 'var(--text-3)',
            border: '2px solid var(--card)',
          }} title={isOnline ? 'En línea' : 'Desconectado'} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="team-name">{member.name}</div>
          <div className="team-position">{member.position || member.email}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 11, fontWeight: 600,
              color: isOnline ? 'var(--success)' : 'var(--text-3)'
            }}>
              {isOnline ? '🟢 En línea' : '⚫ Desconectado'}
            </span>
            <span className={`badge badge-${member.role}`}>
              {member.role}
            </span>
          </div>
        </div>
      </div>

      {/* Task counts (visible to all) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <TaskCount label="Pend." value={pending} color="var(--text-3)" />
        <TaskCount label="Correc." value={inReview} color="var(--warning)" />
        <TaskCount label="Hechas" value={done} color="var(--success)" />
      </div>

      {/* Super Admin: horas activas de hoy */}
      {todayLog && todayLog.hours && Object.keys(todayLog.hours).length > 0 && (() => {
        const activeHours = Object.entries(todayLog.hours)
          .filter(([, secs]) => secs > 0)
          .map(([h]) => parseInt(h))
          .sort((a, b) => a - b)
        const first = activeHours[0]
        const last = activeHours[activeHours.length - 1]
        const totalH = ((todayLog.onlineSeconds || 0) / 3600).toFixed(1)
        const RANGE_START = 6, RANGE_END = 22
        return (
          <div style={{ background: 'var(--bg-2)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)' }}>
              <span>🔌 Hoy: <strong style={{ color: 'var(--text)' }}>
                {String(first).padStart(2, '0')}:00 – {String(last).padStart(2, '0')}:59
              </strong></span>
              <span style={{ fontFamily: 'Space Mono', fontWeight: 700, color: 'var(--success)' }}>{totalH}h</span>
            </div>
            <div className="hours-timeline" title={`Actividad de ${String(RANGE_START).padStart(2,'0')}:00 a ${RANGE_END}:00`}>
              {Array.from({ length: RANGE_END - RANGE_START + 1 }, (_, i) => {
                const h = RANGE_START + i
                const secs = todayLog.hours[String(h).padStart(2, '0')] || 0
                const cls = secs >= 1800 ? 'active' : secs > 0 ? 'partial' : ''
                return <div key={h} className={`hour-block ${cls}`} title={`${String(h).padStart(2,'0')}:00 · ${Math.round(secs/60)} min activa`} />
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-3)', marginTop: 2 }}>
              <span>6am</span><span>2pm</span><span>10pm</span>
            </div>
          </div>
        )
      })()}

      {/* Admin: show avg time */}
      {isAdmin && avgHours && (
        <div style={{
          fontSize: 12, color: 'var(--text-3)', marginBottom: 10,
          background: 'var(--bg-2)', borderRadius: 6, padding: '4px 8px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          <span>⏱ Promedio por tarea</span>
          <span style={{ fontFamily: 'Space Mono', fontWeight: 700 }}>{avgHours}h</span>
        </div>
      )}

      {/* Active task */}
      {activeTask ? (
        <div
          className="team-task-row"
          style={{
            background: 'var(--purple-light)',
            border: '1px solid var(--purple-mid)',
            borderRadius: 8, cursor: 'pointer'
          }}
          onClick={() => onEditTask(activeTask)}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)', marginBottom: 3 }}>
              ⚡ EN PROGRESO
            </div>
            <div className="task-name" style={{ color: 'var(--text)' }}>
              {activeTask.tarea}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              {activeTask.cliente}
            </div>
          </div>
          {/* Timer: only admin sees the actual timing */}
          {isAdmin && (
            <LiveTimer
              timerStartedAt={activeTask.timerStartedAt}
              totalTimeSeconds={activeTask.totalTimeSeconds}
            />
          )}
        </div>
      ) : (
        <div className="team-task-empty">
          Sin tarea activa
        </div>
      )}

      {/* Show next pending (non-active) tasks - visible to all */}
      {memberTasks
        .filter(t => t.estado === 'pendiente')
        .slice(0, 2)
        .map(t => (
          <div key={t.id} className="team-task-row" style={{ cursor: 'pointer' }} onClick={() => onEditTask(t)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="task-name">{t.tarea}</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.cliente}</div>
            </div>
            <span className={`badge badge-${t.prioridad}`} style={{ fontSize: 10 }}>{t.prioridad}</span>
          </div>
        ))
      }
    </div>
  )
}

function TaskCount({ label, value, color }) {
  return (
    <div style={{
      flex: 1, textAlign: 'center',
      background: 'var(--bg-2)',
      borderRadius: 6, padding: '6px 4px'
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'Space Mono', color }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  )
}
