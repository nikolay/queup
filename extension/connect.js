const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube";
const AUTH_TIMEOUT_MS = 120 * 1000;

const connectButton = document.getElementById("connectButton");
const openYouTubeButton = document.getElementById("openYouTubeButton");
const statusEl = document.getElementById("status");
const detailsEl = document.getElementById("details");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setDetails(value) {
  detailsEl.textContent = value || "";
}

function setBusy(isBusy) {
  connectButton.disabled = isBusy;
  openYouTubeButton.disabled = isBusy;
}

function tokenFromResult(result, grantedScopes) {
  if (typeof result === "string") {
    return { token: result, grantedScopes: grantedScopes || [] };
  }
  return {
    token: result?.token || null,
    grantedScopes: result?.grantedScopes || []
  };
}

function getAuthTokenInteractive() {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("Timed out waiting for Google consent. If no prompt appeared, confirm Chrome is signed into the Google account you use for YouTube."));
    }, AUTH_TIMEOUT_MS);

    chrome.identity.getAuthToken(
      {
        interactive: true,
        scopes: [YOUTUBE_SCOPE],
        enableGranularPermissions: true
      },
      (result, grantedScopes) => {
        window.clearTimeout(timeoutId);

        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || "Chrome identity failed."));
          return;
        }

        const auth = tokenFromResult(result, grantedScopes);
        if (!auth.token) {
          reject(new Error("Chrome identity did not return an auth token."));
          return;
        }

        resolve(auth);
      }
    );
  });
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message || "Unable to reach QueUp background worker." });
        return;
      }
      resolve(response || { ok: false, error: "No response from QueUp background worker." });
    });
  });
}

connectButton.addEventListener("click", async () => {
  setBusy(true);
  setDetails("");
  setStatus("Opening Google consent prompt...");

  try {
    const auth = await getAuthTokenInteractive();
    setStatus("Google granted access. Preparing your Que playlist...");

    const response = await sendMessage({ type: "AUTHENTICATE", interactive: false });
    if (!response?.ok) {
      throw new Error(response?.userMessage || response?.error || "Unable to prepare Que playlist.");
    }

    setStatus("Connected. Your private Que playlist is ready.");
    setDetails(`Granted scopes: ${(auth.grantedScopes || []).join(", ") || YOUTUBE_SCOPE}`);
  } catch (error) {
    setStatus(error?.message || "Unable to connect YouTube.", true);
    setDetails("If Chrome did not show a prompt, open Chrome settings and make sure this Chrome profile is signed into the Google account you use for YouTube, then try again.");
  } finally {
    setBusy(false);
  }
});

openYouTubeButton.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.youtube.com/" });
});
