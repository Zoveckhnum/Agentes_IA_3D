import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { join } from 'node:path'
import { root, startEmulators } from './emuladores.mjs'
import { seedLocal } from './sembrar-local.mjs'

const motorEnv = parseEnv(readFileSync(join(root, 'motor/.env'), 'utf8'))
const appEnv = parseEnv(readFileSync(join(root, 'app/.env'), 'utf8'))
if (motorEnv.USE_EMULATORS !== 'true' || appEnv.VITE_USE_EMULATORS !== 'true' ||
    motorEnv.FIREBASE_PROJECT_ID !== 'demo-agentes-ia-3d' || appEnv.VITE_FIREBASE_PROJECT_ID !== 'demo-agentes-ia-3d') {
  throw new Error('npm run local requiere la configuración demo de npm run setup en app/.env y motor/.env.')
}
const children = []
let stopping = false
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', key => { if (key.includes(3)) stop() })
}
async function stop(code = 0) {
  if (stopping) return
  stopping = true
  if (process.stdin.isTTY) { process.stdin.setRawMode(false); process.stdin.pause() }
  // Exporta antes de cerrar procesos: SIGINT no se propaga como señal POSIX en Windows.
  try {
    const res = await fetch('http://127.0.0.1:4400/_admin/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: join(root, '.local/data'), initiatedBy: 'agentes-ia-3d' }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) console.error('No se pudieron guardar los datos locales al salir.')
  } catch { console.error('El emulador no respondió al guardar los datos locales.') }
  for (const child of [...children].reverse()) {
    if (!child.pid || child.exitCode !== null) continue
    if (process.platform === 'win32') {
      await new Promise(resolve => {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        killer.on('exit', resolve)
        killer.on('error', resolve)
      })
    } else child.kill('SIGINT')
  }
  process.exitCode = code
}
function track(child) {
  children.push(child)
  child.on('error', e => { console.error(e.message); stop(1) })
  child.on('exit', code => { if (!stopping) stop(code || 1) })
  return child
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
track(startEmulators())
try {
  const deadline = Date.now() + 120_000
  while (true) {
    if (stopping) throw new Error('Los emuladores se detuvieron al arrancar. Comprueba Java 21+ y los puertos 8080/9099.')
    try {
      const checks = await Promise.all([
        fetch('http://127.0.0.1:9099/', { signal: AbortSignal.timeout(1500) }),
        fetch('http://127.0.0.1:8080/', { signal: AbortSignal.timeout(1500) }),
      ])
      if (checks.every(r => r.ok)) break
    } catch {}
    if (Date.now() > deadline) throw new Error('Los emuladores no respondieron en 120 segundos.')
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  await seedLocal()
  track(spawn(process.execPath, ['worker.mjs'], { cwd: join(root, 'motor'), stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true }))
  track(spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
    cwd: join(root, 'app'), stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true,
  }))
  console.log('\nOficina: http://127.0.0.1:5173 · Firebase: http://127.0.0.1:4000\nCtrl+C para detener.')
} catch (error) { console.error(error.message); stop(1) }
