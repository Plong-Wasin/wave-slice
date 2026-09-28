import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

export interface AudioEngine {
  ffmpeg: FFmpeg;
  sourcePath: string;
  sourceReady: boolean;
  ready: boolean;
}

export async function createAudioEngine(): Promise<AudioEngine> {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const ffmpeg = new FFmpeg();
  return { ffmpeg, sourcePath: "source", sourceReady: false, ready: false };
}

export async function loadAudioEngine(engine: AudioEngine): Promise<void> {
  const manifestURL = new URL("./ffmpeg/manifest.json", document.baseURI);
  const response = await fetch(manifestURL, { cache: "no-cache" });
  if (!response.ok) throw new Error("The audio processor assets could not be found.");
  const manifest: unknown = await response.json();
  if (
    typeof manifest !== "object" || manifest === null ||
    !("coreURL" in manifest) || typeof manifest.coreURL !== "string" ||
    !("wasmURL" in manifest) || typeof manifest.wasmURL !== "string"
  ) {
    throw new Error("The audio processor manifest is invalid.");
  }
  const coreURL = new URL(manifest.coreURL, manifestURL);
  const wasmURL = new URL(manifest.wasmURL, manifestURL);
  if (coreURL.origin !== manifestURL.origin || wasmURL.origin !== manifestURL.origin) {
    throw new Error("The audio processor must be loaded from this site.");
  }
  await engine.ffmpeg.load({ coreURL: coreURL.href, wasmURL: wasmURL.href });
  engine.ready = true;
}

export async function writeAudioSource(engine: AudioEngine, source: File, extension: string): Promise<void> {
  if (engine.sourceReady) return;
  engine.sourcePath = `source.${extension}`;
  try {
    await engine.ffmpeg.writeFile(engine.sourcePath, await fetchFile(source));
    engine.sourceReady = true;
  } catch (error) {
    if (engine.ffmpeg.loaded) await engine.ffmpeg.deleteFile(engine.sourcePath).catch(() => undefined);
    throw error;
  }
}

export function makeTranscodeArguments(
  sourcePath: string,
  outputPath: string,
  startSeconds: number,
  durationSeconds: number,
): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    String(startSeconds),
    "-i",
    sourcePath,
    "-t",
    String(durationSeconds),
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    "-codec:a",
    "libmp3lame",
    "-y",
    outputPath,
  ];
}
