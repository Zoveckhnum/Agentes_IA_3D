import React, { useEffect, useRef, useState } from 'react'
import { db } from '../firebase.js'
import { collection, addDoc, onSnapshot, orderBy, query, limit, serverTimestamp } from '../data/firestore.js'
import Icon from './Icons.jsx'
import { AgentAvatar } from './AgentModal.jsx'

// Chat con un agente (chatId = id del agente) o con todo el equipo de agentes (chatId = 'grupo').
// Las respuestas las escribe el motor de agentes desde el PC del dueño.
export default function AgentChat({ chatId, agent, agents, engineOn, user, userProfile, onClose }) {
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef(null)
  const isGroup = chatId === 'grupo'

  useEffect(() => {
    const q = query(collection(db, 'agentChats', chatId, 'mensajes'), orderBy('createdAt', 'asc'), limit(150))
    return onSnapshot(q, s => setMsgs(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => setMsgs([]))
  }, [chatId])

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [msgs.length])

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    try {
      await addDoc(collection(db, 'agentChats', chatId, 'mensajes'), {
        from: 'humano', text: t.slice(0, 4000), status: 'pending',
        authorUid: user.uid, authorName: userProfile?.name || user.email, createdAt: serverTimestamp(),
      })
      setText('')
    } catch (e) {
      console.error(e)
      alert('No se pudo enviar el mensaje')
    }
    setSending(false)
  }

  const last = msgs[msgs.length - 1]
  const waiting = last?.from === 'humano'
  const byId = Object.fromEntries((agents || []).map(a => [a.id, a]))
  const time = (m) => m.createdAt?.toDate?.().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) || ''

  return (
    <div className="agent-chat">
      <div className="agent-chat-head">
        {isGroup
          ? <span className="agent-chat-group"><Icon name="users" size={16} /></span>
          : <AgentAvatar agent={agent} size={34} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{isGroup ? 'Chat del equipo de agentes' : agent?.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {isGroup ? 'Menciona con @Nombre a quien quieras; si no, responde tu coordinador' : agent?.role}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Cerrar chat"><Icon name="x" size={13} /></button>
      </div>

      <div className="agent-chat-list" ref={listRef}>
        {msgs.length === 0 && (
          <p className="agent-chat-empty">
            {isGroup ? 'Escribe al equipo. Ej.: "@Ana y @Leo, armen juntos el post del lanzamiento".' : `Escríbele a ${agent?.name}. Si tiene preguntas sobre sus tareas, aparecen aquí y puedes responderlas.`}
          </p>
        )}
        {msgs.map(m => {
          const mine = m.from === 'humano'
          const a = !mine && byId[m.agentId]
          return (
            <div key={m.id} className={`agent-msg ${mine ? 'mine' : ''}`}>
              {!mine && isGroup && <AgentAvatar agent={a || { name: m.agentName }} size={26} />}
              <div className="agent-msg-bubble">
                {!mine && isGroup && <div className="agent-msg-name">{m.agentName}</div>}
                <div className="agent-msg-text">{m.text}</div>
                <div className="agent-msg-time">{time(m)}</div>
              </div>
            </div>
          )
        })}
        {waiting && (
          <div className="agent-msg">
            <div className="agent-msg-bubble typing">
              {engineOn ? <><i /><i /><i /></> : <span style={{ fontSize: 12 }}>El motor de agentes está apagado: responderán cuando se encienda el PC.</span>}
            </div>
          </div>
        )}
      </div>

      <div className="agent-chat-input">
        <textarea rows={1} value={text} placeholder={isGroup ? 'Mensaje al equipo…' : `Mensaje a ${agent?.name || 'el agente'}…`}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
        <button className="btn btn-primary btn-sm" onClick={send} disabled={!text.trim() || sending} title="Enviar">
          <Icon name="send" size={14} />
        </button>
      </div>
    </div>
  )
}
