import React from 'react'

// Librería de íconos SVG — estilo consistente: stroke 2, línea redondeada,
// heredan color con currentColor. Uso: <Icon name="bell" size={16} />
const PATHS = {
  // Navegación
  grid:      <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  columns:   <><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="9.5" y="3" width="5" height="12" rx="1"/><rect x="16" y="3" width="5" height="15" rx="1"/></>,
  checkSquare: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-5"/></>,
  users:     <><circle cx="9" cy="7" r="4"/><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/><circle cx="17.5" cy="7.5" r="3"/><path d="M22 21v-1.5a3.5 3.5 0 0 0-3-3.46"/></>,
  user:      <><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></>,
  mail:      <><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 6 10-6"/></>,
  building:  <><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2m2 0h2M9 11h2m2 0h2M9 15h2m2 0h2M10 21v-3h4v3"/></>,
  menu:      <><path d="M3 6h18M3 12h18M3 18h18"/></>,
  office:    <><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-5h6v5"/><path d="M9 10h.01M15 10h.01M12 10h.01"/></>,
  coffee:    <><path d="M17 8h1a3 3 0 0 1 0 6h-1"/><path d="M3 8h14v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><path d="M7 2v2M11 2v2M15 2v2"/></>,
  door:      <><path d="M5 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><path d="M15 12h.01"/></>,

  // Acciones
  power:     <><path d="M12 2v10"/><path d="M5.6 5.6a9 9 0 1 0 12.8 0"/></>,
  plus:      <><path d="M12 5v14M5 12h14"/></>,
  edit:      <><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></>,
  trash:     <><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/></>,
  eye:       <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
  x:         <><path d="M18 6 6 18M6 6l12 12"/></>,
  check:     <><path d="m4 12 5 5L20 6"/></>,
  download:  <><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></>,
  copy:      <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  volume:    <><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></>,
  volumeOff: <><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m16 9 6 6M22 9l-6 6"/></>,
  logout:    <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></>,
  send:      <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
  search:    <><circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/></>,
  chevronL:  <><path d="m15 6-6 6 6 6"/></>,
  chevronR:  <><path d="m9 6 6 6-6 6"/></>,
  chevronUp: <><path d="m6 15 6-6 6 6"/></>,
  chevronDown: <><path d="m6 9 6 6 6-6"/></>,

  // Timer / estados
  play:      <><path d="M6 4l14 8-14 8Z"/></>,
  pause:     <><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></>,
  skip:      <><path d="M5 4l10 8-10 8ZM19 4v16"/></>,
  reset:     <><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></>,
  clock:     <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></>,
  hourglass: <><path d="M6 2h12M6 22h12M8 2v4l4 4 4-4V2M8 22v-4l4-4 4 4v4"/></>,
  timer:     <><circle cx="12" cy="13" r="8"/><path d="M12 9v4M9 2h6"/></>,
  calendar:  <><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></>,
  gear:      <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></>,

  // Notificaciones / feedback
  bell:      <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>,
  bulb:      <><path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 4.9 12 4.6 4.6 0 0 0-1.4 3v1H8.5v-1a4.6 4.6 0 0 0-1.4-3A7 7 0 0 1 12 2Z"/></>,
  alert:     <><path d="M12 3 2 21h20L12 3Z"/><path d="M12 10v4M12 17.5v.5"/></>,
  info:      <><circle cx="12" cy="12" r="9"/><path d="M12 8v.5M12 11v5"/></>,
  trendUp:   <><path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/></>,
  trendDown: <><path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/></>,
  star:      <><path d="m12 2 3 6.6 7 .9-5.2 4.9 1.4 7-6.2-3.5L5.8 21.4l1.4-7L2 9.5l7-.9Z"/></>,
  trophy:    <><path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0Z"/><path d="M7 6H4a1 1 0 0 0-1 1c0 2.5 2 4 4 4M17 6h3a1 1 0 0 1 1 1c0 2.5-2 4-4 4"/></>,
  target:    <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  flag:      <><path d="M5 21V4"/><path d="M5 4c4-2.5 8 2.5 14 0v9c-6 2.5-10-2.5-14 0"/></>,
  link:      <><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></>,
  sun:       <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  moon:      <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></>,
  briefcase: <><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></>,
  wrench:    <><path d="M14.7 6.3a4.5 4.5 0 0 0 6 6L15 18a3 3 0 0 1-4.2 0l-4.8-4.8a3 3 0 0 1 0-4.2l5.7-5.7a4.5 4.5 0 0 0 3 3Z" transform="rotate(90 12 12)"/></>,
  question:  <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5M12 17v.5"/></>,
  wifi:      <><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/></>,
}

export default function Icon({ name, size = 16, strokeWidth = 2, style = {}, className = '', filled = false }) {
  const path = PATHS[name]
  if (!path) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: 'middle', ...style }}
      className={className}
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}
