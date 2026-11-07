import React from 'react'
import { auth } from '../data/sql-auth.js'
import AccountSecurity from '../components/AccountSecurity.jsx'
export default function PasswordChangePage({ onLogout }) {
  return <div className="login-page"><div className="login-card">
    <h1 className="login-title">Protege tu cuenta</h1>
    <AccountSecurity email={auth.currentUser?.email} forced />
    <button type="button" className="btn btn-secondary" onClick={onLogout} style={{ marginTop: 16 }}>Cerrar sesión</button>
  </div></div>
}
