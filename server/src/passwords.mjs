import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
const scrypt = promisify(scryptCallback)
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
export async function passwordDigest(password) {
  const salt = randomBytes(16).toString('hex')
  const digest = await scrypt(password, salt, 64, options)
  return `scrypt:32768:8:1:${salt}:${digest.toString('hex')}`
}
export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':')
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '32768' || parts[2] !== '8' || parts[3] !== '1' || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{128}$/.test(parts[5])) return false
  const digest = await scrypt(password, parts[4], 64, options)
  return timingSafeEqual(digest, Buffer.from(parts[5], 'hex'))
}
