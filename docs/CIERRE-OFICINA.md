# Cierre de oficina por CEO humano

Configuración elegida para esta oficina: **reapertura manual, exclusivamente por el CEO** (`autoResume: false`). No hay apertura automática a las 07:00. El aviso público y Telegram muestran el mismo texto fijo: «Oficina fuera de horario. Las actividades se retomarán cuando el CEO autorice la reapertura.»

En Oficina, el botón **Cerrar oficina** aparece únicamente para una sesión humana cuyo perfil tiene `executiveRole: ceo`. El permiso se valida en el servidor y nuevamente en el controlador de Windows; el cargo editable, el rol admin por sí solo y el token del motor no autorizan el cierre. El propietario puede asignar o revocar este permiso desde Usuarios.

Al confirmar, se bloquea el acceso de negocio, se deshabilitan nuevos trabajos del ejecutor humano y se espera a que termine cualquier operación privilegiada en curso. Se detienen AgentMotor, DeployBroker y ambas API Node; se detienen los sitios IIS de staging y preview. Se conserva una instantánea de sus estados y tipos de inicio. Las tareas activas con arrendamiento del motor se pausan sin borrar sus datos y se reencolan al reabrir.

IIS público, Cloudflare Tunnel, SQL, respaldos, OfficeControl y HumanApprovals siguen activos para mostrar el aviso, conservar los datos y permitir la reapertura. No es un apagado de Windows. Mientras está cerrada, cualquier ruta pública de la aplicación devuelve HTTP 503, `Cache-Control: no-store` y `Retry-After` con:

> Oficina fuera de horario. Las actividades se retomarán cuando el CEO autorice la reapertura.

Telegram envía ese mismo texto al propietario y responde a sus mensajes con el texto fijo. No usa modelos ni procesa aprobaciones durante el cierre. Se permite registrar el resultado de una operación que ya estaba en ejecución. Si el envío inicial tiene un resultado incierto, se registra como `unknown` y no se repite automáticamente para evitar duplicados.

Opcionalmente, con `autoResume: true`, la reapertura automática ocurre a las **07:00 del siguiente día civil**, zona `America/Mexico_City`. La instalación predeterminada es manual; el controlador comprueba solicitudes CEO cada minuto y al arrancar Windows, sin abrir por horario. No se cambia el corte de tareas nuevas del auto-loop. Un CEO puede entrar en el acceso de la página cerrada y autorizar la apertura. Tras tres fallos de reapertura, permanece cerrada para revisión.

## Instalación y comprobación

Usar un commit limpio y probado. Publicar la aplicación por el proceso CI/staging existente. Ejecutar `deploy/windows/Install-OfficeControl.ps1`, luego `office/setup-db.mjs` con el entorno CMS de mantenimiento de producción. El script de BD verifica al propietario humano existente antes de otorgarle CEO y crea un principal Windows con permisos mínimos de sesión y lectura, sin tablas nuevas. Iniciar StackBI-OfficeControl y comprobar `http://127.0.0.1:10014/_office/health` y el proxy en modo abierto.

Ejecutar `deploy/windows/Update-OfficeTelegram.ps1` y `deploy/windows/Enable-OfficeProxy.ps1`. Este último respalda web.config, dirige IIS de 10011 a 10014, conserva el cuerpo de las respuestas 503 y revierte si falla la comprobación HTTPS/SQL. Verificar inicio de sesión, permisos CEO, página de cierre móvil y escritorio. El cierre final se solicita desde una sesión humana real; no se fabrican cookies ni sesiones desde SQL.

El controlador solo recibe comandos tipados `open`/`close`, con revisión de estado, caducidad de dos minutos y una sesión vigente. Sus archivos privados y CMS de ejecución son exclusivos de SYSTEM y administradores. La cuenta del gateway no administra servicios, no modifica perfiles ni escribe el estado. Los registros evitan contraseñas, tokens y cookies.

Pruebas: `node --test office/office.test.mjs`, suites de contratos/HITL y CI SQL/TLS. Validar además con la cuenta de servicio real, el navegador y los servicios de Windows; las pruebas aisladas no acreditan por sí solas una publicación.
