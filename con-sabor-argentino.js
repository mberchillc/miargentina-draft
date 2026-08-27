(() => {
  "use strict";

  const latestEpisode = document.querySelector("[data-latest-episode]");
  const episodeGrid = document.querySelector("[data-episode-grid]");

  if (!latestEpisode || !episodeGrid) return;

  const dateFormatter = new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });

  const getText = (value) => typeof value === "string" ? value.trim() : "";

  const getSafeUrl = (value) => {
    const text = getText(value);
    if (!text) return "";

    try {
      const url = new URL(text, window.location.origin);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
      return "";
    }
  };

  const getDateValue = (value) => {
    const text = getText(value);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return { text, timestamp: date.getTime(), date };
  };

  const getPublishedTimestamp = (value) => {
    const text = getText(value);
    if (!text) return 0;

    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  const getDurationSeconds = (value) => {
    const text = getText(value);
    if (!text) return null;

    const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(text);
    if (!match || !match.slice(1).some(Boolean)) return null;

    const days = Number(match[1] || 0);
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    const seconds = Number(match[4] || 0);
    const total = Math.floor((days * 24 * 60 * 60) + (hours * 60 * 60) + (minutes * 60) + seconds);

    return Number.isFinite(total) && total > 0 ? total : null;
  };

  const normalizeEpisode = (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;

    const videoId = getText(entry.videoId);
    const title = getText(entry.title);
    const programDate = getDateValue(entry.programDate);
    const youtubeUrl = getSafeUrl(entry.youtubeUrl);
    const thumbnailUrl = getSafeUrl(entry.thumbnailUrl);

    if (!videoId || !title || !programDate || !youtubeUrl || !thumbnailUrl) return null;

    return {
      videoId,
      title,
      programDate: programDate.text,
      programTimestamp: programDate.timestamp,
      publishedTimestamp: getPublishedTimestamp(entry.publishedAt),
      youtubeUrl,
      thumbnailUrl,
      durationSeconds: getDurationSeconds(entry.durationIso),
      description: getText(entry.description)
    };
  };

  const getEpisodes = (entries) => {
    const seen = new Set();

    return entries
      .map(normalizeEpisode)
      .filter((episode) => {
        if (!episode || seen.has(episode.videoId)) return false;
        seen.add(episode.videoId);
        return true;
      })
      .sort((a, b) => {
        const programDateDifference = b.programTimestamp - a.programTimestamp;
        return programDateDifference || b.publishedTimestamp - a.publishedTimestamp;
      });
  };

  const formatDate = (episode) => dateFormatter.format(new Date(episode.programTimestamp));

  const formatClockDuration = (totalSeconds) => {
    if (!totalSeconds) return "";

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const paddedMinutes = String(minutes).padStart(2, "0");
    const paddedSeconds = String(seconds).padStart(2, "0");

    return hours > 0
      ? `${hours}:${paddedMinutes}:${paddedSeconds}`
      : `${minutes}:${paddedSeconds}`;
  };

  const formatDurationSummary = (totalSeconds) => {
    if (!totalSeconds) return "";

    const hours = Math.floor(totalSeconds / 3600);
    if (hours > 0) return `${hours} h`;

    const minutes = Math.max(1, Math.floor(totalSeconds / 60));
    return `${minutes} min`;
  };

  const setExternalLink = (link, url) => {
    link.setAttribute("href", url);
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  };

  const createIconText = (text, icon) => {
    const fragment = document.createDocumentFragment();
    fragment.append(document.createTextNode(`${text} `));

    const iconSpan = document.createElement("span");
    iconSpan.setAttribute("aria-hidden", "true");
    iconSpan.textContent = icon;
    fragment.append(iconSpan);

    return fragment;
  };

  const buildLatestEpisode = (episode) => {
    const dateText = formatDate(episode);
    const fragment = document.createDocumentFragment();

    const video = document.createElement("div");
    video.className = "latest-episode__video";

    const videoLink = document.createElement("a");
    setExternalLink(videoLink, episode.youtubeUrl);
    videoLink.setAttribute("aria-label", `Ver la última emisión de ${episode.title} en YouTube`);

    const image = document.createElement("img");
    image.setAttribute("src", episode.thumbnailUrl);
    image.setAttribute("alt", `Última emisión de ${episode.title}, ${dateText}`);
    videoLink.append(image);

    const play = document.createElement("span");
    play.className = "latest-episode__play";
    play.setAttribute("aria-hidden", "true");
    play.textContent = "▶";
    videoLink.append(play);

    const clockDuration = formatClockDuration(episode.durationSeconds);
    if (clockDuration) {
      const duration = document.createElement("span");
      duration.className = "latest-episode__duration";
      duration.textContent = clockDuration;
      videoLink.append(duration);
    }

    video.append(videoLink);
    fragment.append(video);

    const copy = document.createElement("div");
    copy.className = "latest-episode__copy";

    const label = document.createElement("span");
    label.className = "episode-label";
    label.textContent = "Última emisión";
    copy.append(label);

    const meta = document.createElement("p");
    meta.className = "episode-meta";

    const time = document.createElement("time");
    time.setAttribute("datetime", episode.programDate);
    time.textContent = dateText;
    meta.append(time);

    const durationSummary = formatDurationSummary(episode.durationSeconds);
    if (durationSummary) {
      const separator = document.createElement("span");
      separator.setAttribute("aria-hidden", "true");
      separator.textContent = "•";
      meta.append(document.createTextNode(" "), separator, document.createTextNode(` ${durationSummary}`));
    }
    copy.append(meta);

    const title = document.createElement("h2");
    title.id = "latest-title";
    title.textContent = episode.title;
    copy.append(title);

    if (episode.description) {
      const description = document.createElement("p");
      description.textContent = episode.description;
      copy.append(description);
    }

    const button = document.createElement("a");
    button.className = "button button--primary";
    setExternalLink(button, episode.youtubeUrl);
    button.append(createIconText("Ver en YouTube", "↗"));
    copy.append(button);

    fragment.append(copy);
    return fragment;
  };

  const buildEpisodeCard = (episode) => {
    const dateText = formatDate(episode);
    const card = document.createElement("article");
    card.className = "episode-card";

    const media = document.createElement("a");
    media.className = "episode-card__media";
    setExternalLink(media, episode.youtubeUrl);
    media.setAttribute("aria-label", `Ver emisión del ${dateText} en YouTube`);

    const image = document.createElement("img");
    image.setAttribute("src", episode.thumbnailUrl);
    image.setAttribute("alt", `Miniatura de la emisión de ${episode.title} del ${dateText}`);
    image.setAttribute("loading", "lazy");
    media.append(image);

    const play = document.createElement("span");
    play.className = "episode-play";
    play.setAttribute("aria-hidden", "true");
    play.textContent = "▶";
    media.append(play);

    const clockDuration = formatClockDuration(episode.durationSeconds);
    if (clockDuration) {
      const duration = document.createElement("span");
      duration.className = "episode-duration";
      duration.textContent = clockDuration;
      media.append(duration);
    }
    card.append(media);

    const body = document.createElement("div");
    body.className = "episode-card__body";

    const time = document.createElement("time");
    time.setAttribute("datetime", episode.programDate);
    time.textContent = dateText;
    body.append(time);

    const title = document.createElement("h3");
    title.textContent = episode.title;
    body.append(title);

    const link = document.createElement("a");
    setExternalLink(link, episode.youtubeUrl);
    link.append(createIconText("Ver emisión", "→"));
    body.append(link);

    card.append(body);
    return card;
  };

  const loadEpisodes = async () => {
    try {
      const response = await fetch("/data/con-sabor-argentino.json", {
        cache: "no-store"
      });

      if (!response.ok) return;

      const data = await response.json();
      if (!data || !Array.isArray(data.episodes)) return;

      const episodes = getEpisodes(data.episodes);
      if (!episodes.length) return;

      const latestContent = buildLatestEpisode(episodes[0]);
      const archiveContent = document.createDocumentFragment();
      episodes.slice(1).forEach((episode) => archiveContent.append(buildEpisodeCard(episode)));

      latestEpisode.replaceChildren(latestContent);
      episodeGrid.replaceChildren(archiveContent);
    } catch {
      // The existing HTML remains visible as a usable fallback.
    }
  };

  loadEpisodes();
})();
