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
   - Item ID: `cbkkoajgjkbfmnihnaoeoggiilibajkj`
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
- Stable local Chrome extension ID: `cbkkoajgjkbfmnihnaoeoggiilibajkj`
- The extension ID is pinned by the public `key` field in `extension/manifest.json`.
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

The first Chrome Web Store item still needs to be created manually in the Developer Dashboard. After that item exists, this workflow can upload and submit new extension versions through the Chrome Web Store API.

The workflow runs when a tag matching `extension-v*` is pushed. The tag must match the extension manifest version. For example:

```bash
git tag extension-v1.0.0
git push origin extension-v1.0.0
```

The workflow can also be run manually from GitHub Actions.

Required repository secrets:

- `CWS_EXTENSION_ID`: Chrome Web Store item ID. The configured local extension ID is `cbkkoajgjkbfmnihnaoeoggiilibajkj`.
- `CWS_PUBLISHER_ID`: Chrome Web Store publisher ID from the Developer Dashboard account page.
- `CWS_SERVICE_ACCOUNT_JSON`: JSON key for the Google Cloud service account granted Chrome Web Store API access in the Developer Dashboard.

The workflow uses Chrome Web Store API v2 to:

1. Validate the extension files.
2. Zip the contents of `extension/`.
3. Upload the package to the existing Chrome Web Store item.
4. Fetch upload status.
5. Submit the item for review.

By default, manual and tag-triggered submissions use `STAGED_PUBLISH`, so approved updates are staged for manual release instead of immediately published.
