# CI/CD parcial para IIS

El piloto verifica cada PR en GitHub y publica candidatos desde ramas autorizadas.
Un servicio local descarga el ZIP; el despliegue necesita aprobación de un
administrador para el commit, ejecución y SHA-256 exactos. El único destino
habilitado es **staging**, en <http://127.0.0.1:11091>, accesible desde el servidor.

## Flujo y límites

1. `.github/workflows/ci.yml` usa Windows 2022 alojado por GitHub y Node 22.12.0.
   Instala dependencias de los lockfiles, verifica pruebas y los 24 roles/35 skills,
   instala SQL Express temporal con ODBC 18 y certificado validado, ejecuta la
   integración SQL y compila React. Una comprobación fallida impide publicar.
2. El ZIP contiene el frontend compilado y el servidor con sus dependencias Windows,
   incluido el módulo nativo SQL. `manifest.json` registra commit, ejecución,
   intento, verificaciones y SHA-256 de cada archivo. Excluye configuración privada.
3. `StackBI-DeployBroker`, con identidad propia, consulta GitHub cada 30 segundos.
   Acepta únicamente ejecuciones exitosas `push`/`workflow_dispatch` del mismo
   repositorio y workflow en las ramas de `policy.json`. Rechaza artefactos de PR,
   forks, rutas peligrosas, archivos alterados y cambios de migraciones SQL.
4. Un operador inspecciona el candidato y aprueba la identidad exacta. La aprobación
   dura 30 minutos y se consume una sola vez, antes de cambiar staging.
5. El broker extrae una carpeta nueva, cambia exclusivamente el servicio de staging
   y comprueba SQL TLS, permisos limitados, frontend exacto y rechazo de acceso
   anónimo. Si falla, restaura configuración y versión anterior automáticamente.

No se instala un runner de GitHub en el servidor. Los scripts del artefacto no
se ejecutan para instalarlo: el broker usa código de despliegue instalado por el
administrador. Las actualizaciones de ese código requieren mantenimiento local.

## Operación

Desde una consola elevada, en este repositorio:

```powershell
npm run cd:status
npm run cd:approve -- --environment staging --commit COMMIT_COMPLETO --sha256 SHA256_COMPLETO --run-id EJECUCION
```

Copiar los valores del candidato revisado; la herramienta rechaza valores que no
coinciden. No aprobar una ejecución sin revisar sus pruebas y cambios. El broker
revalida la ejecución y el contenido después de recibir la aprobación.

El staging tiene su propia base `AgentesIA3D_Staging`, identidad de servicio,
certificado CMS y configuración. No contiene cuentas ni datos copiados de
producción: las credenciales del portal público no sirven allí. La integración
de CI prueba autenticación y documentos con datos sintéticos en el runner.

## Ubicaciones y almacenamiento

- Broker: `C:\ProgramData\StackBI\DeployBroker`.
- Política y programa: `policy.json`, `program\`; solo administrador/SYSTEM escriben.
- Credencial GitHub: `secrets\github.p7m`, cifrada CMS para la identidad del broker.
  Nunca se agrega al repositorio ni al ZIP. Preferir token dedicado con lectura de
  Actions/contenido; revisar sus permisos y caducidad al rotarlo.
- Aprobaciones: `approvals\`; el broker solo lee. Recibos: `receipts\`.
- Estado: `state\status.json`, `latest-candidate.json`, `last-deployment.json`.
- Staging: `C:\ProgramData\StackBI\Applications\agentes-ia-3d-staging`.
- Retención: tres candidatos y tres versiones, preservando aprobaciones pendientes
  y versión actual/anterior. Límites de 512 MiB de candidatos, 2 GiB de versiones,
  base staging 512 MiB + log 128 MiB. Si los elementos protegidos impiden limpiar,
  el límite detiene nuevas descargas/instalaciones para revisión del operador.
- Logs de servicio: rotación de cinco archivos de 10 MiB por flujo.
- Aprobaciones y recibos conservan la auditoría; revisar/archivar periódicamente.

El ZIP descargado se trata como contenido no confiable: límites de expansión,
CRC, lista exacta y SHA-256 antes de extraer. Una interrupción abrupta puede dejar
`state\broker.lock`; comprobar que el servicio y sus procesos están detenidos
antes de retirar ese bloqueo. No ejecutar dos brokers simultáneamente.

## Verificación y cambios futuros

```powershell
npm run test:ci
npm run ci:check
npm run ci:package
```

Las dos últimas órdenes necesitan Windows x64/Node 22.12.0, configuración SQL TLS
de prueba y dependencias instaladas; empaquetar exige árbol Git limpio y evidencia
del mismo commit. CI suministra estos requisitos en un entorno temporal.

Se probó rollback real en staging con un servidor que termina con error: se
restauró el servicio sano y el manifiesto público permaneció idéntico. El script
`tools/cd-rollback-test.mjs` crea una fixture fija y rechaza sobrescribirla; es una
prueba de instalación supervisada, no un paso de CI repetible.

Producción sigue en `https://stackbi.com.mx` y no se cambia mediante este piloto.
`allowProduction=false` es obligatorio. Los scripts previos de mantenimiento
manual de producción siguen disponibles para administradores. Habilitar promoción
a producción, gestionar nuevas migraciones y probar recuperación de datos son
trabajos posteriores; no basta con editar una rama o aprobar staging.

Configurar en GitHub el check `Tests, SQL TLS and immutable build` como obligatorio
en la rama que recibe integraciones. El workflow por sí solo no impide que un
administrador haga push directo. No mezclar este piloto automáticamente con `main`:
la base de revisión es `feat/sql-local`.

La consulta de protección con la credencial disponible respondió HTTP 403
(`Resource not accessible by personal access token`). Por ello no se cambió ni
se verificó esa protección. El propietario debe revisarla en GitHub → Settings
→ Branches/Rules; hasta entonces no se garantiza el bloqueo de integraciones.

Referencias oficiales: [seguridad de despliegues y entornos de GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[ODBC de Microsoft](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server?view=sql-server-ver17).
