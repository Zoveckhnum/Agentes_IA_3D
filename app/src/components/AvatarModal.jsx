import React, { useState } from 'react'
import { db } from '../firebase.js'
import { doc, updateDoc } from '../data/firestore.js'
import Icon from './Icons.jsx'
import LookEditor, { userLook } from './LookEditor.jsx'

// Personalizar el avatar 3D de una persona del equipo (la propia o, para administradores, la de cualquiera)
export default function AvatarModal({ person, onClose, showToast }) {
  const [look, setLook] = useState(() => ({ arms: userLook(person).torso, skin: '#f6c445', accent: '#ffd23f', emblem: '', ...userLook(person) }))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    const clean = { ...look }
    if (!clean.emblem) delete clean.emblem
    if (!clean.lipstick) delete clean.lipstick
    try {
      await updateDoc(doc(db, 'users', person.uid), { look: clean })
      showToast('Avatar actualizado')
      onClose()
    } catch (e) {
      console.error(e)
      showToast('No se pudo guardar el avatar', 'error')
    }
    setSaving(false)
  }

  const reset = async () => {
    if (!confirm('¿Volver al avatar automático?')) return
    try {
      await updateDoc(doc(db, 'users', person.uid), { look: null })
      showToast('Avatar restablecido')
      onClose()
    } catch { showToast('No se pudo restablecer', 'error') }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h2 className="modal-title">Avatar 3D de {person.name?.split(' ')[0] || 'la persona'}</h2>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '0 0 12px' }}>
          Así aparece en la Oficina. Elige peinado, tono de piel y colores de la ropa.
        </p>
        <LookEditor look={look} onChange={setLook} />
        <div className="modal-footer">
          {person.look && <button className="btn btn-ghost" onClick={reset} style={{ marginRight: 'auto' }}>Restablecer</button>}
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Guardando...' : 'Guardar avatar'}</button>
        </div>
      </div>
    </div>
  )
}
