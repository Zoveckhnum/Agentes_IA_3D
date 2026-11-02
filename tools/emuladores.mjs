import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const root = fileURLToPath(new URL('../', import.meta.url))
export function emulatorEnv() {
  const env = { ...process.env }
  // Java portable opcional, sin alterar PATH ni JAVA_HOME del sistema.
  const javaRoot = join(root, '.local/java')
  if (existsSync(javaRoot)) {
    const home = readdirSync(javaRoot).map(n => join(javaRoot, n))
      .find(p => existsSync(join(p, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')))
    if (home) { env.JAVA_HOME = home; env.PATH = `${join(home, 'bin')}${process.platform === 'win32' ? ';' : ':'}${env.PATH || ''}` }
  }
  return env
}
export function startEmulators() {
  if (!existsSync(join(root, '.local/firestore.rules'))) throw new Error('Primero ejecuta npm run setup.')
  const args = [join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'), 'emulators:start',
    '--config', 'firebase.local.json', '--project', 'demo-agentes-ia-3d',
    '--only', 'auth,firestore', '--export-on-exit', '.local/data']
  if (existsSync(join(root, '.local/data/firebase-export-metadata.json'))) args.push('--import', '.local/data')
  return spawn(process.execPath, args, { cwd: root, env: emulatorEnv(), stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true })
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const child = startEmulators()
  child.on('error', e => { console.error(e.message); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}
