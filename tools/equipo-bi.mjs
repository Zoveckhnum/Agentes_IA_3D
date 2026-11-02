import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { loadMotorEnv } from '../motor/env.mjs'
import { seedLocal } from './sembrar-local.mjs'

const file = new URL('../motor/negocio.json', import.meta.url)
const backup = new URL('../motor/credenciales/negocio-antes-equipo.json', import.meta.url)
const { mkdirSync } = await import('node:fs')
mkdirSync(new URL('../motor/credenciales/', import.meta.url), { recursive: true })
if (!existsSync(backup)) copyFileSync(file, backup)
const business = JSON.parse(readFileSync(file, 'utf8'))
const team = JSON.parse(readFileSync(new URL('../roles/equipo-bi.json', import.meta.url), 'utf8'))
const old = business.equipo || []
business.equipo = team
business.agentes ||= {}
for (const agent of team) business.agentes[agent.id] = { ...business.agentes[agent.id], rol: agent.rol, carpeta: agent.nombre }
writeFileSync(file, JSON.stringify(business, null, 2) + '\n')
if (loadMotorEnv().USE_EMULATORS === 'true') {
  await seedLocal({ reserveIds: old.filter(a => a.id && !team.some(b => b.id === a.id)).map(a => a.id) })
  console.log('Equipo BI: 12 perfiles listos. Los agentes anteriores quedan en reserva; se conservan sus tareas.')
} else {
  console.log('Perfiles preparados. Ejecuta npm --prefix motor run crear-agentes para crearlos en Firebase.')
}
