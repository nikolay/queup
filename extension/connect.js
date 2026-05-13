const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube";
const WEB_AUTH_CLIENT_ID = "340590105282-nncmov0f44k63mef91v0b0eu8kdfeq6s.apps.googleusercontent.com";
const WEB_AUTH_TIMEOUT_MS = 120 * 1000;
const TOKEN_EXCHANGE_TIMEOUT_MS = 25 * 1000;

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

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timeoutId));
  });
}

function base64UrlFromBytes(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlFromBytes(bytes);
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlFromBytes(new Uint8Array(digest));
}

async function createPkcePair() {
  const verifier = randomBase64Url(32);
  return {
    challenge: await sha256Base64Url(verifier),
    verifier
  };
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

function redirectParams(responseUrl) {
  if (!responseUrl) {
    throw new Error("Google OAuth did not return a redirect URL.");
  }

  const url = new URL(responseUrl);
  const params = new URLSearchParams(url.search);
  if (url.hash) {
    const hashParams = new URLSearchParams(url.hash.slice(1));
    for (const [key, value] of hashParams) {
      if (!params.has(key)) {
        params.set(key, value);
      }
    }
  }
  return params;
}

function parseAuthorizationRedirect(responseUrl, expectedState) {
  const params = redirectParams(responseUrl);
  const actualState = params.get("state");
  if (!actualState || actualState !== expectedState) {
    throw new Error("Google OAuth returned an unexpected state. Try connecting again.");
  }

  const oauthError = params.get("error");
  if (oauthError) {
    const description = params.get("error_description");
    throw new Error(`Google OAuth error: ${description || oauthError}`);
  }

  const code = params.get("code");
  if (!code) {
    throw new Error("Google OAuth did not return an authorization code.");
  }

  return code;
}

async function exchangeAuthorizationCode({ code, codeVerifier, redirectUri }) {
  const body = new URLSearchParams({
    client_id: WEB_AUTH_CLIENT_ID,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri
  });

  const response = await withTimeout(
    fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    }),
    TOKEN_EXCHANGE_TIMEOUT_MS,
    "Timed out exchanging Google's authorization code."
  );

  const text = await response.text();
  let result = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch (_error) {
    result = { error_description: text || "Google returned a non-JSON token response." };
  }

  if (!response.ok) {
    const description = result.error_description || result.error || response.statusText;
    throw new Error(`Google token exchange failed: ${description}`);
  }

  if (!result.access_token) {
    throw new Error("Google token exchange did not return an access token.");
  }

  return {
    expiresInSeconds: Number(result.expires_in || 3600),
    grantedScopes: String(result.scope || YOUTUBE_SCOPE).split(/\s+/u).filter(Boolean),
    source: "Google sign-in window",
    token: result.access_token
  };
}

async function getWebAuthFlowToken() {
  const redirectUri = chrome.identity.getRedirectURL("oauth2");
  const state = randomBase64Url(32);
  const pkce = await createPkcePair();

  const params = new URLSearchParams({
    access_type: "online",
    client_id: WEB_AUTH_CLIENT_ID,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPE,
    state
  });

  const responseUrl = await launchWebAuthFlow({
    interactive: true,
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
  });
  const code = parseAuthorizationRedirect(responseUrl, state);
  const auth = await exchangeAuthorizationCode({
    code,
    codeVerifier: pkce.verifier,
    redirectUri
  });

  return {
    ...auth,
    redirectUri
  };
}

async function getOAuthTokenInteractive() {
  setStatus("Opening Google's secure sign-in window...");
  return getWebAuthFlowToken();
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
  const message = String(error?.message || "");
  const lines = [
    `Installed QueUp version: ${manifest.version || "unknown"}`,
    `Extension ID: ${chrome.runtime.id}`,
    `Error: ${message || "Unknown error."}`
  ];

  if (response?.requiresYouTubeChannel) {
    lines.push(
      "",
      "QueUp stores your queue in a private YouTube playlist. Google accounts need an active YouTube channel before the YouTube API can create or update playlists.",
      "Open YouTube with this account, finish creating or activating a channel if prompted, then return here and reconnect QueUp."
    );
  } else if (/client_secret|invalid_client/iu.test(message)) {
    lines.push(
      "",
      "Google is treating the configured OAuth client as a confidential web client. QueUp cannot safely ship a client secret inside the extension.",
      "Use a public OAuth client type that supports Authorization Code with PKCE, or add a small backend token-exchange endpoint for QueUp."
    );
  } else {
    lines.push(
      "",
      "If Google reports a redirect URI problem, add this redirect URI to the QueUp Web Auth Fallback OAuth client:",
      chrome.identity.getRedirectURL("oauth2")
    );
  }

  return lines.join("\n");
}

async function connectYouTube() {
  return withTimeout(
    getOAuthTokenInteractive(),
    WEB_AUTH_TIMEOUT_MS + TOKEN_EXCHANGE_TIMEOUT_MS,
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
    setDetails(`Installed QueUp version: ${manifest.version || "unknown"}\nAuth flow: Authorization Code with PKCE\nGranted scopes: ${(auth.grantedScopes || []).join(", ") || YOUTUBE_SCOPE}`);
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
