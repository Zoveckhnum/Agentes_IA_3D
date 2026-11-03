import React, { useState, useRef } from 'react'
import { db } from '../firebase.js'
import { doc, updateDoc, addDoc, collection, serverTimestamp } from '../data/firestore.js'
import Icon from './Icons.jsx'
import LookEditor, { DEFAULT_LOOK } from './LookEditor.jsx'
import CATALOGO from '../../../roles/catalogo.json'

export { STYLES } from './LookEditor.jsx'

// Foto del agente: se recorta cuadrada y se guarda pequeña (JPG 256 px) dentro del documento del agente
function resizeImage(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagen no válida')) }
    img.src = url
  })
}

// Avatar 2D del agente: su foto, o un círculo con su color e inicial
export function AgentAvatar({ agent, size = 40 }) {
  const color = agent?.look?.torso || '#4700E0'
  if (agent?.photo) {
    return <img src={agent.photo} alt={agent.name} className="agent-avatar" style={{ width: size, height: size }} />
  }
  return (
    <span className="agent-avatar" style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}>
      {(agent?.name || '?').trim().charAt(0).toUpperCase()}
    </span>
  )
}

export default function AgentModal({ agent, nextOrder, onClose, showToast, userEmail }) {
  const [form, setForm] = useState({
    name: agent?.name || '',
    role: agent?.role || '',
    rol: agent?.rol || '',
    bio: agent?.bio || '',
    mission: agent?.mission || '',
    photo: agent?.photo || '',
    look: { ...DEFAULT_LOOK, ...(agent?.look || {}) },
  })
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  // Al elegir un rol se proponen especialidad y misión base (se pueden editar)
  const pickRol = (id) => setForm(f => {
    const r = CATALOGO.roles[id]
    if (!r) return { ...f, rol: id }
    const prev = CATALOGO.roles[f.rol]
    return {
      ...f, rol: id,
      role: !f.role || f.role === prev?.nombre ? r.nombre : f.role,
      mission: !f.mission || f.mission === prev?.mision ? r.mision : f.mission,
      bio: !f.bio || f.bio === prev?.descripcion ? r.descripcion : f.bio,
    }
  })

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) { showToast('Elige una imagen (JPG, PNG o WebP)', 'error'); return }
    try {
      const photo = await resizeImage(file)
      setForm(f => ({ ...f, photo }))
    } catch {
      showToast('No se pudo leer la imagen', 'error')
    }
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.role.trim()) { showToast('Nombre y especialidad son obligatorios', 'error'); return }
    setSaving(true)
    const look = { ...form.look }
    if (!look.emblem) delete look.emblem
    const data = {
      name: form.name.trim(), role: form.role.trim(), bio: form.bio.trim(),
      rol: form.rol || 'personalizado', ...(CATALOGO.roles[form.rol]?.coordinador ? { kind: 'coordinador' } : {}),
      mission: form.mission.trim(), photo: form.photo || '', look,
    }
    try {
      if (agent) {
        await updateDoc(doc(db, 'agents', agent.id), data)
        showToast('Agente actualizado')
      } else {
        await addDoc(collection(db, 'agents'), {
          ...data,
          active: false, order: nextOrder, breakUntil: null, breakType: null,
          createdAt: serverTimestamp(), createdBy: userEmail,
        })
        showToast(`${form.name} quedó en reserva. Actívalo cuando lo necesites`)
      }
      onClose()
    } catch (e) {
      console.error(e)
      showToast('No se pudo guardar el agente', 'error')
    }
    setSaving(false)
  }


  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 540 }}>
        <div className="modal-header">
          <h2 className="modal-title">{agent ? `Editar: ${agent.name}` : 'Nuevo agente'}</h2>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Foto de perfil */}
          <div className="agent-photo-row">
            <AgentAvatar agent={{ ...form, look: form.look }} size={72} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="form-label" style={{ margin: 0 }}>Foto de perfil</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="download" size={12} /> {form.photo ? 'Cambiar foto' : 'Subir foto'}
                </button>
                {form.photo && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm(f => ({ ...f, photo: '' }))}>
                    Quitar
                  </button>
                )}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Se recorta cuadrada. Se ve en Team, Pipeline y la Oficina.</span>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Rol (habilidades)</label>
            <select className="form-select" value={form.rol} onChange={e => pickRol(e.target.value)}>
              <option value="">Elige qué hará este agente…</option>
              {Object.entries(CATALOGO.roles).map(([id, r]) => <option key={id} value={id}>{r.nombre}</option>)}
            </select>
            {CATALOGO.roles[form.rol] && (
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {CATALOGO.roles[form.rol].descripcion}
                {CATALOGO.roles[form.rol].conectores?.length ? ` · Usa: ${CATALOGO.roles[form.rol].conectores.join(', ')}` : ''}
              </span>
            )}
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Nombre</label>
              <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej. Wanda Maximoff" autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">Especialidad</label>
              <input className="form-input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} placeholder="Ej. Creación de imágenes" />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Descripción corta</label>
            <input className="form-input" maxLength={140} value={form.bio}
              onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
              placeholder="Una línea que se muestra en su tarjeta" />
          </div>
          <div className="form-group">
            <label className="form-label">Misión e instrucciones</label>
            <textarea className="form-textarea" rows={5} value={form.mission}
              onChange={e => setForm(f => ({ ...f, mission: e.target.value }))}
              placeholder="Qué hace este agente, qué tono usa, qué entrega..." />
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
              Es lo que el agente lee antes de cada tarea: define cómo trabaja y qué entrega.
            </span>
          </div>
          <div className="form-group">
            <label className="form-label">Personaje en la Oficina 3D</label>
            <LookEditor look={form.look} onChange={look => setForm(f => ({ ...f, look }))} showLipstick={false} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}
