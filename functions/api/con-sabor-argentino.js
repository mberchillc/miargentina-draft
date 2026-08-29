const GITHUB_OWNER = "mberchillc";
const GITHUB_REPOSITORY = "miargentina-draft";
const GITHUB_BRANCH = "main";
const DATA_FILE_PATH = "data/con-sabor-argentino.json";
const GITHUB_API_VERSION = "2022-11-28";
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_GITHUB_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_ATTEMPTS = 3;

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "method_not_allowed", message: "Use POST for this endpoint." },
      405,
      { Allow: "POST" }
    );
  }

  try {
    const automationSecret = readEnvironmentValue(env.AUTOMATION_SECRET);
    const githubToken = readEnvironmentValue(env.GITHUB_CONTENTS_TOKEN);

    if (!automationSecret || !githubToken) {
      throw new ApiError(
        500,
        "server_not_configured",
        "The endpoint is not fully configured."
      );
    }

    const presentedSecret = getPresentedSecret(request);
    if (!presentedSecret || !(await secretsMatch(presentedSecret, automationSecret))) {
      throw new ApiError(401, "unauthorized", "Invalid or missing automation secret.");
    }

    const contentType = request.headers.get("content-type") || "";
    if (!isJsonContentType(contentType)) {
      throw new ApiError(415, "unsupported_media_type", "Content-Type must be application/json.");
    }

    const payload = await readRequestJson(request);
    const episode = validateEpisode(payload);
    const result = await addEpisodeToRepository(episode, githubToken);

    return jsonResponse(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse(
        { ok: false, error: error.code, message: error.message },
        error.status
      );
    }

    console.error(JSON.stringify({
      event: "con_sabor_argentino_endpoint_error",
      message: error instanceof Error ? error.message : "Unknown error"
    }));

    return jsonResponse(
      { ok: false, error: "internal_error", message: "The episode could not be processed." },
      500
    );
  }
}

async function addEpisodeToRepository(episode, githubToken) {
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    const currentFile = await readEpisodeFile(githubToken);

    if (currentFile.data.episodes.some((item) => item?.videoId === episode.videoId)) {
      return { ok: true, duplicate: true };
    }

    const updatedData = {
      ...currentFile.data,
      episodes: [episode, ...currentFile.data.episodes]
    };

    const updateResponse = await writeEpisodeFile(
      githubToken,
      currentFile.sha,
      updatedData,
      episode
    );

    if (updateResponse.ok) {
      return { ok: true, duplicate: false, videoId: episode.videoId };
    }

    if (updateResponse.status === 409 || updateResponse.status === 422) {
      if (attempt < MAX_WRITE_ATTEMPTS) continue;

      throw new ApiError(
        409,
        "concurrent_update",
        "The episode file changed during the request. Please retry."
      );
    }

    throw new ApiError(
      502,
      "github_write_failed",
      "GitHub could not save the updated episode file."
    );
  }

  throw new ApiError(500, "internal_error", "The episode could not be processed.");
}

async function readEpisodeFile(githubToken) {
  const response = await fetch(githubContentsUrl(), {
    method: "GET",
    headers: githubHeaders(githubToken)
  });

  if (!response.ok) {
    throw new ApiError(
      502,
      "github_read_failed",
      "GitHub could not read the current episode file."
    );
  }

  const file = await readJsonResponse(response, MAX_GITHUB_RESPONSE_BYTES);
  if (typeof file?.sha !== "string" || typeof file?.content !== "string") {
    throw new ApiError(502, "invalid_github_response", "GitHub returned an invalid file response.");
  }

  let data;
  try {
    data = JSON.parse(decodeBase64Utf8(file.content));
  } catch {
    throw new ApiError(502, "invalid_episode_file", "The current episode file is not valid JSON.");
  }

  if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.episodes)) {
    throw new ApiError(502, "invalid_episode_file", "The current episode file has an invalid schema.");
  }

  return { sha: file.sha, data };
}

async function writeEpisodeFile(githubToken, sha, data, episode) {
  const formattedJson = `${JSON.stringify(data, null, 2)}\n`;
  const body = {
    message: `Add Con Sabor Argentino episode ${episode.programDate}`,
    content: encodeBase64Utf8(formattedJson),
    sha,
    branch: GITHUB_BRANCH
  };

  return fetch(githubContentsUrl(false), {
    method: "PUT",
    headers: {
      ...githubHeaders(githubToken),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

function githubContentsUrl(includeRef = true) {
  const encodedPath = DATA_FILE_PATH.split("/").map(encodeURIComponent).join("/");
  const baseUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPOSITORY}/contents/${encodedPath}`;
  return includeRef ? `${baseUrl}?ref=${encodeURIComponent(GITHUB_BRANCH)}` : baseUrl;
}

function githubHeaders(githubToken) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${githubToken}`,
    "User-Agent": "miargentina-cloudflare-automation",
    "X-GitHub-Api-Version": GITHUB_API_VERSION
  };
}

function validateEpisode(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(400, "validation_error", "The request body must be a JSON object.");
  }

  const videoId = requiredString(payload.videoId, "videoId", 128);
  const title = requiredString(payload.title, "title", 240);
  const programDate = requiredString(payload.programDate, "programDate", 10);
  const youtubeUrl = requiredString(payload.youtubeUrl, "youtubeUrl", 2048);
  const thumbnailUrl = requiredString(payload.thumbnailUrl, "thumbnailUrl", 2048);
  const durationIso = requiredString(payload.durationIso, "durationIso", 64);

  if (!/^[A-Za-z0-9_-]{6,128}$/.test(videoId)) {
    throw new ApiError(400, "validation_error", "videoId has an invalid format.");
  }

  if (!isValidDateOnly(programDate)) {
    throw new ApiError(400, "validation_error", "programDate must be a valid YYYY-MM-DD date.");
  }

  const parsedYoutubeUrl = validateHttpsUrl(youtubeUrl, "youtubeUrl");
  const youtubeHost = parsedYoutubeUrl.hostname.toLowerCase();
  if (!(youtubeHost === "youtu.be" || youtubeHost === "youtube.com" || youtubeHost.endsWith(".youtube.com"))) {
    throw new ApiError(400, "validation_error", "youtubeUrl must point to YouTube.");
  }

  const urlVideoId = extractYouTubeVideoId(parsedYoutubeUrl);
  if (urlVideoId && urlVideoId !== videoId) {
    throw new ApiError(400, "validation_error", "youtubeUrl does not match videoId.");
  }

  const parsedThumbnailUrl = validateHttpsUrl(thumbnailUrl, "thumbnailUrl");
  const thumbnailHost = parsedThumbnailUrl.hostname.toLowerCase();
  if (thumbnailHost !== "i.ytimg.com" && thumbnailHost !== "img.youtube.com") {
    throw new ApiError(400, "validation_error", "thumbnailUrl must point to a YouTube image host.");
  }

  if (!/^PT(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?$/.test(durationIso)) {
    throw new ApiError(400, "validation_error", "durationIso must use the PT... ISO 8601 format.");
  }

  const episode = {
    videoId,
    title,
    programDate,
    youtubeUrl: parsedYoutubeUrl.toString(),
    thumbnailUrl: parsedThumbnailUrl.toString(),
    durationIso
  };

  if (payload.description !== undefined && payload.description !== null) {
    episode.description = optionalString(payload.description, "description", 10000);
  }

  if (payload.publishedAt !== undefined && payload.publishedAt !== null) {
    const publishedAt = optionalString(payload.publishedAt, "publishedAt", 64);
    const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
    if (!isoDateTimePattern.test(publishedAt) || Number.isNaN(Date.parse(publishedAt))) {
      throw new ApiError(400, "validation_error", "publishedAt must be a valid ISO datetime.");
    }
    episode.publishedAt = publishedAt;
  }

  return episode;
}

function requiredString(value, fieldName, maximumLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "validation_error", `${fieldName} is required.`);
  }

  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new ApiError(400, "validation_error", `${fieldName} is too long.`);
  }

  return normalized;
}

function optionalString(value, fieldName, maximumLength) {
  if (typeof value !== "string") {
    throw new ApiError(400, "validation_error", `${fieldName} must be a string.`);
  }

  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new ApiError(400, "validation_error", `${fieldName} is too long.`);
  }

  return normalized;
}

function validateHttpsUrl(value, fieldName) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError(400, "validation_error", `${fieldName} must be a valid URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new ApiError(400, "validation_error", `${fieldName} must use HTTPS.`);
  }

  return parsed;
}

function extractYouTubeVideoId(url) {
  if (url.hostname.toLowerCase() === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0] || null;
  }

  if (url.searchParams.has("v")) {
    return url.searchParams.get("v");
  }

  const [route, id] = url.pathname.split("/").filter(Boolean);
  return ["embed", "live", "shorts"].includes(route) ? id || null : null;
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isJsonContentType(contentType) {
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function getPresentedSecret(request) {
  const authorization = request.headers.get("authorization") || "";
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch?.[1]?.trim()) return bearerMatch[1].trim();

  const headerSecret = request.headers.get("x-automation-secret");
  return headerSecret?.trim() || "";
}

function readEnvironmentValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function secretsMatch(presented, expected) {
  const encoder = new TextEncoder();
  const [presentedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);

  const left = new Uint8Array(presentedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;

  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }

  return difference === 0;
}

async function readRequestJson(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new ApiError(413, "payload_too_large", "The request body is too large.");
  }

  const text = await readStreamText(request.body, MAX_REQUEST_BYTES, 413, "payload_too_large");
  if (!text.trim()) {
    throw new ApiError(400, "invalid_json", "The request body cannot be empty.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "The request body must contain valid JSON.");
  }
}

async function readJsonResponse(response, maximumBytes) {
  const text = await readStreamText(
    response.body,
    maximumBytes,
    502,
    "invalid_github_response"
  );

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(502, "invalid_github_response", "GitHub returned invalid JSON.");
  }
}

async function readStreamText(stream, maximumBytes, overflowStatus, overflowCode) {
  if (!stream) return "";

  const reader = stream.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new ApiError(overflowStatus, overflowCode, "The response body exceeded the allowed size.");
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

function decodeBase64Utf8(value) {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function jsonResponse(body, status = 200, additionalHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...additionalHeaders
    }
  });
}

