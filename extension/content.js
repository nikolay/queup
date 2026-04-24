(function () {
  const BUTTON_GROUPS = new Map();
  const VIDEO_STATUSES = new Map();
  const AUTO_REMOVED = new Set();
  const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
  const TEXT = {
    add: "Add to Que",
    remove: "Remove from Que",
    updating: "Updating...",
    openQueue: "Open Que Playlist",
    signInOpenQueue: "Sign in to open Que",
    signInRequired: "Sign in required"
  };
  const STATUS_SYNC_SKIP_MS = 15 * 1000;
  const WATCHED_PROGRESS_RATIO = 0.98;

  let statusSyncTimer = null;
  let statusSyncForce = false;
  let lastStatusSyncKey = "";
  let lastStatusSyncAt = 0;
  let pageScanTimer = null;
  let boundVideoElement = null;
  let boundVideoId = null;
  let endedListener = null;
  let progressListener = null;

  function isValidVideoId(videoId) {
    return VIDEO_ID_PATTERN.test(String(videoId || ""));
  }

  function currentVideoIdFromPage() {
    if (window.location.pathname !== "/watch") {
      return null;
    }
    const value = new URL(window.location.href).searchParams.get("v");
    return isValidVideoId(value) ? value : null;
  }

  function videoIdFromHref(href) {
    if (!href) {
      return null;
    }
    try {
      const url = new URL(href, window.location.origin);
      if (url.pathname !== "/watch") {
        return null;
      }
      const videoId = url.searchParams.get("v");
      return isValidVideoId(videoId) ? videoId : null;
    } catch (_error) {
      return null;
    }
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "Messaging failed."
          });
          return;
        }
        resolve(response || { ok: false, error: "No response." });
      });
    });
  }

  function cleanupButtonGroups() {
    for (const [videoId, buttons] of BUTTON_GROUPS.entries()) {
      for (const button of buttons) {
        if (!button.isConnected) {
          buttons.delete(button);
        }
      }
      if (!buttons.size) {
        BUTTON_GROUPS.delete(videoId);
      }
    }
  }

  function setVideoStatus(videoId, inQueue) {
    VIDEO_STATUSES.set(videoId, Boolean(inQueue));
    renderButtonsForVideo(videoId);
  }

  function renderButton(button) {
    const videoId = button.dataset.queupVideoId;
    const inQueue = VIDEO_STATUSES.get(videoId) === true;
    const loading = button.dataset.queupLoading === "true";

    if (loading) {
      button.textContent = TEXT.updating;
    } else {
      button.textContent = inQueue ? TEXT.remove : TEXT.add;
    }

    button.classList.toggle("queup-button--in-queue", inQueue);
    button.disabled = loading;
  }

  function renderButtonsForVideo(videoId) {
    const buttons = BUTTON_GROUPS.get(videoId);
    if (!buttons) {
      return;
    }
    for (const button of buttons) {
      renderButton(button);
    }
  }

  function setLoading(videoId, loading) {
    const buttons = BUTTON_GROUPS.get(videoId);
    if (!buttons) {
      return;
    }
    for (const button of buttons) {
      button.dataset.queupLoading = loading ? "true" : "false";
      renderButton(button);
    }
  }

  function bindButton(button, videoId) {
    const previousVideoId = button.dataset.queupVideoId;
    if (previousVideoId && BUTTON_GROUPS.has(previousVideoId)) {
      BUTTON_GROUPS.get(previousVideoId).delete(button);
    }

    if (!button.dataset.queupClickBound) {
      button.addEventListener("click", onQueueButtonClick);
      button.dataset.queupClickBound = "true";
    }

    button.dataset.queupVideoId = videoId;
    if (!BUTTON_GROUPS.has(videoId)) {
      BUTTON_GROUPS.set(videoId, new Set());
    }
    BUTTON_GROUPS.get(videoId).add(button);
    renderButton(button);
  }

  async function onQueueButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = event.currentTarget;
    const videoId = button.dataset.queupVideoId;
    if (!isValidVideoId(videoId)) {
      return;
    }

    const inQueue = VIDEO_STATUSES.get(videoId) === true;
    setLoading(videoId, true);

    const response = await sendMessage({
      type: inQueue ? "REMOVE_VIDEO" : "ADD_VIDEO",
      videoId,
      interactive: true
    });

    setLoading(videoId, false);

    if (!response?.ok) {
      if (response?.requiresAuth) {
        button.textContent = TEXT.signInRequired;
        window.setTimeout(() => renderButton(button), 1600);
      }
      return;
    }

    setVideoStatus(videoId, response.inQueue === true);
    scheduleStatusSync(80, { force: true });
  }

  function collectVisibleVideoIds() {
    cleanupButtonGroups();
    return [...BUTTON_GROUPS.keys()];
  }

  async function syncStatuses(options = {}) {
    const { force = false } = options;
    statusSyncTimer = null;
    statusSyncForce = false;
    const videoIds = collectVisibleVideoIds();
    if (!videoIds.length) {
      lastStatusSyncKey = "";
      return;
    }

    const syncKey = [...videoIds].sort().join(",");
    if (!force && syncKey === lastStatusSyncKey && Date.now() - lastStatusSyncAt < STATUS_SYNC_SKIP_MS) {
      return;
    }

    lastStatusSyncKey = syncKey;
    lastStatusSyncAt = Date.now();

    const response = await sendMessage({
      type: "GET_VIDEO_STATES",
      videoIds
    });

    if (!response?.ok || !response.statuses) {
      return;
    }

    for (const [videoId, inQueue] of Object.entries(response.statuses)) {
      setVideoStatus(videoId, inQueue);
    }
  }

  function scheduleStatusSync(delay = 220, options = {}) {
    statusSyncForce = statusSyncForce || options.force === true;
    if (statusSyncTimer) {
      window.clearTimeout(statusSyncTimer);
    }
    statusSyncTimer = window.setTimeout(() => {
      syncStatuses({ force: statusSyncForce });
    }, delay);
  }

  function buildQueueButton(className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `queup-button ${className}`.trim();
    button.dataset.queupLoading = "false";
    button.textContent = TEXT.add;
    return button;
  }

  function ensureOpenQueueButton() {
    let button = document.getElementById("queup-open-queue");
    if (button) {
      return;
    }

    button = document.createElement("button");
    button.type = "button";
    button.id = "queup-open-queue";
    button.className = "queup-open-queue";
    button.textContent = TEXT.openQueue;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      const response = await sendMessage({ type: "OPEN_QUEUE" });
      button.disabled = false;
      if (!response?.ok) {
        button.textContent = TEXT.signInOpenQueue;
        window.setTimeout(() => {
          button.textContent = TEXT.openQueue;
        }, 1700);
      }
    });

    document.body.appendChild(button);
  }

  function ensureWatchPageButton() {
    const currentVideoId = currentVideoIdFromPage();
    let button = document.getElementById("queup-watch-button");

    if (!currentVideoId) {
      if (button) {
        button.remove();
      }
      return;
    }

    const host =
      document.querySelector("ytd-watch-metadata #top-level-buttons-computed") ||
      document.querySelector("ytd-watch-metadata #actions-inner") ||
      document.querySelector("ytd-watch-metadata #owner");

    if (!host) {
      return;
    }

    if (!button) {
      button = buildQueueButton("queup-watch-button");
      button.id = "queup-watch-button";
      host.prepend(button);
    }

    bindButton(button, currentVideoId);
  }

  function ensureRendererQueueButtons() {
    const renderers = document.querySelectorAll(
      [
        "ytd-compact-video-renderer",
        "ytd-video-renderer",
        "ytd-rich-item-renderer",
        "ytd-grid-video-renderer",
        "ytd-playlist-video-renderer"
      ].join(",")
    );

    for (const renderer of renderers) {
      const link =
        renderer.querySelector("a#thumbnail[href*='/watch']") ||
        renderer.querySelector("a#video-title[href*='/watch']");
      const videoId = videoIdFromHref(link?.href);

      if (!videoId) {
        continue;
      }

      const host =
        renderer.querySelector("#meta") ||
        renderer.querySelector("#details") ||
        renderer.querySelector("#dismissible");

      if (!host) {
        continue;
      }

      let button = renderer.querySelector(".queup-inline-button");
      if (!button) {
        button = buildQueueButton("queup-inline-button");
        host.appendChild(button);
      }

      bindButton(button, videoId);
    }
  }

  async function removeWhenWatched(videoId) {
    if (!isValidVideoId(videoId) || AUTO_REMOVED.has(videoId)) {
      return;
    }
    if (VIDEO_STATUSES.get(videoId) === false) {
      return;
    }

    AUTO_REMOVED.add(videoId);
    const response = await sendMessage({
      type: "REMOVE_VIDEO",
      videoId,
      interactive: false
    });

    if (response?.ok) {
      setVideoStatus(videoId, false);
    } else {
      AUTO_REMOVED.delete(videoId);
    }
  }

  function bindWatchedRemoval() {
    const videoId = currentVideoIdFromPage();
    const videoElement = document.querySelector("video");

    if (!videoId || !videoElement) {
      return;
    }

    if (boundVideoElement === videoElement && boundVideoId === videoId) {
      return;
    }

    if (boundVideoElement && endedListener && progressListener) {
      boundVideoElement.removeEventListener("ended", endedListener);
      boundVideoElement.removeEventListener("timeupdate", progressListener);
    }

    boundVideoElement = videoElement;
    boundVideoId = videoId;

    endedListener = () => removeWhenWatched(videoId);
    progressListener = () => {
      if (!videoElement.duration || !Number.isFinite(videoElement.duration)) {
        return;
      }
      if (videoElement.currentTime / videoElement.duration >= WATCHED_PROGRESS_RATIO) {
        removeWhenWatched(videoId);
      }
    };

    videoElement.addEventListener("ended", endedListener);
    videoElement.addEventListener("timeupdate", progressListener, { passive: true });
  }

  function scanPage() {
    pageScanTimer = null;
    ensureOpenQueueButton();
    ensureWatchPageButton();
    ensureRendererQueueButtons();
    bindWatchedRemoval();
    scheduleStatusSync(120);
  }

  function schedulePageScan(delay = 220) {
    if (pageScanTimer) {
      window.clearTimeout(pageScanTimer);
    }
    pageScanTimer = window.setTimeout(scanPage, delay);
  }

  function initializeObservers() {
    const observer = new MutationObserver(() => schedulePageScan(140));
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("yt-navigate-finish", () => {
      schedulePageScan(40);
    });
    window.addEventListener("yt-page-data-updated", () => {
      schedulePageScan(40);
    });
    window.addEventListener("popstate", () => {
      schedulePageScan(40);
    });
  }

  initializeObservers();
  schedulePageScan(0);
})();
