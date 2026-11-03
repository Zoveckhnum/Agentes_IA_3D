# Estado comprobado de las integraciones

Fecha: 3 de noviembre de 2026. Revisión de lectura, sin ejecutar tareas del motor,
enviar mensajes, crear PR, subir archivos, cambiar permisos o migrar credenciales.
No se mostraron valores de autenticación ni contenido de archivos privados.

## Instalación SQL publicada

| Integración | Resultado real |
| --- | --- |
| Portal → IIS → API → SQL Server | Correcto. Salud pública, cifrado, certificado y permisos SQL restringidos verificados. |
| Cloudflare Tunnel | Servicio activo y comprobación `/ready` con HTTP 200. |
| Adaptador del motor → API SQL | Autenticación técnica y lectura correctas: 24 agentes y 10 tareas visibles según sus permisos. No ejecutó ninguna tarea. |
| Respaldos SQL | Última tarea con resultado 0; el respaldo posterior a crear los agentes pasó restauración de prueba. |
| Servicio del motor autónomo | Detenido; no hay proceso worker.mjs activo. La API web es un servicio distinto. |
| GitHub/Telegram/Drive en la copia SQL | Pendiente de conectar la configuración externa a esta instalación. No hay registro de proyectos ni autorización OAuth de Drive en esta copia; el paquete CMS del motor no contiene credenciales GitHub/Telegram/Google. |

La copia SQL no tiene `.env` ni `integraciones.env` locales. La información de
configuración anterior permanece en el proyecto original; no se copió ni modificó
durante esta revisión. La presencia de una habilidad o un nombre de herramienta en
el catálogo no activa por sí sola un conector.

## Conexiones del proyecto original

Se ejecutó su diagnóstico de integraciones, que usa su configuración de forma interna
y devuelve estados. No se abrieron los archivos privados para mostrar su contenido.

| Integración | Comprobación | Límite de la comprobación |
| --- | --- | --- |
| GitHub | Acceso correcto a 2 repositorios registrados. | No se crearon ramas, commits ni PR; la escritura no se comprobó mediante una entrega real. |
| Google Drive | Autorización persistente y lectura correctas de la carpeta de la aplicación. | No se subieron documentos ni se modificaron permisos. |
| Telegram | El bot responde a getMe y no tiene webhook activo que impida polling. Hay propietario configurado. | No se enviaron mensajes ni se consumió la cola con getUpdates; falta comprobar el flujo desde la cuenta del propietario con el motor autorizado. |

Esos resultados pertenecen a `Agentes_IA_3D`, no acreditan que el motor de
`Agentes_IA_3D-sql-local` esté usando las mismas conexiones.

## Codex y conectores adicionales

- `codex login status` confirma credenciales presentes mediante ChatGPT para el usuario
  de Windows actual. No se hizo una inferencia ni se consumieron tokens para esta prueba.
  Esto no comprueba todavía autenticación bajo una futura identidad de servicio.
- `codex mcp list --json` devolvió una lista vacía para ese usuario/contexto. No se
  arrancaron servidores MCP externos para probarlos.
- El motor configura su MCP `proyectos` dinámicamente por rol; por eso la lista vacía
  del CLI no demuestra ausencia de ese código. En esta copia aún falta su configuración
  de proyectos y conexiones externas.
- No se acreditó operación de Gmail, Calendar, Magnific u otros conectores citados en
  el catálogo. Los conectores disponibles en esta conversación son independientes
  de los que utiliza la aplicación.

La comprobación de login acredita presencia local de credenciales, como documenta
[OpenAI](https://learn.chatgpt.com/docs/developer-commands); no garantiza vigencia de
una sesión remota ni capacidad de un servicio Windows con otra identidad.

## Trabajo necesario para completar la activación

1. Conectar la configuración de proyectos y las autorizaciones existentes al motor SQL
   mediante configuración protegida, sin incorporar secretos a Git o al frontend.
2. Preparar una identidad y servicio del motor con sus permisos, rutas de trabajo y
   autenticación propios; comprobar nuevamente las integraciones bajo esa identidad.
3. Validar una tarea sintética controlada y el intercambio Telegram del propietario.
   Mantener separadas las autorizaciones para mensajes, entregas externas y producción.

Esta revisión confirma conexiones existentes y sus límites; no inicia automáticamente
el motor ni activa integraciones que puedan procesar las tareas pendientes.
