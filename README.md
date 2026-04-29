# QueUp

QueUp is a Chrome Extension + static website that turns a private YouTube playlist named **Que** into your watch queue.

## Project layout

- `extension/`: Manifest V3 Chrome extension source.
- `site/`: Static website for `https://queup.io`.

## What the extension does

- Adds **Add to Que** / **Remove from Que** actions to:
  - the current watch page video
  - recommended and feed video cards
- Uses a private YouTube playlist named **Que** as storage.
- Adds a prominent **Open Que Playlist** button on YouTube pages.
- Removes a queued video after it is watched (on `ended` and near-end fallback).

## Local setup

1. Create or select a Google Cloud project.
2. Enable **YouTube Data API v3** (`youtube.googleapis.com`).
3. Configure Google Auth Platform for the app:
   - App name: `QueUp`
   - Homepage: `https://queup.io`
   - Privacy policy: `https://queup.io/privacy.html`
   - Scope: `https://www.googleapis.com/auth/youtube`
4. Create an OAuth client:
   - Application type: **Chrome Extension**
   - Name: `QueUp Chrome Extension`
   - Item ID: `fldmblmmafcjlpgnoppjdpkfkkeejnkk`
5. Put the OAuth client id into `extension/manifest.json`.
6. While the OAuth app is in **Testing** mode, add each Google account that will use the extension as a test user in Google Auth Platform > Audience.
7. Open `chrome://extensions`.
8. Enable **Developer mode**.
9. Click **Load unpacked** and select the `extension/` folder.
10. Open YouTube and click **Add to Que** on a video.

## OAuth notes

- Scope used: `https://www.googleapis.com/auth/youtube`
- API used: YouTube Data API v3
- Required Google Cloud service: **YouTube Data API v3**
- Google Cloud project: `queup-nikolay-20260426`
- OAuth client id: `340590105282-87qk9a50ohs9fgdnugs6jfov18g5km7p.apps.googleusercontent.com`
- Publishing status: `Testing`
- Chrome Web Store item ID: `fldmblmmafcjlpgnoppjdpkfkkeejnkk`
- Chrome Web Store uploads cannot include `manifest.key`; the publish workflow strips it from the packaged ZIP.
- The OAuth client is configured for the Chrome Web Store item ID above, and app ownership is verified in Google Auth Platform.
- Local unpacked builds with a different generated extension ID need their own Chrome Extension OAuth client or the published item ID key.
- Google Cloud's `gcloud iam oauth-clients` command is not suitable for this extension because it only supports Google Cloud/IAM scopes, not YouTube account scopes.

## Website deployment (`queup.io`)

The static site is in `site/` with:

- `site/index.html`
- `site/privacy.html`
- `site/styles.css`
- `site/CNAME` (`queup.io`, kept for future custom-domain deployment)

GitHub Pages is deployed from `site/` through `.github/workflows/pages.yml`.
The workflow excludes `site/CNAME` so the project page stays available at:

- `https://nikolay.github.io/queup/`

When DNS for `queup.io` is ready, deploy `site/CNAME` with the site artifact or configure the custom domain in GitHub Pages settings.

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

### Verified CRX uploads

Chrome Web Store Verified CRX uploads require every future package upload to be a signed `.crx` file. Generate a signing key pair with:

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out privatekey.pem
openssl rsa -in privatekey.pem -pubout -out publickey.pem
```

Opt in from the Chrome Web Store Developer Dashboard package tab using the public key. Store the private key as the `CWS_CRX_PRIVATE_KEY` repository secret. Once that secret exists, `.github/workflows/chrome-web-store.yml` signs the stripped extension package with Chrome and uploads the resulting `.crx` with the required Chrome Web Store API headers.

Keep the private key somewhere secure outside the repository. If it is lost, Chrome Web Store support must help replace it before future uploads can continue.

## Troubleshooting OAuth

QueUp uses Chrome's `identity` API, which authenticates with the Google account signed into the Chrome profile. Being signed into youtube.com alone may not be enough. If buttons do not open a Google prompt, open the QueUp toolbar popup, click **Connect YouTube**, and confirm Chrome is signed into the Google account that owns your YouTube playlists.
