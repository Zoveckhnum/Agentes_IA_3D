# Operación con SQL Server local

Preparación realizada el 3 de noviembre de 2026. La rama `feat/sql-local` está en
`C:\Users\Rodrigo\Documents\GitHub\Agentes_IA_3D-sql-local`. Conserva los cambios
previos del proyecto original; no se han creado commits. La copia SQL fue revisada
por el propietario y posteriormente se activó en https://stackbi.com.mx.

## Arquitectura instalada

```text
Navegador HTTPS → Cloudflare Tunnel → IIS/ARR (:80, Host stackbi.com.mx)
                                            ↓ API Node (127.0.0.1:10011)
                                            ↓ ODBC Driver 18 + Windows + TLS
                                  sql.stackbi.com.mx:1433 → AgentesIA3D
```

La instancia es `STACKBI`, servicio `MSSQL$STACKBI`, con autenticación Windows.
SQL Server 2025 Express quedó actualizado a CU10 (17.0.5035.5), con paquete
oficial de Microsoft y firma Authenticode validada.
SQL escucha exclusivamente en loopback. El nombre SQL se resuelve en el archivo
hosts de este equipo; no requiere DNS público ni abrir 1433 en el router.
La API se ejecuta como `NT SERVICE\node-agentes-ia-3d`, con permisos DML sobre
el esquema `app`, sin db_owner, sysadmin ni permisos de crear tablas.
El navegador nunca recibe una cadena de conexión ni acceso directo a SQL.

Se adaptaron las estrategias `ESTRATEGIA-CONEXION-BASES-DATOS.md` y
`FLUJO-APLICACIONES-IIS-ODBC-TLS-IT.md`: pool máximo 3/mínimo 0, conexión 10 s,
consulta 15 s, autenticación integrada, cifrado obligatorio y validación del
certificado. No se habilita TrustServerCertificate. Una CA local firma el
certificado con SAN `sql.stackbi.com.mx`; únicamente este equipo confía en esa CA.
La validación negativa con un nombre que no está en el SAN falla correctamente.
El alias de autenticación loopback se autoriza específicamente mediante
BackConnectionHostNames; no se desactiva globalmente esa protección de Windows.

Configuración y credencial del adaptador del motor: paquetes CMS bajo
`C:\ProgramData\StackBI\Secrets\agentes-ia-3d`, restringidos por ACL y clave privada.
El lanzador descifra únicamente en memoria y no imprime valores. No se copiaron
los archivos .env ni negocio.json del proyecto original.

## Edición de datos de contacto

Cada usuario puede editar su nombre, correo de contacto y teléfono desde **Mi Perfil**.
Los administradores también pueden hacerlo desde **Usuarios**, con el botón
**Editar perfil y contacto**, respetando los permisos de edición existentes.
El correo de contacto se guarda en `contactEmail`; `email` conserva la identidad
de acceso. Los perfiles existentes muestran inicialmente su correo de acceso como
contacto, sin requerir una migración. El contacto se puede dejar vacío.

## Datos y autenticación

En **Mi Perfil → Acceso y seguridad** se puede cambiar el correo de acceso o la
contraseña. Ambas acciones requieren la contraseña actual y códigos de 8 dígitos,
válidos durante 10 minutos y con un máximo de 5 intentos. Para cambiar el correo
se verifica tanto la dirección actual como la nueva. Los códigos no se guardan
en texto claro ni se devuelven al navegador. Cada nueva solicitud invalida las
anteriores y tiene un intervalo mínimo de un minuto y máximo de 5 por 15 minutos.
Al completar el cambio se invalidan todas las sesiones. Se conserva el UID, el
rol y la asignación de tareas; el correo de contacto permanece independiente.
El cambio obligatorio de contraseña también usa verificación por correo.

Los envíos usan Brevo mediante `APP_BREVO_API_KEY`, `APP_MAIL_SENDER`,
`APP_MAIL_SENDER_NAME` y `APP_SECURITY_CODE_SECRET` en el entorno CMS protegido.
`Configure-AccountMail.ps1` importa la clave sin imprimirla y comprueba el remitente.
`variables.md` está excluido de Git. La migración `003-account-verifications.sql`
añade la tabla privada de verificaciones; no se publica mediante la API documental.
Las pruebas de integración usan una base temporal y un remitente simulado, sin
enviar mensajes reales ni modificar cuentas de producción.

Para activar el correo real del propietario migrado desde una cuenta `.local`
sin verificar, el operador puede ejecutar `Authorize-DemoEmailRecovery.ps1`
con `-TargetEmail` y la dirección confirmada por el propietario. La autorización
se guarda cifrada en `APP_OWNER_EMAIL_RECOVERY`, dura 24 horas y se limita al UID
del propietario, correo de origen, destino y versión de credenciales exactos.
El usuario aún debe introducir su contraseña actual y el código recibido en el
correo real. No se envían códigos al correo `.local`. Al completar el cambio la
autorización deja de aplicar y los cambios posteriores verifican ambos correos.

Se conservaron los 46 documentos y las 2 cuentas de la exportación local existente:
agentChats 13, agents 15, config 1, tasks 12, users 1 y worklog 4.
Los identificadores, documentos anidados y marcas de tiempo se preservan.
La importación fue transaccional y verificó la igualdad de los payloads leídos de SQL.
El origen y una copia protegida con hashes están conservados en
`C:\ProgramData\StackBI\MigrationSources`. No se borraron los datos originales.

Los documentos se almacenan como JSON validado en SQL, con identificadores e
índices de colección; las cuentas, sesiones, invitaciones, auditoría y migraciones
tienen tablas propias. Se preserva el modelo documental existente: esta etapa
no convierte automáticamente cada campo de negocio en una columna relacional.
Las escrituras por lote son atómicas, con bloqueo e idempotencia; la API verifica
roles y pertenencia a conversaciones en cada solicitud. Hay un límite explícito
de 5.000 documentos por consulta y el adaptador de suscripciones consulta cada
2 segundos con espera progresiva ante errores. No es una implementación completa
del SDK de Firestore; antes de añadir operaciones nuevas hay que ampliar el adaptador.

Contraseñas almacenadas con scrypt, sesiones en cookies HttpOnly y SameSite,
protección de origen y limitación de intentos. Las cuentas migradas requieren
cambiar contraseña antes de acceder a datos; el propietario ya completó el acceso.
La cuenta técnica del motor no permite inicio de sesión humano.
No utilizar simultáneamente la copia Firebase y la copia SQL como fuentes activas:
no hay sincronización bidireccional entre ambas.

## Servicios, compilación y versiones

API: servicio automático `node-agentes-ia-3d`, con recuperación tras fallos y
logs rotativos (5 archivos de 10 MB). IIS: sitio público `StackBI`, con URL
`https://stackbi.com.mx` y proxy en `C:\inetpub\stackbi-agentes-public`.
El sitio `StackBI-Agentes-SQL-Preview` quedó detenido tras la activación pública;
su URL HTTP anterior ya no es el punto de acceso a la aplicación.
Comprobaciones: `/health` y `/health/db`; esta última verifica conexión TCP,
cifrado, esquema y permisos restringidos de la identidad real del servicio.

El motor de agentes NO está ejecutándose. Se comprobó únicamente su autenticación
y lectura mediante `tools/check-worker-sql.mjs`, sin ejecutar tareas ni enviar mensajes.
Antes de iniciarlo hay que preparar su identidad de Windows, acceso a Codex y
directorios de trabajo; no iniciar `npm run local` para operar esta instalación SQL.

Desde la raíz de esta copia:

```powershell
npm.cmd run sql:build
npm.cmd test
npm.cmd run sql:test
# Con variables CORE_DB_* autorizadas de administrador, sin imprimirlas:
npm.cmd run sql:test:integration
```

Las pruebas de integración crean y eliminan exclusivamente su base sintética;
no modifican AgentesIA3D. Las migraciones en `server/migrations` se versionan en
Git y se registran con SHA-256 en SQL; una migración aplicada no se edita.
Crear una migración nueva y ejecutarla con identidad administradora mediante
`server/tools/migrate-schema.mjs`. La identidad de ejecución no puede aplicar DDL.

`deploy/windows/Update-SqlPreview.ps1` instala una versión de código, comprueba
salud y revierte servicio/configuración si falla. Conserva hasta 3 versiones
y comprueba un presupuesto de 2 GiB. No duplica la base por cada versión.
Revertir código no deshace cambios de esquema o datos: planificar migraciones
compatibles y respaldar antes de cambios destructivos.
Binarios y manifiesto activo:
`C:\ProgramData\StackBI\Applications\agentes-ia-3d`.
El proyecto original y las uniones a sus node_modules se conservan; no borrar
recursivamente esas uniones durante limpieza del código de desarrollo.

## Respaldos y límites de disco

- Datos SQL: máximo configurado 8 GiB; log: 1 GiB, recuperación SIMPLE.
- Respaldos: tarea `StackBI-AgentesIA3D-Backup`, diaria a las 03:00, hora de México.
- Destino: `C:\ProgramData\StackBI\Backups\AgentesIA3D`.
- Retención: 7 diarios, 4 semanales y 2 mensuales, sin duplicar archivos entre grupos.
- Presupuesto de retención: 20 GiB. Se conservan al menos los 2 más recientes;
  si estos solos exceden el presupuesto, se informa error en lugar de borrarlos.
- Cada respaldo usa CHECKSUM, RESTORE VERIFYONLY, restauración real temporal,
  DBCC CHECKDB y manifiesto SHA-256 antes de aplicar la retención.

La tarea se ejecuta como SYSTEM, con privilegio DBA (sysadmin) **solamente en la
instancia STACKBI** para restaurar, comprobar y eliminar su base temporal. Esta
identidad de mantenimiento es distinta del servicio de la aplicación, que no
tiene privilegios administrativos SQL. Los archivos de respaldo se restringen
a SYSTEM, administradores y al servicio SQL.

Estado verificable en `status.json`, último resultado de la tarea y
`C:\ProgramData\StackBI\Platform\maintenance.log`. Para ejecutar una comprobación:

```powershell
Start-ScheduledTask -TaskName StackBI-AgentesIA3D-Backup
Get-ScheduledTaskInfo -TaskName StackBI-AgentesIA3D-Backup
Get-Content C:\ProgramData\StackBI\Backups\AgentesIA3D\status.json
```

Un .bak sin manifiesto detiene la retención: investigar y verificarlo antes de
eliminarlo o incorporarlo. No restaurar encima de la base activa para hacer pruebas.
Los límites son controles de la aplicación/mantenimiento, no una cuota total del
volumen; también revisar espacio libre, logs de Windows/IIS y crecimiento de tempdb.
Los respaldos actuales están en el mismo disco: falta una segunda copia fuera de
este equipo para recuperación ante avería física.

El propietario completó manualmente la limpieza de los medios SQL2025,
SQL2025-ENU y del instalador CU10 después de que la herramienta bloqueara el
comando automático. Se verificó que esos archivos ya no existen y que no quedan
emuladores temporales de migración activos. La aplicación y los servicios siguen
funcionando; la exportación fuente protegida se conserva.

## Certificados y publicación

El certificado SQL vence en noviembre de 2027 y el de protección CMS en noviembre
de 2028. La renovación no está automatizada: revisar con anticipación, renovar
SQL con `Initialize-LocalSql.ps1`, comprobar SAN/ACL y reiniciar/verificar el servicio.
Para CMS se requiere volver a cifrar los paquetes con el certificado nuevo y
probarlos antes de retirar la clave anterior. No quitar certificados de confianza
ni claves mientras los servicios o paquetes dependan de ellos.

La aplicación está publicada en **https://stackbi.com.mx**. HTTP y www redirigen
al origen HTTPS principal, conservando ruta y consulta. PUBLIC_ORIGIN coincide
con ese origen y ALLOW_LOCAL_HTTP=false. La cookie de autenticación usa el prefijo
__Host-, Secure, HttpOnly, SameSite=Strict y Path=/; se requiere iniciar sesión
de nuevo desde el dominio, con la contraseña modificada en la revisión local.
El túnel y sus registros DNS permanecen iguales; IIS dirige el dominio a la API
que sigue escuchando exclusivamente en loopback. SQL tampoco se publica.

`deploy/windows/Activate-PublicSite.ps1` guarda un respaldo de IIS y copias CMS
y del manifiesto antes de cambiar el origen y el sitio. Comprueba HTTPS, interfaz
y salud SQL antes de detener el sitio de pruebas; si falla restaura los anteriores.
El manifiesto `public-activation.json` del directorio de la aplicación registra
las rutas y el nombre del respaldo. Para revertir esta activación inmediatamente,
antes de desplegar nuevas versiones, ejecutar `Restore-PreviousPublicSite.ps1`
como administrador. La reversión no modifica datos SQL. No restaurar encima de
versiones posteriores sin revisar también sus manifiestos y rutas de servicio.

La verificación `server/tools/verify-public-site.mjs` realizó 23 comprobaciones
reales contra el dominio: HTML y JavaScript, salud SQL, redirecciones, cabeceras,
rechazo de acceso anónimo, protección de origen y credenciales inválidas. Se
ejecuta mediante el lanzador CMS para obtener PUBLIC_ORIGIN, sin imprimir secretos.
La página de acceso también se comprobó con navegador, sin errores JavaScript.
La activación del motor requiere una decisión aparte porque ejecutará las tareas
pendientes conservadas; continúa detenido.

El proxy usa X-Forwarded-Proto para distinguir el HTTPS del visitante del HTTP
local del túnel, conforme a la [documentación de Cloudflare](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

Referencia de actualizaciones SQL: [Microsoft](https://www.microsoft.com/en-us/download/details.aspx?id=108788).
