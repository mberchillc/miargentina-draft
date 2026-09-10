# Automatización de Con Sabor Argentino

## Estado actual

La publicación semanal se ejecuta dentro del repositorio mediante GitHub Actions. Make deja de ser un requisito operativo y el endpoint existente de Cloudflare Pages queda disponible como respaldo compatible con integraciones externas.

## Recorrido automático

Cada lunes a las 9:07 AM de `America/New_York` el workflow:

1. Lee los feeds públicos de los canales aprobados de MIArgentina USA y Norberto Spangaro.
2. Conserva únicamente videos cuyo título contiene `Con Sabor Argentino`.
3. Verifica en la página del video que la duración sea superior a 30 minutos y que el canal sea uno de los aprobados.
4. Calcula la fecha editorial del domingo en la zona horaria de Miami.
5. Evita duplicados tanto por `videoId` como por `programDate`, para no publicar dos veces la misma emisión replicada en ambos canales.
6. Si la emisión es nueva, la agrega a `data/con-sabor-argentino.json` sin eliminar episodios anteriores.
7. Registra toda ejecución, incluso un duplicado o un error, en `data/automation-status.json`.
8. Guarda el cambio en `main`. La integración Git de Cloudflare Pages publica el nuevo commit.

El workflow también puede ejecutarse manualmente desde la pestaña **Actions** de GitHub.

## Archivos

- Workflow: `.github/workflows/sync-con-sabor-argentino.yml`
- Lógica: `scripts/sync-con-sabor-argentino.mjs`
- Pruebas: `scripts/sync-con-sabor-argentino.test.mjs`
- Feed público: `data/con-sabor-argentino.json`
- Registro del dashboard: `data/automation-status.json`

## Verificación manual local

Pruebas automáticas:

```text
node --test scripts/sync-con-sabor-argentino.test.mjs
```

Consulta real de YouTube sin modificar archivos:

```text
node scripts/sync-con-sabor-argentino.mjs --dry-run
```

## Credenciales

Este proceso no necesita una API key de YouTube, un token personal de GitHub ni nuevas variables de Cloudflare. GitHub crea un `GITHUB_TOKEN` efímero y limitado al repositorio para cada ejecución; el workflow solicita únicamente `contents: write`.

## Cloudflare

No se requiere un cambio manual en Cloudflare. El sitio continúa desplegándose desde la rama `main` mediante la integración Git ya configurada.

## Respaldo con Make

El endpoint `POST /api/con-sabor-argentino` continúa activo y protegido por `AUTOMATION_SECRET`. Si Make vuelve a utilizarse, debe enviar el episodio al endpoint y no escribir los JSON por separado. La deduplicación del endpoint impide repetir un mismo `videoId`.
