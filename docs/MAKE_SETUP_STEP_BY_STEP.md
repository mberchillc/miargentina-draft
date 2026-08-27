# Configuración paso a paso en Make

Esta guía completa la parte manual de la automatización de **Con Sabor Argentino** y su dashboard de seguimiento.

## Antes de abrir Make

Preparar estos datos:

1. `MIARGENTINA_YOUTUBE_CHANNEL_ID`: ID del canal aprobado de MIArgentina.
2. `RADIO_YOUTUBE_CHANNEL_ID`: ID del segundo canal aprobado.
3. Cuenta de Google con acceso a YouTube.
4. Cuenta de Make.
5. Destino para alertas y confirmaciones: correo, Slack u otro canal operativo.

Los IDs de canales suelen comenzar con `UC`. Copiarlos desde la URL `/channel/UC...` o desde la configuración avanzada del canal. No usar el nombre visible ni el handle `@...` como sustituto.

## 1. Crear el acceso limitado a GitHub

En GitHub:

1. Abrir **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Crear un token con vencimiento definido.
3. En **Repository access**, seleccionar únicamente `mberchillc/miargentina-draft`.
4. En **Repository permissions**, asignar `Contents: Read and write`.
5. No habilitar permisos de administración, Actions ni Workflows.
6. Copiar el token una sola vez.

En Make, guardar el token dentro de una conexión de **HTTP v4 → Make an API key auth request**:

- Key: `Bearer TU_TOKEN`.
- Placement: header.
- Parameter name: `Authorization`.

El token no debe pegarse en módulos de texto, variables, blueprints, archivos JSON ni código del sitio.

## 2. Crear el escenario

1. Crear un escenario nuevo llamado `MIArgentina — Con Sabor semanal`.
2. Configurar la zona horaria de la organización o del escenario como `America/New_York`.
3. Abrir la programación del escenario.
4. Elegir **Weekly**.
5. Día: Monday.
6. Hora: 9:00 AM.
7. Mantener el escenario desactivado hasta completar la prueba manual.

## 3. Agregar la búsqueda de YouTube

Agregar:

`YouTube → Watch Videos by Search`

Configurar:

- Conexión: `Create a connection → Sign in with Google`.
- Query: `Con Sabor Argentino`.
- Ventana reciente recomendada: últimos 8 días.
- Límite inicial recomendado: 10 resultados.

No activar **Show advanced settings** ni introducir credenciales propias de Google Cloud en esta primera versión.

Si el resultado de búsqueda no incluye duración, privacidad o todos los datos necesarios, agregar:

`YouTube → Make an API Call`

y consultar el recurso de videos para el `videoId`, solicitando `snippet`, `contentDetails` y `status`.

## 4. Aplicar los filtros

El candidato debe cumplir simultáneamente:

1. El título contiene `Con Sabor Argentino`.
2. `channelId` coincide con `MIARGENTINA_YOUTUBE_CHANNEL_ID` o `RADIO_YOUTUBE_CHANNEL_ID`.
3. `privacyStatus` es `public`.
4. La duración ISO 8601 es mayor a 30 minutos.
5. La publicación está dentro de los últimos 8 días.
6. No es un Short. La duración superior a 30 minutos lo excluye de manera práctica, pero mantener también el control de tipo si YouTube lo devuelve.

Si quedan varios candidatos, ordenar por `publishedAt` descendente y conservar sólo el primero.

## 5. Construir el objeto del episodio

Mapear el candidato según esta tabla:

| Campo | Valor |
| --- | --- |
| `videoId` | ID del video |
| `title` | Título de YouTube |
| `programDate` | Fecha del programa dominical, `YYYY-MM-DD` |
| `publishedAt` | Fecha y hora de publicación de YouTube |
| `youtubeUrl` | `https://www.youtube.com/watch?v={{videoId}}` |
| `thumbnailUrl` | Mejor miniatura disponible |
| `durationIso` | Duración ISO 8601 |
| `description` | Descripción de YouTube o texto predeterminado aprobado |
| `sourceChannelId` | ID del canal |
| `sourceChannelTitle` | Nombre del canal |

Descripción predeterminada:

`La actualidad y las historias de nuestra comunidad, en vivo desde Miami por Actualidad Radio.`

## 6. Leer el feed y el registro desde GitHub

Usar dos módulos HTTP autenticados con método `GET`:

```text
https://api.github.com/repos/mberchillc/miargentina-draft/contents/data/con-sabor-argentino.json?ref=main
```

```text
https://api.github.com/repos/mberchillc/miargentina-draft/contents/data/automation-status.json?ref=main
```

Headers adicionales:

```text
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

Activar **Parse response**.

Cada respuesta entrega:

- `sha`: necesario para reemplazar el archivo.
- `content`: contenido Base64.

Decodificar `content` y analizar el JSON. En Make puede usarse:

```text
toString(toBinary(content; base64))
```

## 7. Evitar duplicados

Buscar el `videoId` candidato dentro de `episodes`.

### Si ya existe

- No actualizar `con-sabor-argentino.json`.
- Registrar una ejecución `duplicate` en `automation-status.json`.
- Enviar confirmación de ejecución sin cambios.

### Si no existe

- Prependar el episodio.
- Ordenar por `programDate` descendente y luego `publishedAt` descendente.
- Conservar todos los episodios anteriores.
- Mantener `"version": 1`.

## 8. Actualizar el feed en GitHub

Usar **HTTP v4 → Make an API key auth request** con método `PUT`:

```text
https://api.github.com/repos/mberchillc/miargentina-draft/contents/data/con-sabor-argentino.json
```

Content type: `application/json`.

Body:

```json
{
  "message": "content: add Con Sabor Argentino episode YYYY-MM-DD",
  "content": "BASE64_DEL_JSON_FINAL",
  "sha": "SHA_LEIDO_EN_EL_PASO_6",
  "branch": "main"
}
```

Usar `base64(texto_json_final)` para producir `content`.

## 9. Actualizar el registro del dashboard

En todas las rutas que hayan podido leer GitHub:

1. Cambiar `updatedAt` a la hora actual ISO 8601.
2. Actualizar la automatización `con-sabor-argentino-weekly-feed`.
3. Establecer `lastRunAt`, `nextRunAt`, `lastResult` y `lastMessage`.
4. Prependar un elemento en `records`.
5. Conservar sólo los primeros 52 registros.
6. Cambiar `status` a `active` en éxito o duplicado, `warning` si no hay video y `error` ante respuesta inválida.

Actualizar mediante `PUT`:

```text
https://api.github.com/repos/mberchillc/miargentina-draft/contents/data/automation-status.json
```

Body:

```json
{
  "message": "automation: record Con Sabor Argentino run YYYY-MM-DD",
  "content": "BASE64_DEL_REGISTRO_FINAL",
  "sha": "SHA_DEL_REGISTRO_LEIDO_EN_EL_PASO_6",
  "branch": "main"
}
```

## 10. Crear rutas y alertas

Configurar rutas para estos resultados:

| Resultado | `lastResult` | Acción |
| --- | --- | --- |
| Episodio agregado | `episode_added` | Actualizar feed, registrar ejecución y confirmar. |
| Video duplicado | `duplicate` | No tocar feed, registrar ejecución y confirmar. |
| Sin candidato válido | `no_video` | Registrar advertencia y alertar. |
| Respuesta inválida | `invalid_response` | Registrar error y alertar. |
| Falla al escribir GitHub | `github_error` | Alertar; el historial de Make queda como respaldo. |

La confirmación debe incluir título, `programDate`, `/con-sabor-argentino` y `/automatizaciones`.

## 11. Probar y activar

1. Pulsar **Run once**.
2. Usar primero un video que ya exista para comprobar la ruta `duplicate`.
3. Confirmar que el feed de episodios no cambió.
4. Abrir `/automatizaciones` y verificar que aparece la ejecución.
5. Ejecutar una prueba controlada con un episodio temporal nuevo.
6. Confirmar que pasa a “Última emisión”.
7. Retirar el episodio temporal.
8. Confirmar que el dashboard conserva el registro.
9. Activar el escenario semanal.

## Resultado esperado

Después de cada lunes el presidente podrá abrir:

```text
https://miargentina-draft.pages.dev/automatizaciones
```

y revisar:

- Estado de la automatización.
- Última y próxima ejecución.
- Lista de broadcasts publicados.
- Duración y canal de origen.
- Últimas 52 ejecuciones y su resultado.

Referencias oficiales:

- [YouTube en Make](https://apps.make.com/youtube)
- [Programar un escenario en Make](https://help.make.com/schedule-a-scenario)
- [Funciones Base64 de Make](https://help.make.com/text-and-binary-functions)
- [API de contenidos de GitHub](https://docs.github.com/en/rest/repos/contents)
