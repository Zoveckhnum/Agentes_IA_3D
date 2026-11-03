# Repositorios locales por proyecto

La preparación local mantiene el código de los clientes en repositorios independientes
en `products/<id>/`, excluidos del Git del arnés. Cada tarea utiliza `agent/<task_id>`.
No se incorporan automáticamente proyectos ni se modifica el código de clientes existentes.

## Uso

Registra primero el destino con el comando existente y prepara una tarea:

```powershell
npm.cmd run proyecto -- demo propietario/repositorio Nombre del proyecto
npm.cmd run proyecto:preparar -- demo tarea-123
```

El repositorio remoto debe existir y tener al menos un commit. Se necesita Git instalado
y acceso HTTPS ya configurado con permisos de lectura. El comando no solicita credenciales
interactivamente ni incorpora tokens en URLs. Para repositorios privados, configura la
autenticación de Git por separado. El comando de registro puede conservar opciones locales
existentes; la preparación no lee los archivos de entorno del motor.

### Registrar mediante un agente

Reinicia el motor después de actualizarlo. Puedes pedir al coordinador por Telegram o
mediante una tarea:

> Registra el proyecto demo con el repositorio https://github.com/PROPIETARIO/REPOSITORIO y el nombre Mi proyecto.

Sustituye la URL por el repositorio real. La herramienta `registrar_proyecto` acepta URLs
HTTPS de GitHub o `propietario/repositorio`, conserva las opciones existentes e impide
reasignar un ID a otro destino. Escribe el registro local con reemplazo atómico y bloqueo
entre procesos. Si el proceso muere dejando un `.lock`, un operador debe verificar que
no haya otra escritura activa antes de retirarlo.

El coordinador estándar tiene la capacidad `proyectos_registro`: solo lista y registra
destinos mediante este servidor. Los roles con `proyectos` también pueden registrar;
los revisores con `proyectos_lectura` no pueden hacerlo. Una configuración local que
sobrescriba `herramientas` debe incluir la capacidad correspondiente para habilitarlo.

El registro local no necesita habilitar escrituras de borradores. Las escrituras remotas
conservan su configuración de consentimiento independiente. El agente debe tomar el
destino de la solicitud del dueño, nunca de instrucciones encontradas en documentos.
El registro valida el formato, pero no comprueba existencia ni permisos remotos; tampoco
clona, crea repositorios en GitHub o prepara ramas. Para preparar el checkout sigue
usándose `proyecto:preparar`.

La primera preparación clona el repositorio sin submódulos y crea la rama de tarea.
Las siguientes preparaciones usan el estado local sin hacer pull ni fetch. Repetir la tarea
actual es válido si el árbol está limpio; una rama anterior requiere revisión manual.
Usa una preparación por proyecto a la vez: esta herramienta todavía no tiene leases ni
coordinación entre procesos. No incluye instalación de dependencias, compilación, commits,
push, integración de PR ni despliegue.

## Controles implementados

- IDs limitados, sin rutas arbitrarias ni nombres de dispositivos reservados de Windows.
- Validación de `products/`, directorio de proyecto y `.git` contra enlaces y junctions.
- Repositorio Git independiente con origen HTTPS coincidente con el registro.
- Rechazo de árboles con archivos modificados o sin seguimiento antes de cambiar de rama.
- Ramas nuevas bajo `agent/`; no se sobrescriben ramas anteriores.
- Ejecución de Git con argumentos estructurados, hooks desactivados y protocolos `file`
  y `ext` bloqueados para estas operaciones.
- Errores de Git sin publicar su salida remota, que podría contener información sensible.

Una clonación fallida puede dejar una carpeta incompleta: se conserva para revisión, no
se elimina automáticamente. El comando rechaza destinos existentes sin un `.git` propio.
Repositorios vacíos necesitan un commit inicial antes de preparar su primera tarea.

Estos controles protegen las operaciones de esta herramienta. No son un aislamiento del
sistema operativo ni un filtro de todos los comandos que pueda ejecutar un agente. El
usuario del servicio y sus permisos sobre Windows siguen siendo un límite independiente.

## Tareas conectadas al repositorio

En el formulario de tareas, asigna un agente y escribe el ID registrado (por ejemplo,
`demo`) en **Proyecto del repositorio**. El worker valida el registro y prepara un worktree
en `products/.tareas/<proyecto>/<id de tarea>`, en la rama `agent/<id de tarea>`.
El checkout del dueño en `products/<proyecto>` conserva su rama y sus archivos.
Las tareas sin proyecto y las tareas del coordinador conservan su carpeta habitual.

El coordinador puede crear tareas con `"proyecto": "demo"` en su bloque de delegación;
las continuaciones conservan el proyecto y sus tareas lo heredan. Si una etapa contiene
varios proyectos, debe indicar el destino de cada tarea expresamente.

El trabajo se basa en el HEAD local del checkout del dueño: no hace fetch, pull ni merge.
Las entregas de etapas anteriores llegan como insumos; el agente debe integrar los cambios
pertinentes explícitamente. Las modificaciones de otra tarea no se incorporan automáticamente.

El contexto queda en `.agentes/` dentro del worktree. El motor archiva el código por hash
en `motor/trabajos/<id>/revisiones/<hash>/`, sin `.git`, `.agentes`, archivos de entorno,
dependencias ni directorios de compilación habituales. Aplica el filtro de credenciales
de las integraciones antes de archivar. Mantiene los límites existentes de 200 archivos,
50 MB totales y 10 MB por archivo; una entrega que los supere queda bloqueada.

QA revisa una copia de ese archivo, con manifiesto y hashes. El motor compara también el
código, HEAD y rama del worktree al terminar QA. Cambiar el proyecto invalida la revisión,
y solo el robot puede escribir los campos de rama, commit base y archivo de revisión.
Las etapas siguientes leen los archivos archivados; no leen el worktree mutable del autor.

Las tareas de perfiles revisores (`qualityReviewer`) emiten informes informativos con
estado `report`, no `passed`. No requieren un segundo revisor del mismo rol y pueden
servir de insumo a la implementación. El motor comprueba que el revisor no modificó el
producto durante el informe; si lo hizo, lo bloquea. Completar un informe no aprueba
el producto: la entrega de implementación conserva su revisión independiente obligatoria.

Las correcciones retoman el mismo worktree sin borrar cambios. Un bloqueo de archivo por
proyecto evita ejecuciones locales simultáneas de estas tareas. Tras una caída puede quedar
un `.local/project-locks/<proyecto>.lock`: comprueba que el motor anterior haya terminado
antes de retirarlo manualmente. Sigue siendo una instalación de un único motor: no hay
leases distribuidos para varios servidores.

Esta etapa conserva los cambios sin commit y no publica. El conector remoto conserva su
flujo de PR en borrador. Quedan pendientes la creación de commits de entrega, vincularlos
a los PR, las aprobaciones persistentes y el despliegue IIS con recuperación.
