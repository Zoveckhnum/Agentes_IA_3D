import React, { useState } from 'react'
import { changePassword } from '../data/sql-auth.js'
export default function PasswordChangePage({ onLogout }) {
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    if (password !== confirmation) { setError('Las contraseñas no coinciden.'); return }
    setBusy(true); setError('')
    try { await changePassword(password) } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  return <div className="login-page"><div className="login-card">
    <h1 className="login-title">Protege tu cuenta</h1>
    <p className="login-sub">Elige una contraseña nueva de al menos 12 caracteres. Después vuelve a iniciar sesión.</p>
    <form className="login-form" onSubmit={submit}>
      <label className="form-label" htmlFor="new-password">Nueva contraseña</label>
      <input id="new-password" className="form-input" type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
      <label className="form-label" htmlFor="confirm-password">Confirmar contraseña</label>
      <input id="confirm-password" className="form-input" type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} />
      {error && <p role="alert" className="login-error">{error}</p>}
      <button type="submit" className="google-btn" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
      <button type="button" className="btn btn-secondary" onClick={onLogout} disabled={busy}>Cerrar sesión</button>
    </form>
  </div></div>
}
