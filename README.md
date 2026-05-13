# QueUp

QueUp is a Chrome Extension + static website at <https://queup.io> that turns a private YouTube playlist named **Que** into your watch queue.

## Project layout

- `assets/bitmaps.json`: generated bitmap manifest for SVG-to-PNG logo outputs.
- `extension/`: Manifest V3 Chrome extension source.
- `scripts/generate-assets.mjs`: `@resvg/resvg-js` SVG-to-PNG asset generator.
- `site/`: Static website for `https://queup.io`.

## What the extension does

- Adds compact **+ Que** / **- Que** actions to:
  - the current watch page video
  - recommended and feed video cards
- Uses a private YouTube playlist named **Que** as storage.
- Adds a prominent **Open Que** button on YouTube pages.
- Removes a queued video after it is watched (on `ended` and near-end fallback).

## Local setup

1. Create or select a Google Cloud project.
2. Enable **YouTube Data API v3** (`youtube.googleapis.com`).
3. Configure Google Auth Platform for the app:
   - App name: `QueUp`
   - Homepage: `https://queup.io`
   - Privacy policy: `https://queup.io/privacy.html`
   - Terms of service: `https://queup.io/terms.html`
   - Scope: `https://www.googleapis.com/auth/youtube`
4. Create an OAuth client:
   - Application type: **Web application**
   - Name: `QueUp Web Auth Fallback`
   - Authorized redirect URI: `https://fldmblmmafcjlpgnoppjdpkfkkeejnkk.chromiumapp.org/oauth2`
5. Put the web OAuth client id into `WEB_AUTH_CLIENT_ID` in `extension/connect.js`.
6. While the OAuth app is in **Testing** mode, add each Google account that will use the extension as a test user in Google Auth Platform > Audience.
7. Open `chrome://extensions`.
8. Enable **Developer mode**.
9. Click **Load unpacked** and select the `extension/` folder.
10. Open YouTube, connect YouTube from the QueUp toolbar popup, and click **+ Que** on a video.

## OAuth notes

- Scope used: `https://www.googleapis.com/auth/youtube`
- API used: YouTube Data API v3
- Required Google Cloud service: **YouTube Data API v3**
- Google Cloud project: `queup-nikolay-20260426`
- Web OAuth client id: `340590105282-nncmov0f44k63mef91v0b0eu8kdfeq6s.apps.googleusercontent.com`
- Web OAuth redirect URI: `https://fldmblmmafcjlpgnoppjdpkfkkeejnkk.chromiumapp.org/oauth2`
- OAuth flow: `chrome.identity.launchWebAuthFlow` with Authorization Code + PKCE and a per-request `state` value.
- Chrome Web Store status: Published
- Google Auth Platform status: Check Google Cloud Auth Platform; if the OAuth app is still in Testing, add each Google account that should connect YouTube as a test user.
- Chrome Web Store item ID: `fldmblmmafcjlpgnoppjdpkfkkeejnkk`
- Chrome Web Store uploads cannot include `manifest.key`; the publish workflow strips it from the packaged ZIP.
- The web OAuth client redirect URI is configured for the Chrome Web Store item ID above, and app ownership is verified in Google Auth Platform.
- Local unpacked builds with a different generated extension ID need their own web OAuth redirect URI or the published item ID key.
- Earlier QueUp releases used a Chrome Extension OAuth client through `chrome.identity.getAuthToken`. Current releases do not use that client because Google Auth Platform flags it as missing caller-managed `state`.
- If Google rejects the token exchange with `client_secret is missing`, the selected OAuth client is confidential-only. Do not put that secret in the extension; use a public client type that supports Authorization Code with PKCE or add a backend token-exchange endpoint.
- Google Cloud's `gcloud iam oauth-clients` command is not suitable for this extension because it only supports Google Cloud/IAM scopes, not YouTube account scopes.

## Website deployment (`queup.io`)

The static site is in `site/` with:

- `site/index.html`
- `site/privacy.html`
- `site/terms.html`
- `site/styles.css`
- `site/CNAME` (`queup.io`)

GitHub Pages is deployed from `site/` through `.github/workflows/pages.yml`.
The published site is served from the custom domain:

- `https://queup.io/`

The Pages custom domain is configured in GitHub and HTTPS is enforced. Keep `site/CNAME` in the deployed artifact so future site deployments preserve the custom-domain intent.

## Logo and generated assets

The source logo is `site/assets/queup-logo.svg`. PNG derivatives for Chrome extension icons, website favicons, Chrome Web Store assets, the 120x120 Google Auth Platform logo, and the 2048x1152 YouTube channel image are defined in `assets/bitmaps.json`.

Regenerate the PNG assets locally with:

```bash
npm ci
npm run assets
```

Verify committed PNGs are up to date with:

```bash
npm run assets:check
```

GitHub Actions installs the locked Node dependencies and regenerates assets before GitHub Pages deployment and Chrome Web Store packaging. The `Verify Generated Assets` workflow also checks that committed PNGs match the SVG source and JSON manifest.

The YouTube channel image uses the bundled Figtree TTF in `assets/fonts/Figtree-wght.ttf` so SVG text rasterizes consistently in local runs and CI. Its Open Font License text is stored in `assets/fonts/Figtree-OFL.txt`.

## Sponsorship

GitHub Sponsors and related funding links are configured in `.github/FUNDING.yml`.

## Chrome Web Store deployment

Chrome Web Store updates are handled by `.github/workflows/chrome-web-store.yml`.

The first Chrome Web Store item has been created manually in the Developer Dashboard. The workflow uploads and submits new extension versions through the Chrome Web Store API.

The publish workflow runs when a tag matching `extension-v*` is pushed. The tag must match the extension manifest version.

To cut a release, run the `Tag Extension Release` workflow from GitHub Actions and check `confirm_publish`. It reads the version from `extension/manifest.json`, creates `extension-v<version>`, and pushes the tag. That tag then triggers the Chrome Web Store publish workflow.

The equivalent local commands are:

```bash
version="$(node -p "require('./extension/manifest.json').version")"
git tag "extension-v${version}"
git push origin "extension-v${version}"
```

The publish workflow can also be run manually from GitHub Actions without creating a tag.

Required repository secrets:

- `CWS_EXTENSION_ID`: Chrome Web Store item ID, currently `fldmblmmafcjlpgnoppjdpkfkkeejnkk`.
- `CWS_PUBLISHER_ID`: Chrome Web Store publisher ID from the Developer Dashboard account page.
- `CWS_SERVICE_ACCOUNT_JSON`: JSON key for the Google Cloud service account granted Chrome Web Store API access in the Developer Dashboard.
- `CWS_CRX_PRIVATE_KEY`: RSA private key used to sign CRX uploads after Verified CRX uploads are enabled.

Required Google Cloud APIs:

- Chrome Web Store API: `chromewebstore.googleapis.com`
- IAM Service Account Credentials API: `iamcredentials.googleapis.com`

Required service account IAM binding:

- `chrome-web-store-publisher@queup-nikolay-20260426.iam.gserviceaccount.com` needs `roles/iam.serviceAccountTokenCreator` on itself so GitHub Actions can mint a Chrome Web Store API access token from `CWS_SERVICE_ACCOUNT_JSON`.

The workflow uses Chrome Web Store API v2 to:

1. Validate the extension files.
2. Package the contents of `extension/`, with `manifest.key` removed for Chrome Web Store compatibility.
3. Upload the ZIP package, or a signed CRX package when `CWS_CRX_PRIVATE_KEY` is configured, to the existing Chrome Web Store item.
4. Fetch upload status.
5. Submit the item for review.

By default, tag-triggered submissions use `DEFAULT_PUBLISH`, so approved updates publish automatically after Chrome Web Store review. Manual workflow runs can still choose `STAGED_PUBLISH` when you want an approved update to wait for manual release.

If an update was submitted with `STAGED_PUBLISH` and has already passed review, run the `Release Approved Chrome Extension` workflow to publish the approved staged item without uploading a new package.

### Chrome Web Store listing

The Chrome Web Store API v2 used by this repository handles package upload, publish, status, and staged rollout actions. Listing metadata and media are still maintained in the Developer Dashboard.

Use `store-assets/listing.md` as the source of truth when editing the listing. The homepage URL should be `https://queup.io/`, not the GitHub Pages hostname. The current store icon source is `store-assets/queup-store-icon-128.png`, the current small promo tile source is `store-assets/queup-small-promo-tile-440x280.png`, and the current screenshot source is `store-assets/queup-screenshot-1280x800.png`.

### Verified CRX uploads

Chrome Web Store Verified CRX uploads require every future package upload to be a signed `.crx` file. Generate a signing key pair with:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out privatekey.pem
openssl rsa -in privatekey.pem -pubout -out publickey.pem
```

Opt in from the Chrome Web Store Developer Dashboard package tab using the public key. Store the private key as the `CWS_CRX_PRIVATE_KEY` repository secret. Once that secret exists, `.github/workflows/chrome-web-store.yml` signs the stripped extension package with Chrome and uploads the resulting `.crx` with the required Chrome Web Store API headers.

Keep the private key somewhere secure outside the repository. If it is lost, Chrome Web Store support must help replace it before future uploads can continue.

## Troubleshooting OAuth

QueUp uses Chrome's `identity` API only to open Google's secure OAuth window and capture the `chromiumapp.org` redirect. The sign-in request uses Authorization Code + PKCE with a per-request `state` value. QueUp keeps the returned access token in Chrome session storage only, so it is not persisted after the browser session.

### `Channel not found`

If the YouTube API returns `Channel not found`, the selected Google account does not have an active YouTube channel that can own playlists yet. Open YouTube with that account, finish creating or activating a channel if prompted, then reconnect QueUp. For Google Workspace accounts, the organization admin may need to allow YouTube channel creation before QueUp can create the private **Que** playlist.
