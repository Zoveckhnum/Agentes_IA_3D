# Conector de Portal iqualitys · 7 de noviembre de 2026

Implementado localmente, sin publicación ni activación del runtime. La guía completa se encuentra en el checkout hermano `Check-list_diagnostico/central-portal/docs/CONECTORES_Y_PRUEBA_SSO.md`; entregar ambos proyectos junto con Taskosaur.

`server/src/central-connector.mjs` es copia verificable del adaptador canónico del portal central. Configuración opt-in en `applicationConfig`: `CENTRAL_ACCESS_REQUIRED`, `CENTRAL_PORTAL_ORIGIN`, `CENTRAL_PORTAL_SERVICE_TOKEN`, `CENTRAL_OIDC_ISSUER`, `CENTRAL_OIDC_CLIENT_ID`, `CENTRAL_OIDC_CLIENT_SECRET` y `CENTRAL_BINDING_SECRET`. No hay secretos en este documento. Desactivado por defecto.

OIDC usa PKCE, state/nonce de un solo uso, emisor de respuesta RFC9207 y cuenta local expresamente vinculada. Se crean únicamente sesiones normales de la cuenta existente y un vínculo cifrado de sesión. Se preservan perfiles, roles, CEO, cierre de oficina, QA, CredentialVersion y autenticación técnica loopback del motor/puente. No se cambian tablas ni contraseñas. Cuenta deshabilitada/bloqueada o cambio local de contraseña pendiente requieren revisión previa a la activación.

El menú de cuenta incorpora Cambiar plataforma, accesible también a 320 px; la entrada del menú es ahora botón nativo con nombre y estado. La configuración de acceso del perfil remite al portal cuando el modo central está activo. Cada petición humana comprueba el permiso y versión central; caída del central deniega temporalmente. No confundir el código construido con flags activados en producción.

37 pruebas de la API y compilación SQL del frontend aprobadas. Recorrido OIDC real con Keycloak aislado, usuarios ficticios y respuestas en memoria: entrada sin repetir contraseña y retorno al portal. No se usaron bases ni tareas operativas y no se reabrió la oficina. No usar las credenciales del sandbox en producción.
