import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../App.jsx'
import { db } from '../firebase.js'
import { collection, onSnapshot } from '../data/firestore.js'
import Icon from './Icons.jsx'

const STORAGE_KEY = 'aia3d_pomodoro_v2'
const SETTINGS_KEY = 'aia3d_pomodoro_settings'

const DEFAULT_SETTINGS = {
  workMinutes: 40,
  breakMinutes: 10,
  longBreakMinutes: 15,
}

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } } catch { return DEFAULT_SETTINGS }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch {}
}
function loadState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch { return null }
}
function saveState(s) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
}
function fmtTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function PomodoroWidget() {
  const { user, tasks, setPage, setChatTargetUid } = useApp()
  const [settings, setSettings] = useState(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState(settings)
  const [hubOpen, setHubOpen] = useState(false)

  // Tareas esperando mi aceptación
  const pendingAccept = tasks.filter(t => t.asignado === user.uid && t.pendingAcceptance)
  const notifCount = pendingAccept.length

  // Phases derived from settings
  const PHASES = {
    work:      { duration: settings.workMinutes * 60,      label: 'Trabajo',         emoji: '💪' },
    break:     { duration: settings.breakMinutes * 60,     label: 'Descanso corto',  emoji: '☕' },
    longBreak: { duration: settings.longBreakMinutes * 60, label: 'Descanso largo',  emoji: '🎉' },
  }

  const saved = loadState()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState(saved?.phase || 'work')
  const [timeLeft, setTimeLeft] = useState(() => {
    if (saved?.phase && saved?.timeLeft != null) return saved.timeLeft
    return settings.workMinutes * 60
  })
  const [running, setRunning] = useState(false)
  const [sessions, setSessions] = useState(saved?.sessions || 0)
  const intervalRef = useRef(null)

  useEffect(() => { saveState({ phase, timeLeft, sessions }) }, [phase, timeLeft, sessions])

  const notify = useCallback((title, body) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: '/logo.svg' })
      } catch (e) { /* no soportado en móvil */ }
    }
  }, [])

  const advancePhase = useCallback((currentPhase, currentSessions) => {
    let nextPhase, nextSessions = currentSessions
    if (currentPhase === 'work') {
      nextSessions = currentSessions + 1
      nextPhase = nextSessions % 4 === 0 ? 'longBreak' : 'break'
      notify(
        nextPhase === 'longBreak' ? `🎉 ¡Descanso largo! ${settings.longBreakMinutes} min` : `☕ ¡Descanso! ${settings.breakMinutes} min`,
        '¡Buen trabajo! Tómate un respiro.'
      )
    } else {
      nextPhase = 'work'
      notify('💪 ¡De vuelta al trabajo!', `${settings.workMinutes} min de concentración`)
    }
    setSessions(nextSessions)
    setPhase(nextPhase)
    setTimeLeft(PHASES[nextPhase].duration)
    setRunning(false)
  }, [notify, settings, PHASES])

  useEffect(() => {
    if (!running) { clearInterval(intervalRef.current); return }
    intervalRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(intervalRef.current); advancePhase(phase, sessions); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(intervalRef.current)
  }, [running, phase, sessions, advancePhase])

  const handleStartStop = () => {
    if (!running && timeLeft === 0) { setTimeLeft(PHASES[phase].duration); setRunning(true) }
    else setRunning(r => !r)
  }
  const handleReset = () => { setRunning(false); setTimeLeft(PHASES[phase].duration) }
  const handleSkip = () => { setRunning(false); advancePhase(phase, sessions) }
  const handlePhaseSelect = (p) => { setRunning(false); setPhase(p); setTimeLeft(PHASES[p].duration) }

  const handleSaveSettings = () => {
    const s = {
      workMinutes: Math.max(1, Math.min(120, parseInt(settingsForm.workMinutes) || 40)),
      breakMinutes: Math.max(1, Math.min(60, parseInt(settingsForm.breakMinutes) || 10)),
      longBreakMinutes: Math.max(1, Math.min(60, parseInt(settingsForm.longBreakMinutes) || 15)),
    }
    setSettings(s)
    saveSettings(s)
    setPhase('work')
    setTimeLeft(s.workMinutes * 60)
    setRunning(false)
    setShowSettings(false)
  }

  const total = PHASES[phase].duration
  const pct = timeLeft / total
  const R = 44, C = 2 * Math.PI * R
  const dashOffset = C * (1 - pct)

  const phaseColors = { work: 'var(--purple)', break: 'var(--success)', longBreak: 'var(--info)' }
  const phaseColor = phaseColors[phase]

  return (
    <div className="pomodoro-float">
      {!open ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          {/* Menú desplegable del hub */}
          {hubOpen && (
            <div className="fab-menu">
              <button className="fab-option" onClick={() => { setOpen(true); setHubOpen(false) }}>
                <span className="fab-emoji"><Icon name="hourglass" size={17} /></span>
                Pomodoro
                {running && (
                  <span style={{ fontFamily: 'Space Mono', fontSize: 11, color: phaseColor }}>
                    {fmtTime(timeLeft)}
                  </span>
                )}
              </button>
              <button className="fab-option" onClick={() => { setPage('dashboard'); setHubOpen(false) }}>
                <span className="fab-emoji"><Icon name="bell" size={17} /></span>
                Notificaciones
                {pendingAccept.length > 0 && <span className="fab-badge">{pendingAccept.length}</span>}
              </button>
            </div>
          )}

          {/* Botón principal del hub */}
          <button
            className={`pomodoro-mini ${running ? 'running' : ''}`}
            onClick={() => setHubOpen(v => !v)}
            title="Menú rápido"
            style={{ fontSize: 22, position: 'relative' }}
          >
            <Icon name={hubOpen ? 'x' : 'hourglass'} size={22} />
            {!hubOpen && notifCount > 0 && (
              <span className="fab-badge">{notifCount}</span>
            )}
            {!hubOpen && running && notifCount === 0 && (
              <span style={{
                position: 'absolute', top: -8, right: -4,
                fontSize: 9, fontFamily: 'Space Mono',
                background: 'var(--card)', color: phaseColor,
                border: `1px solid ${phaseColor}`,
                borderRadius: 4, padding: '1px 4px', whiteSpace: 'nowrap'
              }}>
                {fmtTime(timeLeft)}
              </span>
            )}
          </button>
        </div>
      ) : (
        <div className="pomodoro-panel">
          {/* Header */}
          <div className="pomodoro-panel-header">
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Icon name="hourglass" size={14} /> Pomodoro
              </div>
              <div className="pomodoro-phase-label">{PHASES[phase].label}</div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="icon-btn" style={{ width: 26, height: 26 }}
                onClick={() => { setShowSettings(s => !s) }} title="Configurar"><Icon name="gear" size={13} /></button>
              <button className="icon-btn" style={{ width: 26, height: 26 }}
                onClick={() => setOpen(false)}><Icon name="x" size={13} /></button>
            </div>
          </div>

          {/* Settings panel */}
          {showSettings && (
            <div style={{ background: 'var(--bg-2)', borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 10 }}>
                Configurar tiempos (minutos)
              </p>
              {[
                { key: 'workMinutes', label: '💪 Trabajo', min: 1, max: 120 },
                { key: 'breakMinutes', label: '☕ Descanso corto', min: 1, max: 60 },
                { key: 'longBreakMinutes', label: '🎉 Descanso largo', min: 1, max: 60 },
              ].map(f => (
                <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <label style={{ fontSize: 12, flex: 1, color: 'var(--text-2)' }}>{f.label}</label>
                  <input
                    type="number"
                    min={f.min} max={f.max}
                    value={settingsForm[f.key]}
                    onChange={e => setSettingsForm(s => ({ ...s, [f.key]: e.target.value }))}
                    className="form-input"
                    style={{ width: 60, padding: '4px 8px', textAlign: 'center' }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>min</span>
                </div>
              ))}
              <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={handleSaveSettings}>
                Guardar y reiniciar
              </button>
            </div>
          )}

          {/* Phase tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
            {Object.entries(PHASES).map(([id, p]) => (
              <button key={id} onClick={() => handlePhaseSelect(id)}
                style={{
                  flex: 1, fontSize: 10.5, padding: '4px 2px',
                  borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: phase === id ? phaseColors[id] : 'var(--card-2)',
                  color: phase === id ? '#fff' : 'var(--text-3)',
                  fontWeight: phase === id ? 700 : 400, transition: 'all 0.2s',
                }}>
                {p.label}
              </button>
            ))}
          </div>

          {/* Clock ring */}
          <div className="pomodoro-clock">
            <svg className="pomodoro-ring" width="110" height="110" viewBox="0 0 110 110">
              <circle cx="55" cy="55" r={R} fill="none" stroke="var(--border)" strokeWidth="6" />
              <circle cx="55" cy="55" r={R} fill="none" stroke={phaseColor} strokeWidth="6"
                strokeLinecap="round" strokeDasharray={C} strokeDashoffset={dashOffset}
                transform="rotate(-90 55 55)" style={{ transition: 'stroke-dashoffset 1s linear' }} />
              <text x="55" y="52" textAnchor="middle" dominantBaseline="middle"
                fill="var(--text)" fontSize="22" fontWeight="700" fontFamily="Space Mono, monospace">
                {fmtTime(timeLeft)}
              </text>
              <text x="55" y="70" textAnchor="middle" dominantBaseline="middle"
                fill="var(--text-3)" fontSize="9">
                {PHASES[phase].emoji} {PHASES[phase].label}
              </text>
            </svg>
          </div>

          {/* Session dots */}
          <div className="pomodoro-sessions">
            {[0,1,2,3].map(i => (
              <div key={i} className={`session-dot ${i < (sessions % 4) ? 'done' : ''}`} />
            ))}
            <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 6, fontFamily: 'Space Mono' }}>
              {sessions} sesiones
            </span>
          </div>

          {/* Controls */}
          <div className="pomodoro-controls" style={{ marginTop: 12 }}>
            <button className={`btn btn-sm ${running ? 'btn-secondary' : 'btn-primary'}`}
              onClick={handleStartStop}
              style={{ flex: 2, justifyContent: 'center', background: running ? 'var(--card-2)' : phaseColor }}>
              <Icon name={running ? 'pause' : timeLeft === 0 ? 'reset' : 'play'} size={13} />
              {running ? ' Pausar' : timeLeft === 0 ? ' Reiniciar' : ' Iniciar'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleReset} title="Reiniciar"><Icon name="reset" size={13} /></button>
            <button className="btn btn-secondary btn-sm" onClick={handleSkip} title="Saltar fase"><Icon name="skip" size={13} /></button>
          </div>

          <div style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'center', marginTop: 10 }}>
            {settings.workMinutes}min trabajo · {settings.breakMinutes}min descanso · {settings.longBreakMinutes}min largo
          </div>
        </div>
      )}
    </div>
  )
}
