# WaveSlice

WaveSlice splits long audio recordings into smaller MP3 chunks in your browser. Source audio is never uploaded to a server.

## Requirements

- Node.js 22 or newer
- pnpm 12.3.4 (the project pins this version through `packageManager`)

## Run locally

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Vite. FFmpeg WebAssembly is copied from the installed package into the ignored `public/ffmpeg/` directory when the dev server starts and when a production build runs.

## Build static files

```sh
pnpm build
```

The deployable site is written to `dist/`. It can be served by a static host. The build includes the FFmpeg WebAssembly runtime so the first split does not need to fetch a third-party runtime.

## Run with Docker Compose

```sh
docker compose up --build
```

Open <http://localhost:8080>. Compose builds a static site and serves it with Nginx; it does not add an audio-processing backend.

## Privacy and limits

Audio metadata is read by the browser, with local FFmpeg inspection as a fallback for formats the browser cannot inspect. FFmpeg runs in a Web Worker on the user's device. Generated chunks stay in the page session for preview and downloads and are cleared when the page is closed or refreshed. Long or large files may use substantial browser memory; WaveSlice warns for files over 500 MB or six hours.

FFmpeg WebAssembly is provided by `@ffmpeg/core` (GPL-2.0-or-later). Review its license and applicable obligations before redistributing a deployed build.
