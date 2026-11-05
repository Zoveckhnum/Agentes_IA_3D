# Puente privado para portales

`server/src/portal-bridge.mjs` permite que un portal autorizado solicite borradores al agente configurado, manteniendo el motor y las aprobaciones existentes.

Configuración externa en `%ProgramData%/StackBI/Applications/agentes-ia-3d/portal-bridge.json`: `enabled`, `id`, `label`, `agentId`, `tokenHash` SHA-256 y `officeStatusUrl` del controlador loopback. No guardar la clave en el repositorio ni en el frontend. ACL de lectura para el servicio de la API; administración para SYSTEM y administradores.

La API solo acepta conexiones loopback, sin Origin y con Bearer propio. Rutas bajo `/api/integrations/portal`: GET `/status`, POST `/jobs`, GET `/jobs/:id?userId=ID`. La clave no es una credencial del motor ni da acceso a `/api/data/*`. La pasarela pública sigue rechazando el acceso.

El trabajo contiene UUID estable, usuario del portal, ID de expediente, instrucción y contexto limitado. No admite rutas ni asignaciones elegidas por el llamante. La tarea usa un espacio `portal-ID-UUID` y conserva identidad y hash de entrada; repetir una solicitud con contenido distinto da conflicto. La consulta de una entrega exige el mismo usuario e integración. El portal responde por sus permisos sobre cada expediente.

La oficina debe estar abierta para crear o consultar trabajos. El puente consulta el controlador y no puede reabrirla; se conserva la decisión del CEO. Los trabajos producen borradores para revisión humana y se procesan por las reglas y límites del motor existente. No se conceden nuevas facultades para publicar ni ejecutar operaciones protegidas.

Pruebas: `npm --prefix server test`. Incluyen credencial, Origin, oficina cerrada, idempotencia, aislamiento de usuario, datos extra y rechazo de la clave en la API general. La publicación del 5 de noviembre se hizo como mantenimiento autorizado, clonando el runtime vigente y cambiando únicamente `main.mjs` y el nuevo módulo. No se publicó el checkout completo con cambios ajenos, ni se reinició el motor o el servicio de aprobaciones.


Actualización de conversación, 5 de noviembre de 2026: el puente pide citar preguntas/áreas y declarar fuentes parciales. Un intercambio previo se considera contexto, no evidencia independiente. Devuelve agentQuestion cuando falta información; no devuelve agentError al portal, sino un aviso general. Treinta y una pruebas del servidor aprobadas. Parche publicado sobre el runtime vigente en 20261105-135951-portal-bridge, conservando motor, pasarela, cierre y aprobaciones. La conversación y los permisos de cada expediente se resuelven en el portal, no por SQL libre generado por el modelo.
