export interface PlannedChunk {
  index: number;
  startSeconds: number;
  endSeconds: number;
}

export function planChunks(
  sourceDurationSeconds: number,
  chunkMinutes: number,
  overlapMinutes: number,
): PlannedChunk[] {
  if (!Number.isFinite(sourceDurationSeconds) || sourceDurationSeconds <= 0) {
    throw new Error("Audio duration must be greater than zero.");
  }
  if (!Number.isInteger(chunkMinutes) || chunkMinutes < 1) {
    throw new Error("Chunk length must be at least 1 whole minute.");
  }
  if (!Number.isInteger(overlapMinutes) || overlapMinutes < 0 || overlapMinutes >= chunkMinutes) {
    throw new Error("Overlap must be a whole number from 0 up to (but not including) the chunk length.");
  }

  const chunkSeconds = chunkMinutes * 60;
  const stepSeconds = (chunkMinutes - overlapMinutes) * 60;
  const chunks: PlannedChunk[] = [];

  for (let startSeconds = 0; startSeconds < sourceDurationSeconds; startSeconds += stepSeconds) {
    chunks.push({
      index: chunks.length + 1,
      startSeconds,
      endSeconds: Math.min(startSeconds + chunkSeconds, sourceDurationSeconds),
    });
  }

  return chunks;
}

export function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainder = totalSeconds % 60;
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatTimestamp(seconds: number): string {
  return formatDuration(Math.round(seconds)).replaceAll(":", "");
}

export function makeOutputBaseName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const normalized = withoutExtension
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return normalized || "audio";
}

export function makeChunkFileName(baseName: string, chunk: PlannedChunk): string {
  const index = String(chunk.index).padStart(3, "0");
  return `${baseName}_${index}_${formatTimestamp(chunk.startSeconds)}-${formatTimestamp(chunk.endSeconds)}.mp3`;
}
