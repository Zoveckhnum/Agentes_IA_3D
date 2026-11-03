export const MAX_AGENT_PHOTO_BYTES = 8 * 1024 * 1024
const fileTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function normalizeAgentPhotoUrl(value) {
  const text = value.trim()
  if (!text) throw new Error('Pega el enlace directo de la imagen.')
  let url
  try { url = new URL(text) } catch { throw new Error('Escribe un enlace válido que empiece por https://.') }
  if (url.protocol !== 'https:' || url.username || url.password || text.length > 8192) throw new Error('Usa un enlace HTTPS a una imagen pública, sin usuario ni contraseña.')
  return url.href
}

function abortError() { return new DOMException('Operación cancelada', 'AbortError') }

export function loadAgentPhoto(source, { signal, timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const image = new Image()
    image.referrerPolicy = 'no-referrer'
    const cleanup = () => { clearTimeout(timer); image.onload = null; image.onerror = null; signal?.removeEventListener('abort', cancel) }
    const fail = error => { cleanup(); image.src = ''; reject(error) }
    const cancel = () => fail(abortError())
    const timer = setTimeout(() => fail(new Error('La imagen tardó demasiado. Prueba otro enlace o sube el archivo.')), timeout)
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) return fail(new Error('El archivo no contiene una imagen válida.'))
      cleanup(); resolve(image)
    }
    image.onerror = () => fail(new Error('No se pudo abrir la imagen. Usa un enlace directo y público, o sube un archivo JPG, PNG o WebP.'))
    signal?.addEventListener('abort', cancel, { once: true })
    image.src = source
  })
}

function readPhotoFile(file, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const reader = new FileReader()
    const cleanup = () => signal?.removeEventListener('abort', cancel)
    const cancel = () => { reader.abort(); cleanup(); reject(abortError()) }
    reader.onload = () => { cleanup(); resolve(reader.result) }
    reader.onerror = () => { cleanup(); reject(new Error('No se pudo leer el archivo. Selecciona otra imagen.')) }
    signal?.addEventListener('abort', cancel, { once: true })
    reader.readAsDataURL(file)
  })
}

export async function resizeAgentPhoto(file, { signal } = {}) {
  if (!fileTypes.has(file.type)) throw new Error('Elige un archivo JPG, PNG o WebP.')
  if (file.size > MAX_AGENT_PHOTO_BYTES) throw new Error('La imagen supera 8 MB. Reduce su tamaño o usa un enlace.')
  // FileReader produces data:, already permitted by the app CSP. Temporary blob:
  // URLs were rejected by img-src, preventing the previous upload from decoding.
  const source = await readPhotoFile(file, signal)
  const image = await loadAgentPhoto(source, { signal })
  if (signal?.aborted) throw abortError()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) throw new Error('El navegador no pudo preparar la foto. Prueba con un enlace.')
  const side = Math.min(image.naturalWidth, image.naturalHeight)
  context.drawImage(image, (image.naturalWidth-side)/2, (image.naturalHeight-side)/2, side, side, 0, 0, 256, 256)
  return canvas.toDataURL('image/jpeg', 0.85)
}
