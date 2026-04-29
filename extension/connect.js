const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube";
const WEB_AUTH_CLIENT_ID = "340590105282-nncmov0f44k63mef91v0b0eu8kdfeq6s.apps.googleusercontent.com";
const CHROME_IDENTITY_TIMEOUT_MS = 20 * 1000;
const WEB_AUTH_TIMEOUT_MS = 120 * 1000;

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
    "Timed out waiting for Chrome's built-in Google consent prompt."
  );
}

function launchWebAuthFlow(details) {
  return withTimeout(
    new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(details, (responseUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || "Google sign-in window failed."));
          return;
        }
        resolve(responseUrl);
      });
    }),
    WEB_AUTH_TIMEOUT_MS,
    "Timed out waiting for Google's sign-in window."
  );
}

function parseOAuthRedirect(responseUrl) {
  if (!responseUrl) {
    throw new Error("Google OAuth did not return a redirect URL.");
  }

  const url = new URL(responseUrl);
  const params = new URLSearchParams(url.hash ? url.hash.slice(1) : url.search.slice(1));
  const oauthError = params.get("error");
  if (oauthError) {
    const description = params.get("error_description");
    throw new Error(`Google OAuth error: ${description || oauthError}`);
  }

  const token = params.get("access_token");
  if (!token) {
    throw new Error("Google OAuth did not return an access token.");
  }

  return {
    expiresInSeconds: Number(params.get("expires_in") || 3600),
    grantedScopes: (params.get("scope") || YOUTUBE_SCOPE).split(/\s+/).filter(Boolean),
    source: "Google sign-in window",
    token
  };
}

async function getWebAuthFlowToken() {
  const redirectUri = chrome.identity.getRedirectURL("oauth2");

  const params = new URLSearchParams({
    client_id: WEB_AUTH_CLIENT_ID,
    include_granted_scopes: "true",
    prompt: "consent select_account",
    redirect_uri: redirectUri,
    response_type: "token",
    scope: YOUTUBE_SCOPE
  });

  const responseUrl = await launchWebAuthFlow({
    interactive: true,
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  });

  return {
    ...parseOAuthRedirect(responseUrl),
    redirectUri
  };
}

async function getAuthTokenInteractive() {
  try {
    setStatus("Opening Chrome's Google consent prompt...");
    return await getChromeIdentityToken();
  } catch (chromeIdentityError) {
    setStatus("Chrome did not open a prompt. Opening a Google sign-in window instead...");
    setDetails(diagnosticDetails(chromeIdentityError, "Trying fallback Google sign-in window..."));
    try {
      return await getWebAuthFlowToken();
    } catch (webAuthError) {
      webAuthError.chromeIdentityError = chromeIdentityError;
      throw webAuthError;
    }
  }
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

function diagnosticDetails(error, extra = "") {
  const lines = [
    `Installed QueUp version: ${manifest.version || "unknown"}`,
    `Extension ID: ${chrome.runtime.id}`,
    `${error?.chromeIdentityError ? "Chrome identity error" : "Error"}: ${error?.chromeIdentityError?.message || error?.message || "Unknown error."}`
  ];

  if (error?.chromeIdentityError && error?.message) {
    lines.push(`Fallback Google sign-in error: ${error.message}`);
  }

  if (extra) {
    lines.push("", extra);
  }

  lines.push(
    "",
    "If the fallback window reports a redirect URI problem, add this redirect URI to a Web Application OAuth client for QueUp:",
    chrome.identity.getRedirectURL("oauth2")
  );

  return lines.join("\n");
}

async function connectYouTube() {
  const result = await withTimeout(
    getAuthTokenInteractive(),
    WEB_AUTH_TIMEOUT_MS + CHROME_IDENTITY_TIMEOUT_MS,
    "Timed out waiting for Google authorization."
  );

  return result;
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
      throw new Error(response?.userMessage || response?.error || "Unable to prepare Que playlist.");
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
