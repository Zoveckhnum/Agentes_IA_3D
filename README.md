# Agentes IA 3D con OpenAI Codex

![Oficina con agentes de IA](docs/oficina-3d.jpg)

Una oficina 3D con agentes de IA: tareas, Kanban, chat y entregables pendientes de aprobación.
La web, el motor y los datos funcionan en tu PC con **Firebase Emulator Suite**.
Los agentes usan **OpenAI Codex** y necesitan conexión a OpenAI. No requiere Claude ni un proyecto de Firebase en la nube.

## Arranque local

Requisitos: **Node.js 22+**, **Java 21+** y acceso a Codex mediante tu cuenta de ChatGPT o una API key.
Los límites y el costo dependen de tu cuenta; el proyecto tiene licencia MIT.

Desde la raíz del repositorio:

```bash
npm run install:all
npm run setup
npm run codex -- login
npm run check:codex
npm run local
```

En Windows, usa `npm.cmd` si PowerShell bloquea `npm.ps1`.
Si no tienes Java, puedes descargarlo solo para este proyecto:

```powershell
powershell -ExecutionPolicy Bypass -File tools/java-local.ps1
```

El script descarga el JRE 21 de Eclipse Temurin, verifica su SHA-256 y lo extrae en `.local/java/`.
En macOS/Linux instala Java 21+ y asegúrate de que `java -version` funcione.

Abre **http://127.0.0.1:5173** e inicia sesión con correo y contraseña.
El formulario incluye un desplegable **Credenciales de demostración** con la cuenta local.
La sesión dura hasta cerrar la pestaña, salvo que marques **Mantener sesión en este navegador**.
Firebase se puede inspeccionar en **http://127.0.0.1:4000**.
La primera ejecución descarga los emuladores. Todos los servicios escuchan en loopback.
Puertos: web 5173, Authentication 9099, Firestore 8080, panel 4000, hub 4400, logs 4500 y websocket 9150.

`npm run local` inicia los emuladores, crea el administrador y robot de prueba, prepara tres agentes
(Coordinador, Redacción e Investigación) y arranca web y motor. Crea una tarea corta y asígnala a Redacción:
pasará de Pendiente a En progreso y luego a Espera Aprobación con su entrega de Codex.
Los usuarios de demostración son `admin@oficina.local` y `robot@oficina.local`,
con contraseña de prueba `solo-emulador-local`. Se usan exclusivamente en los emuladores.

Detén con **Ctrl+C** para exportar los datos a `.local/data/`. Se importan en el próximo arranque.
Cerrar a la fuerza la terminal puede impedir la exportación. `.local/`, las credenciales, los trabajos
y las entregas están excluidos de Git. El sembrado conserva el nombre y los datos del perfil,
no reemplaza agentes existentes ni duplica el equipo.

## Configurar Codex y el negocio

- **`AGENTS.md`** y **`motor/AGENTS.md`** contienen las instrucciones que entiende Codex.
- **`motor/negocio.json`** define negocio, dueño y equipo. **`roles/catalogo.json`** contiene las misiones y capacidades.
- **`app/.env`** configura la marca y la conexión local. Reinicia la web al cambiarlo.
- **`motor/.env`** admite `CODEX_MODEL` (vacío usa el modelo predeterminado de Codex).
- Para autenticación API, introduce tú mismo `CODEX_API_KEY` en `motor/.env`; también se acepta `OPENAI_API_KEY`.
  Nunca uses variables `VITE_` para una clave privada. Sin clave, se reutiliza la sesión de `codex login`.
- `npm run setup` conserva los archivos de configuración existentes.

Puedes abrir este repositorio con Codex y pedirle que personalice el negocio, los roles o las instrucciones.
No existe un comando `/instalar` de Claude en esta versión.

El motor usa el SDK oficial `@openai/codex-sdk` y el CLI instalado en `motor/node_modules`.
Procesa eventos JSONL, conserva el identificador de conversación del coordinador de Telegram,
guarda el uso de tokens y aplica un tiempo máximo de 25 minutos por ejecución.
El presupuesto `maxTurns` de cada rol limita ahora las invocaciones de herramientas.
Ejecuta con sandbox `workspace-write`, sin acceso de red de shell y sin aprobaciones interactivas.
Las reglas de entrega se incluyen explícitamente en cada petición, incluso al reanudar sesiones.
Las credenciales de Firebase y Telegram no se pasan al proceso de Codex.

### Conectores opcionales

El equipo BI incluye un servidor MCP propio para proyectos: GitHub (lectura, ramas nuevas y PR en borrador)
y Google Drive (carpetas privadas y entregas versionadas). Consulta la [guía paso a paso de integraciones](docs/INTEGRACIONES.md)
para preparar GitHub, Telegram y tu Drive personal. Ejecuta `npm run equipo:bi` y `npm run integraciones:check`.
Los revisores no reciben herramientas de escritura de este servidor. Las tareas técnicas pasan por QA independiente
y la plataforma bloquea su cierre si la revisión está pendiente, rechazada o bloqueada.

Los conectores de una cuenta Claude **no se transfieren a Codex**. Gmail, Calendar y Magnific
requieren servidores MCP compatibles configurados por separado en Codex. Los nombres del catálogo son
orientativos: `herramientas` describe capacidades y activa/desactiva búsqueda web, pero no impone una
lista de permisos por rol a los servidores MCP. Configura `enabled_tools` en cada servidor y expón solo
las operaciones que quieras permitir. Los MCP pueden actuar fuera del sandbox de archivos.
El motor hereda la configuración MCP de tu usuario de Codex.

El servidor de medios incluido se registra desde la raíz con una ruta absoluta:

```bash
npm run codex -- mcp add agentes-media -- node /ruta/absoluta/Agentes_IA_3D/motor/media-server.mjs
```

En Windows usa tu ruta entre comillas. Para skills de diseño compatibles con Codex, usa
`motor/.agents/skills/<nombre>/SKILL.md`. Los archivos generados quedan en la carpeta de la tarea
o, usando el servidor de medios, en `motor/entregas/<agente>/`.
Telegram sigue siendo opcional: configura `TELEGRAM_BOT_TOKEN` y `TELEGRAM_OWNER_ID` en `motor/integraciones.env`.
Las herramientas de video y voz pueden descargar modelos al usarse por primera vez.

## Comandos de diagnóstico

| Comando (desde la raíz) | Función |
|---|---|
| `npm run local` | Inicia todos los servicios locales |
| `npm run check:codex` | Verifica autenticación y una respuesta real de Codex; consume una petición |
| `npm run check` | Verifica conexión y permisos del robot; requiere emuladores activos |
| `npm test` | Pruebas del adaptador sin llamadas a OpenAI |
| `npm run build` | Compila la web |
| `npm run emulators` | Ejecuta solo los emuladores |
| `npm run seed` | Prepara usuarios y agentes con emuladores ya activos |
| `npm run dev` / `npm run motor` | Ejecutan web y motor por separado |
| `npm run equipo:bi` | Prepara los 12 perfiles especializados |
| `npm run integraciones:check` | Diagnóstico de GitHub, Telegram y Drive |
| `npm run drive:login` | Autoriza el Drive personal desde el navegador local |
| `npm run proyecto -- id propietario/repo Nombre` | Registra un repositorio por proyecto |
| `npm run proyecto:preparar -- id tarea_id` | Prepara un repositorio local separado y una rama de tarea |
| `npm run test:reglas` | Prueba permisos y controles QA contra los emuladores activos |

Si falla el acceso local, revisa que los emuladores están activos y ejecuta `npm run seed`.
La [guía de aislamiento](docs/AISLAMIENTO.md) describe la preparación local en `products/`, sus controles y cómo conectar tareas al worker usando el campo Proyecto del repositorio.
También puedes pedir al coordinador que registre un proyecto indicando su ID y repositorio GitHub; el registro es local y no crea ni clona el repositorio remoto.
Si Codex devuelve 401 o no tiene sesión, ejecuta `npm run codex -- login`.
Si hay un puerto ocupado, detén la instancia anterior antes de iniciar otra.
El indicador “Motor conectado” confirma Firebase; `check:codex` verifica OpenAI por separado.

## Firebase en la nube (opcional)

Para usar un proyecto real, crea Authentication (Google y correo/contraseña), Firestore y el usuario robot.
Prepara un `instalacion.json` con el formato de `tools/configurar.mjs` y ejecuta:

```bash
node tools/configurar.mjs instalacion.json
```

El configurador genera los `.env`, conserva las opciones de Codex y desactiva los emuladores.
Introduce la contraseña del robot en `motor/.env`. Añade `localhost` y `127.0.0.1` a los dominios
autorizados de Authentication y despliega las reglas generadas usando `--config firebase.cloud.json` en tu proyecto.
Usa `npm run dev` y `npm run motor` en terminales separadas. No uses `npm run local` con datos de producción.
Hosting es opcional y no se publica durante la instalación local.
La [guía de despliegue](docs/DESPLIEGUE.md) explica cómo activar Firebase real, publicar la web
y mantener el motor en una VM con reinicio automático. No publiques los emuladores.

## Estructura y licencia

`app/`: React, Vite, Three.js. `motor/`: Node y Codex. `roles/`: catálogo compartido.
`tools/`: configuración y arranque. `.local/`: Java y datos locales (no versionados).

MIT. Proyecto original de [Ederland Studio](https://eder-land.com).

Referencias: [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk),
[ejecución no interactiva](https://learn.chatgpt.com/docs/non-interactive-mode),
[Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite/install_and_configure).
