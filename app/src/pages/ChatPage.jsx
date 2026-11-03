import React, { useState, useEffect, useRef } from 'react'
import { useApp } from '../App.jsx'
import { db } from '../firebase.js'
import {
  collection, doc, addDoc, setDoc, onSnapshot,
  query, orderBy, serverTimestamp, limit
} from '../data/firestore.js'

// Id determinístico del chat entre dos usuarios
function chatIdFor(uidA, uidB) {
  return [uidA, uidB].sort().join('_')
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}

function isOnline(u) {
  if (!u.lastSeen) return false
  const ms = u.lastSeen.toMillis ? u.lastSeen.toMillis() : u.lastSeen.seconds * 1000
  return Date.now() - ms < 5 * 60 * 1000
}

export default function ChatPage() {
  const { user, users, userProfile, chatTargetUid, setChatTargetUid } = useApp()
  const [selectedUid, setSelectedUid] = useState(chatTargetUid || null)

  // Si llegan desde "Equipo" con un destinatario, abrir esa conversación
  useEffect(() => {
    if (chatTargetUid) {
      setSelectedUid(chatTargetUid)
      setChatTargetUid(null)
    }
  }, [chatTargetUid])
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [chatMeta, setChatMeta] = useState({}) // chatId -> {lastMessage, lastSender, updatedAt, readBy}
  const bottomRef = useRef(null)

  const contacts = users
    .filter(u => u.uid !== user.uid && u.role !== 'pending')
    .sort((a, b) => {
      // Con mensajes recientes primero, luego online, luego nombre
      const metaA = chatMeta[chatIdFor(user.uid, a.uid)]
      const metaB = chatMeta[chatIdFor(user.uid, b.uid)]
      const tA = metaA?.updatedAt?.toMillis?.() || 0
      const tB = metaB?.updatedAt?.toMillis?.() || 0
      if (tA !== tB) return tB - tA
      if (isOnline(a) !== isOnline(b)) return isOnline(a) ? -1 : 1
      return (a.name || '').localeCompare(b.name || '')
    })

  const selected = users.find(u => u.uid === selectedUid)
  const chatId = selectedUid ? chatIdFor(user.uid, selectedUid) : null

  // Escuchar metadatos de todos mis chats (para badges de no leído)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'chats'), snap => {
      const meta = {}
      snap.docs.forEach(d => {
        if (d.id.includes(user.uid)) meta[d.id] = d.data()
      })
      setChatMeta(meta)
    })
    return unsub
  }, [user.uid])

  // Escuchar mensajes del chat seleccionado
  useEffect(() => {
    if (!chatId) { setMessages([]); return }
    const q = query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(200)
    )
    const unsub = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    })
    // Marcar como leído
    setDoc(doc(db, 'chats', chatId), { [`read_${user.uid}`]: serverTimestamp() }, { merge: true })
    return unsub
  }, [chatId, user.uid])

  // Auto-scroll al último mensaje
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const msg = text.trim()
    if (!msg || !chatId) return
    setText('')
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      text: msg,
      from: user.uid,
      fromName: userProfile?.name || user.email,
      createdAt: serverTimestamp(),
    })
    await setDoc(doc(db, 'chats', chatId), {
      participants: [user.uid, selectedUid],
      lastMessage: msg,
      lastSender: user.uid,
      updatedAt: serverTimestamp(),
      [`read_${user.uid}`]: serverTimestamp(),
    }, { merge: true })
  }

  const hasUnread = (contactUid) => {
    const meta = chatMeta[chatIdFor(user.uid, contactUid)]
    if (!meta || !meta.updatedAt) return false
    if (meta.lastSender === user.uid) return false
    const myRead = meta[`read_${user.uid}`]
    if (!myRead) return true
    return meta.updatedAt.toMillis?.() > myRead.toMillis?.()
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <span className="page-eyebrow">Comunicación</span>
          <h1 className="page-title">Chat interno</h1>
          <p className="page-subtitle">Mensajes privados entre miembros del equipo</p>
        </div>
      </div>

      <div className="chat-layout">
        {/* Lista de contactos */}
        <div className="card" style={{ padding: 0, overflow: 'hidden auto' }}>
          {contacts.length === 0 && (
            <div className="empty-state" style={{ padding: 30 }}>
              <div className="empty-icon">👥</div>
              <p style={{ fontSize: 13 }}>Sin compañeros aún</p>
            </div>
          )}
          {contacts.map(c => {
            const meta = chatMeta[chatIdFor(user.uid, c.uid)]
            const unread = hasUnread(c.uid)
            return (
              <div key={c.uid}
                onClick={() => setSelectedUid(c.uid)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '11px 14px', cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  background: selectedUid === c.uid ? 'var(--purple-light)' : 'transparent',
                  transition: 'background 0.15s',
                }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  {c.photo
                    ? <img src={c.photo} alt="" style={{ width: 38, height: 38, borderRadius: '50%' }} />
                    : <div style={{
                        width: 38, height: 38, borderRadius: '50%', background: c.color || '#4700E0',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 15, fontWeight: 700, color: '#fff'
                      }}>{(c.name || '?')[0].toUpperCase()}</div>
                  }
                  <div style={{
                    position: 'absolute', bottom: 0, right: 0, width: 10, height: 10,
                    borderRadius: '50%', background: isOnline(c) ? 'var(--success)' : 'var(--text-3)',
                    border: '2px solid var(--card)'
                  }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13.5, fontWeight: unread ? 700 : 600,
                    display: 'flex', alignItems: 'center', gap: 6
                  }}>
                    {c.name}
                    {unread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--purple)', flexShrink: 0 }} />}
                  </div>
                  <div style={{
                    fontSize: 11.5, color: unread ? 'var(--text)' : 'var(--text-3)',
                    fontWeight: unread ? 600 : 400,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}>
                    {meta?.lastMessage
                      ? (meta.lastSender === user.uid ? 'Tú: ' : '') + meta.lastMessage
                      : (isOnline(c) ? '🟢 En línea' : 'Iniciar conversación')}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Área de conversación */}
        <div className="card" style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selected ? (
            <div className="empty-state" style={{ margin: 'auto' }}>
              <div className="empty-icon">💬</div>
              <h3>Selecciona un compañero</h3>
              <p>Elige a alguien de la lista para empezar a chatear</p>
            </div>
          ) : (
            <>
              {/* Header conversación */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 16px', borderBottom: '1px solid var(--border)',
                background: 'var(--card-2)', flexShrink: 0
              }}>
                {selected.photo
                  ? <img src={selected.photo} alt="" style={{ width: 34, height: 34, borderRadius: '50%' }} />
                  : <div style={{
                      width: 34, height: 34, borderRadius: '50%', background: selected.color || '#4700E0',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 700, color: '#fff'
                    }}>{(selected.name || '?')[0].toUpperCase()}</div>
                }
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{selected.name}</div>
                  <div style={{ fontSize: 11.5, color: isOnline(selected) ? 'var(--success)' : 'var(--text-3)' }}>
                    {isOnline(selected) ? '🟢 En línea' : 'Desconectado'}
                  </div>
                </div>
              </div>

              {/* Mensajes */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {messages.length === 0 && (
                  <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-3)', margin: 'auto' }}>
                    Aún no hay mensajes. ¡Escribe el primero! 👋
                  </p>
                )}
                {messages.map(m => {
                  const mine = m.from === user.uid
                  return (
                    <div key={m.id} style={{
                      alignSelf: mine ? 'flex-end' : 'flex-start',
                      maxWidth: '75%',
                    }}>
                      <div style={{
                        background: mine ? 'var(--purple)' : 'var(--card-2)',
                        color: mine ? '#fff' : 'var(--text)',
                        padding: '8px 12px',
                        borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                        fontSize: 13.5, lineHeight: 1.5,
                        wordBreak: 'break-word',
                      }}>
                        {m.text}
                      </div>
                      <div style={{
                        fontSize: 10, color: 'var(--text-3)', marginTop: 2,
                        textAlign: mine ? 'right' : 'left'
                      }}>
                        {fmtTime(m.createdAt)}
                      </div>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div style={{
                display: 'flex', gap: 8, padding: 12,
                borderTop: '1px solid var(--border)', flexShrink: 0
              }}>
                <input
                  className="form-input"
                  value={text}
                  onChange={e => setText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                  placeholder={`Mensaje para ${selected.name?.split(' ')[0]}...`}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-primary" onClick={handleSend} disabled={!text.trim()}>
                  Enviar ➤
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
