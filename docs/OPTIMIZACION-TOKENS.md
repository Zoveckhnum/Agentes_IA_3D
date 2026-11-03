# Optimización de tokens

El motor conserva los requisitos y las decisiones humanas completos, mide el uso
reportado por Codex y evita iniciar nuevas llamadas cuando no queda presupuesto.
La implementación no requiere instalar un proxy ni cambiar el modelo o la sesión.

## Qué se reduce

Los entregables anteriores de más de 12,000 bytes se guardan íntegros en archivos
UTF-8 bajo `.context/`, identificados por SHA-256. El prompt recibe la ruta, el hash
y un extracto explícitamente parcial; el agente debe consultar el archivo antes de
corregir o evaluar el entregable. Esto permite búsquedas selectivas sin reenviar todo
el documento en cada corrección o revisión. Si finalmente necesita leerlo completo,
ese contenido también consume contexto: no hay un ahorro garantizado.

El MCP `contexto` permite leer páginas o buscar texto literal solo en las referencias
de la tarea actual, verificando su hash. No recibe credenciales, no acepta rutas
arbitrarias y no escribe archivos ni ejecuta comandos. Esta vía evita depender de
permisos de consola para recuperar el texto completo. La primera prueba del servicio
detectó precisamente ese bloqueo; se restauró la versión anterior antes de añadir
el lector y repetir la comprobación.

QA comprueba que el revisor no alteró ni el producto ni las referencias recibidas.
Las referencias de contexto se excluyen de los archivos de producto de los proyectos.
Los originales no se resumen mediante otro modelo ni se eliminan. Se conserva el
límite de almacenamiento del motor. Cada referencia admite como máximo 1 MiB.

No se recortan el brief, los comentarios del propietario, los criterios de QA,
las reglas o los recibos de Telegram. Un prompt completo de más de 96 KiB se bloquea
antes de llamar a Codex: hay que dividir la tarea sin eliminar requisitos.
Ese límite mide las reglas, la ficha y el encargo que construye el runner; no incluye
el historial de un hilo reanudado ni las salidas que las herramientas añadan dentro
de Codex. El uso real de esas interacciones se recoge al terminar, cuando se reporta.

## Uso y presupuestos

Con `AGENTES_STATE_ROOT` configurado, todas las llamadas del runner, incluidas
correcciones, QA y chats habilitados, usan `state/tokens/token-ledger.json`.
Se registran entrada, salida, entrada en caché, escritura de caché y razonamiento
cuando el SDK los proporciona. Entrada en caché y razonamiento son subconjuntos:
el consumo de control es **entrada + salida**, sin sumarlos de nuevo.

| Control predeterminado | Cantidad |
| --- | ---: |
| Presupuesto diario del motor | 2,097,152 tokens |
| Presupuesto diario por proyecto | 1,048,576 tokens |
| Presupuesto acumulado de una tarea, incluyendo QA | 524,288 tokens |
| Reserva antes de cada llamada | 131,072 tokens |
| Prompt explícito completo | 98,304 bytes |
| Registros máximos | 4,000 |

Los días se contabilizan en UTC; el presupuesto de tarea no se reinicia al cambiar
el día. Las tareas sin proyecto comparten el presupuesto del grupo no asignado.
Los chats sin tarea se agrupan por rol dentro de ese proyecto. Los identificadores
de tarea/proyecto se guardan como hashes; no se guardan prompts, entregables,
credenciales ni sesiones en el registro de uso.

Antes de crear el cliente Codex se escribe una reserva persistente. Al terminar,
se sustituye por el uso real disponible. Si falta el dato, se conserva la reserva
como `unknown`; si se interrumpe el proceso, queda `pending`. Reiniciar el servicio
no libera esas cantidades. Los datos corruptos, un bloqueo existente o el límite
de registros impiden continuar hasta que un operador los revise.

El SDK 0.166.0 instalado informa el uso al terminar el turno. **Estos límites son
controles de admisión, no un corte exacto de tokens dentro de una llamada**.
Una llamada puede exceder la reserva; se contabiliza todo el uso reportado y se
bloquean llamadas posteriores según el saldo. Los límites previos de 25 minutos,
herramientas y reintentos siguen aplicándose. No representan un presupuesto en
pesos/dólares ni reconstruyen el consumo anterior a la activación.

## Consultar y configurar

```powershell
# Datos del servicio; imprime solo contadores y límites.
npm run tokens -- --root C:\ProgramData\StackBI\AgentMotor\data

# Uso de una tarea y su proyecto, sin leer el contenido de los documentos SQL.
npm run tokens -- --root C:\ProgramData\StackBI\AgentMotor\data --task ID_TAREA --project ID_PROYECTO
```

El latido `config/agentWorker.tokenUsage` publica los mismos contadores diarios
agregados. Las reservas quedan separadas del consumo reportado. La CLI también
devuelve acumulados de toda la historia local, para consultar una tarea.

Los valores configurables están en `deploy/token-policy.example.json`. Para usar
otros, el operador debe copiar una política validada a una ruta protegida, configurar
`AGENTES_TOKEN_POLICY` en el entorno CMS del servicio y reiniciarlo. `--policy RUTA`
permite consultar el registro con esa misma política; no cambia el servicio.
Sin `AGENTES_STATE_ROOT`, el runner conserva el límite del prompt pero no dispone
de presupuestos persistentes: el servicio instalado sí configura ese directorio.

No borrar el registro o reservas para «liberar saldo». Un bloqueo
`token-ledger.lock` contiene PID y fecha: comprobar que el proceso terminó antes
de retirarlo. Al alcanzar 4,000 registros, archivar bajo supervisión, conservando
las reservas pendientes y el consumo acumulado de las tareas que puedan continuar;
no hay una purga automática que restablezca esos presupuestos. El registro admite
como máximo 4 MiB. La copia externa de la auditoría sigue siendo trabajo operativo
pendiente, igual que la de los demás datos locales del motor.

## Caché y límites de alcance

Las reglas y la ficha del rol preceden al encargo variable. Se mide el campo
`cached_input_tokens` que devuelve Codex; un valor cero también es un resultado
válido. La [documentación oficial de caché](https://developers.openai.com/api/docs/guides/prompt-caching)
describe la reutilización de prefijos, pero este SDK no expone aquí los controles
completos del API Responses: no se configura un proxy TLS ni se promete una tasa
de caché o descuento para la sesión del servicio.

No se reutilizan respuestas del modelo, autorizaciones, QA o resultados externos
por semejanza semántica. Headroom, TOON y GPTCache no se han instalado; interceptar
las respuestas internas de herramientas requeriría una integración adicional del
arnés. No se afirma la reducción de 60–95% citada en `Recomendaciones.md`.
Los porcentajes de bytes en pruebas sintéticas no son porcentajes de ahorro real
de tokens, tiempo o dinero. El [SDK oficial](https://learn.chatgpt.com/docs/codex-sdk)
y los tipos de la versión instalada sustentan la contabilización usada aquí.

## Verificación operativa

El 3 de noviembre de 2026 pasaron 102 pruebas locales, incluidas reservas tras
reinicios, límites por proyecto/tarea, subconjuntos de caché, referencias alteradas,
aislamiento del lector y bloqueo de QA ante modificaciones de su referencia.

Una prueba sintética bajo `NT SERVICE\StackBI-AgentMotor` recuperó correctamente
`TOKENS_OK`, oculto en el centro de una referencia de 75,619 bytes. La referencia
inline ocupó 1,839 bytes; el original permaneció completo. Codex reportó 44,884
tokens de entrada, 39,424 de ellos en caché, y 130 de salida. El registro contabilizó
45,014 tokens, sin duplicar los de caché. Son resultados de una muestra; no una
comparación equivalente antes/después ni una estimación de ahorro de producción.

El registro de prueba está separado del productivo. Tras la comprobación se
restauró el daemon normal, con los límites predeterminados activos y el corte
original de tareas nuevas. Los hashes de los 24 agentes y diez tareas de producción
permanecieron iguales. La aplicación IIS y el esquema SQL no se modificaron.
