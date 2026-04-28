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
const connectYoutubeButton = document.getElementById("connectYoutube");
const openQueueButton = document.getElementById("openQueue");
const refreshQueueButton = document.getElementById("refreshQueue");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#a5183f" : "#3a4d47";
}

function setBusy(isBusy) {
  connectYoutubeButton.disabled = isBusy;
  openQueueButton.disabled = isBusy;
  refreshQueueButton.disabled = isBusy;
}

function errorMessage(response, fallback) {
  if (response?.userMessage) {
    return response.userMessage;
  }
  return response?.error || fallback;
}

connectYoutubeButton.addEventListener("click", async () => {
  setStatus("Connecting to Google...");
  setBusy(true);
  const response = await sendMessage({ type: "AUTHENTICATE" });
  setBusy(false);

  if (!response?.ok) {
    setStatus(errorMessage(response, "Unable to connect YouTube."), true);
    return;
  }

  setStatus("Connected. Your private Que playlist is ready.");
});

openQueueButton.addEventListener("click", async () => {
  setStatus("Opening Que...");
  setBusy(true);
  const response = await sendMessage({ type: "OPEN_QUEUE" });
  setBusy(false);

  if (!response?.ok) {
    setStatus(errorMessage(response, "Unable to open playlist."), true);
    return;
  }

  setStatus("Que playlist opened.");
});

refreshQueueButton.addEventListener("click", async () => {
  setStatus("Refreshing queue cache...");
  setBusy(true);
  const response = await sendMessage({ type: "REFRESH_QUEUE", interactive: true });
  setBusy(false);

  if (!response?.ok) {
    setStatus(errorMessage(response, "Unable to refresh queue."), true);
    return;
  }

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
});
