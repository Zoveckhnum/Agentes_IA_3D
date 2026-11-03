import React, { useState, useEffect, useRef } from 'react'
import { useApp } from '../App.jsx'
import { db } from '../firebase.js'
import {
  collection, addDoc, deleteDoc, doc, updateDoc,
  onSnapshot, orderBy, query, serverTimestamp, arrayUnion, arrayRemove
} from '../data/firestore.js'

function timeAgo(ts) {
  if (!ts) return ''
  const ms = ts.toMillis ? ts.toMillis() : ts.seconds * 1000
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (diff < 60000) return 'ahora mismo'
  if (m < 60) return `hace ${m}m`
  if (h < 24) return `hace ${h}h`
  if (d < 7) return `hace ${d}d`
  return new Date(ms).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

export default function Discussion() {
  const { user, userProfile, isAdmin, isSuperAdmin } = useApp()
  const [posts, setPosts] = useState([])
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const textareaRef = useRef(null)

  useEffect(() => {
    const q = query(collection(db, 'discussions'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [])

  const handlePost = async () => {
    const text = message.trim()
    if (!text) return
    setSending(true)
    await addDoc(collection(db, 'discussions'), {
      uid: user.uid,
      name: userProfile?.name || user.email,
      photo: userProfile?.photo || '',
      color: userProfile?.color || '#4700E0',
      message: text,
      createdAt: serverTimestamp(),
      likes: [],
      pinned: false,
    })
    setMessage('')
    setSending(false)
    textareaRef.current?.focus()
  }

  const handleDelete = async (post) => {
    if (!confirm('¿Eliminar este mensaje?')) return
    await deleteDoc(doc(db, 'discussions', post.id))
  }

  const handleLike = async (post) => {
    const hasLiked = post.likes?.includes(user.uid)
    await updateDoc(doc(db, 'discussions', post.id), {
      likes: hasLiked ? arrayRemove(user.uid) : arrayUnion(user.uid)
    })
  }

  const handlePin = async (post) => {
    await updateDoc(doc(db, 'discussions', post.id), { pinned: !post.pinned })
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePost()
  }

  const pinned = posts.filter(p => p.pinned)
  const regular = posts.filter(p => !p.pinned)
  const allPosts = [...pinned, ...regular]

  return (
    <div style={{ maxWidth: 680 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">💬 Discusión</h1>
          <p className="page-subtitle">Muro del equipo — notas, avisos y mensajes para todos</p>
        </div>
      </div>

      {/* Compose */}
      <div className="discussion-input-box">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          {userProfile?.photo
            ? <img src={userProfile.photo} alt="" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, marginTop: 2 }} />
            : <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                background: userProfile?.color || '#4700E0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, fontWeight: 700, color: '#fff'
              }}>
                {(userProfile?.name || '?')[0].toUpperCase()}
              </div>
          }
          <div style={{ flex: 1 }}>
            <textarea
              ref={textareaRef}
              className="form-textarea"
              value={message}
              onChange={e => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`¿Qué quieres compartir con el equipo, ${userProfile?.name?.split(' ')[0] || ''}?`}
              rows={3}
              style={{ marginBottom: 10, resize: 'none' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>Ctrl+Enter para publicar</span>
              <button
                className="btn btn-primary btn-sm"
                onClick={handlePost}
                disabled={sending || !message.trim()}
              >
                {sending ? 'Publicando...' : '📢 Publicar'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Feed */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : allPosts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">💬</div>
          <h3>Sin mensajes aún</h3>
          <p>Sé el primero en dejar un mensaje al equipo</p>
        </div>
      ) : (
        <div className="discussion-feed">
          {allPosts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              currentUid={user.uid}
              isAdmin={isAdmin}
              isSuperAdmin={isSuperAdmin}
              onLike={() => handleLike(post)}
              onDelete={() => handleDelete(post)}
              onPin={() => handlePin(post)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PostCard({ post, currentUid, isAdmin, isSuperAdmin, onLike, onDelete, onPin }) {
  const isOwn = post.uid === currentUid
  const hasLiked = post.likes?.includes(currentUid)
  const canDelete = isOwn || isAdmin || isSuperAdmin

  return (
    <div className="discussion-post" style={{
      borderLeft: post.pinned ? '3px solid var(--purple)' : undefined
    }}>
      {post.pinned && (
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)', textTransform: 'uppercase',
          letterSpacing: '0.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
          📌 Fijado
        </div>
      )}

      <div className="discussion-post-header">
        {post.photo
          ? <img src={post.photo} alt="" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }}
              onError={e => { e.target.style.display = 'none' }} />
          : <div style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              background: post.color || '#4700E0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 15, fontWeight: 700, color: '#fff'
            }}>
              {(post.name || '?')[0].toUpperCase()}
            </div>
        }
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{post.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{timeAgo(post.createdAt)}</div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 4 }}>
          {isAdmin && (
            <button
              className="icon-btn"
              style={{ width: 28, height: 28, fontSize: 13, color: post.pinned ? 'var(--purple)' : 'var(--text-3)' }}
              onClick={onPin}
              title={post.pinned ? 'Desfijar' : 'Fijar mensaje'}
            >📌</button>
          )}
          {canDelete && (
            <button
              className="icon-btn"
              style={{ width: 28, height: 28, fontSize: 13, color: 'var(--danger)' }}
              onClick={onDelete}
              title="Eliminar"
            >🗑</button>
          )}
        </div>
      </div>

      <div className="discussion-post-body">{post.message}</div>

      <div className="discussion-post-footer">
        <button
          className={`like-btn ${hasLiked ? 'liked' : ''}`}
          onClick={onLike}
        >
          {hasLiked ? '👍' : '👍'} {post.likes?.length > 0 ? post.likes.length : ''} Me gusta
        </button>
        {isOwn && (
          <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 'auto' }}>Tú</span>
        )}
      </div>
    </div>
  )
}
