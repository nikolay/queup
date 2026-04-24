const API_ROOT = "https://www.googleapis.com/youtube/v3";
const STATE_KEY = "queupState";
const QUEUE_TITLE = "Que";
const QUEUE_DESCRIPTION = "Videos saved with QueUp.";
const QUEUE_CACHE_TTL_MS = 2 * 60 * 1000;
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

let memoryState = null;

function defaultState() {
  return {
    playlistId: null,
    queueMap: {},
    queueFetchedAt: 0
  };
}

async function getState() {
  if (memoryState) {
    return memoryState;
  }

  const stored = await chrome.storage.local.get(STATE_KEY);
  memoryState = { ...defaultState(), ...(stored[STATE_KEY] || {}) };
  return memoryState;
}

async function setState(patch) {
  const merged = { ...(await getState()), ...patch };
  memoryState = merged;
  await chrome.storage.local.set({ [STATE_KEY]: merged });
  return merged;
}

function isLikelyAuthError(error) {
  const message = String(error?.message || "");
  const authSnippets = [
    "OAuth2 not granted",
    "User interaction required",
    "The user did not approve",
    "No auth token",
    "Authentication token",
    "not signed in",
    "invalid_grant"
  ];
  return authSnippets.some((snippet) => message.includes(snippet));
}

function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "No auth token."));
        return;
      }
      resolve(token);
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

async function youtubeRequest(endpoint, options = {}) {
  const {
    method = "GET",
    body = null,
    interactive = false,
    retry = true
  } = options;

  const token = await getAuthToken(interactive);
  const response = await fetch(`${API_ROOT}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (response.status === 401 && retry) {
    await removeCachedToken(token);
    return youtubeRequest(endpoint, { method, body, interactive, retry: false });
  }

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`YouTube API error ${response.status}: ${text}`);
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function queueUrl(playlistId) {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}

async function listMyPlaylists(interactive = false) {
  const playlists = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      part: "id,snippet,status",
      mine: "true",
      maxResults: "50"
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const result = await youtubeRequest(`/playlists?${params.toString()}`, { interactive });
    playlists.push(...(result.items || []));
    pageToken = result.nextPageToken || "";
  } while (pageToken);

  return playlists;
}

async function createQueuePlaylist(interactive = true) {
  const body = {
    snippet: {
      title: QUEUE_TITLE,
      description: QUEUE_DESCRIPTION
    },
    status: {
      privacyStatus: "private"
    }
  };

  const result = await youtubeRequest("/playlists?part=snippet,status", {
    method: "POST",
    body,
    interactive
  });

  return result.id;
}

async function ensureQueuePlaylist(options = {}) {
  const {
    interactive = false,
    forceRefresh = false,
    createIfMissing = false
  } = options;

  const state = await getState();
  if (state.playlistId && !forceRefresh) {
    return state.playlistId;
  }

  const playlists = await listMyPlaylists(interactive);
  const queuePlaylist = playlists.find((playlist) => {
    const title = String(playlist?.snippet?.title || "").trim().toLowerCase();
    return title === QUEUE_TITLE.toLowerCase();
  });

  if (!queuePlaylist) {
    if (!createIfMissing) {
      return null;
    }
    const playlistId = await createQueuePlaylist(true);
    await setState({ playlistId });
    return playlistId;
  }

  const playlistId = queuePlaylist.id;
  await setState({ playlistId });

  if (queuePlaylist?.status?.privacyStatus !== "private") {
    try {
      await youtubeRequest("/playlists?part=snippet,status", {
        method: "PUT",
        interactive: true,
        body: {
          id: playlistId,
          snippet: {
            title: QUEUE_TITLE,
            description: queuePlaylist?.snippet?.description || QUEUE_DESCRIPTION
          },
          status: {
            privacyStatus: "private"
          }
        }
      });
    } catch (error) {
      console.warn("Could not enforce private status for Que playlist.", error);
    }
  }

  return playlistId;
}

async function fetchQueueMap(options = {}) {
  const { interactive = false, force = false } = options;
  const state = await getState();
  const cacheIsFresh = Date.now() - (state.queueFetchedAt || 0) < QUEUE_CACHE_TTL_MS;

  if (!force && cacheIsFresh && state.playlistId) {
    return state.queueMap || {};
  }

  const playlistId = await ensureQueuePlaylist({
    interactive,
    createIfMissing: false
  });

  if (!playlistId) {
    await setState({
      queueMap: {},
      queueFetchedAt: Date.now()
    });
    return {};
  }

  const queueMap = {};
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      part: "id,snippet",
      playlistId,
      maxResults: "50"
    });

    if (pageToken) {
      params.set("pageToken", pageToken);
    }

    const result = await youtubeRequest(`/playlistItems?${params.toString()}`, { interactive });
    for (const item of result.items || []) {
      const videoId = item?.snippet?.resourceId?.videoId;
      if (VIDEO_ID_PATTERN.test(videoId || "") && !queueMap[videoId]) {
        queueMap[videoId] = item.id;
      }
    }

    pageToken = result.nextPageToken || "";
  } while (pageToken);

  await setState({
    playlistId,
    queueMap,
    queueFetchedAt: Date.now()
  });

  return queueMap;
}

function sanitizeVideoId(videoId) {
  return VIDEO_ID_PATTERN.test(String(videoId || "")) ? videoId : null;
}

function sanitizeVideoIds(videoIds) {
  const valid = new Set();
  for (const videoId of Array.isArray(videoIds) ? videoIds : []) {
    const normalized = sanitizeVideoId(videoId);
    if (normalized) {
      valid.add(normalized);
    }
  }
  return [...valid];
}

async function getVideoStates(videoIds) {
  const ids = sanitizeVideoIds(videoIds);
  if (!ids.length) {
    const state = await getState();
    return {
      statuses: {},
      playlistId: state.playlistId || null
    };
  }

  const queueMap = await fetchQueueMap({ interactive: false });
  const state = await getState();
  const statuses = {};

  for (const videoId of ids) {
    statuses[videoId] = Boolean(queueMap[videoId]);
  }

  return {
    statuses,
    playlistId: state.playlistId || null
  };
}

async function addVideoToQueue(videoId) {
  const normalizedId = sanitizeVideoId(videoId);
  if (!normalizedId) {
    throw new Error("Invalid YouTube video id.");
  }

  const playlistId = await ensureQueuePlaylist({
    interactive: true,
    createIfMissing: true
  });

  const queueMap = await fetchQueueMap({ interactive: true });
  if (queueMap[normalizedId]) {
    return {
      changed: false,
      videoId: normalizedId,
      inQueue: true,
      playlistId
    };
  }

  const body = {
    snippet: {
      playlistId,
      resourceId: {
        kind: "youtube#video",
        videoId: normalizedId
      }
    }
  };

  const created = await youtubeRequest("/playlistItems?part=snippet", {
    method: "POST",
    body,
    interactive: true
  });

  queueMap[normalizedId] = created.id;
  await setState({
    playlistId,
    queueMap,
    queueFetchedAt: Date.now()
  });

  return {
    changed: true,
    videoId: normalizedId,
    inQueue: true,
    playlistId
  };
}

async function removeVideoFromQueue(videoId, options = {}) {
  const normalizedId = sanitizeVideoId(videoId);
  if (!normalizedId) {
    throw new Error("Invalid YouTube video id.");
  }

  const { interactive = true } = options;
  const playlistId = await ensureQueuePlaylist({
    interactive,
    createIfMissing: false
  });

  if (!playlistId) {
    return {
      changed: false,
      videoId: normalizedId,
      inQueue: false,
      playlistId: null
    };
  }

  let queueMap = await fetchQueueMap({ interactive, force: false });
  let playlistItemId = queueMap[normalizedId];

  if (!playlistItemId) {
    queueMap = await fetchQueueMap({ interactive, force: true });
    playlistItemId = queueMap[normalizedId];
  }

  if (!playlistItemId) {
    return {
      changed: false,
      videoId: normalizedId,
      inQueue: false,
      playlistId
    };
  }

  await youtubeRequest(`/playlistItems?id=${encodeURIComponent(playlistItemId)}`, {
    method: "DELETE",
    interactive
  });

  delete queueMap[normalizedId];
  await setState({
    playlistId,
    queueMap,
    queueFetchedAt: Date.now()
  });

  return {
    changed: true,
    videoId: normalizedId,
    inQueue: false,
    playlistId
  };
}

async function openQueuePlaylist() {
  const playlistId = await ensureQueuePlaylist({
    interactive: true,
    createIfMissing: true
  });

  const url = queueUrl(playlistId);
  await chrome.tabs.create({ url });
  return { playlistId, url };
}

function asResponseError(error) {
  const message = String(error?.message || "Unknown error.");
  return {
    ok: false,
    error: message,
    requiresAuth: isLikelyAuthError(error)
  };
}

chrome.runtime.onInstalled.addListener(async () => {
  await getState();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const type = message?.type;

    if (type === "GET_VIDEO_STATES") {
      const result = await getVideoStates(message.videoIds);
      sendResponse({ ok: true, ...result });
      return;
    }

    if (type === "ADD_VIDEO") {
      const result = await addVideoToQueue(message.videoId);
      sendResponse({ ok: true, ...result });
      return;
    }

    if (type === "REMOVE_VIDEO") {
      const result = await removeVideoFromQueue(message.videoId, {
        interactive: message.interactive !== false
      });
      sendResponse({ ok: true, ...result });
      return;
    }

    if (type === "OPEN_QUEUE") {
      const result = await openQueuePlaylist();
      sendResponse({ ok: true, ...result });
      return;
    }

    if (type === "GET_QUEUE_INFO") {
      const playlistId = await ensureQueuePlaylist({
        interactive: false,
        createIfMissing: false
      });
      sendResponse({
        ok: true,
        playlistId,
        url: playlistId ? queueUrl(playlistId) : null
      });
      return;
    }

    if (type === "REFRESH_QUEUE") {
      await fetchQueueMap({
        interactive: message.interactive === true,
        force: true
      });
      const state = await getState();
      sendResponse({
        ok: true,
        playlistId: state.playlistId || null
      });
      return;
    }

    sendResponse({ ok: false, error: "Unsupported message type." });
  })().catch((error) => {
    console.error("[QueUp] Background error", error);
    sendResponse(asResponseError(error));
  });

  return true;
});
