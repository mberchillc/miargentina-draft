# Automatización semanal de Con Sabor Argentino

## Objetivo

Cada lunes, Make busca la emisión completa más reciente de **Con Sabor Argentino**, actualiza `data/con-sabor-argentino.json` en el repositorio existente y deja que el commit active el despliegue ya configurado de Cloudflare Pages.

La página pública consume el archivo desde `/data/con-sabor-argentino.json` en el mismo dominio. No necesita API key de YouTube, credenciales de GitHub ni otros secretos en el frontend.

## Contrato de datos

El archivo siempre debe conservar este contenedor:

```json
{
  "version": 1,
  "episodes": []
}
```

Cada elemento de `episodes` usa este esquema:

```json
{
  "videoId": "YOUTUBE_VIDEO_ID",
  "title": "Con Sabor Argentino",
  "programDate": "2026-08-16",
  "publishedAt": "2026-08-16T18:00:00-04:00",
  "youtubeUrl": "https://www.youtube.com/watch?v=YOUTUBE_VIDEO_ID",
  "thumbnailUrl": "https://i.ytimg.com/vi/YOUTUBE_VIDEO_ID/hqdefault.jpg",
  "durationIso": "PT2H0M41S",
  "description": "La actualidad y las historias de nuestra comunidad, en vivo desde Miami por Actualidad Radio.",
  "sourceChannelId": "YOUTUBE_CHANNEL_ID",
  "sourceChannelTitle": "MIArgentina USA"
}
```

Campos obligatorios:

- `videoId`: ID único del video de YouTube.
- `title`: título que se muestra en la página.
- `programDate`: fecha del programa dominical, en formato `YYYY-MM-DD`.
- `youtubeUrl`: URL completa del video.
- `thumbnailUrl`: URL pública de la miniatura.

Campos opcionales:

- `publishedAt`: fecha y hora de publicación en formato ISO 8601.
- `durationIso`: duración ISO 8601 de YouTube.
- `description`: descripción que se muestra en la emisión destacada.
- `sourceChannelId`: ID del canal de origen.
- `sourceChannelTitle`: nombre del canal de origen.

La ausencia o invalidez de un campo opcional no debe impedir la publicación. Make no debe eliminar campos existentes que no esté actualizando.

## Escenario de Make

### 1. Programación

Crear un escenario con esta agenda:

- Día: lunes.
- Hora: 9:00 AM.
- Zona horaria: `America/New_York`.

### 2. Buscar videos

Usar el módulo:

`YouTube → Watch Videos by Search`

Conectar YouTube mediante:

`Create a connection → Sign in with Google`

Frase de búsqueda:

`Con Sabor Argentino`

Configurar una ventana reciente suficiente para incluir la emisión del domingo anterior. Después de recibir los resultados, aplicar un filtro que exija todas estas condiciones:

- El título contiene `Con Sabor Argentino`.
- El ID del canal es `MIARGENTINA_YOUTUBE_CHANNEL_ID` o `RADIO_YOUTUBE_CHANNEL_ID`.
- El video es público.
- El video no es un Short.
- La duración es mayor a 30 minutos.
- La publicación está dentro de la ventana reciente configurada.

Si más de un resultado cumple las condiciones, ordenar por la fecha de publicación y seleccionar únicamente el más nuevo.

No reemplazar los placeholders `MIARGENTINA_YOUTUBE_CHANNEL_ID` y `RADIO_YOUTUBE_CHANNEL_ID` hasta que el administrador confirme los dos IDs aprobados.

### 3. Obtener metadatos

Si el módulo de búsqueda no devuelve duración, privacidad o miniatura suficiente para aplicar los filtros y completar el contrato, agregar el módulo de YouTube que obtiene los detalles del video usando el `videoId` seleccionado.

Mapear los datos así:

| Campo JSON | Valor de Make/YouTube |
| --- | --- |
| `videoId` | ID del video de YouTube |
| `title` | Título del video de YouTube |
| `programDate` | Fecha dominical del programa en `YYYY-MM-DD` |
| `publishedAt` | Marca de tiempo de publicación de YouTube |
| `youtubeUrl` | `https://www.youtube.com/watch?v={{videoId}}` |
| `thumbnailUrl` | Mejor miniatura disponible de YouTube |
| `durationIso` | Duración ISO 8601 de YouTube |
| `description` | Descripción de YouTube o descripción predeterminada aprobada |
| `sourceChannelId` | ID del canal de YouTube |
| `sourceChannelTitle` | Nombre del canal de YouTube |

Descripción predeterminada aprobada, si el video no tiene una descripción utilizable:

`La actualidad y las historias de nuestra comunidad, en vivo desde Miami por Actualidad Radio.`

`programDate` representa la fecha del programa dominical, no necesariamente el día u hora exactos en que YouTube terminó de publicar el video.

### 4. Leer el JSON actual en GitHub

Antes de escribir, Make debe obtener el contenido actual de:

`data/con-sabor-argentino.json`

en el repositorio existente, decodificar su contenido si la respuesta de GitHub llega en Base64 y analizarlo como JSON.

Validar antes de continuar:

- El objeto raíz existe.
- `version` sigue siendo `1`.
- `episodes` es un array.

Guardar también el identificador de versión que exija el módulo de GitHub para actualizar el archivo existente, por ejemplo el SHA actual del archivo.

### 5. Evitar duplicados y preparar el archivo final

Buscar `videoId` dentro del array actual.

- Si ya existe el mismo `videoId`, finalizar correctamente el escenario sin crear un commit.
- Si no existe, agregar el nuevo episodio al comienzo.
- Ordenar el array final por `programDate` de más reciente a más antiguo.
- Si dos episodios tienen el mismo `programDate`, usar `publishedAt` como segundo criterio, también descendente.
- Preservar todos los episodios existentes y todos sus datos.
- Mantener `"version": 1`.
- Serializar el objeto completo como JSON válido antes de actualizar GitHub.

Make debe actualizar el archivo existente; no debe crear otro archivo, cambiar su ruta ni reemplazar el array por un único episodio.

### 6. Actualizar GitHub

Usar la conexión de GitHub guardada dentro de Make para actualizar:

`data/con-sabor-argentino.json`

en la rama de producción del repositorio existente.

Mensaje de commit obligatorio:

```text
content: add Con Sabor Argentino episode YYYY-MM-DD
```

Reemplazar `YYYY-MM-DD` por `programDate`.

La credencial de GitHub debe existir únicamente dentro de Make. Nunca debe copiarse en:

- JavaScript.
- HTML.
- El archivo JSON.
- Archivos del repositorio.
- Variables de entorno de Cloudflare Pages, salvo que otra funcionalidad futura lo requiera expresamente.

### 7. Despliegue de Cloudflare Pages

El commit en GitHub debe activar el despliegue de Cloudflare Pages ya conectado al repositorio. No se necesita una llamada separada a la API de Cloudflare ni un Worker.

La confirmación de éxito debe incluir:

- Título del episodio.
- `programDate`.
- Ruta desplegada: `/con-sabor-argentino`.

## Rutas y resultados de error

Configurar manejadores de error o rutas del escenario para estos resultados:

| Resultado | Acción |
| --- | --- |
| El `videoId` ya existe | Finalizar correctamente, sin commit. |
| No hay un video válido | Enviar una alerta y no modificar GitHub. |
| Hay más de un video válido | Seleccionar la emisión completa válida más nueva. |
| La respuesta de YouTube es inválida | Enviar una alerta y no modificar GitHub. |
| La lectura o actualización de GitHub falla | Enviar una alerta y conservar intacto el JSON original. |
| La actualización termina correctamente | Enviar confirmación con título, fecha y `/con-sabor-argentino`. |

La alerta puede enviarse por el canal operativo elegido por el administrador de Make. El escenario no debe continuar hacia GitHub cuando falte un dato obligatorio o una respuesta sea inválida.

## Credenciales de Google

La primera versión usa exclusivamente la conexión estándar de YouTube de Make:

`Create a connection → Sign in with Google`

No requiere:

- Proyecto personalizado de Google Cloud.
- Cliente OAuth personalizado.
- Client ID.
- Client secret.
- API key de YouTube en el frontend.

Un proyecto y credenciales propios de Google Cloud son una configuración futura opcional sólo si la conexión estándar de Make deja de ser suficiente.

## Checklist de activación manual

Antes de activar el escenario semanal:

1. Reemplazar `MIARGENTINA_YOUTUBE_CHANNEL_ID` y `RADIO_YOUTUBE_CHANNEL_ID` por los dos IDs aprobados dentro de los filtros de Make, no dentro del repositorio.
2. Conectar la cuenta de Google en el módulo de YouTube.
3. Conectar GitHub en Make con permiso de escritura limitado al repositorio y la rama necesarios.
4. Confirmar la rama de producción y que un commit de prueba activa Cloudflare Pages.
5. Definir el canal operativo que recibirá alertas y confirmaciones.
6. Ejecutar el escenario una vez en modo manual y comprobar que un `videoId` ya existente termina sin commit.
7. Activar la programación de los lunes a las 9:00 AM en `America/New_York`.
