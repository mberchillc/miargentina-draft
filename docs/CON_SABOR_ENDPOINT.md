# Endpoint de episodios de Con Sabor Argentino

Esta Cloudflare Pages Function recibe un episodio desde Make, evita duplicados por `videoId` y actualiza `data/con-sabor-argentino.json` mediante la API de GitHub. También registra cada ejecución correcta o duplicada en `data/automation-status.json`, de modo que el dashboard refleje el mismo resultado. Cada episodio nuevo genera un commit en `main`; Cloudflare Pages publica después ese commit y la card aparece automáticamente en el sitio.

## Endpoint

```text
POST https://miargentina-draft.pages.dev/api/con-sabor-argentino
```

La solicitud debe usar `Content-Type: application/json` y uno de estos dos encabezados de autenticación:

```text
Authorization: Bearer EL_SECRETO_COMPARTIDO
```

o:

```text
X-Automation-Secret: EL_SECRETO_COMPARTIDO
```

## Variables secretas de Cloudflare

Configurar ambas como **Secrets** en el entorno Production del proyecto de Cloudflare Pages:

- `AUTOMATION_SECRET`: secreto largo y aleatorio compartido únicamente con Make.
- `GITHUB_CONTENTS_TOKEN`: token fine-grained de GitHub limitado al repositorio `mberchillc/miargentina-draft`, con permiso `Contents: Read and write`.

No guardar ninguno de estos valores en GitHub, en el frontend ni en esta documentación. Si se prueba una Preview deployment, configurar también los dos secrets en Preview.

## Cuerpo requerido

```json
{
  "videoId": "AbCdEfGhI12",
  "title": "Con Sabor Argentino",
  "programDate": "2026-08-23",
  "youtubeUrl": "https://www.youtube.com/watch?v=AbCdEfGhI12",
  "thumbnailUrl": "https://i.ytimg.com/vi/AbCdEfGhI12/maxresdefault.jpg",
  "durationIso": "PT2H3M17S",
  "description": "La nueva emisión de Con Sabor Argentino desde Miami.",
  "publishedAt": "2026-08-23T15:00:00Z",
  "sourceChannelId": "UC...",
  "sourceChannelTitle": "MIArgentina USA"
}
```

`description`, `publishedAt`, `sourceChannelId` y `sourceChannelTitle` son opcionales. Los otros seis campos son obligatorios. Cuando llega `publishedAt`, el endpoint normaliza `programDate` al domingo correspondiente en la zona horaria `America/New_York`.

## Ejemplo con curl

```bash
curl --request POST \
  --url "https://miargentina-draft.pages.dev/api/con-sabor-argentino" \
  --header "Authorization: Bearer $AUTOMATION_SECRET" \
  --header "Content-Type: application/json" \
  --data '{
    "videoId": "AbCdEfGhI12",
    "title": "Con Sabor Argentino",
    "programDate": "2026-08-23",
    "youtubeUrl": "https://www.youtube.com/watch?v=AbCdEfGhI12",
    "thumbnailUrl": "https://i.ytimg.com/vi/AbCdEfGhI12/maxresdefault.jpg",
    "durationIso": "PT2H3M17S",
    "description": "La nueva emisión de Con Sabor Argentino desde Miami.",
    "publishedAt": "2026-08-23T15:00:00Z"
  }'
```

En Make, usar el módulo HTTP **Make a request**, método `POST`, body type `Raw`, content type `application/json` y guardar `AUTOMATION_SECRET` en la conexión o keychain, no dentro del escenario como texto visible.

## Respuestas

Episodio nuevo:

```json
{
  "ok": true,
  "duplicate": false,
  "videoId": "AbCdEfGhI12",
  "dashboardUpdated": true
}
```

Episodio ya registrado:

```json
{
  "ok": true,
  "duplicate": true,
  "dashboardUpdated": true
}
```

Los errores de autenticación, validación o acceso a GitHub devuelven un código HTTP apropiado y un objeto JSON con `ok: false`. Si el episodio se guarda pero falla la actualización del dashboard, Make debe reintentar: la segunda llamada detectará el duplicado y completará el registro operativo sin volver a crear la emisión.

## Configuración del despliegue

No hay que cambiar el framework preset, el build command ni el output directory actuales. La carpeta `functions/` en la raíz es detectada por Cloudflare Pages. El único cambio manual es crear los dos secrets de Production y volver a desplegar si Cloudflare no inicia automáticamente un deployment después de configurarlos.

