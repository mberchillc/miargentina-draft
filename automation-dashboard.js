(() => {
  "use strict";

  const elements = {
    state: document.querySelector("[data-dashboard-state]"),
    stateShell: document.querySelector(".automation-hero__state"),
    broadcastsKpi: document.querySelector("[data-kpi-broadcasts]"),
    latestKpi: document.querySelector("[data-kpi-latest]"),
    activeKpi: document.querySelector("[data-kpi-active]"),
    updatedKpi: document.querySelector("[data-kpi-updated]"),
    automationList: document.querySelector("[data-automation-list]"),
    broadcastTable: document.querySelector("[data-broadcast-table]"),
    runHistory: document.querySelector("[data-run-history]")
  };

  if (!elements.automationList || !elements.broadcastTable || !elements.runHistory) return;

  const programDateFormatter = new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });

  const dateTimeFormatter = new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short"
  });

  const text = (value) => typeof value === "string" ? value.trim() : "";

  const safeUrl = (value) => {
    const candidate = text(value);
    if (!candidate) return "";

    try {
      const url = new URL(candidate, window.location.origin);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
    } catch {
      return "";
    }
  };

  const parseProgramDate = (value) => {
    const candidate = text(value);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidate);
    if (!match) return null;

    const date = new Date(`${candidate}T00:00:00Z`);
    return Number.isFinite(date.getTime()) ? { value: candidate, date } : null;
  };

  const parseDateTime = (value) => {
    const candidate = text(value);
    if (!candidate) return null;

    const date = new Date(candidate);
    return Number.isFinite(date.getTime()) ? date : null;
  };

  const parseDuration = (value) => {
    const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(text(value));
    if (!match || !match.slice(1).some(Boolean)) return "—";

    const hours = (Number(match[1] || 0) * 24) + Number(match[2] || 0);
    const minutes = Number(match[3] || 0);

    if (hours && minutes) return `${hours} h ${minutes} min`;
    if (hours) return `${hours} h`;
    if (minutes) return `${minutes} min`;
    return "Menos de 1 min";
  };

  const statusInfo = (status) => {
    const statuses = {
      active: { label: "Activa", tone: "success" },
      pending_configuration: { label: "Configuración pendiente", tone: "warning" },
      warning: { label: "Requiere atención", tone: "warning" },
      error: { label: "Error", tone: "error" },
      paused: { label: "Pausada", tone: "neutral" }
    };

    return statuses[status] || { label: "Estado no informado", tone: "neutral" };
  };

  const resultInfo = (result) => {
    const results = {
      repository_ready: { label: "Repositorio listo", tone: "neutral" },
      episode_added: { label: "Episodio agregado", tone: "success" },
      duplicate: { label: "Sin cambios · duplicado", tone: "neutral" },
      no_video: { label: "Sin video válido", tone: "warning" },
      invalid_response: { label: "Respuesta inválida", tone: "error" },
      github_error: { label: "Error de GitHub", tone: "error" },
      success: { label: "Ejecución correcta", tone: "success" }
    };

    return results[result] || { label: text(result) || "Sin resultado", tone: "neutral" };
  };

  const createBadge = (info) => {
    const badge = document.createElement("span");
    badge.className = `status-badge status-badge--${info.tone}`;
    badge.textContent = info.label;
    return badge;
  };

  const formatProgramDate = (value) => {
    const parsed = parseProgramDate(value);
    return parsed ? programDateFormatter.format(parsed.date) : "—";
  };

  const formatDateTime = (value) => {
    const date = parseDateTime(value);
    return date ? dateTimeFormatter.format(date) : "Aún no ejecutada";
  };

  const normalizeEpisodes = (data) => {
    if (!data || !Array.isArray(data.episodes)) return [];

    const seen = new Set();
    return data.episodes
      .map((episode) => {
        const videoId = text(episode?.videoId);
        const title = text(episode?.title);
        const programDate = parseProgramDate(episode?.programDate);
        const youtubeUrl = safeUrl(episode?.youtubeUrl);
        if (!videoId || !title || !programDate || !youtubeUrl) return null;

        return {
          videoId,
          title,
          programDate: programDate.value,
          date: programDate.date,
          duration: parseDuration(episode.durationIso),
          channel: text(episode.sourceChannelTitle) || "Archivo histórico",
          youtubeUrl
        };
      })
      .filter((episode) => {
        if (!episode || seen.has(episode.videoId)) return false;
        seen.add(episode.videoId);
        return true;
      })
      .sort((a, b) => b.date - a.date);
  };

  const normalizeAutomations = (data) => {
    if (!data || !Array.isArray(data.automations)) return [];

    return data.automations
      .map((automation) => {
        const id = text(automation?.id);
        const name = text(automation?.name);
        if (!id || !name) return null;

        const records = Array.isArray(automation.records)
          ? automation.records.map((record) => ({
            automationId: id,
            automationName: name,
            runAt: text(record?.runAt),
            result: text(record?.result),
            message: text(record?.message),
            videoId: text(record?.videoId),
            programDate: text(record?.programDate)
          })).filter((record) => parseDateTime(record.runAt))
          : [];

        return {
          id,
          name,
          provider: text(automation.provider) || "No informado",
          status: text(automation.status),
          schedule: automation.schedule && typeof automation.schedule === "object" ? automation.schedule : {},
          lastRunAt: text(automation.lastRunAt),
          nextRunAt: text(automation.nextRunAt),
          lastResult: text(automation.lastResult),
          lastMessage: text(automation.lastMessage),
          records
        };
      })
      .filter(Boolean);
  };

  const scheduleLabel = (schedule) => {
    const dayLabels = {
      Monday: "lunes",
      Tuesday: "martes",
      Wednesday: "miércoles",
      Thursday: "jueves",
      Friday: "viernes",
      Saturday: "sábado",
      Sunday: "domingo"
    };
    const day = dayLabels[text(schedule.day)] || text(schedule.day);
    const time = text(schedule.time);
    const zone = text(schedule.timeZone);
    if (!day && !time) return "No informada";
    return `${day || "Semanal"}${time ? ` · ${time}` : ""}${zone ? ` · ${zone}` : ""}`;
  };

  const addDetail = (list, label, value) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    item.append(term, description);
    list.append(item);
  };

  const renderAutomations = (automations) => {
    elements.automationList.replaceChildren();
    if (!automations.length) {
      const empty = document.createElement("p");
      empty.className = "automation-empty";
      empty.textContent = "No hay automatizaciones registradas.";
      elements.automationList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    automations.forEach((automation) => {
      const card = document.createElement("article");
      card.className = "automation-card";

      const titleBox = document.createElement("div");
      titleBox.className = "automation-card__title";
      titleBox.append(createBadge(statusInfo(automation.status)));
      const title = document.createElement("h3");
      title.textContent = automation.name;
      const provider = document.createElement("p");
      provider.textContent = `Proveedor: ${automation.provider}`;
      titleBox.append(title, provider);

      const details = document.createElement("dl");
      details.className = "automation-card__details";
      addDetail(details, "Programación", scheduleLabel(automation.schedule));
      addDetail(details, "Última ejecución", formatDateTime(automation.lastRunAt));
      addDetail(details, "Próxima ejecución", automation.nextRunAt ? formatDateTime(automation.nextRunAt) : "Se calculará al activar Make");

      const message = document.createElement("p");
      message.className = "automation-card__message";
      const result = resultInfo(automation.lastResult);
      message.textContent = `${result.label}: ${automation.lastMessage || "Sin detalle operativo."}`;

      card.append(titleBox, details, message);
      fragment.append(card);
    });

    elements.automationList.append(fragment);
  };

  const renderBroadcasts = (episodes) => {
    elements.broadcastTable.replaceChildren();
    if (!episodes.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.className = "automation-empty";
      cell.textContent = "No hay broadcasts válidos disponibles.";
      row.append(cell);
      elements.broadcastTable.append(row);
      return;
    }

    const fragment = document.createDocumentFragment();
    episodes.forEach((episode) => {
      const row = document.createElement("tr");

      const dateCell = document.createElement("td");
      const time = document.createElement("time");
      time.setAttribute("datetime", episode.programDate);
      time.textContent = formatProgramDate(episode.programDate);
      dateCell.append(time);

      const titleCell = document.createElement("td");
      titleCell.textContent = episode.title;

      const durationCell = document.createElement("td");
      durationCell.textContent = episode.duration;

      const channelCell = document.createElement("td");
      channelCell.textContent = episode.channel;

      const statusCell = document.createElement("td");
      statusCell.append(createBadge({ label: "Publicado", tone: "success" }));

      const actionCell = document.createElement("td");
      const link = document.createElement("a");
      link.className = "automation-table__link";
      link.setAttribute("href", episode.youtubeUrl);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
      link.textContent = "YouTube ↗";
      actionCell.append(link);

      row.append(dateCell, titleCell, durationCell, channelCell, statusCell, actionCell);
      fragment.append(row);
    });

    elements.broadcastTable.append(fragment);
  };

  const renderHistory = (automations) => {
    const records = automations
      .flatMap((automation) => automation.records)
      .sort((a, b) => parseDateTime(b.runAt) - parseDateTime(a.runAt));

    elements.runHistory.replaceChildren();
    if (!records.length) {
      const empty = document.createElement("p");
      empty.className = "automation-empty";
      empty.textContent = "Make todavía no registró ejecuciones.";
      elements.runHistory.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    records.forEach((record) => {
      const item = document.createElement("article");
      item.className = "automation-history__item";

      const date = document.createElement("time");
      date.className = "automation-history__date";
      date.setAttribute("datetime", record.runAt);
      date.textContent = formatDateTime(record.runAt);

      const automationName = document.createElement("span");
      automationName.className = "automation-history__automation";
      automationName.textContent = record.automationName;

      const message = document.createElement("div");
      message.className = "automation-history__message";
      message.append(createBadge(resultInfo(record.result)));
      const detail = document.createElement("span");
      detail.textContent = record.message || "Sin detalle adicional.";
      message.append(detail);

      item.append(date, automationName, message);
      fragment.append(item);
    });

    elements.runHistory.append(fragment);
  };

  const fetchJson = async (url) => {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error("Feed unavailable");
    return response.json();
  };

  const loadDashboard = async () => {
    const [episodesResult, statusResult] = await Promise.allSettled([
      fetchJson("/data/con-sabor-argentino.json"),
      fetchJson("/data/automation-status.json")
    ]);

    const episodes = episodesResult.status === "fulfilled" ? normalizeEpisodes(episodesResult.value) : [];
    const statusData = statusResult.status === "fulfilled" ? statusResult.value : null;
    const automations = normalizeAutomations(statusData);
    const updatedAt = parseDateTime(statusData?.updatedAt);
    const activeCount = automations.filter((automation) => automation.status === "active").length;

    elements.broadcastsKpi.textContent = String(episodes.length);
    elements.latestKpi.textContent = episodes.length ? formatProgramDate(episodes[0].programDate) : "Sin datos";
    elements.activeKpi.textContent = `${activeCount} / ${automations.length}`;
    elements.updatedKpi.textContent = updatedAt ? dateTimeFormatter.format(updatedAt) : "Sin datos";

    renderAutomations(automations);
    renderBroadcasts(episodes);
    renderHistory(automations);

    if (episodesResult.status === "fulfilled" && statusResult.status === "fulfilled") {
      elements.state.textContent = "Datos publicados correctamente";
      elements.stateShell.classList.add("is-ready");
    } else {
      elements.state.textContent = "Información parcial: revisar la automatización";
      elements.stateShell.classList.add("is-error");
    }
  };

  loadDashboard();
})();
