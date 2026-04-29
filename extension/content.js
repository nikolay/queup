(function () {
  const BUTTON_GROUPS = new Map();
  const VIDEO_STATUSES = new Map();
  const AUTO_REMOVED = new Set();
  const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
  const MESSAGE_TIMEOUT_MS = 75 * 1000;
  const TEXT = {
    add: "+ Que",
    remove: "- Que",
    updating: "Updating...",
    signingIn: "Connecting...",
    openQueue: "Open Que",
    signInOpenQueue: "Sign in to open Que",
    signInRequired: "Open QueUp to connect",
    timedOut: "QueUp timed out",
    failed: "QueUp error"
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
  let toastTimer = null;

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

  function sendMessage(message, options = {}) {
    const timeoutMs = options.timeoutMs || MESSAGE_TIMEOUT_MS;

    return new Promise((resolve) => {
      let settled = false;
      const timeoutId = window.setTimeout(() => {
        settled = true;
        resolve({
          ok: false,
          timedOut: true,
          error: "QueUp timed out waiting for the background worker. Open the QueUp toolbar popup and try Connect YouTube."
        });
      }, timeoutMs);

      chrome.runtime.sendMessage(message, (response) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);

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
      button.textContent = button.dataset.queupLoadingText || TEXT.updating;
    } else {
      button.textContent = inQueue ? TEXT.remove : TEXT.add;
    }

    button.classList.toggle("queup-button--in-queue", inQueue);
    button.title = inQueue ? "Remove from Que" : "Add to Que";
    button.setAttribute("aria-label", inQueue ? "Remove from Que" : "Add to Que");
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

  function setLoading(videoId, loading, text = TEXT.updating) {
    const buttons = BUTTON_GROUPS.get(videoId);
    if (!buttons) {
      return;
    }
    for (const button of buttons) {
      button.dataset.queupLoading = loading ? "true" : "false";
      button.dataset.queupLoadingText = loading ? text : "";
      renderButton(button);
    }
  }

  function flashButtonMessage(button, text, title = "", duration = 3200) {
    button.dataset.queupLoading = "false";
    button.dataset.queupLoadingText = "";
    button.disabled = false;
    button.textContent = text;
    if (title) {
      button.title = title;
      console.warn("[QueUp]", title);
      showToast(title, true);
    }
    window.setTimeout(() => {
      button.title = "";
      renderButton(button);
    }, duration);
  }

  function showToast(message, isError = false) {
    let toast = document.getElementById("queup-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "queup-toast";
      toast.className = "queup-toast";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.toggle("queup-toast--error", isError);
    toast.classList.add("queup-toast--visible");

    if (toastTimer) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("queup-toast--visible");
    }, 6500);
  }

  function buttonMessageForError(response) {
    if (response?.requiresAuth) {
      return TEXT.signInRequired;
    }
    if (response?.timedOut || String(response?.error || "").includes("Timed out")) {
      return TEXT.timedOut;
    }
    return TEXT.failed;
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
    setLoading(videoId, true, inQueue ? TEXT.updating : TEXT.signingIn);

    const response = await sendMessage({
      type: inQueue ? "REMOVE_VIDEO" : "ADD_VIDEO",
      videoId,
      interactive: false
    });

    setLoading(videoId, false);

    if (!response?.ok) {
      flashButtonMessage(
        button,
        buttonMessageForError(response),
        response?.userMessage || response?.error || "Unable to update Que."
      );
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
        button.textContent = response?.requiresAuth ? TEXT.signInOpenQueue : TEXT.failed;
        button.title = response?.userMessage || response?.error || "Unable to open Que.";
        showToast(button.title, true);
        window.setTimeout(() => {
          button.textContent = TEXT.openQueue;
          button.title = "";
        }, 1700);
      }
    });

    document.body.appendChild(button);
  }

  function ensureWatchPageButton() {
    const currentVideoId = currentVideoIdFromPage();
    let wrapper = document.getElementById("queup-watch-button-wrap");
    let button = document.getElementById("queup-watch-button");

    if (!currentVideoId) {
      if (wrapper) {
        wrapper.remove();
      } else if (button) {
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

    if (!wrapper) {
      wrapper = document.createElement("span");
      wrapper.id = "queup-watch-button-wrap";
      wrapper.className = "queup-watch-button-wrap";
    }

    if (!button) {
      button = buildQueueButton("queup-watch-button");
      button.id = "queup-watch-button";
    }

    if (!wrapper.contains(button)) {
      wrapper.appendChild(button);
    }

    if (wrapper.parentElement !== host) {
      host.appendChild(wrapper);
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
