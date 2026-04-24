async function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
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
const openQueueButton = document.getElementById("openQueue");
const refreshQueueButton = document.getElementById("refreshQueue");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#a5183f" : "#3a4d47";
}

openQueueButton.addEventListener("click", async () => {
  setStatus("Opening Que...");
  openQueueButton.disabled = true;
  const response = await sendMessage({ type: "OPEN_QUEUE" });
  openQueueButton.disabled = false;

  if (!response?.ok) {
    setStatus(response?.error || "Unable to open playlist.", true);
    return;
  }

  setStatus("Que playlist opened.");
});

refreshQueueButton.addEventListener("click", async () => {
  setStatus("Refreshing queue cache...");
  refreshQueueButton.disabled = true;
  const response = await sendMessage({ type: "REFRESH_QUEUE", interactive: false });
  refreshQueueButton.disabled = false;

  if (!response?.ok) {
    setStatus(response?.error || "Unable to refresh queue.", true);
    return;
  }

  setStatus("Queue cache refreshed.");
});

sendMessage({ type: "GET_QUEUE_INFO" }).then((response) => {
  if (!response?.ok) {
    setStatus("Sign in and use Add to Que on YouTube to initialize.", true);
    return;
  }

  if (response.playlistId) {
    setStatus("Que playlist is ready.");
  } else {
    setStatus("Que playlist will be created on first Add to Que.");
  }
});
