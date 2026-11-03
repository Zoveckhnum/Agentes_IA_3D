import React, { useState, useRef } from 'react'
import { useApp } from '../App.jsx'
import { db } from '../firebase.js'
import { doc, updateDoc } from '../data/firestore.js'

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })
}

function fmtHours(s) {
  if (!s) return '0h'
  return `${(s / 3600).toFixed(1)}h`
}

export default function ProfilePage() {
  const { user, userProfile, setUserProfile, tasks, showToast } = useApp()
  const [form, setForm] = useState({
    name: userProfile?.name || '',
    position: userProfile?.position || '',
    phone: userProfile?.phone || '',
    bio: userProfile?.bio || '',
    photo: userProfile?.photo || '',
  })
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [photoMode, setPhotoMode] = useState('url') // 'url' | 'upload'
  const fileInputRef = useRef(null)

  const myTasks = tasks.filter(t => t.asignado === user.uid)
  const done = myTasks.filter(t => t.estado === 'completada')
  const active = myTasks.filter(t => t.estado === 'en_progreso')
  const pending = myTasks.filter(t => t.estado === 'pendiente')
  const totalTime = done.reduce((a, t) => a + (t.totalTimeSeconds || 0), 0)
  const avgTime = done.filter(t => t.totalTimeSeconds > 0).length > 0
    ? totalTime / done.filter(t => t.totalTimeSeconds > 0).length : 0

  const setField = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true) }

  // Comprime la imagen a máx 512px JPEG antes de guardar.
  // Firestore limita cada documento a 1 MB — sin esto, fotos grandes
  // hacían fallar TODO el guardado del perfil (foto, nombre, tel y bio).
  const handleFileChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { showToast('La imagen es demasiado grande (máx 10 MB)', 'error'); return }
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX = 512
      let { width, height } = img
      if (width > height && width > MAX) { height = Math.round(height * MAX / width); width = MAX }
      else if (height > MAX) { width = Math.round(width * MAX / height); height = MAX }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      let quality = 0.8
      let dataUrl = canvas.toDataURL('image/jpeg', quality)
      // Garantizar < 700 KB para dejar margen al resto del documento
      while (dataUrl.length > 700 * 1024 && quality > 0.3) {
        quality -= 0.1
        dataUrl = canvas.toDataURL('image/jpeg', quality)
      }
      setField('photo', dataUrl)
      showToast('✓ Imagen lista para guardar')
    }
    img.onerror = () => { URL.revokeObjectURL(url); showToast('No se pudo leer la imagen', 'error') }
    img.src = url
  }

  const handleSave = async () => {
    if (!form.name.trim()) { showToast('El nombre no puede estar vacío', 'error'); return }
    setSaving(true)
    try {
      const updates = {
        name: form.name.trim(),
        position: form.position.trim(),
        phone: form.phone.trim(),
        bio: form.bio.trim(),
        photo: form.photo.trim(),
      }
      await updateDoc(doc(db, 'users', user.uid), updates)
      setUserProfile(p => ({ ...p, ...updates }))
      setDirty(false)
      showToast('Perfil actualizado ✓')
    } catch (e) {
      showToast('Error al guardar', 'error')
    }
    setSaving(false)
  }

  const displayPhoto = form.photo || userProfile?.photo

  return (
    <div style={{ maxWidth: 600 }}>
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Tu cuenta</span>
          <h1 className="page-title">Mi Perfil</h1>
          <p className="page-subtitle">Tu información visible para el equipo</p>
        </div>
      </div>

      {/* Profile header */}
      <div className="profile-header" style={{ marginBottom: 24 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {displayPhoto
            ? <img src={displayPhoto} alt="" className="profile-avatar" style={{ width: 72, height: 72 }}
                onError={e => { e.target.style.display = 'none' }} />
            : <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: userProfile?.color || '#4700E0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 28, fontWeight: 700, color: '#fff',
                border: '3px solid var(--purple)', flexShrink: 0
              }}>
                {(form.name || '?')[0].toUpperCase()}
              </div>
          }
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{form.name || userProfile?.name}</h2>
          <p style={{ fontSize: 13, margin: 0 }}>{userProfile?.email}</p>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className={`badge badge-${userProfile?.role}`}>
              {userProfile?.role === 'admin' ? '★ Admin' : userProfile?.role}
            </span>
            {form.position && (
              <span className="badge" style={{ background: 'var(--card-2)', color: 'var(--text-2)' }}>
                {form.position}
              </span>
            )}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '8px 0 0' }}>
            Miembro desde {fmtDate(userProfile?.createdAt)}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <span className="stat-icon">✅</span>
          <span className="stat-value" style={{ color: 'var(--success)' }}>{done.length}</span>
          <span className="stat-label">Completadas</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon">⚡</span>
          <span className="stat-value" style={{ color: 'var(--purple)' }}>{active.length}</span>
          <span className="stat-label">En progreso</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon">⏳</span>
          <span className="stat-value">{pending.length}</span>
          <span className="stat-label">Pendientes</span>
        </div>
        <div className="stat-card">
          <span className="stat-icon">⏱</span>
          <span className="stat-value">{fmtHours(avgTime)}</span>
          <span className="stat-label">Promedio/tarea</span>
        </div>
      </div>

      {/* Edit form */}
      <div className="card">
        <p className="section-title">Editar información</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Photo */}
          <div className="form-group">
            <label className="form-label">Foto de perfil</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                className={`btn btn-sm ${photoMode === 'url' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPhotoMode('url')}
              >URL</button>
              <button
                className={`btn btn-sm ${photoMode === 'upload' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPhotoMode('upload')}
              >Subir archivo</button>
            </div>
            {photoMode === 'url' ? (
              <input
                className="form-input"
                value={form.photo}
                onChange={e => setField('photo', e.target.value)}
                placeholder="https://... (URL de tu foto)"
              />
            ) : (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
                <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>
                  📁 Seleccionar imagen (se comprime automáticamente)
                </button>
                {form.photo?.startsWith('data:') && (
                  <span style={{ fontSize: 12, color: 'var(--success)', marginLeft: 10 }}>✓ Imagen cargada</span>
                )}
              </div>
            )}
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Nombre completo</label>
              <input className="form-input" value={form.name}
                onChange={e => setField('name', e.target.value)} placeholder="Tu nombre" />
            </div>
            <div className="form-group">
              <label className="form-label">Cargo / Posición</label>
              <input className="form-input" value={form.position}
                onChange={e => setField('position', e.target.value)}
                placeholder="Ej. Diseñadora, Community Manager..." />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Teléfono</label>
            <input className="form-input" value={form.phone}
              onChange={e => setField('phone', e.target.value)}
              placeholder="+1 (xxx) xxx-xxxx" type="tel" />
          </div>

          <div className="form-group">
            <label className="form-label">Bio</label>
            <textarea className="form-textarea" value={form.bio}
              onChange={e => setField('bio', e.target.value)}
              placeholder="Cuéntanos un poco sobre ti..." rows={3} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={handleSave} disabled={!dirty || saving}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
