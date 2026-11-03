import React, { useState, useRef, useEffect } from 'react'
import { db } from '../firebase.js'
import { doc, updateDoc, addDoc, collection, serverTimestamp } from '../data/firestore.js'
import Icon from './Icons.jsx'
import LookEditor, { DEFAULT_LOOK } from './LookEditor.jsx'
import CATALOGO from '../../../roles/catalogo.json'
import RoleCapabilities from './RoleCapabilities.jsx'
import { normalizeAgentPhotoUrl, loadAgentPhoto, resizeAgentPhoto } from '../utils/agent-photo.js'

export { STYLES } from './LookEditor.jsx'

// Avatar 2D del agente: su foto, o un círculo con su color e inicial
export function AgentAvatar({ agent, size = 40 }) {
  const [failedPhoto, setFailedPhoto] = useState(null)
  const color = agent?.look?.torso || '#4700E0'
  if (agent?.photo && failedPhoto !== agent.photo) {
    return <img src={agent.photo} alt={agent.name} referrerPolicy="no-referrer" onError={() => setFailedPhoto(agent.photo)} className="agent-avatar" style={{ width: size, height: size }} />
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
  const [photoLink, setPhotoLink] = useState(agent?.photo?.startsWith('https://') ? agent.photo : '')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState(null)
  const [photoNotice, setPhotoNotice] = useState('')
  const fileRef = useRef(null)
  const photoController = useRef(null)
  useEffect(() => () => photoController.current?.abort(), [])

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
    const controller = new AbortController()
    photoController.current?.abort()
    photoController.current = controller
    setPhotoBusy(true); setPhotoError(null); setPhotoNotice('')
    try {
      const photo = await resizeAgentPhoto(file, { signal: controller.signal })
      setForm(f => ({ ...f, photo }))
      setPhotoLink(''); setPhotoNotice('Foto preparada. Guarda los cambios para aplicarla.')
    } catch (error) {
      if (error.name !== 'AbortError') setPhotoError({ source: 'file', message: error.message })
    } finally { if (photoController.current === controller) setPhotoBusy(false) }
  }

  const usePhotoLink = async () => {
    const controller = new AbortController()
    photoController.current?.abort()
    photoController.current = controller
    setPhotoBusy(true); setPhotoError(null); setPhotoNotice('')
    try {
      const photo = normalizeAgentPhotoUrl(photoLink)
      await loadAgentPhoto(photo, { signal: controller.signal })
      setForm(f => ({ ...f, photo }))
      setPhotoLink(photo); setPhotoNotice('Vista previa lista. Guarda los cambios para aplicarla.')
      return photo
    } catch (error) {
      if (error.name !== 'AbortError') setPhotoError({ source: 'link', message: error.message })
      return null
    } finally { if (photoController.current === controller) setPhotoBusy(false) }
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.role.trim()) { showToast('Nombre y especialidad son obligatorios', 'error'); return }
    setSaving(true)
    let photo = form.photo || ''
    if (photoLink.trim() && photoLink.trim() !== photo) {
      photo = await usePhotoLink()
      if (photo === null) { setSaving(false); return }
    }
    const look = { ...form.look }
    if (!look.emblem) delete look.emblem
    const data = {
      name: form.name.trim(), role: form.role.trim(), bio: form.bio.trim(),
      rol: form.rol || 'personalizado', ...(CATALOGO.roles[form.rol]?.coordinador ? { kind: 'coordinador' } : {}),
      mission: form.mission.trim(), photo, look,
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
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="agent-modal-title" style={{ maxWidth: 540 }}>
        <div className="modal-header">
          <h2 id="agent-modal-title" className="modal-title">{agent ? `Editar: ${agent.name}` : 'Nuevo agente'}</h2>
          <button className="icon-btn" aria-label="Cerrar editor de agente" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Foto de perfil */}
          <div className="agent-photo-row">
            <AgentAvatar agent={{ ...form, look: form.look }} size={72} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, flex: 1 }}>
              <span className="form-label" style={{ margin: 0 }}>Foto de perfil</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary btn-sm" disabled={photoBusy || saving} onClick={() => fileRef.current?.click()}>
                  <Icon name="download" size={12} /> {form.photo ? 'Cambiar foto' : 'Subir foto'}
                </button>
                {form.photo && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={photoBusy || saving} onClick={() => { setForm(f => ({ ...f, photo: '' })); setPhotoLink(''); setPhotoError(null); setPhotoNotice('Foto quitada. Guarda los cambios para aplicarlo.') }}>
                    Quitar
                  </button>
                )}
              </div>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>JPG, PNG o WebP, hasta 8 MB. El archivo se recorta a una foto cuadrada.</span>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Archivo de foto del agente" hidden onChange={pickPhoto} />
              <label className="form-label" htmlFor="agent-photo-url" style={{ margin: '4px 0 0' }}>O usa un enlace de imagen</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <input id="agent-photo-url" className="form-input" type="url" inputMode="url" placeholder="https://ejemplo.com/foto.jpg" value={photoLink}
                  style={{ flex: '1 1 180px', minWidth: 0, minHeight: 44 }} disabled={photoBusy || saving}
                  aria-invalid={photoError?.source === 'link' ? true : undefined}
                  aria-describedby={`agent-photo-help${photoError ? ' agent-photo-error' : ''}`}
                  onChange={e => { setPhotoLink(e.target.value); setPhotoError(null); setPhotoNotice('') }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); usePhotoLink() } }} />
                <button type="button" className="btn btn-secondary btn-sm" style={{ minHeight: 44 }} disabled={photoBusy || saving || !photoLink.trim()} onClick={usePhotoLink}>Ver imagen</button>
              </div>
              <span id="agent-photo-help" style={{ fontSize: 12, color: 'var(--text-2)' }}>Usa un enlace directo HTTPS a una imagen pública. También puedes pegarlo y pulsar Guardar.</span>
              {photoError && <span id="agent-photo-error" role="alert" style={{ fontSize: 12, color: 'var(--danger)' }}>{photoError.message}</span>}
              <span role="status" style={{ fontSize: 12, color: 'var(--text-2)' }}>{photoBusy ? 'Comprobando imagen…' : photoNotice}</span>
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
              Concreta el trabajo de este agente sin sustituir las actividades ni los límites de su rol.
            </span>
          </div>
          <div className="form-group">
            <RoleCapabilities role={CATALOGO.roles[form.rol || 'personalizado']} />
          </div>
          <div className="form-group">
            <label className="form-label">Personaje en la Oficina 3D</label>
            <LookEditor look={form.look} onChange={look => setForm(f => ({ ...f, look }))} showLipstick={false} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || photoBusy}>{saving ? 'Guardando...' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  )
}
