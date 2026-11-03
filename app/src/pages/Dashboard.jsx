import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useApp, SUPER_ADMIN_EMAIL } from '../App.jsx'
import { db } from '../firebase.js'
import { doc, updateDoc, serverTimestamp, onSnapshot, collection, query, where } from '../data/firestore.js'
import { logWork, todayKey } from '../utils/worklog.js'
import { sortByPriorityAndAge, inPeriod, PeriodFilter, wipLimitReached, WIP_LIMIT } from './KanbanView.jsx'
import Icon from '../components/Icons.jsx'

function fmtSeconds(s) {
  if (!s || s <= 0) return '00:00:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':')
}

function fmtHours(s) {
  if (!s) return '0h'
  return `${(s / 3600).toFixed(1)}h`
}

function tsToMs(ts) {
  if (!ts) return 0
  return ts.toMillis ? ts.toMillis() : ts.seconds * 1000
}

function useLiveSeconds(timerStartedAt, totalTimeSeconds) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!timerStartedAt) { setElapsed(totalTimeSeconds || 0); return }
    const base = totalTimeSeconds || 0
    const startMs = tsToMs(timerStartedAt)
    const tick = () => setElapsed(base + Math.floor((Date.now() - startMs) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timerStartedAt, totalTimeSeconds])
  return elapsed
}

function isOnline(u) {
  if (!u.lastSeen) return false
  return Date.now() - tsToMs(u.lastSeen) < 5 * 60 * 1000
}

function BarRow({ label, value, max, color = 'var(--purple)', suffix = '' }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="bar-row">
      <span className="bar-label" title={label}
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
        {label}
      </span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="bar-value">{value}{suffix}</span>
    </div>
  )
}

// ============ ADMIN DASHBOARD ============
function AdminDashboard() {
  const { tasks, users, agents, openNewTask, openEditTask, setViewAsEmployee, setPage, isSuperAdmin, showToast } = useApp()

  // Cambio de rol directo desde el panel (solo Super Admin)
  const roleValue = (u) => (u.email === SUPER_ADMIN_EMAIL || u.isSuper) ? 'superadmin' : (u.role === 'admin' ? 'manager' : 'empleado')
  const handleRoleChange = async (u, val) => {
    if (u.email === SUPER_ADMIN_EMAIL) { showToast('El rol del dueño no se puede cambiar', 'error'); return }
    const updates = val === 'superadmin'
      ? { role: 'admin', isSuper: true }
      : val === 'manager'
        ? { role: 'admin', isSuper: false }
        : { role: 'empleado', isSuper: false }
    try {
      await updateDoc(doc(db, 'users', u.uid), updates)
      showToast(`Rol de ${u.name} actualizado`)
    } catch (e) {
      showToast('No se pudo cambiar el rol', 'error')
    }
  }

  // Filtro de periodo (afecta estadísticas y productividad)
  const [period, setPeriod] = useState('all')
  const [monthVal, setMonthVal] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [filterEmpleado, setFilterEmpleado] = useState('')
  const filteredTasks = tasks
    .filter(t => inPeriod(t, period, monthVal, fromDate, toDate))
    .filter(t => !filterEmpleado || t.asignado === filterEmpleado)

  // Tiempo de conexión de hoy por usuario (solo lo ve el super admin)
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

  const now = Date.now()
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const dayMs = dayStart.getTime()
  const weekMs = now - 7 * 24 * 3600 * 1000
  const monthMs = now - 30 * 24 * 3600 * 1000

  const employees = users.filter(u => u.role !== 'pending')
  const online = employees.filter(isOnline)
  const offline = employees.filter(u => !isOnline(u))
  const activeTasks = tasks.filter(t => t.estado === 'en_progreso')
  // Las tareas pueden estar asignadas a un empleado o a un agente de IA
  const getUserById = (uid) => users.find(u => u.uid === uid)
    || ((a) => a && { uid: a.id, name: `${a.name} (agente)`, color: a.look?.torso, photo: a.photo || '' })(agents.find(a => a.id === uid))

  // Productividad por empleado: día / semana / mes
  const productivity = useMemo(() => {
    return employees.map(u => {
      const done = filteredTasks.filter(t => t.asignado === u.uid && t.estado === 'completada')
      const doneDay = done.filter(t => tsToMs(t.fechaEntrega) >= dayMs).length
      const doneWeek = done.filter(t => tsToMs(t.fechaEntrega) >= weekMs).length
      const doneMonth = done.filter(t => tsToMs(t.fechaEntrega) >= monthMs).length
      const totalTime = done.reduce((a, t) => a + (t.totalTimeSeconds || 0), 0)
      const withTime = done.filter(t => t.totalTimeSeconds > 0)
      const avgTime = withTime.length ? totalTime / withTime.length : 0
      return { user: u, doneDay, doneWeek, doneMonth, doneTotal: done.length, totalTime, avgTime }
    }).sort((a, b) => b.doneMonth - a.doneMonth)
  }, [filteredTasks, employees])

  const maxMonth = Math.max(...productivity.map(p => p.doneMonth), 1)

  const totals = {
    pendiente: filteredTasks.filter(t => t.estado === 'pendiente').length,
    en_progreso: filteredTasks.filter(t => t.estado === 'en_progreso').length,
    en_espera: filteredTasks.filter(t => t.estado === 'en_espera').length,
    en_revision: filteredTasks.filter(t => t.estado === 'en_revision').length,
    completada: filteredTasks.filter(t => t.estado === 'completada').length,
  }

  const medalColor = (i) => i === 0 ? 'var(--warning)' : i === 1 ? 'var(--text-3)' : i === 2 ? '#b45309' : 'var(--text-3)'

  return (
    <div>
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Administración</span>
          <h1 className="page-title">Panel de Control</h1>
          <p className="page-subtitle">
            {isSuperAdmin ? 'Vista completa · Super Admin' : 'Vista de Manager: equipo en línea y timers activos'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Filtros de periodo y empleado */}
          <PeriodFilter
            period={period} setPeriod={setPeriod}
            monthVal={monthVal} setMonthVal={setMonthVal}
            fromDate={fromDate} setFromDate={setFromDate}
            toDate={toDate} setToDate={setToDate}
          />
          <select className="form-select" style={{ fontSize: 13, padding: '6px 10px', width: 'auto' }}
            value={filterEmpleado} onChange={e => setFilterEmpleado(e.target.value)}>
            <option value="">Todos los empleados</option>
            {employees.map(u => <option key={u.uid} value={u.uid}>{u.name}</option>)}
          </select>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { setViewAsEmployee(true); setPage('pipeline') }}
            title="Ver la plataforma exactamente como la ven tus empleados"
          >
            <Icon name="eye" size={14} /> Ver como empleado
          </button>
          <button className="btn btn-primary btn-sm" onClick={openNewTask}>
            <Icon name="plus" size={14} /> Nueva tarea
          </button>
        </div>
      </div>

      {/* Stats generales */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        {[
          { icon: 'wifi', value: online.length, label: 'En línea', color: 'var(--success)' },
          { icon: 'checkSquare', value: filteredTasks.length, label: 'Total tareas', color: 'var(--text)' },
          { icon: 'hourglass', value: totals.pendiente, label: 'Pendientes', color: 'var(--text-3)' },
          { icon: 'timer', value: totals.en_progreso, label: 'En progreso', color: 'var(--purple)' },
          { icon: 'clock', value: totals.en_espera, label: 'Espera aprobación', color: 'var(--info)' },
          { icon: 'wrench', value: totals.en_revision, label: 'Correcciones', color: 'var(--warning)' },
          { icon: 'check', value: totals.completada, label: 'Completadas', color: 'var(--success)' },
        ].map((s, i) => (
          <div className="stat-card" key={i}>
            <span style={{ color: s.color }}><Icon name={s.icon} size={20} /></span>
            <span className="stat-value" style={{ color: s.color }}>{s.value}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* En línea / Offline */}
      <div className="metrics-grid" style={{ marginBottom: 24 }}>
        <div className="card">
          <p className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--success)' }}><Icon name="wifi" size={13} /></span> En línea ({online.length})
          </p>
          {online.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Nadie conectado ahora</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {online.map(u => {
              const activeTask = activeTasks.find(t => t.asignado === u.uid)
              return (
                <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <UserAvatar u={u} online />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                    {activeTask
                      ? <div style={{ fontSize: 11.5, color: 'var(--purple)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="timer" size={11} /> {activeTask.tarea}
                        </div>
                      : <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Sin tarea activa</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card">
          <p className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="moon" size={13} /> Desconectados ({offline.length})
          </p>
          {offline.length === 0 && <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Todo el equipo está en línea</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {offline.map(u => (
              <div key={u.uid} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: 0.65 }}>
                <UserAvatar u={u} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{u.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>
                    {u.lastSeen
                      ? `Última vez: ${new Date(tsToMs(u.lastSeen)).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                      : 'Nunca conectado'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Timers activos */}
      {activeTasks.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <p className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="timer" size={13} /> Timers activos ahora
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {activeTasks.map(task => (
              <ActiveTimerRow key={task.id} task={task}
                assignedUser={getUserById(task.asignado)}
                onEdit={() => openEditTask(task)} />
            ))}
          </div>
        </div>
      )}

      {/* Tabla de productividad — SOLO Super Admin */}
      {isSuperAdmin && (
      <div className="card" style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <p className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="trendUp" size={13} /> Productividad por empleado
          </p>
        </div>
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Empleado</th>
                <th style={{ textAlign: 'center' }}>Hoy</th>
                <th style={{ textAlign: 'center' }}>Semana</th>
                <th style={{ textAlign: 'center' }}>Mes</th>
                <th style={{ textAlign: 'center' }}>Total</th>
                <th style={{ textAlign: 'center' }}>Tiempo total</th>
                <th style={{ textAlign: 'center' }}>Promedio/tarea</th>
                <th style={{ textAlign: 'center' }}>Conexión hoy</th>
                <th style={{ textAlign: 'center' }}>Rol</th>
              </tr>
            </thead>
            <tbody>
              {productivity.map(p => (
                <tr key={p.user.uid}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <UserAvatar u={p.user} online={isOnline(p.user)} size={26} />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{p.user.name}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', fontFamily: 'Space Mono' }}>{p.doneDay}</td>
                  <td style={{ textAlign: 'center', fontFamily: 'Space Mono' }}>{p.doneWeek}</td>
                  <td style={{ textAlign: 'center', fontFamily: 'Space Mono', color: 'var(--purple)', fontWeight: 700 }}>{p.doneMonth}</td>
                  <td style={{ textAlign: 'center', fontFamily: 'Space Mono' }}>{p.doneTotal}</td>
                  <td style={{ textAlign: 'center', fontFamily: 'Space Mono', fontSize: 12 }}>{fmtHours(p.totalTime)}</td>
                  <td style={{ textAlign: 'center', fontFamily: 'Space Mono', fontSize: 12 }}>{fmtHours(p.avgTime)}</td>
                  <td style={{ textAlign: 'center', fontFamily: 'Space Mono', fontSize: 12, color: 'var(--info)' }}>
                    {fmtHours(todayLogs[p.user.uid]?.onlineSeconds || 0)}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {p.user.email === SUPER_ADMIN_EMAIL ? (
                      <span className="badge badge-admin">Super Admin</span>
                    ) : (
                      <select
                        className="form-select"
                        style={{ fontSize: 12, padding: '4px 8px', width: 'auto' }}
                        value={roleValue(p.user)}
                        onChange={e => handleRoleChange(p.user, e.target.value)}
                      >
                        <option value="empleado">Empleado</option>
                        <option value="manager">Manager</option>
                        <option value="superadmin">Super Admin</option>
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Informe mensual — SOLO Super Admin */}
      {isSuperAdmin && <MonthlyReport tasks={tasks} employees={employees} />}

      {/* Gráfica + Ranking — SOLO Super Admin */}
      {isSuperAdmin && (
      <div className="metrics-grid">
        <div className="card">
          <p className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="trendUp" size={13} /> Completadas este mes
          </p>
          <div className="bar-chart">
            {productivity.map(p => (
              <BarRow key={p.user.uid}
                label={p.user.name?.split(' ')[0]}
                value={p.doneMonth} max={maxMonth} />
            ))}
          </div>
        </div>

        <div className="card">
          <p className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="trophy" size={13} /> Ranking del mes
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {productivity.slice(0, 5).map((p, i) => (
              <div key={p.user.uid} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8,
                background: i === 0 ? 'rgba(245,158,11,0.08)' : 'var(--bg-2)',
                border: i === 0 ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent',
              }}>
                <span style={{ minWidth: 28, textAlign: 'center', color: medalColor(i), display: 'inline-flex', justifyContent: 'center' }}>
                  {i < 3 ? <Icon name="trophy" size={i === 0 ? 20 : 16} /> : <span style={{ fontSize: 13 }}>{i + 1}.</span>}
                </span>
                <UserAvatar u={p.user} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{p.user.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{fmtHours(p.totalTime)} trabajadas</div>
                </div>
                <span style={{ fontFamily: 'Space Mono', fontWeight: 700, color: 'var(--purple)' }}>
                  {p.doneMonth}
                </span>
              </div>
            ))}
            {productivity.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Sin datos aún</p>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  )
}

function UserAvatar({ u, online = false, size = 32 }) {
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {u.photo
        ? <img src={u.photo} alt="" style={{ width: size, height: size, borderRadius: '50%' }} />
        : <div style={{
            width: size, height: size, borderRadius: '50%',
            background: u.color || '#4700E0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: size * 0.4, fontWeight: 700, color: '#fff'
          }}>
            {(u.name || '?')[0].toUpperCase()}
          </div>
      }
      {online && (
        <div style={{
          position: 'absolute', bottom: 0, right: 0,
          width: size * 0.3, height: size * 0.3, borderRadius: '50%',
          background: 'var(--success)', border: '2px solid var(--card)'
        }} />
      )}
    </div>
  )
}

function ActiveTimerRow({ task, assignedUser, onEdit }) {
  const isPaused = task.timerPaused === true
  const elapsed = useLiveSeconds(isPaused ? null : task.timerStartedAt, task.totalTimeSeconds)

  return (
    <div className="card card-sm" style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }} onClick={onEdit}>
      {assignedUser && <UserAvatar u={assignedUser} size={32} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{task.tarea}</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{assignedUser?.name || '—'} · {task.cliente}</div>
      </div>
      <div className="timer-display" style={{
        opacity: isPaused ? 0.7 : 1,
        background: isPaused ? 'rgba(239,68,68,0.1)' : undefined,
        color: isPaused ? 'var(--danger)' : undefined,
        borderColor: isPaused ? 'rgba(239,68,68,0.3)' : undefined,
      }}>
        {!isPaused && <span className="timer-dot" />}
        {isPaused && <span style={{ fontSize: 10 }}>⏸</span>}
        {fmtSeconds(elapsed)}
      </div>
      <span className={`badge badge-${task.prioridad}`}>{task.prioridad}</span>
    </div>
  )
}

// ============ EMPLOYEE DASHBOARD ============
const WELCOME_MESSAGES = [
  (n) => `¡Bienvenid@ ${n}! Hoy será un día maravilloso`,
  (n) => `Hola ${n}, tu productividad sigue creciendo. ¡Sigue así!`,
  (n) => `¡Buen día ${n}! Cada tarea completada te acerca a tus metas`,
  (n) => `${n}, hoy es un gran día para hacer cosas increíbles`,
  (n) => `¡Hola ${n}! Respira, enfócate y a darle con todo`,
  (n) => `${n}, tu esfuerzo de cada día construye algo grande`,
  (n) => `¡Bienvenid@ de nuevo ${n}! El equipo cuenta contigo`,
  (n) => `${n}, la constancia es tu superpoder. ¡A brillar hoy!`,
  (n) => `¡Hola ${n}! Un paso a la vez, una tarea a la vez`,
  (n) => `${n}, hoy es perfecto para superar tu récord`,
]

function dailyWelcome(name) {
  // Mensaje distinto cada día, estable durante el día
  const dayNumber = Math.floor(Date.now() / 86400000)
  const msg = WELCOME_MESSAGES[dayNumber % WELCOME_MESSAGES.length]
  return msg(name)
}

// Frases motivadoras — rotan cada día, distintas del saludo
const MOTIVATIONAL_QUOTES = [
  '"El éxito es la suma de pequeños esfuerzos repetidos día tras día." · Robert Collier',
  '"No cuentes los días, haz que los días cuenten." · Muhammad Ali',
  '"La disciplina es el puente entre las metas y los logros." · Jim Rohn',
  '"Hazlo con pasión o no lo hagas." · Rosa Nouchette',
  '"El único modo de hacer un gran trabajo es amar lo que haces." · Steve Jobs',
  '"La creatividad es la inteligencia divirtiéndose." · Albert Einstein',
  '"No esperes el momento perfecto, toma el momento y hazlo perfecto."',
  '"Los grandes logros requieren tiempo. Confía en tu proceso."',
  '"Cada tarea completada es un paso hacia la mejor versión de ti."',
  '"El talento gana partidos, pero el trabajo en equipo gana campeonatos." · Michael Jordan',
  '"Enfócate en el progreso, no en la perfección."',
  '"Tu actitud, no tu aptitud, determinará tu altitud." · Zig Ziglar',
  '"Un pequeño progreso cada día suma grandes resultados."',
  '"Trabaja duro en silencio, deja que tu éxito haga el ruido." · Frank Ocean',
]

function dailyQuote() {
  const dayNumber = Math.floor(Date.now() / 86400000)
  return MOTIVATIONAL_QUOTES[dayNumber % MOTIVATIONAL_QUOTES.length]
}

const DAILY_QUOTA_HOURS = 8

function EmployeeDashboard() {
  const { user, userProfile, tasks, showToast, sendNotification, openEditTask, openNewTask } = useApp()
  const notifiedTimers = useRef(new Set())

  // Horas trabajadas hoy (worklog en tiempo real)
  const [todayLoggedSeconds, setTodayLoggedSeconds] = useState(0)
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'worklog', `${user.uid}_${todayKey()}`), snap => {
      setTodayLoggedSeconds(snap.exists() ? (snap.data().seconds || 0) : 0)
    })
    return unsub
  }, [user.uid])

  const myTasks = tasks.filter(t => t.asignado === user.uid)
  const myActive = myTasks.find(t => t.estado === 'en_progreso')
  const myPending = sortByPriorityAndAge(myTasks.filter(t => t.estado === 'pendiente'))
  const myReview = myTasks.filter(t => t.estado === 'en_revision')
  const myWaiting = myTasks.filter(t => t.estado === 'en_espera')
  const myDone = myTasks.filter(t => t.estado === 'completada')

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
  const doneWeek = myDone.filter(t => tsToMs(t.fechaEntrega) > weekAgo).length

  const completedWithTime = myDone.filter(t => t.totalTimeSeconds > 0)
  const avgHours = completedWithTime.length > 0
    ? (completedWithTime.reduce((acc, t) => acc + (t.totalTimeSeconds || 0), 0) / completedWithTime.length / 3600).toFixed(1)
    : null

  useEffect(() => {
    if (!myActive?.timerStartedAt) return
    const key = `${myActive.id}-${myActive.timerStartedAt?.seconds}`
    if (notifiedTimers.current.has(key)) return
    notifiedTimers.current.add(key)
    const age = Date.now() - tsToMs(myActive.timerStartedAt)
    if (age < 60000) {
      showToast(`⏱️ ¡Timer iniciado! "${myActive.tarea}"`, 'info')
      sendNotification('⏱️ ¡El tiempo está corriendo!', `Tarea: "${myActive.tarea}"`)
    }
  }, [myActive?.timerStartedAt?.seconds])

  const isPaused = myActive?.timerPaused === true
  const elapsed = useLiveSeconds(isPaused ? null : myActive?.timerStartedAt, myActive?.totalTimeSeconds)

  // Aviso de tiempo excedido: si supera el tiempo estimado de la tarea
  const estimateSecs = (myActive?.tiempoEstimadoMin || 0) * 60
  const overEstimate = estimateSecs > 0 && elapsed > estimateSecs
  const overrunNotified = useRef(new Set())
  useEffect(() => {
    if (!overEstimate || !myActive) return
    if (overrunNotified.current.has(myActive.id)) return
    overrunNotified.current.add(myActive.id)
    showToast(`Estás tomando más tiempo del previsto (${myActive.tiempoEstimadoMin} min) en "${myActive.tarea}"`, 'warning')
    sendNotification('Tiempo excedido', `"${myActive.tarea}" superó el tiempo previsto de ${myActive.tiempoEstimadoMin} min`)
  }, [overEstimate, myActive?.id])

  // Sesión en curso (solo lo que corre AHORA, sin lo acumulado de la tarea)
  const currentSessionSeconds = useLiveSeconds(isPaused ? null : myActive?.timerStartedAt, 0)
  const todayTotalSeconds = todayLoggedSeconds + (myActive && !isPaused ? currentSessionSeconds : 0)
  const todayHours = todayTotalSeconds / 3600
  const quotaPct = Math.min(100, Math.round((todayHours / DAILY_QUOTA_HOURS) * 100))
  const quotaMet = todayHours >= DAILY_QUOTA_HOURS

  // Tareas devueltas por el admin esperando mi aceptación
  const pendingAccept = myTasks.filter(t => t.pendingAcceptance)

  const handleAcceptTask = async (task) => {
    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        pendingAcceptance: false,
        timerPaused: false,
        timerStartedAt: serverTimestamp(),
        lastEditedBy: user.email,
        lastEditedAt: serverTimestamp(),
      })
      showToast(`Aceptaste "${task.tarea}". ¡Timer corriendo!`, 'info')
      sendNotification('⏱️ Timer iniciado', `Aceptaste: "${task.tarea}"`)
    } catch (e) {
      console.error(e)
      const detail = e?.code === 'permission-denied' ? 'sin permisos' : (e?.code || '')
      showToast(`No se pudo aceptar la tarea${detail ? ` (${detail})` : ''}`, 'error')
    }
  }

  const handleTakeTask = async (task) => {
    if (wipLimitReached(tasks, user.uid, task.id)) {
      showToast(`Máximo ${WIP_LIMIT} tareas En Progreso. Termina una o devuélvela a Pendiente antes de tomar otra`, 'error')
      return
    }
    const updates = {
      estado: 'en_progreso',
      timerStartedAt: serverTimestamp(),
      timerPaused: false,
      lastEditedBy: user.email,
      lastEditedAt: serverTimestamp(),
    }
    if (!task.fechaInicio) updates.fechaInicio = serverTimestamp()
    await updateDoc(doc(db, 'tasks', task.id), updates)
    showToast(`Tomaste "${task.tarea}". ¡Timer iniciado!`, 'info')
    sendNotification('⏱️ ¡Timer iniciado!', `Empezaste: "${task.tarea}"`)
  }

  const handlePauseResume = async (task) => {
    if (!task.timerPaused) {
      const startMs = tsToMs(task.timerStartedAt)
      const elapsedNow = startMs ? Math.floor((Date.now() - startMs) / 1000) : 0
      await updateDoc(doc(db, 'tasks', task.id), {
        timerPaused: true,
        timerStartedAt: null,
        totalTimeSeconds: (task.totalTimeSeconds || 0) + elapsedNow,
        lastEditedBy: user.email,
        lastEditedAt: serverTimestamp(),
      })
      logWork(task.asignado, elapsedNow)
      showToast('⏸ Timer pausado')
    } else {
      await updateDoc(doc(db, 'tasks', task.id), {
        timerPaused: false,
        timerStartedAt: serverTimestamp(),
        lastEditedBy: user.email,
        lastEditedAt: serverTimestamp(),
      })
      showToast('▶ Timer reanudado')
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Tu espacio</span>
          <h1 className="page-title">{dailyWelcome(userProfile?.name?.split(' ')[0] || 'crack')}</h1>
          <p className="page-subtitle">Tu panel de productividad personal</p>
        </div>
        <button className="btn btn-primary" onClick={openNewTask}>+ Nueva tarea</button>
      </div>

      {/* Frase motivadora del día */}
      <div className="motivation-card">
        <span className="quote-icon">💜</span>
        <span className="quote-text">{dailyQuote()}</span>
      </div>

      {/* Horas trabajadas hoy */}
      <div className="card" style={{ marginBottom: 20, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: quotaMet ? 'var(--success)' : 'var(--purple)' }}>
              <Icon name={quotaMet ? 'trophy' : 'clock'} size={22} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Horas trabajadas hoy</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {quotaMet
                  ? '¡Cuota diaria cumplida! Excelente trabajo'
                  : `Meta diaria: ${DAILY_QUOTA_HOURS}h · Te faltan ${(DAILY_QUOTA_HOURS - todayHours).toFixed(1)}h`}
              </div>
            </div>
          </div>
          <div style={{ fontFamily: 'Space Mono', fontSize: 24, fontWeight: 700, color: quotaMet ? 'var(--success)' : 'var(--purple)' }}>
            {todayHours.toFixed(1)}h
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}> / {DAILY_QUOTA_HOURS}h</span>
          </div>
        </div>
        <div className="bar-track" style={{ height: 10 }}>
          <div className="bar-fill" style={{
            width: `${quotaPct}%`,
            background: quotaMet ? 'var(--success)' : 'var(--purple)',
            transition: 'width 1s ease'
          }} />
        </div>
      </div>

      {/* Popup: tareas devueltas por el admin */}
      {pendingAccept.map(task => (
        <div key={task.id} className="card accept-task-popup" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ color: 'var(--purple)' }}><Icon name="bell" size={30} /></div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
              Te devolvieron una tarea
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              <strong>{task.returnedBy || 'El administrador'}</strong> puso "{task.tarea}" de nuevo En Progreso.
              El timer NO corre hasta que la aceptes.
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => handleAcceptTask(task)}>
            <Icon name="check" size={14} /> Aceptar y comenzar
          </button>
        </div>
      ))}

      {myActive ? (
        <div className="active-task-banner" style={{
          marginBottom: 24,
          background: isPaused
            ? 'linear-gradient(135deg, #b91c1c, #ef4444)'
            : undefined,
        }}>
          <div>
            <div className="timer-big">{fmtSeconds(elapsed)}</div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 4, textAlign: 'center' }}>
              {isPaused ? 'EN PAUSA' : 'tiempo activo'}
            </div>
            {estimateSecs > 0 && (
              <div style={{
                fontSize: 10.5, marginTop: 4, textAlign: 'center', fontWeight: 700,
                color: overEstimate ? '#ffd6d6' : 'rgba(255,255,255,0.75)',
                background: overEstimate ? 'rgba(0,0,0,0.25)' : 'transparent',
                borderRadius: 6, padding: '2px 6px'
              }}>
                {overEstimate ? 'TIEMPO EXCEDIDO' : `Estimado: ${myActive.tiempoEstimadoMin} min`}
              </div>
            )}
          </div>
          <div className="timer-info" style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{myActive.tarea}</h3>
            <p>{myActive.cliente}</p>
            {!isPaused && (
              <div className="timer-running-badge">
                <span style={{ animation: 'blink 1s infinite', display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
                Timer corriendo
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-sm"
              onClick={() => handlePauseResume(myActive)}
              style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', minWidth: 42 }}
              title={isPaused ? 'Reanudar timer' : 'Pausar timer'}
            >
              <Icon name={isPaused ? 'play' : 'pause'} size={14} />
            </button>
            <button
              className="btn btn-sm"
              onClick={() => openEditTask(myActive)}
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}
            >
              Ver tarea
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 24, textAlign: 'center', padding: '24px', borderStyle: 'dashed' }}>
          <div style={{ marginBottom: 8, color: 'var(--text-3)' }}><Icon name="target" size={32} /></div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Sin tarea activa</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Toma una tarea pendiente para iniciar el timer</div>
        </div>
      )}

      <div className="stats-grid" style={{ marginBottom: 28 }}>
        <div className="stat-card">
          <span style={{ color: 'var(--text-3)' }}><Icon name="hourglass" size={20} /></span>
          <span className="stat-value">{myPending.length}</span>
          <span className="stat-label">Pendientes</span>
        </div>
        <div className="stat-card">
          <span style={{ color: 'var(--info)' }}><Icon name="clock" size={20} /></span>
          <span className="stat-value" style={{ color: 'var(--info)' }}>{myWaiting.length}</span>
          <span className="stat-label">Espera aprobación</span>
        </div>
        <div className="stat-card">
          <span style={{ color: 'var(--warning)' }}><Icon name="wrench" size={20} /></span>
          <span className="stat-value" style={{ color: 'var(--warning)' }}>{myReview.length}</span>
          <span className="stat-label">Correcciones</span>
        </div>
        <div className="stat-card">
          <span style={{ color: 'var(--success)' }}><Icon name="check" size={20} /></span>
          <span className="stat-value" style={{ color: 'var(--success)' }}>{doneWeek}</span>
          <span className="stat-label">Esta semana</span>
        </div>
        {avgHours && (
          <div className="stat-card">
            <span style={{ color: 'var(--purple)' }}><Icon name="timer" size={20} /></span>
            <span className="stat-value">{avgHours}h</span>
            <span className="stat-label">Promedio/tarea</span>
          </div>
        )}
      </div>

      {/* ===== Mis métricas: panel personal con comparativas ===== */}
      <MyMetricsPanel myTasks={myTasks} myDone={myDone} myPending={myPending} myReview={myReview} />

      {myPending.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <p className="section-title">Tus tareas pendientes ({myPending.length})</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myPending.slice(0, 6).map(task => (
              <div key={task.id} className="card card-sm" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => openEditTask(task)}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.tarea}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{task.cliente}</div>
                </div>
                <span className={`badge badge-${task.prioridad}`}>{task.prioridad}</span>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => handleTakeTask(task)}
                  disabled={!!myActive}
                  title={myActive ? 'Termina o pausa tu tarea activa primero' : 'Tomar esta tarea e iniciar timer'}
                  style={{ minWidth: 88, opacity: myActive ? 0.5 : 1 }}
                >
                  <Icon name="play" size={12} /> Tomar
                </button>
              </div>
            ))}
            {myPending.length > 6 && (
              <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-3)', paddingTop: 4 }}>
                +{myPending.length - 6} más · ve a "Tareas" para ver todas
              </div>
            )}
          </div>
        </div>
      )}

      {myReview.length > 0 && (
        <div>
          <p className="section-title">🔧 Correcciones solicitadas</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myReview.map(task => (
              <div key={task.id} className="card card-sm" style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => openEditTask(task)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.tarea}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{task.cliente}</div>
                </div>
                <span className={`badge badge-${task.prioridad}`}>{task.prioridad}</span>
                <span className="badge badge-en_revision">Correcciones</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ===== Informe mensual detallado por empleado (Super Admin) =====
function MonthlyReport({ tasks, employees }) {
  const nowMonth = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  const [month, setMonth] = useState(nowMonth())
  const [monthLogs, setMonthLogs] = useState([])

  // Horas de conexión del mes: rango sobre el campo date (YYYY-MM-DD)
  useEffect(() => {
    if (!month) return
    const q = query(
      collection(db, 'worklog'),
      where('date', '>=', `${month}-01`),
      where('date', '<=', `${month}-31`)
    )
    const unsub = onSnapshot(q, snap => setMonthLogs(snap.docs.map(d => d.data())))
    return unsub
  }, [month])

  const [y, m] = month.split('-').map(Number)
  const monthStart = new Date(y, m - 1, 1).getTime()
  const monthEnd = new Date(y, m, 1).getTime()
  const inMonth = (ts) => { const ms = tsToMs(ts); return ms >= monthStart && ms < monthEnd }

  const rows = employees.map(u => {
    const done = tasks.filter(t => t.asignado === u.uid && t.estado === 'completada' && inMonth(t.fechaEntrega))
    const totalTime = done.reduce((a, t) => a + (t.totalTimeSeconds || 0), 0)
    const withTime = done.filter(t => t.totalTimeSeconds > 0)
    const avgTime = withTime.length ? totalTime / withTime.length : 0

    // Cumplimiento de tiempo estimado
    const withEstimate = done.filter(t => t.tiempoEstimadoMin > 0)
    const overTime = withEstimate.filter(t => (t.totalTimeSeconds || 0) > t.tiempoEstimadoMin * 60).length
    const underTime = withEstimate.length - overTime

    // Cumplimiento de fechas de vencimiento
    const withDeadline = done.filter(t => t.fechaVencimiento)
    const late = withDeadline.filter(t => tsToMs(t.fechaEntrega) > tsToMs(t.fechaVencimiento)).length
    const onTime = withDeadline.length - late

    // Inicio a tiempo: fechaInicio vs fechaRequerimiento
    const withReq = done.filter(t => t.fechaRequerimiento && t.fechaInicio)
    const startedLate = withReq.filter(t => tsToMs(t.fechaInicio) > tsToMs(t.fechaRequerimiento)).length

    // Prioridad: urgentes/altas entregadas tarde
    const priorityMissed = done.filter(t =>
      ['urgente', 'alta'].includes(t.prioridad) &&
      t.fechaVencimiento && tsToMs(t.fechaEntrega) > tsToMs(t.fechaVencimiento)
    ).length

    // Conexión del mes
    const onlineSecs = monthLogs.filter(l => l.uid === u.uid).reduce((a, l) => a + (l.onlineSeconds || 0), 0)

    // Calificación promedio
    const rated = done.filter(t => t.rating > 0)
    const avgRating = rated.length ? (rated.reduce((a, t) => a + t.rating, 0) / rated.length) : 0

    return { u, done: done.length, totalTime, avgTime, overTime, underTime, withEstimate: withEstimate.length,
      onTime, late, withDeadline: withDeadline.length, startedLate, withReq: withReq.length, priorityMissed, onlineSecs, avgRating }
  }).sort((a, b) => b.done - a.done)

  return (
    <div className="card" style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <p className="section-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="calendar" size={13} /> Informe mensual por empleado
        </p>
        <input type="month" className="form-input" style={{ width: 'auto', padding: '5px 10px', fontSize: 13 }}
          value={month} onChange={e => setMonth(e.target.value)} />
      </div>
      <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Empleado</th>
              <th style={{ textAlign: 'center' }}>Conexión</th>
              <th style={{ textAlign: 'center' }}>Completadas</th>
              <th style={{ textAlign: 'center' }}>Tiempo total</th>
              <th style={{ textAlign: 'center' }}>Promedio/tarea</th>
              <th style={{ textAlign: 'center' }}>Tiempo estimado</th>
              <th style={{ textAlign: 'center' }}>Fechas de entrega</th>
              <th style={{ textAlign: 'center' }}>Inicio tardío</th>
              <th style={{ textAlign: 'center' }}>Prioridad incumplida</th>
              <th style={{ textAlign: 'center' }}>Calificación</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.u.uid}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <UserAvatar u={r.u} size={26} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{r.u.name}</span>
                  </div>
                </td>
                <td style={{ textAlign: 'center', fontFamily: 'Space Mono', fontSize: 12, color: 'var(--info)' }}>{fmtHours(r.onlineSecs)}</td>
                <td style={{ textAlign: 'center', fontFamily: 'Space Mono', fontWeight: 700, color: 'var(--purple)' }}>{r.done}</td>
                <td style={{ textAlign: 'center', fontFamily: 'Space Mono', fontSize: 12 }}>{fmtHours(r.totalTime)}</td>
                <td style={{ textAlign: 'center', fontFamily: 'Space Mono', fontSize: 12 }}>{fmtHours(r.avgTime)}</td>
                <td style={{ textAlign: 'center', fontSize: 12 }}>
                  {r.withEstimate === 0 ? <span style={{ color: 'var(--text-3)' }}>Sin datos</span> : (
                    <>
                      <span style={{ color: 'var(--success)', fontWeight: 700 }}>{r.underTime} ok</span>
                      {' · '}
                      <span style={{ color: r.overTime > 0 ? 'var(--danger)' : 'var(--text-3)', fontWeight: 700 }}>{r.overTime} excedidas</span>
                    </>
                  )}
                </td>
                <td style={{ textAlign: 'center', fontSize: 12 }}>
                  {r.withDeadline === 0 ? <span style={{ color: 'var(--text-3)' }}>Sin datos</span> : (
                    <>
                      <span style={{ color: 'var(--success)', fontWeight: 700 }}>{r.onTime} a tiempo</span>
                      {' · '}
                      <span style={{ color: r.late > 0 ? 'var(--danger)' : 'var(--text-3)', fontWeight: 700 }}>{r.late} tarde</span>
                    </>
                  )}
                </td>
                <td style={{ textAlign: 'center', fontSize: 12, color: r.startedLate > 0 ? 'var(--warning)' : 'var(--text-3)' }}>
                  {r.withReq === 0 ? 'Sin datos' : `${r.startedLate} de ${r.withReq}`}
                </td>
                <td style={{ textAlign: 'center', fontSize: 12, color: r.priorityMissed > 0 ? 'var(--danger)' : 'var(--text-3)', fontWeight: 700 }}>
                  {r.priorityMissed}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {r.avgRating > 0 ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: 'var(--warning)', fontFamily: 'Space Mono', fontSize: 12, fontWeight: 700 }}>
                      <Icon name="star" size={12} filled /> {r.avgRating.toFixed(1)}
                    </span>
                  ) : <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Sin calificar</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ===== Panel de métricas personales con comparativas semana/mes =====
function MyMetricsPanel({ myTasks, myDone, myPending, myReview }) {
  const now = new Date()
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0)
  const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(weekStart.getDate() - 7)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const doneIn = (from, to) => myDone.filter(t => {
    const ms = tsToMs(t.fechaEntrega)
    return ms >= from.getTime() && (!to || ms < to.getTime())
  })

  const thisWeek = doneIn(weekStart)
  const lastWeek = doneIn(lastWeekStart, weekStart)
  const thisMonth = doneIn(monthStart)
  const lastMonth = doneIn(lastMonthStart, monthStart)

  const sumHours = (list) => list.reduce((a, t) => a + (t.totalTimeSeconds || 0), 0) / 3600
  const hoursWeek = sumHours(thisWeek)
  const withTime = myDone.filter(t => t.totalTimeSeconds > 0)
  const avgH = withTime.length ? sumHours(withTime) / withTime.length : 0

  const weekDiff = thisWeek.length - lastWeek.length
  const monthDiff = thisMonth.length - lastMonth.length

  const Metric = ({ icon, value, label, color }) => (
    <div className="stat-card" style={{ padding: 14 }}>
      <span style={{ color: color || 'var(--text-2)' }}><Icon name={icon} size={20} /></span>
      <span className="stat-value" style={{ fontSize: 22, color }}>{value}</span>
      <span className="stat-label" style={{ fontSize: 10.5 }}>{label}</span>
    </div>
  )

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <p className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Icon name="target" size={14} /> Mis métricas
      </p>

      {/* Comparativa semanal */}
      {(lastWeek.length > 0 || thisWeek.length > 0) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          borderRadius: 10, marginBottom: 16,
          background: weekDiff >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
          border: `1px solid ${weekDiff >= 0 ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.3)'}`,
        }}>
          <span style={{ color: weekDiff >= 0 ? 'var(--success)' : 'var(--warning)' }}>
            <Icon name={weekDiff >= 0 ? 'trendUp' : 'trendDown'} size={26} />
          </span>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            {weekDiff > 0 && (
              <><strong>¡Excelente trabajo!</strong> Esta semana superaste tu productividad de la semana anterior
              ({thisWeek.length} vs {lastWeek.length} tareas completadas).</>
            )}
            {weekDiff === 0 && (
              <><strong>Vas al mismo ritmo</strong> que la semana pasada ({thisWeek.length} tareas). ¡Un empujón más y la superas!</>
            )}
            {weekDiff < 0 && (
              <><strong>Esta semana tu productividad fue inferior a la anterior</strong> ({thisWeek.length} vs {lastWeek.length}).
              Revisa tus métricas e identifica oportunidades de mejora.</>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
        <Metric icon="check" value={thisWeek.length} label="Completadas semana" color="var(--success)" />
        <Metric icon="checkSquare" value={thisMonth.length} label="Completadas mes" color="var(--success)" />
        <Metric icon="clock" value={`${hoursWeek.toFixed(1)}h`} label="Horas esta semana" color="var(--purple)" />
        <Metric icon="timer" value={`${avgH.toFixed(1)}h`} label="Promedio por tarea" />
        <Metric icon="hourglass" value={myPending.length} label="Pendientes" color="var(--text-2)" />
        <Metric icon="wrench" value={myReview.length} label="En correcciones" color="var(--warning)" />
      </div>

      {/* Comparativa mensual */}
      <div style={{ display: 'flex', gap: 16, marginTop: 14, fontSize: 12, color: 'var(--text-3)', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: weekDiff >= 0 ? 'var(--success)' : 'var(--warning)' }}>
            <Icon name={weekDiff >= 0 ? 'trendUp' : 'trendDown'} size={13} />
          </span>
          Semana: {thisWeek.length} vs {lastWeek.length} anterior
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: monthDiff >= 0 ? 'var(--success)' : 'var(--warning)' }}>
            <Icon name={monthDiff >= 0 ? 'trendUp' : 'trendDown'} size={13} />
          </span>
          Mes: {thisMonth.length} vs {lastMonth.length} anterior
        </span>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { isAdmin } = useApp()
  return isAdmin ? <AdminDashboard /> : <EmployeeDashboard />
}
