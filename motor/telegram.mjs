// Canal de Telegram del coordinador: long polling desde el PC (no necesita servidor público).
// Solo atiende al dueño (TELEGRAM_OWNER_ID); cualquier otra persona recibe un rechazo.

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'

export function acceptsMessage(message, ownerId) {
  return message?.chat?.type === 'private' && !!ownerId && String(message.from?.id) === String(ownerId)
}

export function startTelegram({ token, ownerId, log, onMessage, onReply, transcribe }) {
  mkdirSync(new URL('logs/', import.meta.url), { recursive: true })
  const stateFile = new URL(`logs/telegram-${createHash('sha256').update(token).digest('hex').slice(0, 16)}.json`, import.meta.url)
  let offset = 0
  if (existsSync(stateFile)) {
    try { const saved = JSON.parse(readFileSync(stateFile, 'utf8')); if (Number.isSafeInteger(saved.offset) && saved.offset >= 0) offset = saved.offset } catch { log('No se pudo recuperar el cursor de Telegram.') }
  }
  let stopped = false

  const call = async (method, body) => {
    const r = await fetch(API(token, method), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    })
    const j = await r.json()
    if (!j.ok) throw new Error(j.description || method)
    return j.result
  }

  const send = async (chatId, text) => {
    const chunks = []
    for (let s = String(text || '').trim() || '(sin respuesta)'; s.length; s = s.slice(3800)) chunks.push(s.slice(0, 3800))
    // La red a veces corta la conexión con Telegram: hasta 4 intentos por mensaje
    const ids = []
    for (const c of chunks) {
      for (let i = 1; i <= 4; i++) {
        try { ids.push((await call('sendMessage', { chat_id: chatId, text: c })).message_id); break }
        catch (e) {
          if (i === 4) log('Telegram no envió:', e.message)
          else await new Promise(r => setTimeout(r, 3000 * i))
        }
      }
    }
    return ids
  }

  const typing = (chatId) => call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {})

  async function loop() {
    for (let tries = 1; ; tries++) {
      try {
        const me = await call('getMe')
        log(`Telegram conectado como @${me.username}`)
        break
      } catch (e) {
        if (/unauthorized|not found/i.test(e.message)) { log('✖ Telegram: el token no es válido. Revisa TELEGRAM_BOT_TOKEN en .env'); return }
        log(`Telegram: sin conexión (${e.cause?.code || e.message}), reintento en 30 s`)
        await new Promise(r => setTimeout(r, 30_000))
        if (stopped) return
      }
    }
    while (!stopped) {
      try {
        const updates = await call('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] })
        for (const u of updates) {
          try {
          const m = u.message
          if (m?.chat?.type !== 'private') continue
          const voice = m?.voice || (m?.audio?.mime_type === 'audio/ogg' ? m.audio : null)
          if (!m?.text && !voice) continue
          const fromId = String(m.from?.id)
          if (!ownerId) {
            log(`Telegram: mensaje de ${m.from?.first_name} con ID ${fromId}. Pon TELEGRAM_OWNER_ID=${fromId} en .env si eres tú.`)
            await send(m.chat.id, `Hola. Tu ID de Telegram es ${fromId}. Aún no estoy vinculado a ningún dueño.`)
            continue
          }
          if (!acceptsMessage(m, ownerId)) {
            log(`Telegram: mensaje ignorado de un desconocido (ID ${fromId})`)
            continue
          }
          const keepTyping = setInterval(() => typing(m.chat.id), 4500)
          typing(m.chat.id)
          try {
            let text = m.text
            if (voice) {
              if (!transcribe) { await send(m.chat.id, 'Todavía no puedo escuchar notas de voz.'); continue }
              const file = await call('getFile', { file_id: voice.file_id })
              const r = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`)
              const bytes = new Uint8Array(await r.arrayBuffer())
              text = await transcribe(bytes)
              if (!text) { await send(m.chat.id, 'No logré entender la nota de voz. ¿Me la repites?'); continue }
              log(`Telegram: nota de voz de ${voice.duration || '?'} s transcrita`)
              await send(m.chat.id, `Escuché: "${text}"`)
            }
            // Respuesta a una pregunta de un agente (el usuario usó "Responder" sobre el aviso)
            const replyTo = m.reply_to_message?.message_id
            if (replyTo && onReply) {
              const ack = await onReply(replyTo, text)
              if (ack) { await send(m.chat.id, ack); continue }
            }
            const reply = await onMessage(text, { updateId: u.update_id })
            await send(m.chat.id, reply)
          } catch (e) {
            await send(m.chat.id, 'Tuve un problema: ' + e.message)
          } finally {
            clearInterval(keepTyping)
          }
          } finally {
            offset = u.update_id + 1
            const temp = new URL(stateFile.href + '.tmp')
            writeFileSync(temp, JSON.stringify({ offset }))
            renameSync(temp, stateFile)
          }
        }
      } catch (e) {
        log('Telegram: error de conexión, reintento en 10 s (' + e.message + ')')
        await new Promise(r => setTimeout(r, 10_000))
      }
    }
  }

  loop()
  return {
    // Devuelve los message_id enviados (para reconocer respuestas a ese aviso)
    notify: (text) => ownerId ? send(ownerId, text) : Promise.resolve([]),
    stop: () => { stopped = true },
  }
}
