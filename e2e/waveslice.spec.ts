import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

function silentWav(durationSeconds: number): Buffer {
  const sampleRate = 8_000;
  const channels = 1;
  const bitsPerSample = 16;
  const dataLength = durationSeconds * sampleRate * channels * (bitsPerSample / 8);
  const bytes = Buffer.alloc(44 + dataLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * (bitsPerSample / 8), true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeText(36, "data");
  view.setUint32(40, dataLength, true);
  return bytes;
}

function findMpegFrame(data: Uint8Array): number {
  for (let index = 0; index < Math.min(data.length - 3, 16_384); index += 1) {
    if (data[index] === 0xff && (data[index + 1] & 0xe0) === 0xe0) return index;
  }
  return -1;
}

test("a user splits local audio, previews and downloads chunks, and gets a ZIP without uploading the source", async ({ page }) => {
  const requests: { method: string; url: string }[] = [];
  page.context().on("request", (request) => {
    requests.push({ method: request.method(), url: request.url() });
  });

  await page.goto("/");
  await page.getByLabel("Choose File").setInputFiles({
    name: "meeting.wav",
    mimeType: "audio/wav",
    buffer: silentWav(150),
  });

  await expect(page.getByText("meeting.wav", { exact: true })).toBeVisible();
  await expect(page.getByText("Duration: 00:02:30", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Size:/)).toBeVisible();
  await expect(
    page.getByText("Your audio is processed locally in your browser. Files are never uploaded to our server.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(requests.some(({ url }) => new URL(url).pathname.endsWith("/ffmpeg/manifest.json"))).toBe(false);

  await page.getByLabel("Chunk length").fill("2");
  await page.getByRole("button", { name: "Split audio" }).click();

  await expect(page.getByText("All chunks are ready to preview or download.")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("00:00:00 → 00:02:00", { exact: true })).toBeVisible();
  await expect(page.getByText("00:01:00 → 00:02:30", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Preview chunk 1")).toBeVisible();

  const chunkDownloads = page.getByRole("button", { name: "Download", exact: true });
  await expect(chunkDownloads).toHaveCount(2);
  for (const [index, fileName] of [
    "meeting_001_000000-000200.mp3",
    "meeting_002_000100-000230.mp3",
  ].entries()) {
    const download = page.waitForEvent("download");
    await chunkDownloads.nth(index).click();
    expect((await download).suggestedFilename()).toBe(fileName);
  }

  const zipDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download all ZIP" }).click();
  const archiveDownload = await zipDownload;
  expect(archiveDownload.suggestedFilename()).toBe("meeting_chunks.zip");
  const archivePath = await archiveDownload.path();
  expect(archivePath).not.toBeNull();
  const archive = await JSZip.loadAsync(await readFile(archivePath!));
  const expectedFiles = [
    "meeting_001_000000-000200.mp3",
    "meeting_002_000100-000230.mp3",
  ];
  expect(Object.keys(archive.files).filter((name) => !archive.files[name].dir)).toEqual(expectedFiles);

  for (const fileName of expectedFiles) {
    const entry = archive.file(fileName);
    expect(entry).not.toBeNull();
    const audio = await entry!.async("uint8array");
    const frame = findMpegFrame(audio);
    expect(frame).toBeGreaterThanOrEqual(0);
    expect((audio[frame + 1] >> 3) & 0b11).toBe(0b10); // MPEG-2
    expect((audio[frame + 1] >> 1) & 0b11).toBe(0b01); // Layer III
    expect((audio[frame + 2] >> 4) & 0b1111).toBe(8); // 64 kbps
    expect((audio[frame + 2] >> 2) & 0b11).toBe(2); // 16 kHz
    expect(audio[frame + 3] >> 6).toBe(3); // Mono
  }

  const appOrigin = new URL("http://127.0.0.1:4173").origin;
  expect(requests.filter(({ method }) => method !== "GET" && method !== "HEAD")).toEqual([]);
  expect(
    requests.filter(({ url }) => new URL(url).origin !== appOrigin),
  ).toEqual([]);
  expect(requests.some(({ url }) => new URL(url).pathname.endsWith("/ffmpeg/manifest.json"))).toBe(true);
});
