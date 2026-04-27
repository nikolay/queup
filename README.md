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
