const API_ROOT = "https://www.googleapis.com/youtube/v3";
const STATE_KEY = "queupState";
const SESSION_AUTH_KEY = "queupSessionAuth";
const QUEUE_TITLE = "Que";
const QUEUE_DESCRIPTION = "Videos saved with QueUp.";
const QUEUE_CACHE_TTL_MS = 2 * 60 * 1000;
const SESSION_AUTH_EXPIRY_SKEW_MS = 60 * 1000;
const API_REQUEST_TIMEOUT_MS = 25 * 1000;
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_CHANNEL_REQUIRED_MESSAGE =
  "QueUp connected to Google, but this Google account does not have an active YouTube channel yet. Open YouTube with this account and finish creating or activating a YouTube channel, then reconnect QueUp. If this is a Google Workspace account, your admin may need to allow YouTube channel creation.";
const INTERACTIVE_MESSAGE_TYPES = new Set([
  "ADD_VIDEO",
  "AUTHENTICATE",
  "OPEN_QUEUE",
  "REFRESH_QUEUE",
  "REMOVE_VIDEO"
]);

let memoryState = null;
let memorySessionAuth = null;

function defaultState() {
  return {
    authConnected: false,
    authMode: null,
    authSource: null,
    account: null,
    playlistId: null,
    queueMap: {},
    queueFetchedAt: 0,
    lastError: null
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

function hasCachedAuth(state) {
  return Boolean(state.authConnected || state.playlistId);
}

function isConnectedState(state, sessionAuthActive) {
  return Boolean(state.authConnected && sessionAuthActive);
}

function isLikelyAuthError(error) {
  const message = String(error?.message || "");
  const authSnippets = [
    "access_denied",
    "Access denied",
    "Authorization",
    "Google sign-in",
    "No primary account",
    "OAuth2 not granted",
    "OAuth",
    "User interaction required",
    "The user did not approve",
    "No auth token",
    "No active Google sign-in session",
    "Authentication token",
    "not authorized",
    "not signed in",
    "not granted or revoked",
    "invalid_grant"
  ];
  return authSnippets.some((snippet) => message.includes(snippet));
}

async function getSessionAuth() {
  if (chrome.storage?.session) {
    const stored = await chrome.storage.session.get(SESSION_AUTH_KEY);
    memorySessionAuth = stored[SESSION_AUTH_KEY] || memorySessionAuth;
  }
  return memorySessionAuth;
}

async function setSessionAuth(token, expiresInSeconds = 3600) {
  const expiresInMs = Math.max(60, Number(expiresInSeconds) || 3600) * 1000;
  const auth = {
    token,
    expiresAt: Date.now() + expiresInMs - SESSION_AUTH_EXPIRY_SKEW_MS
  };
  memorySessionAuth = auth;
  if (chrome.storage?.session) {
    await chrome.storage.session.set({ [SESSION_AUTH_KEY]: auth });
  }
}

async function clearSessionAuth() {
  memorySessionAuth = null;
  if (chrome.storage?.session) {
    await chrome.storage.session.remove(SESSION_AUTH_KEY);
  }
}

async function getUsableSessionToken() {
  const auth = await getSessionAuth();
  if (!auth?.token) {
    return null;
  }

  if (auth.expiresAt && auth.expiresAt > Date.now()) {
    return auth.token;
  }

  await clearSessionAuth();
  return null;
}

async function getRequestAuth(interactive = false) {
  const sessionToken = await getUsableSessionToken();
  if (sessionToken) {
    return {
      source: "session",
      token: sessionToken
    };
  }

  throw new Error(
    interactive
      ? "No active Google sign-in session is available. Open QueUp from the Chrome toolbar, click Connect YouTube, and finish Google sign-in."
      : "No active Google sign-in session is available."
  );
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Timed out contacting the YouTube API.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function removeCachedToken(token) {
  return chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
}

async function clearChromeIdentityTokens() {
  try {
    if (chrome.identity.clearAllCachedAuthTokens) {
      await chrome.identity.clearAllCachedAuthTokens();
    }
  } catch (_error) {
    // A disconnect action should succeed even if Chrome has no cached token.
  }
}

function setBadge(text, color = "#a5183f") {
  if (!chrome.action) {
    return Promise.resolve();
  }

  return Promise.all([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({ color })
  ]).catch(() => {});
}

function errorPayload(error, context = "") {
  const rawMessage = String(error?.message || "Unknown error.");
  const requiresYouTubeChannel = isMissingChannelError(error);
  return {
    at: new Date().toISOString(),
    context,
    message: requiresYouTubeChannel ? YOUTUBE_CHANNEL_REQUIRED_MESSAGE : rawMessage,
    technicalMessage: requiresYouTubeChannel ? rawMessage : null,
    requiresAuth: isLikelyAuthError(error),
    requiresYouTubeChannel,
    apiReason: error?.apiReason || null,
    status: error?.status || null
  };
}

async function rememberError(context, error) {
  try {
    await setState({ lastError: errorPayload(error, context) });
    await setBadge("!");
  } catch (_error) {
    // Avoid masking the original failure while reporting it to the UI.
  }
}

async function clearLastError() {
  try {
    await setState({
      authConnected: true,
      lastError: null
    });
    await setBadge("");
  } catch (_error) {
    // Badge/storage cleanup should not block the user's action.
  }
}

function shouldTrackError(type, message) {
  if (!INTERACTIVE_MESSAGE_TYPES.has(type)) {
    return false;
  }
  if ((type === "ADD_VIDEO" || type === "REMOVE_VIDEO" || type === "REFRESH_QUEUE") && message?.interactive === false) {
    return false;
  }
  return true;
}

async function youtubeRequest(endpoint, options = {}) {
  const {
    method = "GET",
    body = null,
    interactive = false,
    retry = true
  } = options;

  const auth = await getRequestAuth(interactive);
  const token = auth.token;
  const response = await fetchWithTimeout(`${API_ROOT}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (response.status === 401 && retry) {
    if (auth.source === "session") {
      await clearSessionAuth();
    } else {
      await removeCachedToken(token);
    }
    return youtubeRequest(endpoint, { method, body, interactive, retry: false });
  }

  if (!response.ok) {
    const text = await response.text();
    let apiMessage = text;
    let apiReason = null;
    let apiStatus = null;
    let apiErrors = [];
    try {
      const parsed = JSON.parse(text);
      apiErrors = Array.isArray(parsed?.error?.errors) ? parsed.error.errors : [];
      apiReason = apiErrors[0]?.reason || parsed?.error?.status || null;
      apiStatus = parsed?.error?.status || null;
      apiMessage = parsed?.error?.message || text;
    } catch (_error) {
      // Keep the raw API body when it is not JSON.
    }

    const error = new Error(`YouTube API error ${response.status}: ${apiMessage}`);
    error.status = response.status;
    error.apiReason = apiReason;
    error.apiStatus = apiStatus;
    error.apiErrors = apiErrors;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function accountFromChannel(channel) {
  if (!channel) {
    return null;
  }

  const thumbnails = channel?.snippet?.thumbnails || {};
  return {
    channelId: channel.id || null,
    title: channel?.snippet?.title || "YouTube",
    thumbnailUrl: thumbnails.default?.url || thumbnails.medium?.url || thumbnails.high?.url || null,
    fetchedAt: new Date().toISOString()
  };
}

async function fetchConnectedAccount(interactive = false) {
  const result = await youtubeRequest("/channels?part=snippet&mine=true", {
    interactive
  });
  const account = accountFromChannel(result?.items?.[0]);
  await setState({
    authConnected: true,
    account
  });
  return account;
}

function queueUrl(playlistId) {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}

function isMissingPlaylistError(error) {
  const message = String(error?.message || "");
  return error?.status === 404 && (
    message.includes("playlistId") ||
    /playlist.*cannot be found/i.test(message) ||
    /playlist.*not found/i.test(message)
  );
}

function isMissingChannelError(error) {
  const message = String(error?.message || "");
  return error?.status === 404 && (
    error?.apiReason === "channelNotFound" ||
    /channel.*not found/i.test(message)
  );
}

async function clearQueuePlaylistCache() {
  await setState({
    playlistId: null,
    queueMap: {},
    queueFetchedAt: 0
  });
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
      await clearQueuePlaylistCache();
      return null;
    }
    const playlistId = await createQueuePlaylist(interactive);
    await setState({
      playlistId,
      queueMap: {},
      queueFetchedAt: 0
    });
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

async function readQueueMapFromPlaylist(playlistId, interactive = false) {
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

  return queueMap;
}

async function fetchQueueMap(options = {}) {
  const {
    interactive = false,
    force = false,
    createIfMissing = false,
    repairMissingPlaylist = true
  } = options;
  const state = await getState();
  const cacheIsFresh = Date.now() - (state.queueFetchedAt || 0) < QUEUE_CACHE_TTL_MS;

  if (!interactive && !(await getUsableSessionToken())) {
    return state.queueMap || {};
  }

  if (!interactive && !hasCachedAuth(state)) {
    return state.queueMap || {};
  }

  if (!force && cacheIsFresh && state.playlistId) {
    return state.queueMap || {};
  }

  let playlistId = await ensureQueuePlaylist({
    interactive,
    forceRefresh: force,
    createIfMissing
  });

  if (!playlistId) {
    await setState({
      queueMap: {},
      queueFetchedAt: Date.now()
    });
    return {};
  }

  let queueMap;
  try {
    queueMap = await readQueueMapFromPlaylist(playlistId, interactive);
  } catch (error) {
    if (!repairMissingPlaylist || !isMissingPlaylistError(error)) {
      throw error;
    }

    await clearQueuePlaylistCache();
    playlistId = await ensureQueuePlaylist({
      interactive,
      forceRefresh: true,
      createIfMissing
    });

    if (!playlistId) {
      await setState({
        authConnected: true,
        queueMap: {},
        queueFetchedAt: Date.now()
      });
      return {};
    }

    queueMap = await readQueueMapFromPlaylist(playlistId, interactive);
  }

  await setState({
    authConnected: true,
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

async function addVideoToQueue(videoId, options = {}) {
  const normalizedId = sanitizeVideoId(videoId);
  if (!normalizedId) {
    throw new Error("Invalid YouTube video id.");
  }

  const { interactive = true } = options;
  let playlistId = await ensureQueuePlaylist({
    interactive,
    createIfMissing: true
  });

  const queueMap = await fetchQueueMap({
    interactive,
    force: true,
    createIfMissing: true
  });
  playlistId = (await getState()).playlistId || playlistId;
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
    interactive
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
  let playlistId = await ensureQueuePlaylist({
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

  let queueMap = await fetchQueueMap({ interactive, force: true });
  playlistId = (await getState()).playlistId || null;
  if (!playlistId) {
    return {
      changed: false,
      videoId: normalizedId,
      inQueue: false,
      playlistId: null
    };
  }

  let playlistItemId = queueMap[normalizedId];

  if (!playlistItemId) {
    queueMap = await fetchQueueMap({ interactive, force: true });
    playlistId = (await getState()).playlistId || null;
    if (!playlistId) {
      return {
        changed: false,
        videoId: normalizedId,
        inQueue: false,
        playlistId: null
      };
    }
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
    forceRefresh: true,
    createIfMissing: true
  });

  const url = queueUrl(playlistId);
  await chrome.tabs.create({ url });
  return { playlistId, url };
}

async function authenticate(options = {}) {
  const { interactive = true } = options;
  const playlistId = await ensureQueuePlaylist({
    interactive,
    forceRefresh: true,
    createIfMissing: true
  });
  const queueMap = await fetchQueueMap({
    interactive,
    force: true,
    createIfMissing: true
  });
  const account = await fetchConnectedAccount(interactive).catch(() => null);

  return {
    version: chrome.runtime.getManifest().version,
    account,
    playlistId,
    queueSize: Object.keys(queueMap).length,
    url: queueUrl(playlistId)
  };
}

async function getConnectionInfo() {
  const state = await getState();
  const sessionAuthActive = Boolean(await getUsableSessionToken());
  const connected = isConnectedState(state, sessionAuthActive);
  let account = state.account || null;

  if (connected && !account && sessionAuthActive) {
    account = await fetchConnectedAccount(false).catch(() => null);
  }

  const currentState = await getState();
  const playlistId = currentState.playlistId || null;

  return {
    ok: true,
    account,
    authMode: currentState.authMode || null,
    authSource: currentState.authSource || null,
    connected,
    lastError: currentState.lastError || null,
    playlistId,
    queueSize: Object.keys(currentState.queueMap || {}).length,
    sessionAuthActive,
    url: playlistId ? queueUrl(playlistId) : null,
    version: chrome.runtime.getManifest().version
  };
}

async function disconnectYoutube() {
  await clearSessionAuth();
  await clearChromeIdentityTokens();
  memoryState = defaultState();
  await chrome.storage.local.set({ [STATE_KEY]: memoryState });
  await setBadge("");
  return getConnectionInfo();
}

function asResponseError(error, context = "") {
  const message = String(error?.message || "Unknown error.");
  const requiresAuth = isLikelyAuthError(error);
  const requiresYouTubeChannel = isMissingChannelError(error);
  return {
    ok: false,
    context,
    error: message,
    requiresAuth,
    requiresYouTubeChannel,
    status: error?.status || null,
    apiReason: error?.apiReason || null,
    userMessage: requiresYouTubeChannel
      ? YOUTUBE_CHANNEL_REQUIRED_MESSAGE
      : requiresAuth
        ? `Connect YouTube to continue: ${message}. Click Connect YouTube, finish Google sign-in, then try again.`
        : message
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
      const result = await addVideoToQueue(message.videoId, {
        interactive: message.interactive !== false
      });
      await clearLastError();
      sendResponse({ ok: true, ...result });
      return;
    }

    if (type === "REMOVE_VIDEO") {
      const result = await removeVideoFromQueue(message.videoId, {
        interactive: message.interactive !== false
      });
      if (message.interactive !== false) {
        await clearLastError();
      }
      sendResponse({ ok: true, ...result });
      return;
    }

    if (type === "OPEN_QUEUE") {
      const result = await openQueuePlaylist();
      await clearLastError();
      sendResponse({ ok: true, ...result });
      return;
    }

    if (type === "AUTHENTICATE") {
      if (message.accessToken) {
        await setSessionAuth(message.accessToken, message.expiresInSeconds);
      }
      await setState({
        authMode: "webAuthCodePkce",
        authSource: message.authSource || "Google sign-in window"
      });
      const result = await authenticate({
        interactive: message.interactive !== false
      });
      await clearLastError();
      sendResponse({ ok: true, ...result });
      return;
    }

    if (type === "GET_QUEUE_INFO") {
      sendResponse(await getConnectionInfo());
      return;
    }

    if (type === "GET_CONNECTION_INFO") {
      sendResponse(await getConnectionInfo());
      return;
    }

    if (type === "DISCONNECT") {
      sendResponse(await disconnectYoutube());
      return;
    }

    if (type === "GET_DEBUG_INFO") {
      const state = await getState();
      const sessionAuthActive = Boolean(await getUsableSessionToken());
      sendResponse({
        ok: true,
        lastError: state.lastError || null,
        account: state.account || null,
        authMode: state.authMode || null,
        connected: isConnectedState(state, sessionAuthActive),
        playlistId: state.playlistId || null,
        queueSize: Object.keys(state.queueMap || {}).length,
        sessionAuthActive,
        version: chrome.runtime.getManifest().version
      });
      return;
    }

    if (type === "REFRESH_QUEUE") {
      await fetchQueueMap({
        interactive: message.interactive === true,
        force: true
      });
      const account = await fetchConnectedAccount(message.interactive === true).catch(async (error) => {
        if (isLikelyAuthError(error)) {
          throw error;
        }
        return (await getState()).account || null;
      });
      const state = await getState();
      await clearLastError();
      sendResponse({
        ok: true,
        account,
        playlistId: state.playlistId || null
      });
      return;
    }

    sendResponse({ ok: false, error: "Unsupported message type." });
  })().catch((error) => {
    console.error("[QueUp] Background error", error);
    (async () => {
      if (shouldTrackError(message?.type, message)) {
        await rememberError(message?.type || "UNKNOWN", error);
      }
      sendResponse(asResponseError(error, message?.type || ""));
    })();
  });

  return true;
});
