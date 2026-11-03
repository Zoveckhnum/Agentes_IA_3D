# Auto-loop y memoria persistente

El piloto procesa solo tareas creadas después de su primera activación. El corte
se guarda en `acceptAfter` y no cambia al reiniciar. Las tareas anteriores no se
retoman automáticamente. Los agentes en reserva, tareas pausadas, dependencias
sin entregar/QA y aceptaciones pendientes conservan sus restricciones.

## Ejecución

El servicio Windows `StackBI-AgentMotor` usa una identidad virtual propia sin
permisos de administración ni acceso directo a SQL. Accede a la API por loopback
con configuración CMS. El código y la política solo los escribe el administrador;
datos, memoria, espacios de trabajo y credenciales de Codex tienen ACL privadas.

Cada tarea se adquiere mediante comparación y actualización en una transacción
SQL serializable. La asignación vence a los dos minutos y se renueva cada 30 s.
Si cambia el encargo, se pausa, se pierde la conexión o el propietario, la señal
cancela Codex y QA. Los resultados de un propietario anterior son rechazados.
Un bloqueo local adicional impide arrancar dos motores en el mismo directorio.

Se conserva la cola de prioridades, las dependencias y el máximo de ocho etapas
de coordinación. Las entregas pasan por el QA correspondiente y quedan para
revisión humana; Auto-loop no acepta entregas automáticamente.

Límites iniciales: una tarea a la vez, diez intentos de ejecución diarios (UTC),
tres adquisiciones por tarea y el límite existente de 25 minutos por llamada de
Codex. QA puede requerir llamadas adicionales: estos límites no son un presupuesto
monetario ni un límite estricto de tokens. Un error de modelo queda para revisión;
la recuperación automática aplica a asignaciones abandonadas tras un reinicio.

El presupuesto de datos/espacios es 2 GiB y se exige 1 GiB libre, comprobados antes
de cada tarea y durante las renovaciones. Es una supervisión periódica, no una
cuota del sistema operativo; una escritura grande puede excederla entre controles.
No se eliminan entregables de negocio para liberar espacio automáticamente.
El log del motor rota a 4 MiB con tres históricos; WinSW rota sus propios logs.

`data/state/consensus.md` resume hasta 50 tareas. Es una vista reconstruible de
los documentos SQL, no una segunda máquina de estados que pueda sobrescribirlos.

## Tres capas de memoria

- `preferencias`: decisiones expresas y revisadas del operador/cliente.
- `manuales`: documentación técnica revisada, con procedencia.
- `lecciones`: recordatorios operativos derivados de fallos, sin copiar respuestas
  del modelo, datos privados o diagnósticos con credenciales.

Los documentos actuales viven en Markdown bajo `data/memories`, con metadatos,
procedencia y SHA-256. El índice invertido local `index.json` se reconstruye desde
esos documentos, incluso si falta o está corrupto. No se requiere Redis, SQLite,
embeddings ni llamadas adicionales al modelo para la búsqueda.

La recuperación respeta cliente y proyecto; los documentos globales son material
común que el operador incorporó deliberadamente. Se incluyen como máximo seis
resultados/6,000 caracteres de contenido por tarea, presentados como datos de
referencia que no conceden permisos. No constituye protección absoluta frente a
instrucciones maliciosas: solo incorporar fuentes revisadas.

Límites: 1,000 documentos, 16 MiB totales y 32,000 bytes de contenido por documento.
La misma identidad/capa/cliente/proyecto se sobrescribe sin acumular versiones.
Se rechazan enlaces, cambios de integridad y patrones habituales de credenciales;
este filtro no garantiza detectar cualquier secreto. Al alcanzar el límite se
requiere archivar o retirar documentos; no se descartan preferencias en silencio.

```powershell
node tools/memoria.mjs status --root C:\ProgramData\StackBI\AgentMotor\data\memories
node tools/memoria.mjs put --root C:\ProgramData\StackBI\AgentMotor\data\memories --layer manuales --title "Manual SQL" --file C:\Documentos\manual-revisado.md --source "operador:manual-v1" --project proyecto --client cliente
node tools/memoria.mjs search --root C:\ProgramData\StackBI\AgentMotor\data\memories --query "conciliar SQL" --project proyecto --client cliente
```

## Instalación y activación

1. Verificar CI del commit. Instalar la API que admite precondiciones; la ruta
   autenticada `/api/worker/capabilities` confirma `atomicClaims=true`. El motor
   rechaza arrancar contra una API antigua que ignore esas condiciones.
2. En consola elevada, ejecutar `deploy/windows/Install-AgentMotor.ps1`. Instala
   dependencias de un lockfile separado, sin scripts npm, sin paquetes de voz/video,
   y registra el servicio en modo desactivado. No procesa tareas al instalarlo.
3. Ejecutar `deploy/windows/Login-AgentMotor.ps1` y completar la autenticación en
   el navegador. Se utiliza un `CODEX_HOME` privado del servicio; no se copia la
   sesión personal del operador. No compartir credenciales en chat ni Git.
4. El servicio hace una prueba real y acotada de Codex sin herramientas, bajo su
   identidad. Consultar `data/state/codex-probe.json` y `daemon.json`.
5. Con la prueba correcta, ejecutar `deploy/windows/Enable-AgentMotor.ps1`. La
   primera activación fija el corte de tareas nuevas y enciende la cola.

Para pausar: `deploy/windows/Enable-AgentMotor.ps1 -Pause`. Para reanudar, usar el
mismo script sin parámetros; conserva el corte original. Una política inválida,
API incompatible o bloqueo tras una terminación abrupta exige revisión local.
Antes de retirar `data/state/worker.lock`, detener el servicio y comprobar que no
quedan procesos de ejecución. No borrar bloqueos mientras otro motor trabaja.

La memoria, política y espacios viven fuera de las versiones de código. El backup
SQL incluye estados de tareas y auditoría. La tarea `StackBI-AgentMotor-Backup`
respalda Markdown, política y contador diario a las 03:30, con siete copias diarias
y presupuesto de 128 MiB; excluye sesiones y credenciales. Las copias locales no
cubren los archivos de entregas ni la pérdida del disco: queda pendiente una copia
privada externa con retención. El índice se reconstruye al restaurar los Markdown.

Telegram y chats automáticos no se activan en este piloto; tampoco se habilitan
credenciales de conectores ni publicación. Las aprobaciones de producción del
broker de CI/CD conservan su flujo independiente. La creación de este servicio
no completa las barreras generales de comandos/Windows Event Log pendientes en
la revisión de recomendaciones.

Runtime mínimo: Codex/SDK 0.166.0 y MCP SDK 1.32.1; Zod 4.6.7, compatible con el
peer declarado del SDK y fuera del rango del [aviso de consumo de memoria](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Se conserva el runner basado en el [SDK oficial de Codex](https://learn.chatgpt.com/docs/codex-sdk);
la señal de cancelación se comprobó también contra los tipos de la versión fijada.

## Comprobación operativa del 3 de noviembre de 2026

El servicio quedó activo a las 14:42:26 de Ciudad de México. El corte persistido
es `2026-11-03T20:42:26.2266259Z`: las tareas anteriores se conservaron. La memoria
de producción comienza vacía; las preferencias y manuales se incorporan mediante
fuentes revisadas, sin inventar datos del negocio.

El código fue validado con 76 pruebas y 48 verificaciones SQL, y se instaló la API
desde el ZIP de la [ejecución 41713354652](https://github.com/Zoveckhnum/Agentes_IA_3D/actions/runs/41713354652),
commit `0c8c4509a7a10dc7a6ce9502789575522c31206e`, SHA-256
`2e69a02715c7470ed909d1fc91b8bb59fe2d3f6b9edb89b3ab5a36793120dc94`.
La prueba real del motor bajo su identidad respondió `MEMORIA_OK` desde una
preferencia sintética en staging, entregó una vez y liberó la asignación. Otra
tarea anterior al corte permaneció idéntica. Los 24 agentes y diez tareas de
producción conservaron sus hashes antes/después de instalar y activar.
