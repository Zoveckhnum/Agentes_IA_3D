---

### 1. Definición de Prompts y Habilidades Especializadas por Rol
Para evitar que Codex actúe como un único desarrollador genérico, debes estructurar **fichas de persona y catálogos de habilidades (*Agent Skills*) independientes** para cada empleado virtual:
* **Especialista Frontend / Web:** Debe incluir guías de diseño y buenas prácticas modernas de React/Next.js/Tailwind y validación de accesibilidad web.
* **Especialista en Análisis de Datos:** Prompt especializado en procesamiento distribuido, scripts de limpieza (Pandas/Numpy) y generación de reportes analíticos automatizados.
* **Especialista en Optimización Administrativa:** Enfocado en arquitectura de flujos de trabajo (*Workflow Architect*), mapeo de procesos de negocio e integración de APIs.
* **Especialista DevOps Windows & IIS:** Un rol configurado con scripts de **PowerShell (`WebAdministration` / MSDeploy)** para la automatización de App Pools, sitios web en IIS, enlaces de puertos, certificados SSL y reglas de reescritura.
* **Agente QA & Auditor de Código:** Encargado de ejecutar revisiones de código (*code-review*) y pruebas de entrega verificada (*verified-delivery*) antes de autorizar cualquier cambio.

---

### 2. Aislamiento de Repositorios de Proyectos y CI/CD en Windows IIS
* **Aislamiento de código (*Separation of Concerns*):** El código del arnés de los agentes debe estar totalmente separado del código de los clientes. Cada proyecto debe crearse en una carpeta/repositorio independiente (`./products/<slug>/`).
* **Estrategia de Despliegue Autónomo en IIS:**
  1. El agente de desarrollo trabaja en una rama de función (`agent/{task_id}`) y realiza commits atómicos.
  2. El agente DevOps ejecuta un script de PowerShell que realiza el *checkout*, la compilación del proyecto y la publicación hacia el directorio de IIS.
  3. **Pruebas de Humo y Rollback:** Tras publicar en IIS, el agente de QA verifica que los HTTP Endpoints respondan con código 200. Si detecta un error 500, el sistema debe revertir automáticamente el commit en GitHub y restaurar el App Pool.

---

### 3. Motor de Autogestión (Auto-Loop) y Memoria Persistente
* **Bucle Autónomo (*Auto-Loop*):** Necesitas un script o servicio de fondo (daemon en Windows/WSL) que mantenga a los agentes trabajando asíncronamente a través de una máquina de estados compartida (`memories/consensus.md` o un bus de eventos en SQLite/Redis).
* **Gestión de Memoria en 3 Capas:** Implementar una capa de memoria estructurada (como **agent-memory** o **openJiuwen**) que guarde las preferencias de los clientes, manuales técnicos y lecciones aprendidas de errores pasados en archivos Markdown locales respaldados por un índice de búsqueda rápida.

---

### 4. Bucle de Aprobación Humana (HITL) e Interfaz Telegram
* **Puertas de Control Humano (*Human-In-The-Loop*):** Aunque la empresa sea casi autónoma, los agentes deben enviar mensajes interactivos a Telegram con botones de **[Aprobar] / [Rechazar]** cuando se requiera:
  1. Autorización para realizar un despliegue en producción sobre IIS.
  2. Modificaciones estructurales en bases de datos.
  3. Generación de documentos oficiales en Google Drive para el cliente final.

---

### 5. Optimización de Tokens de IA
Al correr múltiples agentes continuos con Codex, los costos de tokens pueden dispararse rápidamente. Se recomienda integrar un proxy o middleware de compresión como **Headroom** o **TOON**:
* **SmartCrusher/CodeCompressor:** Reduce entre un 60% y 95% la cantidad de tokens al enviar logs de consola, respuestas JSON y fragmentos de código al LLM.
* **Caché Semántico (GPTCache):** Evita llamadas repetidas para consultas frecuentes.

---

### 6. Barreras de Seguridad Duras (*Hard Safety Gates*)
Para evitar acciones destructivas dentro del servidor Windows:
* **Restricciones de Comandos:** Bloquear explícitamente comandos de eliminación masiva, `git push --force` en ramas principales o modificación de archivos del sistema operativo fuera del directorio de IIS asignado.
* **Redacción de Credenciales:** Garantizar que ninguna API key, token de Telegram o credencial de Google Drive quede registrada en el historial de git o logs públicos.
* **Monitoreo de Auditoría:** Registrar la actividad de los agentes en el servidor mediante registros de auditoría de Windows para detectar comportamientos imprevistos.

---
