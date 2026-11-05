import React, { useEffect, useRef, useState } from 'react'
import { requestSecurityCode, changePassword, changeLoginEmail } from '../data/sql-auth.js'
import SessionClosingNotice, { SESSION_CLOSING_MS } from './SessionClosingNotice.jsx'

export default function AccountSecurity({ email, forced = false }) {
  const [purpose, setPurpose] = useState(forced ? 'password' : '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('')
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState(''), [currentCode, setCurrentCode] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [closing, setClosing] = useState(false)
  const closingTimer = useRef(null), closingResolve = useRef(null)
  useEffect(() => () => { clearTimeout(closingTimer.current); closingResolve.current?.() }, [])
  function continueToLogin() {
    clearTimeout(closingTimer.current)
    closingResolve.current?.()
    closingResolve.current = null
  }
  function showConfirmation() {
    return new Promise(resolve => {
      closingResolve.current = resolve
      setClosing(true)
      closingTimer.current = setTimeout(continueToLogin, SESSION_CLOSING_MS)
    })
  }
  const prefix = forced ? 'required-security' : 'account-security'
  useEffect(() => {
    if (seconds <= 0) return
    const timer = setTimeout(() => setSeconds(value => Math.max(0, value - 1)), 1000)
    return () => clearTimeout(timer)
  }, [seconds])
  function choose(value) {
    setPurpose(value); setChallenge(null); setError(''); setCode(''); setCurrentCode('')
    setPassword(''); setConfirmation(''); setCurrentPassword(''); setNewEmail('')
  }
  async function send(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await requestSecurityCode({ purpose, currentPassword, ...(purpose === 'email' ? { email: newEmail } : {}) })
      setChallenge(result); setCurrentPassword(''); setSeconds(60)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  async function confirm(event) {
    event.preventDefault(); setError('')
    if (purpose === 'password' && password !== confirmation) { setError('Las contraseñas no coinciden.'); return }
    setBusy(true)
    try {
      const verification = { id: challenge.id, code, ...(challenge.requiresCurrentCode ? { currentCode } : {}) }
      if (purpose === 'email') await changeLoginEmail(verification, showConfirmation)
      else await changePassword(password, verification, showConfirmation)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  function input(label, suffix, value, setter, attributes = {}) {
    return <div className="form-group"><label className="form-label" htmlFor={`${prefix}-${suffix}`}>{label}</label>
      <input id={`${prefix}-${suffix}`} className="form-input" required value={value} onChange={e => setter(e.target.value)} {...attributes} /></div>
  }
  const fields = { border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: 14 }
  const codeAttributes = { inputMode: 'numeric', pattern: '[0-9]{8}', minLength: 8, maxLength: 8 }
  return <section aria-labelledby={`${prefix}-title`}>
    {closing && <SessionClosingNotice purpose={purpose} email={purpose === 'email' ? challenge.destination : email} onContinue={continueToLogin} />}
    <h2 id={`${prefix}-title`} style={{ fontSize: 18, marginBottom: 8 }}>{forced ? 'Verifica tu correo y cambia la contraseña' : 'Acceso y seguridad'}</h2>
    <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16, overflowWrap: 'anywhere' }}>Correo de acceso actual: {email}</p>
    {!forced && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
      <button type="button" className="btn btn-secondary" aria-pressed={purpose === 'email'} disabled={busy} onClick={() => choose('email')}>Cambiar correo de acceso</button>
      <button type="button" className="btn btn-secondary" aria-pressed={purpose === 'password'} disabled={busy} onClick={() => choose('password')}>Cambiar contraseña</button>
    </div>}
    {purpose && <>
      <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>{purpose === 'email'
        ? email?.toLowerCase().endsWith('.local')
          ? 'Configuración inicial de la cuenta de prueba: confirma tu contraseña actual y verifica el correo real autorizado. Tus tareas y permisos se conservan.'
          : 'Confirma tu contraseña actual. Enviaremos un código al correo actual y otro al nuevo. Tus tareas y permisos se conservan.'
        : 'Confirma tu contraseña actual. Enviaremos un código a tu correo de acceso para autorizar la nueva contraseña.'}</p>
      {!challenge ? <form onSubmit={send}>
        <fieldset disabled={busy} style={fields}>
          {purpose === 'email' && input('Nuevo correo de acceso', 'email', newEmail, setNewEmail, { type: 'email', autoComplete: 'email', maxLength: 320 })}
          {input('Contraseña actual', 'current-password', currentPassword, setCurrentPassword, { type: 'password', autoComplete: 'current-password', maxLength: 256 })}
          <button className="btn btn-primary" type="submit" disabled={busy || seconds > 0}>{busy ? 'Enviando…' : seconds > 0 ? `Solicitar otro código en ${seconds} s` : purpose === 'email' ? 'Enviar códigos' : 'Enviar código'}</button>
        </fieldset>
      </form> : <form onSubmit={confirm}>
        <p role="status" style={{ fontSize: 13, overflowWrap: 'anywhere', marginBottom: 16 }}>Código enviado a {challenge.destination}{challenge.requiresCurrentCode ? ` y a ${email}` : ''}. Revisa también la carpeta de spam. Vence en 10 minutos.</p>
        <fieldset disabled={busy} style={fields}>
          {challenge.requiresCurrentCode && input('Código enviado a tu correo actual', 'current-code', currentCode, setCurrentCode, { ...codeAttributes, autoComplete: 'off' })}
          {input(purpose === 'email' ? 'Código enviado al correo nuevo' : 'Código de verificación', 'code', code, setCode, { ...codeAttributes, autoComplete: 'one-time-code' })}
          {purpose === 'password' && <>
            {input('Nueva contraseña (al menos 12 caracteres)', 'new-password', password, setPassword, { type: 'password', autoComplete: 'new-password', minLength: 12, maxLength: 256 })}
            {input('Confirmar nueva contraseña', 'confirm-password', confirmation, setConfirmation, { type: 'password', autoComplete: 'new-password', minLength: 12, maxLength: 256 })}
          </>}
          <p style={{ fontSize: 13, color: 'var(--text-2)' }}>Al confirmar, se cerrarán tus sesiones. Vuelve a entrar con los nuevos datos.</p>
          <button className="btn btn-primary" type="submit">{busy ? 'Confirmando…' : purpose === 'email' ? 'Confirmar cambio de correo' : 'Confirmar nueva contraseña'}</button>
          <button className="btn btn-secondary" type="button" onClick={() => choose(purpose)}>Solicitar códigos nuevos</button>
        </fieldset>
      </form>}
      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
    </>}
  </section>
}
