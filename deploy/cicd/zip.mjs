import { deflateRawSync, inflateRawSync, crc32 } from 'node:zlib'
const limits = { files: 20000, bytes: 512 * 1024 * 1024, archive: 128 * 1024 * 1024 }
export function safeName(name) {
  if (!name || name.length > 240 || name.includes('\\') || /[\x00-\x1f:]/.test(name) || name.startsWith('/') || name.split('/').some(p=>!p || p==='.' || p==='..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))) throw new Error('Unsafe archive path')
  return name
}
export function createZip(files) {
  const local = [], central = [], seen = new Set()
  let offset = 0, bytes = 0
  if (!files.length || files.length > limits.files) throw new Error('Archive file limit')
  for (const { name, content } of files) {
    safeName(name)
    const key = name.toLowerCase()
    if (seen.has(key)) throw new Error('Duplicate archive path')
    seen.add(key)
    bytes += content.length
    if (bytes > limits.bytes) throw new Error('Archive size limit')
    const filename = Buffer.from(name), packed = deflateRawSync(content, { level: 6 }), crc = crc32(content)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt16LE(0x800,6); header.writeUInt16LE(8,8); header.writeUInt16LE(33,12)
    header.writeUInt32LE(crc,14); header.writeUInt32LE(packed.length,18); header.writeUInt32LE(content.length,22); header.writeUInt16LE(filename.length,26)
    local.push(header,filename,packed)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20,4); entry.writeUInt16LE(20,6); entry.writeUInt16LE(0x800,8); entry.writeUInt16LE(8,10); entry.writeUInt16LE(33,14)
    entry.writeUInt32LE(crc,16); entry.writeUInt32LE(packed.length,20); entry.writeUInt32LE(content.length,24); entry.writeUInt16LE(filename.length,28); entry.writeUInt32LE(offset,42)
    central.push(entry,filename); offset += header.length + filename.length + packed.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length,8); end.writeUInt16LE(files.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16)
  const result = Buffer.concat([...local,directory,end])
  if (result.length > limits.archive) throw new Error('Compressed archive size limit')
  return result
}
export function readZip(buffer) {
  if (buffer.length < 22 || buffer.length > limits.archive) throw new Error('Invalid archive size')
  let end = -1
  for (let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--) if(buffer.readUInt32LE(i)===0x06054b50){end=i;break}
  if (end < 0 || end+22+buffer.readUInt16LE(end+20)!==buffer.length || buffer.readUInt16LE(end+4) || buffer.readUInt16LE(end+6)) throw new Error('Invalid ZIP directory')
  const count = buffer.readUInt16LE(end+10), length = buffer.readUInt32LE(end+12), start = buffer.readUInt32LE(end+16)
  if (!count || count > limits.files || count!==buffer.readUInt16LE(end+8) || start+length!==end) throw new Error('ZIP64, split or oversized ZIP not allowed')
  let cursor = start, bytes = 0
  const files = new Map(), seen = new Set()
  for (let i=0;i<count;i++) {
    if(cursor+46>end || buffer.readUInt32LE(cursor)!==0x02014b50) throw new Error('Invalid ZIP entry')
    const flags=buffer.readUInt16LE(cursor+8),method=buffer.readUInt16LE(cursor+10),crc=buffer.readUInt32LE(cursor+16),compressed=buffer.readUInt32LE(cursor+20),size=buffer.readUInt32LE(cursor+24),nameLength=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32),attrs=buffer.readUInt32LE(cursor+38),offset=buffer.readUInt32LE(cursor+42)
    const name=buffer.subarray(cursor+46,cursor+46+nameLength).toString('utf8')
    cursor+=46+nameLength+extra+comment
    if(cursor>end || flags & 1 || ![0,8].includes(method) || ((attrs>>>16)&0xf000)===0xa000) throw new Error('Encrypted, linked or unsupported ZIP entry')
    if (name.endsWith('/')) { safeName(name.slice(0,-1)); if(size)throw new Error('Nonempty directory'); continue }
    safeName(name)
    if(seen.has(name.toLowerCase())) throw new Error('Duplicate archive entry')
    seen.add(name.toLowerCase()); bytes+=size
    if(bytes>limits.bytes || size>limits.bytes || offset+30>start || buffer.readUInt32LE(offset)!==0x04034b50) throw new Error('Archive expansion or offset rejected')
    const localNameLength=buffer.readUInt16LE(offset+26),localExtra=buffer.readUInt16LE(offset+28),data=offset+30+localNameLength+localExtra
    if(buffer.subarray(offset+30,offset+30+localNameLength).toString('utf8')!==name || data+compressed>start || buffer.readUInt16LE(offset+8)!==method) throw new Error('ZIP header mismatch')
    const packed=buffer.subarray(data,data+compressed)
    const content=method===0?Buffer.from(packed):inflateRawSync(packed,{maxOutputLength: Math.max(1,size)})
    if(content.length!==size || crc32(content)!==crc) throw new Error('ZIP checksum mismatch')
    files.set(name,content)
  }
  if(cursor!==end) throw new Error('Unexpected ZIP directory data')
  return files
}
