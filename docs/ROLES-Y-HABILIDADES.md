# Roles y habilidades de skills.sh

Actualización: 3 de noviembre de 2026. Los **24 roles** existentes conservan sus IDs,
nombres y herramientas, con misiones ajustadas y fichas que definen actividades,
entregables, criterios de aceptación, límites y requisitos. No se modifican nombres,
misiones personales, tareas ni datos del negocio en SQL.

Las **35 habilidades** se localizaron en [skills.sh](https://skills.sh/), se verificaron
contra sus repositorios y se incorporaron como archivos locales de referencia. Cada
fuente queda fijada por commit y cada archivo por SHA-256. Se conservan las licencias
incluidas en los paquetes y las de repositorio cuando corresponden. No se instala una
dependencia del sistema ni se ejecuta un script por instalar una guía.

## Asignación del equipo BI y aplicaciones

| Rol | Responsabilidad y entrega principal | Habilidades |
| --- | --- | --- |
| Coordinador de proyectos | Alcance, tareas, dependencias, aceptación y entrega consolidada | create-implementation-plan; project-workflow-analysis-blueprint-generator |
| Arquitectura y seguridad | Arquitectura, decisiones, límites de confianza y amenazas | architecture-blueprint-generator; security-review |
| SQL y bases de datos | SQL Server/T-SQL, rendimiento, migraciones y conciliación | sql-optimization; sql-code-review |
| Ingeniería de datos | Pipelines Pandas/NumPy, contratos, incrementales e idempotencia | pandas-pro; data-quality-frameworks |
| BI y analítica | KPIs, modelo dimensional, DAX y narrativa del reporte | powerbi-modeling; power-bi-dax-optimization; data-storytelling |
| Backend e integraciones | APIs, permisos en servidor, contratos y recuperación | api-design-principles; workflow-orchestration-patterns; security-review |
| Frontend y portales | React/Vite, navegación, accesibilidad y rendimiento | vercel-react-best-practices; web-design-guidelines; frontend-design |
| IA aplicada | Automatización, datasets de evaluación, privacidad y métricas | llm-evaluation; api-design-principles; data-quality-frameworks |
| DevOps e infraestructura | PowerShell, Windows/IIS, TLS, ODBC y recuperación | powershell-windows; devops-rollout-plan; security-review |
| QA de software | Revisión independiente y pruebas sobre la revisión exacta | code-review-excellence; e2e-testing-patterns; security-review; web-design-guidelines |
| QA de datos y BI | Calidad, conciliación, SQL, relaciones y medidas BI | data-quality-frameworks; sql-code-review; power-bi-model-design-review |
| Procesos y mejora continua | Procesos administrativos/operativos, desperdicios, flujo objetivo y KPIs | process-optimization; statistical-analysis; project-workflow-analysis-blueprint-generator |

## Otros perfiles disponibles

| Rol | Habilidades |
| --- | --- |
| Asistente personal y coordinador | task-management; create-implementation-plan |
| Copies para Instagram, Facebook y TikTok | copywriting; social |
| Contenido para LinkedIn y X | social; copywriting |
| Estrategia de marketing | marketing-plan; content-strategy |
| Lanzamientos | launch; content-strategy |
| Textos largos y SEO | seo-audit; copywriting; content-strategy |
| Diseño web y landing pages | frontend-design; web-design-guidelines |
| Edición de video | hyperframes-cli; hyperframes |
| Creación de imágenes | image; frontend-design |
| Automatizaciones y flujos | workflow-orchestration-patterns; process-optimization; api-design-principles |
| Investigación | research-synthesis; data-storytelling |
| Personalizado | create-implementation-plan; research-synthesis |

Personalizado requiere una misión delimitada y no equivale a un especialista universal.
Los perfiles de contenido conservan revisión humana; la existencia de una habilidad no
añade un revisor automático de contenido ni autoriza publicar.

## Fuentes

- [GitHub: SQL](https://skills.sh/github/awesome-copilot/sql-optimization),
  [Power BI](https://skills.sh/github/awesome-copilot/powerbi-modeling) y
  [planes de despliegue](https://skills.sh/github/awesome-copilot/devops-rollout-plan).
- [Vercel: React](https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices)
  y [guías web](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines).
- [Anthropic: mejora de procesos](https://skills.sh/anthropics/knowledge-work-plugins/process-optimization),
  [investigación](https://skills.sh/anthropics/knowledge-work-plugins/research-synthesis) y
  [diseño frontend](https://skills.sh/anthropics/skills/frontend-design).
- [Wshobson: calidad de datos](https://skills.sh/wshobson/agents/data-quality-frameworks)
  y [evaluación de LLM](https://skills.sh/wshobson/agents/llm-evaluation).
- [Jeff Allan: Pandas](https://skills.sh/jeffallan/claude-skills/pandas-pro).
- [AG Kit: PowerShell Windows](https://skills.sh/vudovn/ag-kit/powershell-windows).
  Tiene menor volumen de instalaciones que los anteriores; se escogió por su alcance
  específico, fuente identificada y revisión local, no como certificación de seguridad.
- [Corey Haines: copywriting](https://skills.sh/coreyhaines31/marketingskills/copywriting)
  y otras especialidades de marketing.
- [HeyGen: Hyperframes](https://skills.sh/heygen-com/hyperframes/hyperframes-cli).

Todas las fichas y URLs exactas están en [skills.index.json](../roles/skills.index.json).
Versiones, procedencia y hashes están en [skills.lock.json](../roles/skills.lock.json).
El tamaño inicial de los paquetes es aproximadamente 2,5 MiB (303 archivos).

## Cómo las recibe el motor

1. La elección de rol guardada en la Oficina tiene prioridad sobre el rol de una
   configuración local antigua. Si no hay selección, se usa la configuración local
   y finalmente Personalizado.
2. El motor resuelve la ficha canónica. Las preferencias particulares no sustituyen
   la misión base, skills, criterios, límites ni requisitos de revisión independiente.
3. Antes de crear el cliente de Codex, verifica la procedencia, rutas sin enlaces,
   lista completa de archivos y hashes de las habilidades asignadas. Si encuentra
   cambios, referencias desconocidas o una ficha incompleta, no ejecuta el modelo.
4. Proporciona la ficha y las rutas de las habilidades del rol. El agente debe elegir
   las pertinentes y leer sus SKILL.md y referencias necesarias antes de trabajar.
   No se inyectan todas las guías completas en cada solicitud.
5. La entrega debe identificar habilidades utilizadas. Los revisores QA reciben su
   propio rol y guías, conservan el esquema de dictamen y no heredan permisos del autor.

El coordinador ve las actividades y entregables canónicos de cada agente para delegar,
en lugar de depender de una descripción libre o misión antigua guardada en la interfaz.

Este mecanismo proporciona instrucciones y comprueba integridad; no es una barrera
de comandos del sistema operativo ni una garantía de que un modelo cumpla cada guía.
El sandbox y los permisos de herramientas siguen siendo límites independientes.
Una revisión interna prueba el cableado con clientes simulados: no certifica por sí
misma la calidad de una ejecución real del modelo.

## Herramientas, permisos y requisitos

Una skill no instala Power BI, Python, navegadores, generadores de imágenes, MCP,
MSDeploy, Spark ni proveedores de pago. El agente debe comprobar disponibilidad y
versión antes de ejecutar. Las guías que proponen otros proveedores o frameworks se
adaptan al entorno real y al alcance del proyecto. Si falta una herramienta esencial,
debe informar la limitación o bloquear la verificación; no inventar archivos ni pruebas.

La instalación conserva referencias y scripts originales, pero no los ejecuta.
Publicación, cambios productivos, envíos externos, telemetría, cargas de datos,
instalación de dependencias y consumo facturable no quedan autorizados por una guía.
Las instrucciones del propietario y del motor prevalecen sobre ejemplos de terceros.

El motor sigue detenido. Las fichas se usarán en su próxima ejecución, cuando se
configure y autorice su servicio; este cambio no ejecuta las tareas pendientes.

## Verificación de esta entrega

- 24 fichas y 35 habilidades; verificación sin red de los 303 archivos fijados.
- 12 agentes existentes en SQL con roles registrados; se preservan sus documentos.
- 3 pruebas del perfil local, 42 del motor y 18 SQL: 63 correctas.
- Cliente Codex simulado: se comprueba la transmisión de la ficha y el rol del revisor,
  sin llamadas reales al proveedor ni ejecución de tareas de agentes.
- Compilación SQL correcta y versión pública `20261103-111125` verificada.
- 23 comprobaciones públicas correctas; página de acceso sin errores JavaScript.
- El bundle público contiene la vista de actividades y los enlaces de skills.sh.
  No se realizó inicio de sesión automatizado con credenciales del propietario.

## Uso y mantenimiento

En la app, abrir **Agentes → Editar → Actividades y habilidades** para consultar la
ficha, las condiciones de aceptación y los enlaces de skills.sh del rol seleccionado.
La misión personal permanece editable y se trata como contexto específico.

Desde la raíz del proyecto:

```powershell
npm.cmd run roles:check
npm.cmd run roles:ver -- frontend_portales
npm.cmd test
```

`roles:check` funciona sin red, verifica todas las habilidades y comprueba que cada
una está asignada y que los enlaces visibles coinciden con el lock. Para actualizar,
revisar una versión concreta de la fuente, preservar sus licencias y recursos,
regenerar el registro de hashes e índice y ejecutar las pruebas. No ejecutar una
actualización global sin revisar los cambios ni editar un paquete dejando el lock
anterior. Modificar actividades o asignaciones requiere editar `roles/catalogo.json`.

La aplicación pública usa una compilación del catálogo. Tras cambios de fichas o del
índice hay que compilar y desplegar una nueva versión para reflejarlos en la interfaz.
El motor usa los archivos locales al iniciar cada ejecución; no modifica el catálogo
ni descarga versiones nuevas por sí mismo.
El script de actualización comprueba fichas y hashes antes de copiar una nueva versión.
