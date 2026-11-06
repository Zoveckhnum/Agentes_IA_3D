# Puente privado para portales

`server/src/portal-bridge.mjs` permite que un portal autorizado solicite borradores al agente configurado, manteniendo el motor y las aprobaciones existentes.

Configuración externa en `%ProgramData%/StackBI/Applications/agentes-ia-3d/portal-bridge.json`: `enabled`, `id`, `label`, `agentId`, `tokenHash` SHA-256 y `officeStatusUrl` del controlador loopback. No guardar la clave en el repositorio ni en el frontend. ACL de lectura para el servicio de la API; administración para SYSTEM y administradores.

La API solo acepta conexiones loopback, sin Origin y con Bearer propio. Rutas bajo `/api/integrations/portal`: GET `/status`, POST `/jobs`, GET `/jobs/:id?userId=ID`. La clave no es una credencial del motor ni da acceso a `/api/data/*`. La pasarela pública sigue rechazando el acceso.

El trabajo contiene UUID estable, usuario del portal, ID de expediente, instrucción y contexto limitado. No admite rutas ni asignaciones elegidas por el llamante. La tarea usa un espacio `portal-ID-UUID` y conserva identidad y hash de entrada; repetir una solicitud con contenido distinto da conflicto. La consulta de una entrega exige el mismo usuario e integración. El portal responde por sus permisos sobre cada expediente.

La oficina debe estar abierta para crear o consultar trabajos. El puente consulta el controlador y no puede reabrirla; se conserva la decisión del CEO. Los trabajos producen borradores para revisión humana y se procesan por las reglas y límites del motor existente. No se conceden nuevas facultades para publicar ni ejecutar operaciones protegidas.

Pruebas: `npm --prefix server test`. Incluyen credencial, Origin, oficina cerrada, idempotencia, aislamiento de usuario, datos extra y rechazo de la clave en la API general. La publicación del 5 de noviembre se hizo como mantenimiento autorizado, clonando el runtime vigente y cambiando únicamente `main.mjs` y el nuevo módulo. No se publicó el checkout completo con cambios ajenos, ni se reinició el motor o el servicio de aprobaciones.


Actualización de conversación, 5 de noviembre de 2026: el puente pide citar preguntas/áreas y declarar fuentes parciales. Un intercambio previo se considera contexto, no evidencia independiente. Devuelve agentQuestion cuando falta información; no devuelve agentError al portal, sino un aviso general. Treinta y una pruebas del servidor aprobadas. Parche publicado sobre el runtime vigente en 20261105-135951-portal-bridge, conservando motor, pasarela, cierre y aprobaciones. La conversación y los permisos de cada expediente se resuelven en el portal, no por SQL libre generado por el modelo.
## Trazabilidad de solicitudes de iqualitys (5 de noviembre de 2026)

QA proporcional y recuperación automática: `motor/calidad.mjs` reintenta una vez un dictamen incoherente de iqualitys y conserva intentos con redacción de secretos. `motor/portal-quality-cycle.mjs` permite hasta dos correcciones del autor por defectos concretos, con nueva QA y presupuesto persistente. No reintenta autor frente a bloqueo, permiso, seguridad o falta de datos. Conserva controles de lease, fuentes y aprobación profesional.

POST privado `/jobs/:id/review` solicita únicamente QA para la entrega existente: UUID idempotente, usuario propietario, versión y SHA-256; CAS sobre entrega/versión/lease. Solo iqualitys sin proyecto, tarea terminada en espera. El motor comprueba manifiesto de fuentes y no incrementa ejecuciones del autor. Conserva pendingAcceptance; la petición exclusiva autoriza únicamente revisar ese borrador. Campos portalQaOnly, portalQaLastRequest, qualityHistory y qualityCorrectionCount protegidos contra escritura de usuarios. No compartir esta clave ni exponer la ruta en el navegador. 97 pruebas motor y 36 servidor aprobadas; publicación selectiva sin modificar CMS, política, credenciales o bot de aprobaciones.

GET de trabajo incluye una instantánea acotada: agente autor, fechas realmente registradas, duración, ejecuciones y revisiones QA con evidencia/incidencias. No expone el contexto completo ni errores técnicos o credenciales. La URL vigente es `https://stack-office.stackbi.com.mx`.

`/portal-task.html?task=portal-iqualitys-UUID` presenta una tarjeta de solo lectura. La página usa la sesión existente y `/api/data/read`, sin recibir la clave del puente; no otorga acceso por conocer el enlace. Sigue distinguiendo QA bloqueada de aprobación y revisión humana. No permite ejecutar, editar, aprobar ni reabrir la oficina.

Helper canónico `server/src/portal-job-trace.mjs`, con copia pública para la tarjeta. Empaquetado CI y actualización SQL incluyen los activos de `server/public` y esa copia; cinco pruebas de empaquetado aprobadas. Esta publicación fue un parche selectivo del runtime, conservando motor, frontend, bot de aprobaciones y configuración privada; no es una publicación CI del checkout completo. Las 34 pruebas de servidor pasaron.
