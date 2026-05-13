# Chrome Web Store Listing

## Description

QueUp gives YouTube a lightweight watch queue that lives in your own account. It adds compact + Que and - Que buttons to video pages and recommended videos, then stores your queue in a private YouTube playlist named Que.

Use QueUp when you want to keep watching momentum without opening a dozen tabs or losing recommendations you want to revisit later. The extension also adds a prominent Open Que button on YouTube, so your saved videos are always one click away.

QueUp keeps the queue tidy automatically. Once a queued video is watched, the extension removes it from the Que playlist so the list stays focused on what is still waiting.

Privacy is intentionally simple. QueUp uses Google OAuth only to read and update your own YouTube playlists and playlist items. It does not run a separate server, sell data, or send your queue to any third-party service controlled by QueUp.

## Fields

- Category: Workflow & Planning
- Language: English (United States)
- Homepage URL: https://queup.io/
- Support URL: https://github.com/nikolay/queup/issues
- Mature content: Off

## Media

- Store icon: `store-assets/queup-store-icon-128.png`
- Small promo tile: `store-assets/queup-small-promo-tile-440x280.png`
- Screenshot: `store-assets/queup-screenshot-1280x800.png`
- Google Auth Platform logo: `store-assets/queup-google-auth-logo-120.png`
- YouTube channel image: `store-assets/queup-youtube-channel-2048x1152.png`

The Chrome Web Store dashboard should use the `queup.io` homepage URL, not the GitHub Pages fallback hostname.

## Privacy Practices Notes

- Host permission: `https://www.youtube.com/*` lets QueUp place compact queue controls on YouTube pages.
- Host permission: `https://www.googleapis.com/*` lets QueUp read and update the user's own private Que playlist through the YouTube Data API.
- Host permission: `https://oauth2.googleapis.com/*` is used only to exchange a Google authorization code for an access token during the secure OAuth sign-in flow.
- Identity permission: used only to open the Google OAuth window and capture the extension-owned `chromiumapp.org` redirect.
- Storage permission: used to cache Que playlist state and the short-lived session access token locally in Chrome.
