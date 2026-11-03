import React from 'react'
import SOURCES from '../../../roles/skills.index.json'

export default function RoleCapabilities({ role }) {
  if (!role?.skills?.length) return null
  const sections = [
    ['Actividades', role.actividades], ['Entregables', role.entregables],
    ['Cómo se acepta la entrega', role.criteriosAceptacion],
    ['Límites del rol', role.limites], ['Qué necesita para trabajar', role.requisitos],
  ]
  return (
    <details style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Actividades y habilidades de {role.nombre}</summary>
      <p>{role.mision}</p>
      {sections.map(([label, items]) => (
        <div key={label} style={{ marginTop: 10 }}>
          <strong>{label}</strong>
          <ul style={{ paddingLeft: 20, margin: '6px 0' }}>{items.map(item => <li key={item}>{item}</li>)}</ul>
        </div>
      ))}
      <strong>Habilidades de skills.sh</strong>
      <ul style={{ paddingLeft: 20, margin: '6px 0' }}>
        {role.skills.map(id => <li key={id}><a href={SOURCES[id].url} target="_blank" rel="noopener noreferrer">{SOURCES[id].name}</a></li>)}
      </ul>
      <p style={{ color: 'var(--text-3)', marginBottom: 0 }}>La misión particular adapta este perfil al agente. No cambia su especialidad ni autoriza publicar o modificar producción.</p>
    </details>
  )
}
