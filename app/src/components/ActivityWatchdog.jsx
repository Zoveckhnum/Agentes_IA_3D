import React, { useState, useEffect, useRef } from 'react'
import { useApp } from '../App.jsx'
import { db } from '../firebase.js'
import { doc, updateDoc, serverTimestamp } from '../data/firestore.js'
import { logWork } from '../utils/worklog.js'
import Icon from './Icons.jsx'

const CHECK_INTERVAL_MS = 45 * 60 * 1000  // popup cada 45 minutos de trabajo continuo
const RESPONSE_TIMEOUT_S = 5 * 60         // 5 min para responder antes de dejarla en pausa
const MUTE_KEY = 'watchdog_muted'

export function isMuted() {
  return localStorage.getItem(MUTE_KEY) === '1'
}

function beep() {
  if (isMuted()) return
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.start(); osc.stop(ctx.currentTime + 0.6)
    // doble tono
    setTimeout(() => {
      const o2 = ctx.createOscillator(); const g2 = ctx.createGain()
      o2.connect(g2); g2.connect(ctx.destination)
      o2.frequency.value = 660
      g2.gain.setValueAtTime(0.25, ctx.currentTime)
      g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
      o2.start(); o2.stop(ctx.currentTime + 0.6)
    }, 400)
  } catch (e) { /* sin audio */ }
}

export default function ActivityWatchdog() {
  const { user, tasks, showToast, sendNotification } = useApp()
  const [prompting, setPrompting] = useState(null) // task siendo verificada
  const [countdown, setCountdown] = useState(RESPONSE_TIMEOUT_S)
  const [muted, setMuted] = useState(isMuted())

  const toggleMute = () => {
    const next = !muted
    localStorage.setItem(MUTE_KEY, next ? '1' : '0')
    setMuted(next)
  }
  const lastConfirmRef = useRef({}) // taskId -> timestamp de última confirmación
  const countdownRef = useRef(null)

  const myActive = tasks.find(t =>
    t.asignado === user.uid &&
    t.estado === 'en_progreso' &&
    t.timerStartedAt &&
    !t.timerPaused
  )

  // Chequear cada minuto si toca preguntar.
  // Nota: al abrir el popup la tarea se pausa, así que myActive desaparece;
  // NO cerrar el popup en ese caso (espera la respuesta del empleado).
  useEffect(() => {
    if (!myActive) return
    const check = () => {
      const startMs = myActive.timerStartedAt?.toMillis?.() || (myActive.timerStartedAt?.seconds || 0) * 1000
      const lastConfirm = lastConfirmRef.current[myActive.id] || startMs
      if (Date.now() - lastConfirm >= CHECK_INTERVAL_MS && !prompting) {
        setPrompting(myActive)
        setCountdown(RESPONSE_TIMEOUT_S)
        beep()
        // El timer se PAUSA de inmediato al aparecer el popup: el tiempo de
        // decisión no se cuenta como trabajado. Solo se reanuda si confirma.
        pauseTimer(myActive)
        sendNotification('¿Sigues trabajando?', `Confirma que sigues en "${myActive.tarea}" para reanudar el timer`)
      }
    }
    check()
    const id = setInterval(check, 60000)
    return () => clearInterval(id)
  }, [myActive?.id, myActive?.timerStartedAt?.seconds, prompting])

  // Cuenta regresiva del popup → auto-pausa al agotarse
  useEffect(() => {
    if (!prompting) { clearInterval(countdownRef.current); return }
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(countdownRef.current)
          dismissPaused(prompting)
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(countdownRef.current)
  }, [prompting?.id])

  // Pausa inmediata: acumula el tiempo transcurrido hasta este momento
  const pauseTimer = async (task) => {
    try {
      const startMs = task.timerStartedAt?.toMillis?.() || (task.timerStartedAt?.seconds || 0) * 1000
      const elapsed = startMs ? Math.floor((Date.now() - startMs) / 1000) : 0
      await updateDoc(doc(db, 'tasks', task.id), {
        timerPaused: true,
        timerStartedAt: null,
        totalTimeSeconds: (task.totalTimeSeconds || 0) + elapsed,
        autoPausedAt: serverTimestamp(),
        lastEditedBy: user.email,
        lastEditedAt: serverTimestamp(),
      })
      logWork(task.asignado, elapsed)
    } catch (e) { console.error(e) }
  }

  // No respondió: la tarea queda en pausa y se le informa
  const dismissPaused = (task) => {
    setPrompting(null)
    delete lastConfirmRef.current[task.id]
    showToast('Timer pausado automáticamente por inactividad. Reactiva la tarea para continuar', 'warning')
    sendNotification('Timer pausado', `"${task.tarea}" quedó en pausa por falta de respuesta. Reactívala para continuar.`)
  }

  // Confirmó que sigue activo: reanudar el timer
  const handleConfirm = async (task) => {
    try {
      await updateDoc(doc(db, 'tasks', task.id), {
        timerPaused: false,
        timerStartedAt: serverTimestamp(),
        lastEditedBy: user.email,
        lastEditedAt: serverTimestamp(),
      })
      lastConfirmRef.current[task.id] = Date.now()
      setPrompting(null)
      showToast('Confirmado: el timer sigue corriendo', 'success')
    } catch (e) {
      console.error(e)
      showToast('No se pudo reanudar el timer', 'error')
    }
  }

  if (!prompting) return null

  const mins = Math.floor(countdown / 60)
  const secs = countdown % 60

  return (
    <div className="modal-overlay" style={{ zIndex: 800 }}>
      <div className="modal" style={{ maxWidth: 420, textAlign: 'center', position: 'relative' }}>
        <div style={{ color: 'var(--warning)', marginBottom: 12 }}>
          <Icon name="clock" size={44} />
        </div>
        <div style={{ position: 'absolute', top: 14, right: 14 }}>
          <button
            className="icon-btn"
            onClick={toggleMute}
            title={muted ? 'Activar sonido de notificación' : 'Silenciar sonido de notificación'}
            style={{ color: muted ? 'var(--text-3)' : 'var(--purple)' }}
          >
            <Icon name={muted ? 'volumeOff' : 'volume'} size={15} />
          </button>
        </div>
        <h2 style={{ fontSize: 19, fontWeight: 700, marginBottom: 8 }}>¿Sigues trabajando?</h2>
        <p style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 6 }}>
          Llevas más de 45 minutos con el timer corriendo en:
        </p>
        <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>"{prompting.tarea}"</p>

        <div style={{
          fontFamily: 'Space Mono', fontSize: 26, fontWeight: 700,
          color: countdown < 60 ? 'var(--danger)' : 'var(--warning)', marginBottom: 6
        }}>
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 20 }}>
          El timer ya está en pausa: este tiempo no cuenta como trabajado.
          Confirma para reanudarlo, o la tarea quedará pausada.
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => handleConfirm(prompting)} style={{ minWidth: 180 }}>
            <Icon name="check" size={15} /> Sí, sigo trabajando
          </button>
          <button className="btn btn-secondary" onClick={() => dismissPaused(prompting)}>
            <Icon name="pause" size={15} /> Dejar en pausa
          </button>
        </div>
      </div>
    </div>
  )
}
