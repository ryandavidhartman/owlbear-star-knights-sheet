# Shadows of the Star Knights — Character Sheet

An [Owlbear Rodeo](https://www.owlbear.rodeo/) extension that adds a fillable digital
character sheet for the *Shadows of the Star Knights* TTRPG (a sci-fi Shadowdark hack).
It's a straight digitization of the paper sheet — no derived/computed values, just the
same fields as fillable inputs.

## Install

In any Owlbear Rodeo room, open **Extensions**, click **+** to install by URL, and
paste:

```
https://ryandavidhartman.github.io/owlbear-star-knights-sheet/manifest.json
```

Toggle it on for the room. No local setup needed — it's hosted on GitHub Pages and
redeploys automatically on every push to `main`.

## How it works

- Right-click a character token → **Character Sheet** opens a modal with the form.
- Each token gets its own independent sheet, stored as metadata on that token (so it
  travels with the token and persists in the scene).
- A new token that shares a portrait image with a character you've already filled in
  (even in a different scene) starts pre-filled with that character's last-saved data,
  since portrait-keyed sheets are also cached in room metadata. Editing the new token's
  sheet only changes that token — it doesn't rewrite the original.
- If a token's own data ever plainly differs from that cross-scene cache — e.g. someone
  edited the same character on a token in another scene — opening its sheet shows a
  banner rather than silently picking a side. Click **Load other version** to pull in
  the other copy, or **Dismiss** to keep what's on this token.
- Saving is safe with several people editing sheets at once: each player's edits are
  scoped to their own token and character, so simultaneous saves by different players
  (the normal case at the table) don't overwrite each other.

## Development

```sh
npm install
npm run dev
```

This starts a Vite dev server (default `http://localhost:5173`). To test local changes
before pushing, install a *second* extension entry in your OBR room pointing at:

```
http://localhost:5173/manifest.json
```

Drop a token on the **Character** layer, right-click it, and choose **Character
Sheet**.

## Build & deploy

```sh
npm run build
```

Outputs static assets to `dist/`, with `manifest.json` rewritten to use fully-qualified
`https://ryandavidhartman.github.io/owlbear-star-knights-sheet/...` URLs for its
`icon`/`background_url` fields (see `vite.config.ts`) — Owlbear Rodeo resolves those two
manifest fields itself, before any of our code runs, so relative paths are ambiguous
under a GitHub Pages project site's subpath.

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes
`dist/` to GitHub Pages automatically. No manual deploy step required.
