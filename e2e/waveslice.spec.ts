import { expect, test } from "@playwright/test";

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

test("a user splits local audio, previews and downloads chunks, and gets a ZIP without uploading the source", async ({ page }) => {
  const requests: { method: string; url: string }[] = [];
  page.on("request", (request) => {
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

  await page.getByLabel("Chunk length").fill("2");
  await page.getByRole("button", { name: "Split audio" }).click();

  await expect(page.getByText("All chunks are ready to preview or download.")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("00:00:00 → 00:02:00", { exact: true })).toBeVisible();
  await expect(page.getByText("00:01:00 → 00:02:30", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Preview chunk 1")).toBeVisible();

  const firstDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).first().click();
  expect((await firstDownload).suggestedFilename()).toBe("meeting_001_000000-000200.mp3");

  const zipDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download all ZIP" }).click();
  expect((await zipDownload).suggestedFilename()).toBe("meeting_chunks.zip");

  const appOrigin = new URL("http://127.0.0.1:4173").origin;
  expect(requests.filter(({ method }) => method !== "GET" && method !== "HEAD")).toEqual([]);
  expect(
    requests.filter(({ url }) => new URL(url).origin !== appOrigin),
  ).toEqual([]);
});
