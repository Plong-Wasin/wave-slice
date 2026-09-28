import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceDirectory = resolve(projectRoot, "node_modules/@ffmpeg/core/dist/esm");
const targetDirectory = resolve(projectRoot, "public/ffmpeg");
const packageDirectory = resolve(projectRoot, "node_modules/@ffmpeg/core");
const { version } = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8"));
const versionDirectory = resolve(targetDirectory, version);

await rm(targetDirectory, { recursive: true, force: true });
await mkdir(versionDirectory, { recursive: true });
await Promise.all(
  ["ffmpeg-core.js", "ffmpeg-core.wasm"].map((fileName) =>
    copyFile(resolve(sourceDirectory, fileName), resolve(versionDirectory, fileName)),
  ),
);
await writeFile(
  resolve(targetDirectory, "manifest.json"),
  JSON.stringify({ coreURL: `${version}/ffmpeg-core.js`, wasmURL: `${version}/ffmpeg-core.wasm` }),
);
