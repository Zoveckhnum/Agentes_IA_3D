import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const vite = fileURLToPath(new URL('../app/node_modules/vite/bin/vite.js', import.meta.url))
const result = spawnSync(process.execPath, [vite, 'build', '--outDir', '../deploy/sql-preview', '--emptyOutDir'], { cwd: `${root}/app`, env: { ...process.env, VITE_DATA_BACKEND: 'sql', VITE_APP_NAME: process.env.VITE_APP_NAME || 'Stackbi Office' }, stdio: 'inherit', windowsHide: true })
process.exit(result.status ?? 1)
