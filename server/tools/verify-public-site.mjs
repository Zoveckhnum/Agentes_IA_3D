import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const origin = process.env.PUBLIC_ORIGIN
assert.ok(origin?.startsWith('https://'), 'Se requiere el origen HTTPS instalado')
let checks = 0
const check = (actual, expected) => { assert.equal(actual, expected); checks++ }
const request = (path, options = {}) => fetch(`${origin}${path}`, { redirect: 'manual', ...options, signal: AbortSignal.timeout(20000) })
const home = await request('/')
check(home.status, 200)
const html = await home.text()
assert.ok(html.includes('<div id="root"')); checks++
const script = html.match(/<script[^>]+src="([^"]+)"/)
assert.ok(script?.[1]?.startsWith('/assets/')); checks++
const asset = await request(script[1])
check(asset.status, 200)
assert.ok(asset.headers.get('content-type')?.includes('javascript')); checks++
const health = await request('/health/db')
check(health.status, 200)
const state = await health.json()
for (const name of ['ok', 'connectedOverTcp', 'encrypted', 'certificateValidated', 'schemaReady', 'permissionsRestricted']) check(state[name], true)
const me = await request('/api/auth/me')
check(me.status, 401)
const anonymous = await request('/api/data/read', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })
check(anonymous.status, 401)
const csrf = await request('/api/data/read', { method: 'POST', headers: { Origin: 'https://invalid.example', 'Content-Type': 'application/json' }, body: '{}' })
check(csrf.status, 403)
const invalidLogin = await request('/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `probe-${randomUUID()}@example.invalid`, password: randomUUID() }) })
check(invalidLogin.status, 401)
check(invalidLogin.headers.has('set-cookie'), false)
// Explicit aliases avoid inventing a nested www hostname for subdomain deployments.
const aliases = process.argv.length > 2 ? process.argv.slice(2) : [origin.replace('https:', 'http:'), origin.replace('https://', 'https://www.')]
for (const base of aliases) {
  const response = await fetch(`${base}/?activation=verified`, { redirect: 'manual', signal: AbortSignal.timeout(20000) })
  check(response.status, 301)
  check(response.headers.get('location'), `${origin}/?activation=verified`)
}
assert.ok(home.headers.get('strict-transport-security')?.includes('max-age=')); checks++
assert.ok(home.headers.get('content-security-policy')?.includes("default-src 'self'")); checks++
console.log(JSON.stringify({ ok: true, origin, checks, authenticatedDataExposed: false, redirectsVerified: true, sqlHealthVerified: true }))
