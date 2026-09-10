import { readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PROGRAM_TITLE = "Con Sabor Argentino";
const PROGRAM_TIME_ZONE = "America/New_York";
const MINIMUM_DURATION_SECONDS = 30 * 60;
const MAX_RECORDS = 52;
const EPISODE_FILE = "data/con-sabor-argentino.json";
const STATUS_FILE = "data/automation-status.json";
const AUTOMATION_ID = "con-sabor-argentino-weekly-feed";
const DEFAULT_DESCRIPTION =
  "Programa en vivo destinado a la comunidad latina en Estados Unidos por Actualidad Radio 1040";

const SOURCES = [
  {
    channelId: "UCjRFHcYvGmwto_u8rtoTWzA",
    channelTitle: "MIArgentina USA",
    priority: 0
  },
  {
    channelId: "UCLcP-Ko_xaWgCNj7H8jowqQ",
    channelTitle: "Norberto Spangaro",
    priority: 1
  }
];

const USER_AGENT = "MIArgentina-Con-Sabor-Sync/1.0";

export function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readXmlTag(xml, tagName) {
  const match = new RegExp(
    `<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(tagName)}>`
  ).exec(xml);
  return match ? decodeXml(match[1]) : "";
}

export function parseYouTubeFeed(xml, source = {}) {
  if (typeof xml !== "string" || !xml.includes("<feed")) {
    throw new Error("YouTube devolvió un feed inválido.");
  }

  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((match) => {
      const entry = match[1];
      const thumbnailMatch = /<media:thumbnail\b[^>]*\burl="([^"]+)"/i.exec(entry);
      return {
        videoId: readXmlTag(entry, "yt:videoId"),
        channelId: readXmlTag(entry, "yt:channelId") || source.channelId || "",
        channelTitle: readXmlTag(entry, "name") || source.channelTitle || "",
        title: readXmlTag(entry, "title"),
        publishedAt: readXmlTag(entry, "published"),
        description: readXmlTag(entry, "media:description"),
        thumbnailUrl: thumbnailMatch ? decodeXml(thumbnailMatch[1]) : "",
        sourcePriority: Number(source.priority || 0)
      };
    })
    .filter((entry) => entry.videoId && entry.title && entry.publishedAt);
}

function extractBalancedJson(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;

  const start = text.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === "\"") inString = false;
      continue;
    }

    if (character === "\"") inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

export function parseVideoDetails(html) {
  if (typeof html !== "string") throw new Error("YouTube devolvió una página inválida.");

  const markers = ["var ytInitialPlayerResponse = ", "ytInitialPlayerResponse = "];
  const serialized = markers
    .map((marker) => extractBalancedJson(html, marker))
    .find(Boolean);

  if (!serialized) throw new Error("No se encontraron los metadatos del video.");

  let response;
  try {
    response = JSON.parse(serialized);
  } catch {
    throw new Error("Los metadatos del video no son JSON válido.");
  }

  const details = response.videoDetails || {};
  const microformat = response.microformat?.playerMicroformatRenderer || {};
  const durationSeconds = Number(details.lengthSeconds);

  if (!details.videoId || !details.title || !Number.isFinite(durationSeconds)) {
    throw new Error("Faltan metadatos obligatorios del video.");
  }

  return {
    videoId: details.videoId,
    title: details.title,
    channelId: details.channelId || "",
    channelTitle: details.author || "",
    durationSeconds,
    description: typeof details.shortDescription === "string" ? details.shortDescription.trim() : "",
    publishedAt: microformat.publishDate || microformat.uploadDate || "",
    startedAt: microformat.liveBroadcastDetails?.startTimestamp || "",
    isLiveContent: details.isLiveContent === true
  };
}

function textValue(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value?.simpleText === "string") return value.simpleText.trim();
  if (Array.isArray(value?.runs)) {
    return value.runs.map((run) => run?.text || "").join("").trim();
  }
  return "";
}

export function durationLabelToSeconds(value) {
  const parts = String(value || "")
    .trim()
    .split(":")
    .map((part) => Number(part));

  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part))) {
    return Number.NaN;
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
}

function collectShortStrings(value, results = []) {
  if (typeof value === "string") {
    if (value.length <= 160) results.push(value);
    return results;
  }
  if (!value || typeof value !== "object") return results;

  for (const child of Object.values(value)) collectShortStrings(child, results);
  return results;
}

export function parseChannelStreams(html) {
  if (typeof html !== "string") throw new Error("YouTube devolvió una página inválida.");

  const markers = ["var ytInitialData = ", "ytInitialData = "];
  const serialized = markers
    .map((marker) => extractBalancedJson(html, marker))
    .find(Boolean);

  if (!serialized) throw new Error("No se encontraron los datos públicos del canal.");

  let initialData;
  try {
    initialData = JSON.parse(serialized);
  } catch {
    throw new Error("Los datos públicos del canal no son JSON válido.");
  }

  const videos = new Map();

  function visit(value) {
    if (!value || typeof value !== "object") return;

    const model = value.lockupViewModel || value.videoRenderer || value.gridVideoRenderer || value;
    const videoId = model?.contentId || model?.videoId || model?.navigationEndpoint?.watchEndpoint?.videoId;

    if (typeof videoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      const title =
        textValue(model?.metadata?.lockupMetadataViewModel?.title) ||
        textValue(model?.title) ||
        collectShortStrings(model).find((item) => titleMatches(item)) ||
        "";
      const durationLabel = collectShortStrings(model).find((item) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(item)) || "";
      const durationSeconds = durationLabelToSeconds(durationLabel);

      if (Number.isFinite(durationSeconds)) {
        const current = videos.get(videoId);
        if (!current || (!current.title && title)) videos.set(videoId, { videoId, title, durationSeconds });
      }
    }

    for (const child of Object.values(value)) visit(child);
  }

  visit(initialData);
  return [...videos.values()];
}

export function secondsToIso(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds)));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `PT${hours ? `${hours}H` : ""}${minutes ? `${minutes}M` : ""}${remainder || (!hours && !minutes) ? `${remainder}S` : ""}`;
}

function zonedParts(value, timeZone = PROGRAM_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short"
  }).formatToParts(new Date(value));

  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday")
  };
}

export function programDateForTimestamp(value) {
  const parts = zonedParts(value);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

function localDateTimeToUtc({ year, month, day, hour, minute = 0, second = 0 }) {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = targetAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = zonedParts(guess);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second
    );
    guess += targetAsUtc - observedAsUtc;
  }

  return new Date(guess);
}

export function nextMondayAtNine(value) {
  const parts = zonedParts(value);
  const weekdayNumbers = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayNumbers[parts.weekday];
  const daysUntilMonday = weekday === 1 && parts.hour < 9 ? 0 : ((8 - weekday) % 7 || 7);
  const targetDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  targetDate.setUTCDate(targetDate.getUTCDate() + daysUntilMonday);

  return localDateTimeToUtc({
    year: targetDate.getUTCFullYear(),
    month: targetDate.getUTCMonth() + 1,
    day: targetDate.getUTCDate(),
    hour: 9
  }).toISOString();
}

function titleMatches(value) {
  return typeof value === "string" && value.toLocaleLowerCase("es").includes(PROGRAM_TITLE.toLocaleLowerCase("es"));
}

function validHttpUrl(value, allowedHosts) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && allowedHosts.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": USER_AGENT
    },
    redirect: "follow"
  });

  if (!response.ok) throw new Error(`La consulta a ${new URL(url).hostname} respondió ${response.status}.`);
  return response.text();
}

export async function findLatestEpisode({ fetchTextImpl = fetchText } = {}) {
  const [feedResults, streamResults] = await Promise.all([
    Promise.allSettled(
      SOURCES.map(async (source) => {
        const xml = await fetchTextImpl(
          `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(source.channelId)}`
        );
        return parseYouTubeFeed(xml, source);
      })
    ),
    Promise.allSettled(
      SOURCES.map(async (source) => {
        const html = await fetchTextImpl(
          `https://www.youtube.com/channel/${encodeURIComponent(source.channelId)}/streams`
        );
        return parseChannelStreams(html);
      })
    )
  ]);

  const entries = feedResults
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value)
    .filter((entry) => titleMatches(entry.title))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.sourcePriority - b.sourcePriority);

  if (!entries.length) {
    const reasons = feedResults
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message)
      .filter(Boolean);
    throw new Error(reasons[0] || "No se encontró una emisión pública de Con Sabor Argentino.");
  }

  const streamMetadata = new Map(
    streamResults
      .filter((result) => result.status === "fulfilled")
      .flatMap((result) => result.value)
      .map((video) => [video.videoId, video])
  );

  for (const entry of entries) {
    const details = streamMetadata.get(entry.videoId);
    if (!details) continue;
    if (details.title && !titleMatches(details.title)) continue;
    if (details.durationSeconds < MINIMUM_DURATION_SECONDS) continue;

    return {
      videoId: entry.videoId,
      title: PROGRAM_TITLE,
      programDate: programDateForTimestamp(entry.publishedAt),
      youtubeUrl: `https://www.youtube.com/watch?v=${entry.videoId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${entry.videoId}/maxresdefault.jpg`,
      durationIso: secondsToIso(details.durationSeconds),
      description: entry.description || DEFAULT_DESCRIPTION,
      publishedAt: entry.publishedAt,
      sourceChannelId: entry.channelId,
      sourceChannelTitle: entry.channelTitle
    };
  }

  const streamErrors = streamResults
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message)
    .filter(Boolean);

  throw new Error(
    streamErrors[0]
      ? `No se pudo validar la duración de las emisiones. ${streamErrors[0]}`
      : "No se encontró una emisión completa válida en los canales aprobados."
  );
}

function episodeSortValue(episode) {
  const date = typeof episode?.programDate === "string" ? episode.programDate : "";
  const published = typeof episode?.publishedAt === "string" ? episode.publishedAt : "";
  return `${date}|${published}`;
}

export function mergeEpisode(feedData, episode) {
  if (!feedData || typeof feedData !== "object" || !Array.isArray(feedData.episodes)) {
    throw new Error("El archivo de episodios tiene un formato inválido.");
  }

  const existing = feedData.episodes.find(
    (item) => item?.videoId === episode.videoId || item?.programDate === episode.programDate
  );

  if (existing) {
    return { data: feedData, duplicate: true, existing };
  }

  const episodes = [episode, ...feedData.episodes]
    .sort((a, b) => episodeSortValue(b).localeCompare(episodeSortValue(a)));

  return {
    data: { ...feedData, episodes },
    duplicate: false,
    existing: null
  };
}

export function updateAutomationStatus(statusData, { result, message, now, episode, status = "active" }) {
  if (!statusData || typeof statusData !== "object" || !Array.isArray(statusData.automations)) {
    throw new Error("El archivo del dashboard tiene un formato inválido.");
  }

  const index = statusData.automations.findIndex((automation) => automation?.id === AUTOMATION_ID);
  if (index < 0) throw new Error("No se encontró la automatización de Con Sabor Argentino en el dashboard.");

  const runAt = new Date(now).toISOString();
  const current = statusData.automations[index];
  const records = Array.isArray(current.records) ? current.records : [];
  const record = { runAt, result, message };
  if (episode?.videoId) record.videoId = episode.videoId;
  if (episode?.programDate) record.programDate = episode.programDate;

  const automation = {
    ...current,
    provider: "GitHub Actions + Cloudflare Pages",
    status,
    schedule: {
      frequency: "weekly",
      day: "Monday",
      time: "09:00",
      timeZone: PROGRAM_TIME_ZONE
    },
    lastRunAt: runAt,
    nextRunAt: nextMondayAtNine(now),
    lastResult: result,
    lastMessage: message,
    records: [record, ...records].slice(0, MAX_RECORDS)
  };

  const automations = [...statusData.automations];
  automations[index] = automation;
  return { ...statusData, updatedAt: runAt, automations };
}

async function readJson(filePath) {
  const value = JSON.parse(await readFile(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filePath} no contiene un objeto JSON válido.`);
  }
  return value;
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function writeSummary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, "utf8");
}

export async function runSync({ root = process.cwd(), dryRun = false, now = new Date() } = {}) {
  const episodePath = resolve(root, EPISODE_FILE);
  const statusPath = resolve(root, STATUS_FILE);
  const feedData = await readJson(episodePath);
  const statusData = await readJson(statusPath);
  const episode = await findLatestEpisode();

  if (!validHttpUrl(episode.youtubeUrl, ["www.youtube.com", "youtube.com"])) {
    throw new Error("La URL del episodio no pertenece a YouTube.");
  }
  if (!validHttpUrl(episode.thumbnailUrl, ["i.ytimg.com", "img.youtube.com"])) {
    throw new Error("La miniatura del episodio no pertenece a YouTube.");
  }

  const merged = mergeEpisode(feedData, episode);
  const result = merged.duplicate ? "duplicate" : "episode_added";
  const message = merged.duplicate
    ? `La emisión del ${episode.programDate} ya estaba publicada; el control automático terminó correctamente.`
    : `Se publicó automáticamente la emisión del ${episode.programDate}.`;
  const updatedStatus = updateAutomationStatus(statusData, { result, message, now, episode });

  if (!dryRun) {
    if (!merged.duplicate) await writeJson(episodePath, merged.data);
    await writeJson(statusPath, updatedStatus);
  }

  await writeSummary([
    "## Con Sabor Argentino",
    "",
    `- Resultado: **${result}**`,
    `- Emisión: **${episode.programDate}**`,
    `- Video: [${episode.videoId}](${episode.youtubeUrl})`,
    `- Modo: ${dryRun ? "prueba sin escritura" : "actualización del repositorio"}`
  ]);

  return { result, message, episode, duplicate: merged.duplicate };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const nowArgument = process.argv.find((argument) => argument.startsWith("--now="));
  const now = nowArgument ? new Date(nowArgument.slice("--now=".length)) : new Date();
  let statusData;

  try {
    const result = await runSync({ dryRun, now });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido en la automatización.";
    console.error(JSON.stringify({ ok: false, error: message }, null, 2));

    if (!dryRun) {
      try {
        const statusPath = resolve(process.cwd(), STATUS_FILE);
        statusData = await readJson(statusPath);
        const failedStatus = updateAutomationStatus(statusData, {
          result: "invalid_response",
          message,
          now,
          status: "error"
        });
        await writeJson(statusPath, failedStatus);
        await writeSummary(["## Con Sabor Argentino", "", `- Resultado: **error**`, `- Detalle: ${message}`]);
      } catch (statusError) {
        console.error(`No se pudo registrar el error en el dashboard: ${statusError instanceof Error ? statusError.message : statusError}`);
      }
    }

    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) await main();

