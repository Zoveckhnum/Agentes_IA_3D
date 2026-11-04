# Barreras de seguridad del motor

El servicio de agentes usa `NT SERVICE\StackBI-AgentMotor`, sin administración.
El perfil estricto limita las herramientas antes de la ejecución y registra las
decisiones en un canal propio de Windows Event Log. Las reglas de texto complementan
estos controles; no son la barrera que autoriza una operación.

## Operaciones permitidas y bloqueadas

| Superficie | Control efectivo |
| --- | --- |
| Consola general | `features.shell_tool=false`: no se ofrece ejecución de comandos. Esto incluye eliminación masiva, intérpretes, instalaciones y cualquier `git push`, también `--force`. El clasificador adicional siempre rechaza comandos; sus patrones solo distinguen el motivo. |
| Escritura nativa de Codex | Sandbox `read-only`, aprobación `never`, sin red de comandos. La edición necesaria pasa por el MCP limitado de archivos. |
| Archivos de producto | Solo dentro de la carpeta de la tarea; un archivo por llamada, hasta 1 MiB. Para reemplazar exige el SHA-256 actual. No hay funciones de borrar, mover ni ejecutar. |
| Entradas y metadatos | Escritura bloqueada en `insumos`, `revisiones`, `.agentes`, `.github`, `tarea.md`, metadatos Git, configuración Codex y archivos de credenciales. |
| Rutas | Rechaza rutas absolutas, traversal, UNC, flujos alternativos de NTFS, dispositivos, nombres ambiguos, enlaces y hardlinks. |
| QA | Recibe lector; no recibe escritor. Los hashes del producto y de sus referencias siguen verificándose. |
| Habilidades | Lector de bundles verificados asignados al rol; no permite instalar otras guías ni ampliar permisos. |
| Apps, plugins, navegador y subagentes | Deshabilitados en el perfil del runner. Los MCP explícitos del motor mantienen únicamente sus herramientas seleccionadas. |
| IIS, SQL y documentos oficiales | Conservan el ejecutor separado y la aprobación humana ligada al contenido y destino. El MCP de archivos no administra estos servicios. |

Los agentes pueden redactar código y entregables. Las compilaciones, instalaciones
y pruebas ejecutables se realizan en CI o requieren un ejecutor aislado aprobado;
no se permite ejecutar un `npm run`, Python o PowerShell arbitrario bajo la cuenta
del motor. Si falta esa verificación, QA debe indicar `blocked`, sin inventar pruebas.
La revisión del servicio no afecta las consolas administrativas del propietario.

El puente de herramientas `code_mode_host` permanece habilitado: en esta versión
es necesario para llamar a los MCP. Es JavaScript aislado sin Node, sistema de
archivos, red directa ni procesos; solo invoca las herramientas disponibles.
Deshabilitarlo impedía también leer/editar por MCP y se corrigió antes de validar
la activación. No equivale a reactivar la consola general.

## Raíces y configuración

Con `AGENTES_SECURITY_MODE=strict`, el runner admite tareas bajo
`AGENTES_STATE_ROOT/trabajos`, la prueba inicial bajo `AGENTES_STATE_ROOT/probe`
y los worktrees bajo `AGENTES_PROJECT_ROOT/products/.tareas`. Compara las rutas
canónicas de Windows, incluyendo alias 8.3. No admite raíces enlazadas.

El servicio conserva su `CODEX_HOME` exclusivo. Un `config.toml` heredado allí o
una configuración `.codex/config.toml` en los ancestros del proyecto bloquea el
arranque de la tarea, evitando cargar otros MCP o ajustes de un repositorio.
No se modifica la configuración personal de Codex del propietario.

Ante una denegación del MCP de archivos o referencias, el runner cancela el turno
inmediatamente. La tarea queda en error con QA bloqueado y requiere revisión;
no se transforma en una entrega aprobada ni se reintenta en bucle. Una reserva de
tokens sin consumo final reportado se conserva, tal como establece el presupuesto.
Si falla la auditoría obligatoria, no se autoriza la operación de archivos.

## Credenciales y Git

El runner bloquea posibles credenciales reconocidas antes de enviar el encargo y
antes de entregar una respuesta del modelo. El escritor de archivos rechaza esos
contenidos y los mensajes de error/logs del motor aplican redacción. El entorno
de Codex sigue excluyendo credenciales de SQL, Telegram y otros conectores.

Se instalaron ganchos locales para este repositorio y sus worktrees:

- `pre-commit`: revisa el contenido del índice antes de crear el commit.
- `pre-push`: revisa los blobs textuales únicos alcanzables desde las refs locales.
- CI: repite el escaneo con historial completo del checkout y bloquea el check.

El escáner y los ganchos ejecutados localmente están protegidos en
`C:\ProgramData\StackBI\SecurityTools`; no dependen de una copia editable del
escáner dentro de una tarea. El instalador conserva ganchos ajenos y exige revisar
su integración si ya existen; no los sobrescribe. No cambia la configuración global
de Git. Los ganchos son prevención de accidentes, no una restricción contra un
administrador que deliberadamente los desactive o use otra ruta de publicación.

```powershell
npm run security:scan
node tools/security-scan.mjs --staged
```

El reporte `.local/security-scan.json` contiene rutas, OID y cantidades, nunca el
valor coincidente. Busca patrones reconocibles de claves OpenAI/GitHub, bot Telegram,
OAuth Google y claves privadas PEM completas. No lee `.env`, configuraciones privadas
ni archivos de credenciales; si aparecen versionados, bloquea por su nombre. Las
plantillas `.env.example` se excluyen sin leerlas y se identifican en el reporte.
El escaneo admite hasta 128 MiB totales y 2 MiB por blob; un exceso requiere revisión.

No certifica cualquier secreto arbitrario, valores divididos/codificados ni refs
remotas que no estén recuperadas. No se reescribió el historial ni se revocaron
credenciales: el escaneo ejecutado no encontró coincidencias de los patrones cubiertos.

## Auditoría de Windows

Canal: **StackBI-Security**, proveedor: **StackBI.AgentSecurity**.
Tiene un máximo de 32 MiB con sobrescritura de los eventos más antiguos. El SID del
motor tiene permiso de escribir (`0x2`), sin leer ni borrar el canal. SYSTEM y los
administradores administran y consultan el registro. El script escritor está
protegido contra modificaciones del servicio.

| ID | Actividad |
| --- | --- |
| 1001 / 1002 | Inicio / fin del turno |
| 2001 / 2002 | Inicio / fin de herramienta |
| 2101–2104 | Lectura, listado, escritura de archivo o lectura de habilidad |
| 3001 / 3002 | Denegación de herramienta o consola |
| 9001 | Prueba controlada de las barreras |

Los eventos contienen hora, resultado, código, ID de ejecución y SHA-256 de tarea,
proyecto y objeto. No contienen prompts, comandos completos, contenido de archivos,
URLs con credenciales ni valores de claves. Para inspeccionarlos como administrador:

```powershell
Get-WinEvent -LogName StackBI-Security -MaxEvents 30 |
  Select-Object TimeCreated, Id, ProviderName
```

El latido `config/agentWorker.security` informa la configuración del perfil.
Este canal registra la actividad del arnés y sus herramientas, no todos los comandos
del equipo ni una captura universal de Windows. Tampoco es un archivo externo
inmutable: un administrador puede modificarlo y la rotación elimina eventos antiguos.
La exportación externa/SIEM sigue pendiente.

## Verificación operativa

Pruebas del 3 de noviembre de 2026, hora de Ciudad de México:

- Edición y lectura reales por MCP bajo la identidad del servicio: `BARRERAS_OK`.
- Traversal, rutas del sistema, metadatos Git, credenciales e insumos: rechazados
  sobre fixtures; canarios externos sin cambios.
- Lectura y apertura de escritura de un canario administrativo: acceso denegado.
- Denegación real mediante el modelo: turno cancelado en aproximadamente nueve
  segundos, `security_blocked=true`, sin cambios al canario y con reserva conservada.
- Eventos de operaciones permitidas y denegadas presentes en Windows Event Log.
- 59 asignaciones de habilidades legibles sin ampliar el catálogo autorizado.

No se ejecutaron eliminaciones ni publicaciones forzadas para probar los bloqueos.
Las pruebas negativas de comandos usan cadenas y la configuración efectiva de
herramientas; las de archivos usan únicamente canarios sintéticos. Esto protege
el acceso del modelo mediante este arnés; no convierte componentes confiables,
el mismo SID del servicio o todo Windows en procesos aislados por cliente. Ejecutar
código arbitrario de clientes localmente requeriría otro aislamiento antes de habilitarlo.

Instalación administrativa: `Install-AgentSecurity.ps1`, `Install-RepoSecretHooks.ps1`
y `Update-AgentMotor.ps1`, todos bajo `deploy/windows`. El perfil no cambia datos
de tareas, esquema SQL ni la versión pública de la aplicación IIS.

Fuentes: [configuración de Codex](https://learn.chatgpt.com/docs/config-file/config-reference),
[JavaScript aislado para herramientas](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling),
[permisos de Event Log](https://learn.microsoft.com/en-us/windows/win32/eventlog/eventlog-key)
y [wevtutil](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/wevtutil).
