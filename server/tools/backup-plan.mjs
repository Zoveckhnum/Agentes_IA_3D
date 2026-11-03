import { fileURLToPath } from 'node:url'
export function retentionPlan(backups, budget = 20 * 1024 ** 3) {
  if (!Array.isArray(backups) || backups.some(b => !/^AgentesIA3D-\d{8}T\d{9}Z\.bak$/.test(b.name) || !Number.isSafeInteger(b.bytes) || b.bytes < 1 || !Number.isFinite(Date.parse(b.createdAt)) || b.verified !== true)) throw new Error('Inventario de respaldos no válido')
  const ordered = [...backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (new Set(ordered.map(b => b.name)).size !== ordered.length) throw new Error('Respaldo duplicado en inventario')
  const selected = new Set(ordered.slice(0, 2).map(b => b.name))
  const bucket = (b, interval) => {
    const date = new Date(b.createdAt)
    if (interval === 'day') return date.toISOString().slice(0, 10)
    if (interval === 'month') return date.toISOString().slice(0, 7)
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
    return date.toISOString().slice(0, 10)
  }
  for (const [interval, count] of [['day', 7], ['week', 4], ['month', 2]]) {
    const periods = new Set()
    for (const backup of ordered) {
      const period = bucket(backup, interval)
      if (periods.has(period)) continue
      if (periods.size >= count) break
      periods.add(period); selected.add(backup.name)
    }
  }
  const total = () => ordered.filter(b => selected.has(b.name)).reduce((sum, b) => sum + b.bytes, 0)
  for (const backup of [...ordered].reverse()) {
    if (total() <= budget) break
    if (ordered.slice(0, 2).some(b => b.name === backup.name)) continue
    selected.delete(backup.name)
  }
  if (total() > budget) throw new Error('Los dos respaldos recientes exceden el presupuesto; se requiere intervención, no se borran automáticamente')
  return { keep: ordered.filter(b => selected.has(b.name)).map(b => b.name), remove: ordered.filter(b => !selected.has(b.name)).map(b => b.name), bytes: total() }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = ''
  for await (const part of process.stdin) input += part
  const parsed = JSON.parse(input.replace(/^\uFEFF/, ''))
  console.log(JSON.stringify(retentionPlan(parsed.backups, parsed.budget)))
}
