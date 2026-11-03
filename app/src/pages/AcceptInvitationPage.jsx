import React, { useState } from 'react'
import { request } from '../data/sql-auth.js'
export default function AcceptInvitationPage({ email, token, onComplete }) {
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    if (password !== confirmation) { setError('Las contraseñas no coinciden.'); return }
    setBusy(true); setError('')
    try { await request('/auth/register', { method: 'POST', body: { email, token, password } }); onComplete() } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  return <div className="login-page"><div className="login-card">
    <h1 className="login-title">Activa tu cuenta</h1><p className="login-sub">{email}</p>
    <form className="login-form" onSubmit={submit}>
      <label className="form-label" htmlFor="invite-password">Contraseña de al menos 12 caracteres</label>
      <input id="invite-password" className="form-input" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
      <label className="form-label" htmlFor="invite-confirmation">Confirmar contraseña</label>
      <input id="invite-confirmation" className="form-input" type="password" autoComplete="new-password" required value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} />
      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="google-btn" type="submit" disabled={busy}>{busy ? 'Activando…' : 'Activar cuenta'}</button>
    </form>
  </div></div>
}
