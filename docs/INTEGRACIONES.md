# Equipo e integraciones

Todos los comandos se ejecutan desde la raíz del repositorio, en PowerShell. La configuración del motor es independiente de los conectores de esta conversación de Codex.

## Equipo preparado

`npm run equipo:bi` prepara 12 perfiles: coordinación, arquitectura y seguridad, SQL/DBA, ingeniería de datos, BI, backend, frontend, IA aplicada, DevOps, QA de software, QA de datos y mejora continua. En local conserva los agentes anteriores en reserva y sus tareas. En Firebase real prepara los perfiles; `npm --prefix motor run crear-agentes` crea los que falten, sin duplicar IDs.

El coordinador recibe solicitudes y delega tareas en el Pipeline. Debe incluir objetivo, insumos, alcance, criterios de aceptación y destino. El motor procesa una tarea del Pipeline a la vez. Cada bloque delegado crea también una tarea de continuación del coordinador, guardada junto con la etapa en Firestore. La continuación espera a que todas sus dependencias estén entregadas y hayan pasado su QA obligatorio. Conserva la solicitud original y recibe copias de los archivos y evidencia en `insumos/<id>/`. Puede delegar la etapa siguiente o guardar el producto revisado en los destinos solicitados. Las tareas de un mismo bloque deben ser independientes entre sí; las dependencias se separan en etapas. Los chats pueden responder mientras una tarea está en ejecución.

El avance entre etapas no marca tareas como aprobadas por el propietario ni autoriza integrar PR o desplegar. QA pendiente, fallido o bloqueado detiene la continuación: corrige la tarea y vuelve a revisarla. Hay un límite de ocho etapas automáticas por solicitud para evitar ciclos. Las tareas creadas antes de esta función necesitan una continuación explícita; no se reabren automáticamente. Un aviso de finalización corresponde a una tarea, no al proyecto completo: el guardado se acredita con enlaces a las entregas reales. Las continuaciones conservan sus dependencias tras reiniciar el motor; los archivos locales también deben conservarse en `motor/trabajos/`.

Los roles técnicos y de datos pasan por el QA indicado en el catálogo. El revisor es otro perfil, trabaja sobre una copia de los archivos y devuelve evidencia, incidencias y un resultado: aprobado, rechazado o bloqueado. Se registra una huella de la entrega; si cambia durante la revisión, se invalida. La plataforma impide completar una tarea revisada que no tenga QA aprobado. Cambiar requisitos invalida la aprobación. Las correcciones se solicitan desde Feedback → Correcciones; no hay bucles automáticos de reintentos. Tras dos revisiones fallidas, el coordinador debe escalar la decisión al dueño. No se garantiza ausencia de errores ni se sustituyen las pruebas con datos y herramientas reales.

El diagnóstico de conexiones es de lectura y no envía mensajes ni crea repositorios:

```powershell
npm run integraciones:check
```

## 1. GitHub: un repositorio por proyecto

1. En GitHub crea un repositorio **privado** para el primer proyecto, con un README inicial. Debe tener al menos un commit y una rama predeterminada. No necesitas usar el repositorio de la plataforma como almacén de todos los proyectos.
2. En tu cuenta: **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**. Selecciona el propietario correcto y **Only select repositories**. Autoriza únicamente los repositorios de trabajo. Define una caducidad que puedas renovar.
3. Permisos del repositorio: **Contents: Read and write**, **Pull requests: Read and write**; Metadata queda en lectura. Si la organización exige aprobación o SSO, complétalos. No concedas Administration ni Workflows.
4. Abre `motor/integraciones.env` con un editor local. El diagnóstico lo crea si falta. Guarda el token en `GITHUB_TOKEN=`. No lo pegues en el chat, archivos de tareas ni commits.
5. Registra el destino, sustituyendo los valores de ejemplo:

   ```powershell
   npm run proyecto -- ventas TU_USUARIO/bi-ventas Analítica de ventas
   npm run proyecto -- operaciones TU_USUARIO/portal-operaciones Portal de operaciones
   npm run integraciones:check
   ```

6. Para cada repositorio nuevo, amplía la selección del token o crea uno específico. Los destinos se guardan en `motor/proyectos.json`, excluido de Git. Los IDs de proyecto son estables; para cambiar el repositorio de un ID existente usa un nuevo ID, evitando mezclar historiales.
7. Pide desde la plataforma o Telegram: “En el proyecto ventas, prepara un README de prueba y guárdalo en GitHub como PR en borrador. No lo integres”. Verifica en GitHub el PR y sus archivos. El diagnóstico solo comprueba acceso; esta entrega comprueba los permisos de escritura y PR.
8. Cuando QA haya revisado la entrega y tú estés conforme, integra el PR desde GitHub. El conector no puede hacer merge, borrar ramas, desplegar ni modificar `.github/`. Usa protección de ramas cuando tu plan de GitHub la permita.

El conector crea una rama nueva `agentes/<proyecto>/<versión>` por entrega. Una interrupción de la API puede dejar una rama sin PR; revisa el repositorio antes de repetir. Cada llamada acepta hasta 30 archivos, de hasta 10 MB cada uno. No es un clon completo ni sincronización bidireccional: el agente puede leer archivos del repo y guardar los archivos seleccionados de su tarea.

Si el repositorio ya tiene GitHub Actions, la creación de ramas o PR puede activar sus workflows. Configura los despliegues para requerir aprobación y las ramas adecuadas; el conector no modifica esa configuración.

Los tokens fine-grained se limitan a un propietario. Para distintos propietarios, añade por ejemplo `GITHUB_TOKEN_CLIENTE=` en `motor/integraciones.env` y `"tokenEnv": "GITHUB_TOKEN_CLIENTE"` al proyecto correspondiente en `motor/proyectos.json`. Sin `tokenEnv` se usa `GITHUB_TOKEN`. Para operación organizacional duradera, GitHub recomienda una GitHub App; el conector inicial usa PAT. [Documentación oficial](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

## 2. Telegram: enviar tareas al coordinador

1. En Telegram abre **@BotFather**, verificando que sea la cuenta oficial.
2. Envía `/newbot`, elige nombre y un usuario terminado en `bot`.
3. Copia el token **solo** en `TELEGRAM_BOT_TOKEN=` de `motor/integraciones.env`.
4. Deja `TELEGRAM_OWNER_ID=` vacío por este primer arranque. Reinicia `npm run local` si usas emuladores, o el servicio del motor si ya usas Firebase real.
5. Abre un chat **privado** con tu bot y envía `/start`. El bot te mostrará tu ID numérico; también aparecerá en la terminal del motor. Mientras no haya propietario, no ejecuta tareas.
6. Escribe ese número en `TELEGRAM_OWNER_ID=`, guarda y reinicia el motor.
7. Ejecuta `npm run integraciones:check`. Envía `/ayuda`, `/equipo`, `/estado` y `/proyectos` desde tu cuenta. Los mensajes de otras cuentas y de grupos se ignoran.
8. Prueba una tarea sencilla: “Prepara un diseño de tablas para ventas; proyecto ventas; usa datos sintéticos, documenta supuestos y entrega criterios de validación. Por ahora no almacenes nada fuera de la plataforma”. Comprueba que aparezca asignada en el Pipeline.
9. Si un agente solicita información, usa **Responder** sobre su mensaje para devolverle los datos. `/nuevo` reinicia la conversación del coordinador.

El bot usa long polling; no necesita dominio, IP pública ni puertos entrantes. Mantén **una sola instancia** del motor por bot. Un webhook activo impide usar polling: si reutilizas un bot que tenía webhook, llama al método oficial `deleteWebhook` desde un cliente local de confianza, sin publicar su token. El diagnóstico detecta esta condición. El cursor se conserva entre reinicios y las tareas delegadas por el mismo mensaje tienen IDs estables para reducir duplicados. [Bot API oficial](https://core.telegram.org/bots/api).

## 3. Google Drive personal

1. En [Google Cloud Console](https://console.cloud.google.com/), selecciona el mismo proyecto de Firebase o un proyecto de Google Cloud que controles.
2. En **APIs y servicios → Biblioteca**, habilita **Google Drive API**.
3. Configura **Google Auth Platform** (o Pantalla de consentimiento OAuth): nombre de la app, correo de soporte y audiencia **External** para una cuenta personal. Durante pruebas añade tu propio Gmail como usuario de prueba.
4. En acceso a datos añade únicamente `https://www.googleapis.com/auth/drive.file`. Este alcance permite trabajar con archivos de esta app; no otorga acceso general a todo tu Drive.
5. En **Clientes / Credenciales**, crea un **ID de cliente OAuth → Aplicación de escritorio**. Descarga el JSON y guárdalo exactamente como `motor/credenciales/google-oauth.json`. No uses una cuenta de servicio para tu Drive personal.
6. En tu PC ejecuta:

   ```powershell
   npm run drive:login
   ```

7. Abre la URL que muestra la terminal en el navegador **del mismo PC**, elige tu cuenta personal y autoriza. El proceso escucha un callback temporal en loopback, con PKCE y comprobación de estado. Debe terminar mostrando “Drive conectado” y un enlace a la carpeta privada **Stackbi Office**.
8. Ejecuta `npm run integraciones:check`. La autorización persistente se guarda en `motor/credenciales/google-token.json`, excluido de Git.
9. Registra un proyecto con el comando de GitHub anterior, o uno que use solo Drive:

   ```powershell
   npm run proyecto -- informes - Informes internos
   ```

10. Pide al coordinador: “Para el proyecto informes, crea prueba.txt con la frase Integración verificada y guárdalo en Drive”. Abre el enlace devuelto y verifica contenido y carpeta. Cada proyecto obtiene una subcarpeta; cada subida genera una versión nueva con fecha y huella del archivo. No cambia permisos ni comparte enlaces públicamente.
11. Para funcionamiento permanente revisa el estado de publicación OAuth: en modo **Testing**, con este alcance, los refresh tokens pueden caducar a los siete días. Pasa la app a **Production** cuando corresponda y completa los requisitos que Google indique. Si autorizaste durante pruebas, vuelve a ejecutar `drive:login` después del cambio. También puede ser necesario reautorizar si revocas acceso o caducan credenciales. [Política de expiración](https://developers.google.com/identity/protocols/oauth2#expiration).

La integración inicial almacena y lista entregas creadas por esta app. No es una sincronización de todo tu Drive ni permite leer automáticamente cualquier archivo que subas manualmente a esa carpeta. Para incorporar fuentes de Drive ajenas a la app hace falta selección explícita mediante Google Picker o una ampliación de la integración. [OAuth de escritorio](https://developers.google.com/identity/protocols/oauth2/native-app), [alcance drive.file](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Activación y comprobación final

Para autorizar de forma persistente al bot a crear PR en borrador y guardar versiones en Drive,
el propietario puede establecer `PROJECTS_ALLOW_DRAFT_WRITES=true` en `motor/integraciones.env`.
Reinicia el motor después de cambiarlo. El permiso se aplica únicamente a `github_borrador` y
`drive_guardar`, para roles con escritura y destinos registrados. No habilita merge, despliegues,
borrado ni cambios de permisos. Para revocarlo, usa `false` y reinicia el motor.
Las consultas MCP declaran su carácter de solo lectura; no necesitan este permiso de escritura.

Los cambios de Telegram requieren reiniciar el motor. Las herramientas de proyectos leen su configuración al usarse. Al probar, crea entregas pequeñas sin datos reales; verifica enlaces, contenido y el informe QA en la plataforma. Después de autenticar los tres servicios:

```powershell
npm run integraciones:check -- --strict
npm run check:codex
```

Los secretos quedan en archivos locales ignorados por Git. El filtro de archivos rechaza rutas fuera de la tarea, archivos de entorno y algunos patrones de claves, pero no sustituye la revisión del contenido antes de almacenarlo. Para nube, transfiere las credenciales por un canal privado y restringe el acceso al usuario del servicio; no las copies al directorio público de Hosting.
