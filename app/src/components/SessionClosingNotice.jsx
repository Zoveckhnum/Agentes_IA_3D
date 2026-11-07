import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

export const SESSION_CLOSING_MS = 3000

export default function SessionClosingNotice({ purpose, email, onContinue }) {
  const dialog = useRef(null)
  const id = useId()
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => { if (element.open) element.close() }
  }, [])
  return createPortal(
    <dialog ref={dialog} className="session-closing-notice" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      style={{ '--session-closing-duration': `${SESSION_CLOSING_MS}ms` }} onCancel={event => { event.preventDefault(); onContinue() }}>
      <svg className="session-closing-check" width="60" height="60" viewBox="0 0 60 60" fill="none" aria-hidden="true">
        <circle cx="30" cy="30" r="27" stroke="currentColor" strokeWidth="2" opacity="0.25" />
        <path d="M18 30l8 8 16-17" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength="1" />
      </svg>
      <div role="status" aria-live="polite" aria-atomic="true">
        <h2 id={`${id}-title`}>{purpose === 'email' ? 'Correo actualizado' : 'Contraseña actualizada'}</h2>
        <p className="session-closing-status">Cerrando tu sesión de forma segura…</p>
      </div>
      <p id={`${id}-description`} className="session-closing-description">{purpose === 'email' ? 'Vuelve a iniciar sesión con tu nuevo correo:' : 'Vuelve a iniciar sesión con tu nueva contraseña:'}<strong>{email}</strong></p>
      <div className="session-closing-progress" aria-hidden="true" />
      <button type="button" className="btn btn-primary" onClick={onContinue} autoFocus>Ir al inicio de sesión</button>
    </dialog>, document.body,
  )
}
