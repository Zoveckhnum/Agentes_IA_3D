# Stackbi Office

> Si eres un agente de IA ejecutando una tarea del motor (tu carpeta de trabajo está dentro de `motor/trabajos/`),
> ignora este archivo: tus reglas están en `motor/AGENTS.md` y en el texto de tu tarea.

Proyecto de código abierto: una oficina 3D con agentes de IA para cualquier negocio.

- `app/` — app web (React + Vite + Three.js + Firebase): Pipeline de tareas, Oficina 3D, chat con agentes, equipo.
- `motor/` — motor local (Node): toma las tareas de los agentes y las ejecuta con OpenAI Codex; Telegram, voz, medios.
- `roles/catalogo.json` — catálogo de roles (habilidades) que comparten la app y el motor.
- `firestore.rules` — reglas de seguridad. `tools/configurar.mjs` las personaliza.
- `README.md` — instalación y configuración con Codex.

## Si la persona quiere instalarlo o configurarlo

La instalación predeterminada es local con emuladores Firebase y OpenAI Codex.
Lee `README.md`. Usa `npm run setup`, instala dependencias
y `npm run local`. No publiques en Firebase Hosting salvo que la persona lo solicite.

## Reglas para trabajar en este repo

- Nunca leas, muestres ni subas `motor/.env`, `app/.env`, `motor/negocio.json` ni contraseñas o tokens.
- Nada específico de un negocio va en el código: va en `.env`, `motor/negocio.json` o `roles/catalogo.json`.
- Los textos de la interfaz están en español.
- Para agregar una habilidad nueva, crea un rol en `roles/catalogo.json` (misión, herramientas, entrega).
