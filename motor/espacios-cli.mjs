import { fileURLToPath } from 'node:url'
import { project } from './integraciones.mjs'
import { prepareProject } from './espacios-proyecto.mjs'

try {
  const [id, taskId, ...extra] = process.argv.slice(2)
  if (!id || !taskId || extra.length) throw new Error('Uso: npm run proyecto:preparar -- proyecto tarea_id')
  const registered = project(id)
  if (!registered.github) throw new Error('El proyecto necesita un repositorio GitHub registrado.')
  const result = await prepareProject({ root: fileURLToPath(new URL('../', import.meta.url)), id, github: registered.github, taskId })
  console.log(`Proyecto preparado: ${result.cwd}\nRama: ${result.branch}\nNo se han enviado commits ni ejecutado compilaciones.`)
} catch (error) { console.error(error.message); process.exitCode = 1 }
