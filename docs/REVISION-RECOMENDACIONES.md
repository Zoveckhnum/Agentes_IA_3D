# Revisión de Recomendaciones.md

Fecha: 3 de noviembre de 2026, hora de Ciudad de México.
Repositorio: `Agentes_IA_3D-sql-local`, rama `feat/sql-local`, commit `549e1b1`.
Documento de referencia: [Recomendaciones.md](../Recomendaciones.md), conservado sin cambios.

Actualización posterior de esta revisión: se completaron las fichas de los 24 roles
y la integración de 35 habilidades de skills.sh. Véase [ROLES-Y-HABILIDADES.md](ROLES-Y-HABILIDADES.md).
Los apartados restantes conservan las brechas indicadas; el motor continúa detenido.

Esta revisión distingue código existente de capacidades operativas. Las recomendaciones
son criterios para evaluar; no autorizan por sí mismas despliegues, cambios de esquema,
mensajes a terceros ni la activación del motor. No se realizaron esas acciones.

## Resultado por apartado

| Apartado | Estado | Evidencia y alcance pendiente |
| --- | --- | --- |
| 1. Roles y habilidades | Fichas e integración implementadas | 24 roles con actividades, entregas, aceptación, límites y requisitos; 35 skills de skills.sh fijadas por commit y SHA-256. El motor y QA reciben la ficha efectiva y rutas de guías verificadas. Falta evaluar la calidad de ejecuciones reales cuando se active el motor. |
| 2. Aislamiento y CI/CD | Aislamiento implementado; CI/CD parcial | Repositorios en `products/<id>`, ramas `agent/<task_id>`, worktrees, bloqueos locales y archivos de entrega con hashes. Hay despliegue/reversión IIS de esta aplicación, pero no una cadena general de agentes que cree commits atómicos, compile, obtenga aprobación y despliegue cualquier proyecto registrado. |
| 3. Auto-loop y memoria | Bucle implementado pero detenido; memoria parcial | El worker tiene cola, estados, dependencias y continuaciones. Persiste conversaciones e insumos de tareas. No se encontró memoria de tres capas con documentos Markdown e índice de búsqueda. No hay proceso worker activo en esta comprobación. |
| 4. Aprobación humana por Telegram | Parcial; botones y autorización persistente pendientes | Hay recepción de mensajes privados del propietario, respuestas a preguntas y avisos de entrega. No hay manejo de `callback_query`, botones Aprobar/Rechazar ni un registro de autorizaciones ligado a una operación y revisión concretas. |
| 5. Optimización de tokens | Controles básicos; compresión/caché pendientes | Hay límites de tiempo, herramientas, longitud y etapas; se guarda uso de tokens. No se encontró proxy de compresión ni caché semántica. No se han medido ahorros porcentuales. |
| 6. Barreras de seguridad | Parcial | Hay validación de rutas y enlaces, filtrado de archivos/credenciales, entorno reducido para Codex, sandbox solicitado, SQL restringido y configuración CMS. No se encontró un ejecutor central con bloqueo explícito de comandos destructivos ni integración de actividad del motor con Windows Event Log. |

## 1. Roles y habilidades (revisión inicial)

Evidencia: [catálogo](../roles/catalogo.json), `perfilDe`, `toolsFor` y construcción
del prompt en [worker.mjs](../motor/worker.mjs), [calidad.mjs](../motor/calidad.mjs).

- `frontend_portales`: accesibilidad, adaptación, estados de error y pruebas; no incluye
  todavía guías específicas React/Next/Tailwind ni evidencia de verificaciones WCAG.
- `ingenieria_datos`: Pandas, SQL, ETL, conciliación e idempotencia; procesamiento
  distribuido y NumPy no están definidos explícitamente en su misión.
- `mejora_continua`: procesos industriales y metodologías de calidad. Cubre parte de
  la intención administrativa; falta especificar el mapeo de flujos administrativos
  y sus integraciones API como entregables verificables.
- `devops`: contempla IIS, ODBC, TLS y recuperación. Hay scripts PowerShell reales
  en `deploy/windows`; aún no están conectados a autorizaciones del motor por proyecto.
- `qa_software` y `qa_datos`: revisores independientes. Se comprueban hashes de
  entregas y se bloquea la aprobación si falta revisor o cambia la entrega.

Los perfiles efectivos también admiten configuración privada del negocio; no se leyó
esa configuración, por lo que no se certifica la composición efectiva de cada agente.
Los tests prueban mecanismos; no demuestran calidad de una entrega real del LLM.

Esas brechas de definición y asignación se atendieron posteriormente: cada rol tiene
guías concretas, contratos de entrega y requisitos de herramientas. El rol de la Oficina
tiene prioridad sobre configuraciones antiguas. La misión particular no sustituye el
contrato ni los revisores. Se prueban integridad de bundles, separación de especialidades,
rechazo de roles desconocidos y transmisión del rol correcto al cliente y a QA.
El alcance y las fuentes de la implementación están en el manual enlazado al inicio.

## 2. Aislamiento y despliegue

Evidencia: [espacios-proyecto.mjs](../motor/espacios-proyecto.mjs),
[tareas-proyecto.mjs](../motor/tareas-proyecto.mjs),
[AISLAMIENTO.md](AISLAMIENTO.md), [scripts Windows](../deploy/windows).

El aislamiento por repositorio está implementado. Los worktrees conservan el checkout
del propietario. Los archivos revisados se archivan por hash y los cambios posteriores
invalidan QA. Esto no equivale a un aislamiento completo del sistema operativo.

`Update-SqlPreview.ps1` copia una compilación y código locales a una versión, comprueba
salud y recupera servicio/configuración si falla. `Activate-PublicSite.ps1` guarda la
configuración anterior y comprueba el dominio. No hacen checkout y compilación automática
por commit ni automatizan commits de entrega. Los PR en borrador del conector GitHub
son otra capacidad; no constituyen una cadena CI/CD aprobada.

Para futuras entregas se recomienda restaurar la versión desplegada ante fallos y
registrar el incidente; una recuperación no necesita reescribir la historia remota.
Un revert en GitHub debe tratarse como una operación separada y autorizada.

## 3. Continuidad y memoria

Evidencia: `pump`, `nextTask` y listeners en [worker.mjs](../motor/worker.mjs),
[continuidad.mjs](../motor/continuidad.mjs), [adaptador SQL](../motor/firebase-adapter.mjs).

La cola ejecuta una tarea principal a la vez. Las continuaciones están limitadas a ocho
etapas y conservan dependencias e insumos. Hay sesión persistida del coordinador y
conversaciones/documentos de tareas. No existe todavía un repositorio de preferencias,
manuales y lecciones aprendidas con búsqueda y política de actualización/retención.
No es obligatorio añadir Redis o SQLite para la máquina de estados: la instalación ya
dispone de SQL Server, pero aún falta un servicio de ejecución del motor configurado.

## 4. Aprobaciones

Evidencia: [telegram.mjs](../motor/telegram.mjs),
[reglas de agentes](../motor/AGENTS.md), [integraciones](../motor/integraciones.mjs).

Telegram solicita únicamente actualizaciones `message`; no procesa callbacks. Las
reglas prohíben publicar y los conectores preparan borradores, pero una instrucción
en un prompt no sustituye una autorización persistente que un ejecutor valide.

La autorización futura debe identificar operación, proyecto, revisión/hash, aprobador,
vencimiento y consumo único. Aprobar QA no debe aprobar automáticamente un despliegue,
una migración SQL o un documento oficial. No se envió ningún mensaje para esta revisión.

## 5. Tokens

Evidencia: [codex-runner.mjs](../motor/codex-runner.mjs) y `agentLastUsage` en el worker.
El límite actual es de 25 minutos por ejecución y existe un límite de llamadas de
herramientas por rol. Son controles de consumo; no son un límite estricto de tokens
ni un presupuesto monetario total. Falta registrar costes por tarea/proyecto,
establecer presupuestos y medir antes de decidir compresión o caché. Una caché no
debe reutilizar autorizaciones ni resultados mutables entre clientes o revisiones.

## 6. Seguridad y auditoría

Evidencia: `safeFile` en [integraciones.mjs](../motor/integraciones.mjs),
`codexEnvironment` y opciones de sandbox en el runner, [política SQL](../server/src/policy.mjs),
[repositorio SQL](../server/src/repository.mjs) y [operación SQL](SQL-LOCAL.md).

El runner solicita `workspace-write`, sin acceso de red y con aprobación `never`;
esto no es una lista explícita de comandos permitidos ni prueba de bloqueo de cada
comando destructivo en Windows. Falta probar el aislamiento real bajo una cuenta
dedicada del motor sin privilegios de administración y con permisos por proyecto.
No se ejecutaron comandos destructivos para comprobar esta brecha.

Hay filtros de secretos y exclusiones Git. No se realizó un escaneo completo de todo
el historial ni de todos los logs; por ello no se garantiza ausencia histórica de
credenciales. Tampoco se leyeron `.env`, `motor/negocio.json` ni archivos de credenciales.

`app.AuditLog` registra escrituras de documentos y hay logs de servicio. Eso no cubre
los comandos ejecutados por los agentes ni equivale a Windows Event Log. No se auditó
la política completa de auditoría del sistema operativo.

## Comprobaciones realizadas

- `npm.cmd test`: 33 pruebas, todas correctas.
- `npm.cmd run sql:test`: 18 pruebas, todas correctas.
- `https://stackbi.com.mx/health/db`: estado correcto, transporte TCP, cifrado,
  certificado validado, esquema disponible y permisos restringidos.
- Fuentes comparadas con la versión publicada `20261103-092447`: coinciden los hashes
  de 55 archivos de `app/src`, `shared`, `server/src` y `server/migrations`.
  Esa comprobación no incluye motor, herramientas ni scripts de operación.
- Sin proceso `worker.mjs` activo durante la revisión.
- La revisión no desplegó código, no cambió la base y no inició agentes.

## Orden propuesto para continuar

1. Completar barreras de ejecución y auditoría para una identidad dedicada del motor.
2. Implementar autorizaciones persistentes y su interfaz Telegram, sin enviar avisos
   automáticamente durante pruebas.
3. Conectar entregas, commits, QA y despliegue IIS con recuperación y aprobación.
4. Preparar el servicio del motor y comprobarlo primero con tareas sintéticas.
5. Añadir memoria de tres capas, habilidades explícitas por rol y presupuestos de uso.

Los pasos anteriores son trabajo pendiente, no capacidades ya activadas. La publicación
de la aplicación web y la base local ya operan; eso no implica que el motor autónomo
cumpla todos los requisitos del documento.
