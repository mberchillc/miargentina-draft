import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeEpisode,
  nextMondayAtNine,
  parseVideoDetails,
  parseYouTubeFeed,
  programDateForTimestamp,
  secondsToIso,
  updateAutomationStatus
} from "./sync-con-sabor-argentino.mjs";

const sampleEpisode = {
  videoId: "abcdefghijk",
  title: "Con Sabor Argentino",
  programDate: "2026-09-06",
  youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk",
  thumbnailUrl: "https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg",
  durationIso: "PT2H3M4S",
  publishedAt: "2026-09-06T15:00:00Z"
};

test("parsea el feed público de YouTube", () => {
  const xml = `<?xml version="1.0"?><feed><entry>
    <yt:videoId>abcdefghijk</yt:videoId>
    <yt:channelId>UCtest</yt:channelId>
    <title>Con Sabor Argentino &amp; invitados</title>
    <author><name>MIArgentina USA</name></author>
    <published>2026-09-06T15:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" />
      <media:description>Descripción &amp; comunidad</media:description>
    </media:group>
  </entry></feed>`;

  const entries = parseYouTubeFeed(xml, { priority: 0 });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].videoId, "abcdefghijk");
  assert.equal(entries[0].title, "Con Sabor Argentino & invitados");
  assert.equal(entries[0].description, "Descripción & comunidad");
});

test("extrae duración y fecha real de una transmisión", () => {
  const playerResponse = {
    videoDetails: {
      videoId: "abcdefghijk",
      title: "Con Sabor Argentino",
      channelId: "UCtest",
      author: "MIArgentina USA",
      lengthSeconds: "7384",
      shortDescription: "Programa completo",
      isLiveContent: true
    },
    microformat: {
      playerMicroformatRenderer: {
        publishDate: "2026-09-06T09:00:00-04:00",
        liveBroadcastDetails: { startTimestamp: "2026-09-06T13:00:00Z" }
      }
    }
  };
  const html = `<script>var ytInitialPlayerResponse = ${JSON.stringify(playerResponse)};</script>`;
  const details = parseVideoDetails(html);

  assert.equal(details.durationSeconds, 7384);
  assert.equal(details.startedAt, "2026-09-06T13:00:00Z");
  assert.equal(details.channelTitle, "MIArgentina USA");
});

test("normaliza duración y fecha editorial", () => {
  assert.equal(secondsToIso(7384), "PT2H3M4S");
  assert.equal(programDateForTimestamp("2026-09-07T01:30:00Z"), "2026-09-06");
});

test("evita duplicar una emisión replicada por otro canal", () => {
  const feed = {
    version: 1,
    episodes: [{ ...sampleEpisode, videoId: "oldmirror01" }]
  };
  const result = mergeEpisode(feed, sampleEpisode);
  assert.equal(result.duplicate, true);
  assert.equal(result.data.episodes.length, 1);
});

test("inserta una emisión nueva y preserva el archivo", () => {
  const feed = {
    version: 1,
    editorialNote: "preservar",
    episodes: [{ ...sampleEpisode, videoId: "oldervideo1", programDate: "2026-08-30" }]
  };
  const result = mergeEpisode(feed, sampleEpisode);
  assert.equal(result.duplicate, false);
  assert.equal(result.data.episodes[0].videoId, sampleEpisode.videoId);
  assert.equal(result.data.episodes.length, 2);
  assert.equal(result.data.editorialNote, "preservar");
});

test("actualiza el dashboard y calcula la siguiente ejecución", () => {
  const status = {
    version: 1,
    updatedAt: null,
    automations: [{
      id: "con-sabor-argentino-weekly-feed",
      name: "Con Sabor Argentino — emisión semanal",
      provider: "Make",
      status: "warning",
      records: []
    }]
  };
  const now = new Date("2026-09-10T16:00:00Z");
  const result = updateAutomationStatus(status, {
    result: "episode_added",
    message: "Publicado",
    now,
    episode: sampleEpisode
  });

  const automation = result.automations[0];
  assert.equal(automation.provider, "GitHub Actions + Cloudflare Pages");
  assert.equal(automation.status, "active");
  assert.equal(automation.nextRunAt, "2026-09-14T13:00:00.000Z");
  assert.equal(automation.records[0].videoId, sampleEpisode.videoId);
  assert.equal(nextMondayAtNine(now), "2026-09-14T13:00:00.000Z");
});
