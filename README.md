# Shadows of the Star Knights — Character Sheet

An [Owlbear Rodeo](https://www.owlbear.rodeo/) extension that adds a fillable digital
character sheet for the *Shadows of the Star Knights* TTRPG (a sci-fi Shadowdark hack).
It's a straight digitization of the paper sheet — no derived/computed values, just the
same fields as fillable inputs.

## How it works

- Right-click a character token → **Character Sheet** opens a modal with the form.
- Each token gets its own independent sheet, stored as metadata on that token (so it
  travels with the token and persists in the scene).

## Development

```sh
npm install
npm run dev
```

This starts a Vite dev server (default `http://localhost:5173`). In an Owlbear Rodeo
room, open **Extensions → Install extension by URL** and point it at:

```
http://localhost:5173/manifest.json
```

Drop a token on the **Character** layer, right-click it, and choose **Character
Sheet**.

## Build

```sh
npm run build
```

Outputs static assets to `dist/`, which can be hosted anywhere (e.g. GitHub Pages) and
installed the same way by pointing Owlbear Rodeo at `<host>/manifest.json`.
