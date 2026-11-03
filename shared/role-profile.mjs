// Pure, shared by UI and worker. Business preferences can specialize a mission,
// but cannot replace the role's skill assignment or independent QA requirements.
export function effectiveRole(catalog, roleId, preferences = {}) {
  const id = Object.hasOwn(catalog.roles, roleId || '') ? roleId : 'personalizado'
  const role = catalog.roles[id]
  if (!role) throw new Error('No existe el perfil personalizado de respaldo')
  return {
    ...role, ...preferences, id,
    mision: role.mision,
    misionPersonalizada: preferences.mision || '',
    skills: role.skills,
    actividades: role.actividades,
    entregables: role.entregables,
    criteriosAceptacion: role.criteriosAceptacion,
    limites: role.limites,
    requisitos: role.requisitos,
    qualityReviewer: !!role.qualityReviewer,
    qualityReviewers: role.qualityReviewers || [],
    coordinador: !!role.coordinador,
  }
}

export function effectiveAgentRole(catalog, agent, preferences = {}) {
  // A role explicitly selected in the Office takes precedence over old setup data.
  return effectiveRole(catalog, agent?.rol || preferences.rol || 'personalizado', preferences)
}
