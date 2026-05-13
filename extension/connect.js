const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube";
const CHROME_IDENTITY_TIMEOUT_MS = 120 * 1000;

const connectButton = document.getElementById("connectButton");
const openYouTubeButton = document.getElementById("openYouTubeButton");
const statusEl = document.getElementById("status");
const detailsEl = document.getElementById("details");
const manifest = chrome.runtime.getManifest();

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

function showVersion() {
  const version = manifest.version || "unknown";
  setDetails(`Installed QueUp version: ${version}`);
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

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

function getChromeIdentityToken() {
  return withTimeout(
    new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (result, grantedScopes) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || "Chrome identity failed."));
          return;
        }

        const auth = tokenFromResult(result, grantedScopes);
        if (!auth.token) {
          reject(new Error("Chrome identity did not return an auth token."));
          return;
        }

        resolve({ ...auth, source: "Chrome profile" });
      });
    }),
    CHROME_IDENTITY_TIMEOUT_MS,
    "Timed out waiting for Chrome's Google consent prompt."
  );
}

async function authenticateWithBackground(auth) {
  const message = {
    type: "AUTHENTICATE",
    interactive: false
  };

  if (auth.token) {
    message.accessToken = auth.token;
    message.authSource = auth.source;
    message.expiresInSeconds = auth.expiresInSeconds;
  }

  return sendMessage(message);
}

function responseError(response, fallback) {
  const error = new Error(response?.userMessage || response?.error || fallback);
  error.response = response || null;
  return error;
}

function diagnosticDetails(error) {
  const response = error?.response || null;
  const lines = [
    `Installed QueUp version: ${manifest.version || "unknown"}`,
    `Extension ID: ${chrome.runtime.id}`,
    `Error: ${error?.message || "Unknown error."}`
  ];

  if (response?.requiresYouTubeChannel) {
    lines.push(
      "",
      "QueUp stores your queue in a private YouTube playlist. Google accounts need an active YouTube channel before the YouTube API can create or update playlists.",
      "Open YouTube with this account, finish creating or activating a channel if prompted, then return here and reconnect QueUp."
    );
  } else {
    lines.push(
      "",
      "QueUp uses Chrome's built-in Google sign-in for extensions. If no prompt appears, open Chrome settings and confirm this Chrome profile is signed into the Google account you use for YouTube, then try again."
    );
  }

  return lines.join("\n");
}

async function connectYouTube() {
  setStatus("Opening Chrome's Google consent prompt...");
  return withTimeout(
    getChromeIdentityToken(),
    CHROME_IDENTITY_TIMEOUT_MS,
    "Timed out waiting for Google authorization."
  );
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

  try {
    const auth = await connectYouTube();
    setStatus("Google granted access. Preparing your Que playlist...");

    const response = await authenticateWithBackground(auth);
    if (!response?.ok) {
      throw responseError(response, "Unable to prepare Que playlist.");
    }

    setStatus("Connected. Your private Que playlist is ready.");
    setDetails(`Installed QueUp version: ${manifest.version || "unknown"}\nAuth source: ${auth.source || "Chrome profile"}\nGranted scopes: ${(auth.grantedScopes || []).join(", ") || YOUTUBE_SCOPE}`);
  } catch (error) {
    setStatus(error?.message || "Unable to connect YouTube.", true);
    setDetails(diagnosticDetails(error));
  } finally {
    setBusy(false);
  }
});

openYouTubeButton.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.youtube.com/" });
});

showVersion();
