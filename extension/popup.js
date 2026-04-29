const MESSAGE_TIMEOUT_MS = 75 * 1000;

const statusEl = document.getElementById("status");
const lastErrorEl = document.getElementById("lastError");
const connectionEl = document.getElementById("connection");
const connectYoutubeButton = document.getElementById("connectYoutube");
const disconnectYoutubeButton = document.getElementById("disconnectYoutube");
const openQueueButton = document.getElementById("openQueue");
const refreshQueueButton = document.getElementById("refreshQueue");
const manifest = chrome.runtime.getManifest();

let isBusy = false;
let isConnected = false;

async function sendMessage(message) {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      settled = true;
      resolve({
        ok: false,
        timedOut: true,
        error: "QueUp timed out waiting for Chrome. Open Connect YouTube, finish Google sign-in, then try again."
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

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#a5183f" : "#3a4d47";
}

function setLastError(error, version = manifest.version) {
  const lines = [`Installed version: ${version || "unknown"}`];

  if (error) {
    const context = error.context ? `${error.context}: ` : "";
    lines.unshift(`Last error: ${context}${error.message}`);
  }

  lastErrorEl.textContent = lines.join("\n");
}

function setBusy(nextBusy) {
  isBusy = nextBusy;
  connectYoutubeButton.disabled = isBusy;
  disconnectYoutubeButton.disabled = isBusy;
  openQueueButton.disabled = isBusy || !isConnected;
  refreshQueueButton.disabled = isBusy || !isConnected;
}

function accountLabel(account) {
  if (account?.title) {
    return `Connected to ${account.title}`;
  }
  return "Connected to YouTube";
}

function renderConnection(info = {}, options = {}) {
  isConnected = Boolean(info.connected);
  connectionEl.textContent = isConnected ? accountLabel(info.account) : "YouTube is not connected.";
  connectionEl.classList.toggle("connection--connected", isConnected);

  connectYoutubeButton.hidden = isConnected;
  disconnectYoutubeButton.hidden = !isConnected;
  setBusy(isBusy);
  if (options.updateDetail !== false) {
    setLastError(info.lastError || null, info.version || manifest.version);
  }
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

async function loadConnectionInfo(options = {}) {
  const updateStatus = options.updateStatus !== false;
  const updateDetail = options.updateDetail !== false;
  const response = await sendMessage({ type: "GET_CONNECTION_INFO" });
  if (!response?.ok) {
    renderConnection({ connected: false, version: manifest.version }, { updateDetail });
    if (updateStatus) {
      setStatus("Connect YouTube to initialize QueUp.");
    }
    if (updateDetail) {
      setLastError({
        context: response?.context || "GET_CONNECTION_INFO",
        message: response?.error || "Unable to read connection state."
      });
    }
    return;
  }

  renderConnection(response, { updateDetail });
  if (!updateStatus) {
    return;
  }

  if (response.connected) {
    setStatus(response.playlistId ? "Que is ready." : "Que will be created on first add.");
  } else {
    setStatus("Connect YouTube to initialize QueUp.");
  }
}

connectYoutubeButton.addEventListener("click", () => {
  setLastError(null);
  setStatus("Opening YouTube connection page...");
  openConnectPage();
});

disconnectYoutubeButton.addEventListener("click", async () => {
  setStatus("Disconnecting YouTube...");
  setBusy(true);
  const response = await sendMessage({ type: "DISCONNECT" });
  setBusy(false);

  if (!response?.ok) {
    setStatus(errorMessage(response, "Unable to disconnect YouTube."), true);
    setLastError({
      context: response?.context || "DISCONNECT",
      message: response?.error || "Unable to disconnect YouTube."
    });
    return;
  }

  renderConnection(response);
  setStatus("YouTube disconnected.");
});

openQueueButton.addEventListener("click", async () => {
  if (!isConnected) {
    setStatus("Connect YouTube before opening Que.", true);
    return;
  }

  setStatus("Opening Que...");
  setBusy(true);
  const response = await sendMessage({ type: "OPEN_QUEUE" });
  setBusy(false);

  if (!response?.ok) {
    setStatus(errorMessage(response, "Unable to open Que."), true);
    setLastError({
      context: response?.context || "OPEN_QUEUE",
      message: response?.error || "Unable to open Que."
    });
    await loadConnectionInfo({ updateStatus: false, updateDetail: false });
    return;
  }

  setLastError(null);
  setStatus("Que opened.");
  await loadConnectionInfo();
});

refreshQueueButton.addEventListener("click", async () => {
  if (!isConnected) {
    setStatus("Connect YouTube before refreshing Que.", true);
    return;
  }

  setStatus("Refreshing Que...");
  setBusy(true);
  const response = await sendMessage({ type: "REFRESH_QUEUE", interactive: false });
  setBusy(false);

  if (!response?.ok) {
    setStatus(errorMessage(response, "Unable to refresh Que."), true);
    setLastError({
      context: response?.context || "REFRESH_QUEUE",
      message: response?.error || "Unable to refresh Que."
    });
    await loadConnectionInfo({ updateStatus: false, updateDetail: false });
    return;
  }

  setLastError(null);
  setStatus("Que refreshed.");
  await loadConnectionInfo();
});

loadConnectionInfo();
