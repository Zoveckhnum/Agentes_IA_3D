# Fotos de agentes: enlace y archivo

En **Agentes → Editar**, la sección de foto admite:

- Un enlace directo HTTPS a una imagen pública. Se puede usar **Ver imagen** para
  comprobarlo o pegarlo y pulsar **Guardar**; el guardado comprueba el enlace pendiente.
- Un archivo JPG, PNG o WebP de hasta 8 MB, recortado y reducido localmente a JPEG
  cuadrado de 256 × 256 píxeles.
- **Quitar**, que elimina la foto al guardar los cambios del agente.

Un enlace a una página de galería o a una vista de Drive no equivale al enlace directo
de la imagen. Si el recurso exige autenticación o impide mostrarlo desde otro sitio,
el formulario informa del error y conserva la foto anterior. Las URLs con usuario o
contraseña y los protocolos distintos de HTTPS se rechazan.

Las imágenes remotas se muestran directamente en el navegador sin enviar el referente;
el servidor no descarga ni transforma recursos de URLs externas. Si una foto remota
deja de estar disponible, el avatar muestra la inicial del agente.

## Fallo corregido

La subida anterior creaba una URL temporal `blob:` para decodificar el archivo.
La política de seguridad de la app permite `img-src 'self' data: https:`, por lo que
bloqueaba esa URL antes del recorte. Se reprodujo el fallo en navegador. El flujo
corregido usa FileReader/data:, sin ampliar la política de imágenes.

## Verificación

- Formulario real en un entorno local aislado, con el mismo img-src que producción;
  únicamente el almacenamiento del formulario y el editor 3D ajeno al cambio se simulan.
- Archivo PNG convertido a JPEG de 256 × 256, guardado en el almacenamiento de prueba
  y recuperado tras recargar el formulario.
- Enlace HTTPS comprobado, guardado directamente con Guardar y recuperado tras recarga.
- Enlace HTTP rechazado y recurso HTTPS inexistente con error claro.
- Vista móvil de 390 × 844: campo dentro de la pantalla, sin desbordamiento horizontal;
  comprobación visual, etiquetas, estado de carga y botón Guardar mediante clic.
- API y SQL reales en una base sintética aislada: ida y vuelta de URL y data URI.
  Suite de integración: 39 comprobaciones correctas, sin modificar agentes reales.
- Compilación de producción correcta; detector de la interfaz sin hallazgos.

No se cambian fotos existentes, datos de agentes ni el esquema SQL durante el despliegue.
