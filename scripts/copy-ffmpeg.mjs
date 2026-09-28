import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceDirectory = resolve(projectRoot, "node_modules/@ffmpeg/core/dist/esm");
const targetDirectory = resolve(projectRoot, "public/ffmpeg");

await mkdir(targetDirectory, { recursive: true });
await Promise.all(
  ["ffmpeg-core.js", "ffmpeg-core.wasm"].map((fileName) =>
    copyFile(resolve(sourceDirectory, fileName), resolve(targetDirectory, fileName)),
  ),
);
