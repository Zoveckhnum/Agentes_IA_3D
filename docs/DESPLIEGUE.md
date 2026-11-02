# Disponibilidad web y motor siempre activo

## Arquitectura recomendada

Usa **Firebase Hosting** para la web, **Firebase Authentication + Firestore reales** para identidad y tareas, y **una VM persistente** para el motor Node.js/Codex y el bot de Telegram. Puedes alojar la VM en Google Compute Engine para concentrar la operación en Google Cloud. Es una recomendación para la arquitectura actual: el motor mantiene listeners, polling y archivos de trabajo; un servicio orientado a peticiones requeriría adaptar esas partes.

Como punto de partida de ingeniería, una VM Linux con 2 vCPU, 4 GB RAM y disco persistente de 30 GB puede servir para un motor con una tarea a la vez. Evalúa 8 GB si compila proyectos o procesa archivos grandes. No necesita GPU para llamar a Codex. Ajusta el tamaño midiendo carga; no es una garantía de capacidad. Power BI Desktop, pruebas de IIS y componentes Windows necesitan un ejecutor Windows separado, sus herramientas y licencias: el agente no los obtiene por tener un rol.

Firebase Hosting puede mantener la web disponible aunque apagues tu PC. Para que los **agentes también trabajen**, la VM debe seguir encendida. Un único motor tiene un punto de fallo: recuperación automática y copias reducen interrupciones, pero no constituyen alta disponibilidad. No ejecutes dos motores sobre las mismas tareas: todavía no existe un sistema de leases distribuido.

Los emuladores se conservan para desarrollo; no se publican ni se usan como base de producción. [Firebase Hosting](https://firebase.google.com/docs/hosting/quickstart), [Emulator Suite](https://firebase.google.com/docs/emulator-suite), [Compute Engine](https://cloud.google.com/compute/docs/instances/create-start-instance).

## 1. Preparar Firebase

1. Abre tu proyecto en la consola de Firebase. Crear una cuenta de Firebase no activa automáticamente sus productos.
2. Crea **Firestore Database**, edición estándar, base `(default)`, en modo producción. Elige una región cercana a usuarios y VM; decide la ubicación antes de crear la base.
3. En **Authentication → Sign-in method**, activa **Google** para el administrador y **Email/Password** para el robot.
4. En Authentication crea un usuario exclusivo para el robot, con contraseña larga. No uses la cuenta personal del administrador. La identidad del robot se autoriza por su correo en las reglas generadas.
5. En configuración del proyecto registra una **aplicación web**. Copia el objeto público `firebaseConfig`: apiKey, authDomain, projectId, appId, messagingSenderId y storageBucket cuando aparezca.
6. Completa `instalacion.nube.json`, que ya contiene el ID de proyecto y correo administrador acordados. Sustituye los valores `PEGA_AQUI`, incluido el correo real del robot. La configuración web no contiene la contraseña del robot.
7. Detén `npm run local` con Ctrl+C. El siguiente paso cambia los archivos activos al entorno real; no mezcla ni migra los datos del emulador. Conserva una copia previa en `motor/credenciales/antes-nube/`.

   ```powershell
   node tools/configurar.mjs instalacion.nube.json
   ```

8. Abre `motor/.env` con un editor local y coloca la contraseña del robot en `AGENT_PASSWORD`. Comprueba `USE_EMULATORS=false`; en `app/.env`, `VITE_USE_EMULATORS=false`. No cambies `CODEX_API_KEY` si ya usas una sesión válida local de Codex.
9. Autentica Firebase CLI con tu cuenta propietaria:

   ```powershell
   npx firebase login
   npx firebase projects:list
   ```

10. Publica **primero** las reglas generadas, con el ID real de tu proyecto:

    ```powershell
    npx firebase deploy --only firestore:rules --config firebase.cloud.json --project TU_PROJECT_ID
    npm run check
    npm --prefix motor run crear-agentes
    ```

11. En Authentication → Settings → Authorized domains, verifica los dominios `TU_PROJECT_ID.web.app` y `TU_PROJECT_ID.firebaseapp.com`; añade tu dominio propio si lo usas. Para probar desde localhost con Firebase real puede ser necesario autorizar también `localhost`.
12. Compila y publica la web:

    ```powershell
    npm run build
    npx firebase deploy --only hosting --config firebase.cloud.json --project TU_PROJECT_ID
    ```

13. Entra en `https://TU_PROJECT_ID.web.app` con Google usando el correo administrador configurado. Debes ver el equipo de 12 perfiles. Una cuenta no invitada debe quedar pendiente y sin acceso a tareas. Verifica esta condición con una cuenta de prueba antes de incorporar información real.

Esta preparación no ha ejecutado los comandos de publicación ni creado recursos facturables. El archivo `firebase.cloud.json` usa `.local/firestore.cloud.rules`; no publiques las reglas plantilla sin configurar.

## 2. Preparar la VM del motor

1. Crea una VM Linux estable con disco persistente, presupuesto y alertas de gasto. Limita SSH a tus accesos. El motor solo necesita conexiones salientes HTTPS; no abras los puertos de los emuladores ni el de Vite.
2. Instala Node.js 22 o posterior compatible, npm y Git. Crea un usuario de servicio `agentes`, sin permisos administrativos habituales. Copia una versión revisada de este repositorio en `/opt/agentes-ia-3d` y asigna su propiedad a ese usuario. Instala las dependencias con `npm ci` y `npm --prefix motor ci`.
3. Transfiere privadamente `motor/.env`, `motor/negocio.json`, `motor/integraciones.env`, `motor/proyectos.json` y los JSON OAuth de `motor/credenciales/`. No copies la carpeta de credenciales completa si contiene copias de la instalación local; lleva solo lo necesario. Restringe permisos de los archivos a ese usuario.
4. Configura Codex **como el usuario agentes**. Puedes usar `npm run codex -- login` con una modalidad de inicio de sesión compatible con tu cuenta, o una API key propia en `CODEX_API_KEY` de `motor/.env`. El acceso de Codex en tu PC no inicia sesión automáticamente en la VM. La facturación y los límites dependen del método elegido.
5. Como ese usuario ejecuta `npm run check`, `npm run check:codex` y `npm run integraciones:check`. La prueba de Codex debe ejecutarse con el mismo usuario y HOME que usará el servicio.
6. Adapta `deploy/agentes-motor.service.example` a tus rutas y binario Node. Instálalo como `/etc/systemd/system/agentes-motor.service` y ejecuta:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now agentes-motor
   sudo systemctl status agentes-motor
   sudo journalctl -u agentes-motor -n 80 --no-pager
   ```

7. Apaga el motor de tu PC antes de habilitar el de la VM contra la misma base. Envía una tarea pequeña por Telegram, revisa la web y comprueba los archivos en GitHub/Drive. Reinicia la VM y confirma que el servicio arranque solo y `/equipo` responda.
8. Configura monitorización de `config/agentWorker.lastSeen`, espacio en disco y errores del servicio. La web ya utiliza el latido del motor. Configura rotación de logs, copias cifradas de archivos de trabajo y credenciales, y respaldos de Firestore según necesidades y plan; prueba la restauración.

No se han creado automatizaciones de backup ni alertas en tu cuenta: estos pasos se completan al elegir/provisionar el servidor. Una revisión de QA puede tardar y consumir llamadas adicionales a Codex; mide ese coste con tareas representativas.

## Costes y mantenimiento

Separa cuatro partidas: VM/disco, uso de Firebase, consumo o plan de Codex/OpenAI y almacenamiento Google. Activa facturación solo cuando corresponda y revisa precios regionales al contratar. No se presupone que todo será gratuito. Para empezar no necesitas Kubernetes ni una GPU.

Mantén credenciales con el menor alcance posible, renueva tokens antes de su vencimiento y prueba cambios en local antes de actualizar el servicio. El paso a varios motores requiere reclamación atómica de tareas, recuperación de leases y aislamiento por proyecto; no se resuelve aumentando réplicas del proceso actual.
