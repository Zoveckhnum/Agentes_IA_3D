import React, { useState } from 'react'
import { BRAND } from '../config.js'
import { APP_VERSION } from '../App.jsx'
import { useEmulators } from '../firebase.js'

export default function LoginPage({ onLogin, theme }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    setError('')
    setSubmitting(true)
    try { await onLogin({ email, password, remember }) }
    catch (failure) { setError(failure.message || 'No se pudo iniciar sesión. Vuelve a intentarlo.') }
    finally { setSubmitting(false) }
  }

  return (
    <div className="login-page" data-theme={theme || 'dark'}>
      <div className="login-card">
        {/* Logo según tema */}
        <div style={{ marginBottom: 24 }}>
          <img
            src={theme === 'light' ? BRAND.logo : BRAND.logoDark}
            alt={BRAND.company}
            style={{ height: 52, objectFit: 'contain', maxWidth: '100%' }}
            onError={e => {
              e.target.style.display = 'none'
              e.target.nextSibling.style.display = 'flex'
            }}
          />
          {/* Fallback si no carga la imagen */}
          <div style={{
            display: 'none', width: 56, height: 56, borderRadius: 14,
            background: 'var(--purple)', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, fontWeight: 900, color: '#fff', margin: '0 auto'
          }}>E</div>
        </div>

        <h1 className="login-title">{BRAND.appName}</h1>
        <p className="login-sub">
          Tu equipo y tus agentes de IA · {BRAND.company}<br />
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Versión {APP_VERSION}</span>
        </p>

        <form onSubmit={handleSubmit} className="login-form" aria-busy={submitting}>
          {useEmulators && <>
            <div className="form-group">
              <label className="form-label" htmlFor="login-email">Correo electrónico</label>
              <input id="login-email" className="form-input" type="email" name="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} disabled={submitting} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="login-password">Contraseña</label>
              <input id="login-password" className="form-input" type="password" name="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={submitting} />
            </div>
            <label className="login-remember">
              <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} disabled={submitting} />
              Mantener sesión en este navegador
            </label>
          </>}
          {error && <p className="login-error" role="alert">{error}</p>}
        <button className="google-btn" type="submit" disabled={submitting}>
          {!useEmulators && <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>}
          {submitting ? 'Iniciando sesión…' : useEmulators ? 'Iniciar sesión' : 'Continuar con Google'}
        </button>
        </form>

        {useEmulators && <details className="login-demo">
          <summary>Credenciales de demostración</summary>
          <p>Correo: <code>admin@oficina.local</code><br />Contraseña: <code>solo-emulador-local</code></p>
          <p>Cuenta compartida de prueba. Puedes cambiar tu nombre en Mi Perfil.</p>
        </details>}

        <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 24, lineHeight: 1.5 }}>
          {useEmulators ? 'Entorno local de prueba · Los datos se guardan en este equipo.' : <>
            Acceso restringido al equipo de {BRAND.company}.<br />
            Tu cuenta requiere aprobación del administrador.
          </>}
        </p>
      </div>
    </div>
  )
}
