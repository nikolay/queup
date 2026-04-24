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

1. Create a Google Cloud OAuth client for a Chrome Extension.
2. Put the OAuth client id into `extension/manifest.json`:
   - `oauth2.client_id = "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com"`
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the `extension/` folder.
6. Open YouTube and click **Add to Que** on a video.

## OAuth notes

- Scope used: `https://www.googleapis.com/auth/youtube`
- API used: YouTube Data API v3
- Required Google Cloud service: **YouTube Data API v3**

## Website deployment (`queup.io`)

The static site is in `site/` with:

- `site/index.html`
- `site/privacy.html`
- `site/styles.css`
- `site/CNAME` (`queup.io`)

You can deploy `site/` to any static host (GitHub Pages, Netlify, Cloudflare Pages, Vercel static).
