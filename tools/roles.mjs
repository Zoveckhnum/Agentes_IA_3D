import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRoleSkillContext, validateRoleCatalog, verifySkillBundle } from '../motor/role-skills.mjs'
const root = fileURLToPath(new URL('../', import.meta.url))
const catalog = JSON.parse(readFileSync(new URL('../roles/catalogo.json', import.meta.url), 'utf8'))
const lock = JSON.parse(readFileSync(new URL('../roles/skills.lock.json', import.meta.url), 'utf8'))
const index = JSON.parse(readFileSync(new URL('../roles/skills.index.json', import.meta.url), 'utf8'))
if (process.argv[2] === 'check') {
  validateRoleCatalog(catalog, lock)
  const bundles = Object.entries(lock.skills).map(([id, entry]) => verifySkillBundle(root, id, entry))
  if (Object.keys(index).sort().join() !== Object.keys(lock.skills).sort().join() || bundles.some(b=>index[b.id]?.url!==b.source || index[b.id]?.name!==b.name)) throw new Error('Las fuentes visibles no coinciden con el registro fijado')
  const assigned = new Set(Object.values(catalog.roles).flatMap(r => r.skills))
  if (bundles.some(b => !assigned.has(b.id))) throw new Error('Hay habilidades instaladas que no corresponden a ningún rol')
  console.log(JSON.stringify({ ok: true, roles: Object.keys(catalog.roles).length, skills: bundles.length, files: bundles.reduce((n,s)=>n+s.files,0), bytes: bundles.reduce((n,s)=>n+s.bytes,0), source: 'skills.sh', networkRequired: false }))
} else {
  const role = process.argv[2] || 'personalizado'
  console.log(createRoleSkillContext(role).text)
}
