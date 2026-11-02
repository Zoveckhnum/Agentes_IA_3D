import { mkdirSync, writeFileSync, lstatSync, rmSync } from 'node:fs'
import { join, dirname, resolve, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { snapshotFiles } from './calidad.mjs'

export function dependencyReady(task, requiresQA = false) {
  return !!task && ['completada', 'en_espera'].includes(task.estado)
    && task.agentStatus === 'done' && !task.pendingAcceptance
    && (!(requiresQA || task.qualityStatus) || task.qualityStatus === 'passed')
}

export function continuation(origin, ids, { request, inputs = [], depth = 0 }, coordinatorId) {
  if (depth >= 8) throw new Error('Se alcanzó el límite de 8 etapas. Revisa el alcance antes de continuar.')
  const inputTaskIds = [...new Set([...inputs, ...ids])]
  if (!request || !ids.length || inputTaskIds.length > 60) throw new Error('Continuación sin objetivo o con demasiados insumos.')
  return {
    id: 'continuar-' + createHash('sha256').update(origin).digest('hex').slice(0, 32),
    tarea: `Continuar entrega: etapa ${depth + 1}`,
    descripcion: `Retoma la solicitud original hasta entregar todos sus resultados:\n${request}\n\nLee insumos/ y su evidencia de revisión. Si falta implementación o pruebas, delega la siguiente etapa concreta. Si el producto está listo y pasó QA, reúne los archivos revisados sin modificarlos y guárdalos en los destinos solicitados. Entrega enlaces reales y el resultado de QA. Un plan o una lista de pruebas no son una implementación ni pruebas ejecutadas. No declares completado el proyecto si falta un entregable.`,
    coordinationRequest: request,
    coordinationDepth: depth + 1,
    inputTaskIds,
    dependsOn: inputTaskIds,
    asignado: coordinatorId,
    asignadoAgente: true,
    estado: 'pendiente',
    prioridad: 'media',
    cliente: '', feedback: '', links: '', linkTerminada: '', totalTimeSeconds: 0,
  }
}

// Copias aisladas: los agentes siguen trabajando exclusivamente dentro de su tarea.
// No copiamos insumos de insumos; cada origen aparece una sola vez en la etapa.
export function stageInputs(root, ids, cwd, tasks) {
  if (!ids.length) return
  cwd = resolve(cwd)
  function ensureDirectory(target) {
    const within = relative(cwd, resolve(target))
    if (within.startsWith('..') || isAbsolute(within)) throw new Error('Destino de insumos inválido.')
    if (target !== cwd) ensureDirectory(dirname(target))
    try {
      const stat = lstatSync(target)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Destino de insumos inválido.')
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      mkdirSync(target)
    }
  }
  ensureDirectory(cwd)
  let count = 0, bytes = 0
  for (const id of [...new Set(ids)]) {
    if (!/^[\w-]+$/.test(id) || !tasks.has(id) || resolve(root, id) === resolve(cwd)) throw new Error('Insumo de tarea inválido.')
    const source = join(root, id)
    if (lstatSync(source).isSymbolicLink()) throw new Error('Insumo de tarea inválido: enlace simbólico.')
    const task = tasks.get(id)
    const files = snapshotFiles(source, new Set(['insumos']))
    const manifest = new Map((task.qualityManifest || []).map(f => [f.path, f.hash]))
    // Las revisiones de insumos anteriores están en sus propios orígenes.
    const reviewed = [...manifest].filter(([path]) => !path.startsWith('insumos/'))
    if (task.qualityStatus === 'passed' && manifest.size &&
        (reviewed.length !== files.length || files.some(f => manifest.get(f.path) !== f.hash))) {
      throw new Error(`La entrega ${id} cambió después de QA; requiere revisión.`)
    }
    const targetRoot = join(cwd, 'insumos', id)
    ensureDirectory(targetRoot)
    // Carpeta administrada por el motor, contenida y comprobada sin enlaces.
    // Evita mantener archivos obsoletos si se repite una etapa tras correcciones.
    const withinInputs = relative(resolve(cwd, 'insumos'), resolve(targetRoot))
    if (!withinInputs || withinInputs.startsWith('..') || isAbsolute(withinInputs)) throw new Error('Destino de insumos inválido.')
    rmSync(targetRoot, { recursive: true, force: true })
    mkdirSync(targetRoot)
    for (const file of files) {
      bytes += file.content.length
      if (++count > 200 || bytes > 50 * 1024 * 1024) throw new Error('Los insumos superan 200 archivos o 50 MB; divide la entrega.')
      const target = join(targetRoot, file.path)
      ensureDirectory(dirname(target))
      try { if (lstatSync(target).isSymbolicLink()) throw new Error('Destino de insumos inválido.') } catch (e) { if (e.code !== 'ENOENT') throw e }
      writeFileSync(target, file.content)
    }
    const evidence = join(targetRoot, 'revision.json')
    try { if (lstatSync(evidence).isSymbolicLink()) throw new Error('Destino de evidencia inválido.') } catch (e) { if (e.code !== 'ENOENT') throw e }
    writeFileSync(evidence, JSON.stringify({ tarea: task.tarea, entrega: task.agentOutput || '', qualityStatus: task.qualityStatus || null,
      qualityRevision: task.qualityRevision || null, qualityReviews: task.qualityReviews || [], archivos: files.map(({ path, hash }) => ({ path, hash })) }, null, 2))
  }
}
