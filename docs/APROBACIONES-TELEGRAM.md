# Aprobación humana por Telegram

Una aprobación de QA no autoriza publicar ni cambiar SQL. Este flujo requiere un
plan preparado por un operador, una decisión del propietario en el chat privado
del bot y el consumo de esa decisión por el ejecutor separado.

## Operaciones admitidas

| Tipo | Contenido y destino vinculados a la autorización |
| --- | --- |
| `iis-production` | ZIP verificado del candidato de CI, commit, ejecución/intento, SHA-256 y manifiesto actual de producción. Únicamente esta aplicación en `https://stackbi.com.mx`. |
| `sql-schema` | Archivo SQL revisado, SHA-256, base `AgentesIA3D` y huella del esquema actual. Exige respaldo/restauración de prueba antes del SQL, con transacción para aplicar los lotes. |
| `drive-official` | Bytes del documento, SHA-256, nombre, proyecto y carpeta existente dentro de la raíz de Drive autorizada. Crea un archivo nuevo; no comparte ni sobrescribe documentos. |
| `verification` | Comprobación del circuito de autorización; solo registra un recibo, sin operaciones sobre IIS, SQL o Drive. |

Los planes están en `C:\ProgramData\StackBI\HumanApprovals\registry\<planId>`.
El administrador y SYSTEM los escriben; el bot solo lee. No se aceptan scripts,
comandos, rutas o destinos enviados por Telegram. Cada revisión requiere otro plan.
El operador debe revisar contenido y alcance antes de registrarlo; los filtros de
credenciales y comandos no sustituyen esa revisión ni constituyen una sandbox SQL.

## Qué hace el propietario

El mensaje muestra operación, proyecto, tarea, destino, revisión y vencimiento,
con botones **Aprobar / Rechazar**. La decisión debe provenir del propietario
configurado y del mismo chat privado, mensaje y nonce. Texto como «aprobar»,
mensajes reenviados y clics de otras personas no autorizan operaciones.

La solicitud dura 30 minutos. Rechazo, vencimiento, cambio de contenido o consumo
previo impiden usarla. Un plan mantiene una sola solicitud, incluso si fue rechazado;
para reconsiderarlo el operador debe preparar otro plan y obtener otra decisión.

El ejecutor consume la autorización ANTES del efecto. `approved` significa
autorizado y en cola; `executed` confirma el recibo satisfactorio del ejecutor.
Un fallo o corte con resultado incierto no se reintenta automáticamente: revisar
IIS, SQL o Drive antes de solicitar una operación nueva. El protocolo evita repetir
un intento con la misma autorización; no promete «exactamente una vez» en un API
externo después de una interrupción de red.

## Separación de identidades

- `StackBI-HumanApprovals`: identidad virtual sin permisos de administración,
  atiende exclusivamente `127.0.0.1:10013`, recibe Telegram y registra decisiones.
- Motor de agentes: credencial de **solicitar/consultar**, cifrada CMS. El MCP no
  recibe el token del bot ni la credencial de ejecución. La clave de solicitud se
  obtiene por un pipe privado; no va en argumentos de Codex ni en prompts.
- `StackBI-HumanExecutor`: tarea programada SYSTEM, código fijo protegido,
  una operación por ejecución y sin instancias concurrentes. Revisa las decisiones
  cada minuto. Tiene su propia credencial CMS, inaccesible al bot y al motor.

Las credenciales OAuth de Drive solo se entregan al ejecutor/operador. La conexión
existente se configura mediante un pipe privado, sin mostrar ni copiar `.env` al
servicio. Las claves y sesiones quedan fuera del repositorio y de los artefactos CI.

## Motor y portal

Las tareas pueden solicitar un `planId` que el dueño les proporcione expresamente,
mediante `aprobaciones.solicitar_aprobacion`. El plan debe existir; la herramienta
no prepara planes nuevos, no aprueba ni ejecuta. El ID de tarea se fija desde el
motor, no desde parámetros del modelo.

La tarea queda en Espera con «Esperando tu aprobación en Telegram». No consume
llamadas al modelo mientras espera. Solo vuelve a Correcciones cuando todos sus
recibos dicen `executed`. Rechazo, vencimiento o fallo la detienen para revisión.
Se conservan los límites del Auto-loop, el corte de tareas nuevas y el QA aplicable.
El portal no permite completar una tarea con operaciones humanas aún pendientes.

Los chats generales, voz y conversaciones autónomas de Telegram siguen separados:
este bot atiende aprobaciones y los comandos `/estado`, `/ayuda` y `/start`.

## Operación desde el servidor

En una consola elevada:

```powershell
# Crear una prueba sin efectos. Copiar el planId devuelto.
.\deploy\windows\Invoke-HumanApproval.ps1 -Action prepare -Kind verification -Summary "Prueba del circuito de aprobación, sin cambios de negocio"
.\deploy\windows\Invoke-HumanApproval.ps1 -Action request -PlanId PLAN_UUID
.\deploy\windows\Invoke-HumanApproval.ps1 -Action status -RequestId SOLICITUD_UUID

# Preparar una publicación del candidato CI actual, tras revisar sus pruebas.
.\deploy\windows\Invoke-HumanApproval.ps1 -Action prepare -Kind iis-production -Summary "Publicar la revisión de aplicación comprobada en staging"

# Preparar SQL o documento revisados; preparar no ejecuta estas operaciones.
.\deploy\windows\Invoke-HumanApproval.ps1 -Action prepare -Kind sql-schema -Document C:\Cambios\migracion-revisada.sql -Summary "Descripción exacta del cambio y de sus efectos sobre los datos"
.\deploy\windows\Invoke-HumanApproval.ps1 -Action prepare -Kind drive-official -Project PROYECTO -Document C:\Entregas\documento-revisado.pdf -FolderId CARPETA_ID -Name "Documento oficial revisado" -Summary "Crear la versión oficial revisada en la carpeta indicada"
```

Después se solicita el plan concreto, se revisa en el servidor y se decide en
Telegram. No ejecutar una solicitud de prueba sobre una operación real de negocio.

## Persistencia y límites

`state/requests` conserva decisiones, vínculo a mensaje/propietario, vencimiento,
consumo y resultado. El cursor de Telegram se escribe después de persistir la
decisión. Las escrituras de estado usan archivo temporal, fsync y reemplazo.
El límite es 20 solicitudes nuevas diarias y 2,000 registros; alcanzarlo exige
archivar auditoría bajo supervisión, sin reactivar planes ya consumidos.

El registro de planes tiene presupuesto de 512 MiB y los espacios de ejecución
de 2 GiB. Los logs rotan; no se incluyen contenidos de documentos, tokens ni SQL
en los mensajes del bot. Conservar copia privada externa de registro y auditoría;
persistir en el disco local no cubre la pérdida del equipo.

La tarea SYSTEM y los scripts administrativos son componentes privilegiados.
Sus actualizaciones y los planes requieren mantenimiento administrativo; no se
conceden al motor permisos para modificarlos. Las herramientas administrativas
previas siguen existiendo y un administrador puede actuar fuera de este circuito.
El flujo no completa por sí solo todas las barreras generales del sistema operativo.

Referencias: [Bot API de Telegram](https://core.telegram.org/bots/api#callbackquery),
[configuración MCP de Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
