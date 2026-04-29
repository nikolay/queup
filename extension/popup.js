const MESSAGE_TIMEOUT_MS = 75 * 1000;

async function sendMessage(message) {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      settled = true;
      resolve({
        ok: false,
        timedOut: true,
        error: "QueUp timed out waiting for Chrome. Make sure Chrome is signed into the Google account you use for YouTube, then try again."
      });
    }, MESSAGE_TIMEOUT_MS);

    chrome.runtime.sendMessage(message, (response) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);

      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message || "Unknown messaging error."
        });
        return;
      }
      resolve(response || { ok: false, error: "No response." });
    });
  });
}

const statusEl = document.getElementById("status");
const lastErrorEl = document.getElementById("lastError");
const connectYoutubeButton = document.getElementById("connectYoutube");
const openQueueButton = document.getElementById("openQueue");
const refreshQueueButton = document.getElementById("refreshQueue");
const manifest = chrome.runtime.getManifest();

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#a5183f" : "#3a4d47";
}

function setLastError(error) {
  if (!error) {
    lastErrorEl.textContent = "";
    return;
  }

  const context = error.context ? `${error.context}: ` : "";
  lastErrorEl.textContent = `Last error: ${context}${error.message}`;
}

function appendVersion() {
  if (!lastErrorEl.textContent) {
    lastErrorEl.textContent = `Installed version: ${manifest.version || "unknown"}`;
  }
}

function setBusy(isBusy) {
  connectYoutubeButton.disabled = isBusy;
  openQueueButton.disabled = isBusy;
  refreshQueueButton.disabled = isBusy;
}

function openConnectPage() {
  const url = chrome.runtime.getURL("connect.html");
  chrome.tabs.create({ url });
}

function errorMessage(response, fallback) {
  if (response?.userMessage) {
    return response.userMessage;
  }
  return response?.error || fallback;
}

connectYoutubeButton.addEventListener("click", async () => {
  setLastError(null);
  setStatus("Opening the persistent YouTube connection page...");
  openConnectPage();
});

openQueueButton.addEventListener("click", async () => {
  setStatus("Opening Que...");
  setBusy(true);
  const response = await sendMessage({ type: "OPEN_QUEUE" });
  setBusy(false);

  if (!response?.ok) {
    setStatus(errorMessage(response, "Unable to open playlist."), true);
    setLastError({
      context: response?.context || "OPEN_QUEUE",
      message: response?.error || "Unable to open playlist."
    });
    return;
  }

  setLastError(null);
  setStatus("Que playlist opened.");
});

refreshQueueButton.addEventListener("click", async () => {
  setStatus("Refreshing queue cache...");
  setBusy(true);
  const response = await sendMessage({ type: "REFRESH_QUEUE", interactive: true });
  setBusy(false);

  if (!response?.ok) {
    setStatus(errorMessage(response, "Unable to refresh queue."), true);
    setLastError({
      context: response?.context || "REFRESH_QUEUE",
      message: response?.error || "Unable to refresh queue."
    });
    return;
  }

  setLastError(null);
  setStatus("Queue cache refreshed.");
});

sendMessage({ type: "GET_QUEUE_INFO" }).then((response) => {
  if (!response?.ok) {
    setStatus("Connect YouTube to initialize QueUp.");
    return;
  }

  if (response.playlistId) {
    setStatus("Que playlist is ready.");
  } else {
    setStatus("Que playlist will be created on first Add to Que.");
  }

  setLastError(response.lastError || null);
  appendVersion();
});

sendMessage({ type: "GET_DEBUG_INFO" }).then((response) => {
  if (response?.ok) {
    setLastError(response.lastError || null);
    appendVersion();
  }
});
