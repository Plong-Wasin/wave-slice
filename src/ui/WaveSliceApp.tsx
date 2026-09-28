import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import JSZip from "jszip";
import {
  formatBytes,
  formatDuration,
  makeChunkFileName,
  makeOutputBaseName,
  planChunks,
  type PlannedChunk,
} from "../domain/chunks";
import {
  createAudioEngine,
  loadAudioEngine,
  makeTranscodeArguments,
  writeAudioSource,
  type AudioEngine,
} from "../audio/ffmpeg";

type ChunkState = "pending" | "processing" | "complete" | "failed";
type ChunkResult = { state: ChunkState; blob?: Blob; error?: string };
type MetadataState = "empty" | "reading" | "ready" | "error";

const SUPPORTED_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "webm"]);
const MEMORY_ERROR = "Your browser ran low on memory. Try a shorter chunk length or a smaller source file.";

function isMemoryFailure(error: unknown): boolean {
  return error instanceof Error && /memory|allocation|out of bounds/i.test(error.message);
}

function fileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const timeout = window.setTimeout(() => finish(new Error("Reading this file's duration took too long.")), 30_000);
    let settled = false;

    function finish(error?: Error, duration?: number) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve(duration!);
    }

    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) finish(undefined, audio.duration);
      else finish(new Error("The browser could not read a valid audio duration."));
    };
    audio.onerror = () => finish(new Error("This file could not be opened as audio in this browser."));
    audio.src = url;
  });
}

async function inspectDurationLocally(
  file: File,
  existingEngine: AudioEngine | null,
  onEngine: (engine: AudioEngine | null) => void,
): Promise<number> {
  try {
    return await readAudioDuration(file);
  } catch {
    let engine = existingEngine;
    if (!engine?.ready) {
      engine = await createAudioEngine();
      onEngine(engine);
      try {
        await loadAudioEngine(engine);
      } catch {
        engine.ffmpeg.terminate();
        onEngine(null);
        throw new Error("This file could not be read as audio. Try another file.");
      }
    }
    const outputPath = "source-duration.txt";
    try {
      await writeAudioSource(engine, file, fileExtension(file.name));
      const code = await engine.ffmpeg.ffprobe([
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        engine.sourcePath,
        "-o", outputPath,
      ]);
      if (code !== 0) throw new Error("Could not inspect audio duration.");
      const value = await engine.ffmpeg.readFile(outputPath, "utf8");
      const duration = Number(value);
      if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not inspect audio duration.");
      return duration;
    } catch {
      if (engine.ffmpeg.loaded && engine.sourceReady) {
        await engine.ffmpeg.deleteFile(engine.sourcePath).catch(() => undefined);
        engine.sourceReady = false;
      }
      throw new Error("This file could not be read as audio. Try another file.");
    } finally {
      if (engine.ffmpeg.loaded) await engine.ffmpeg.deleteFile(outputPath).catch(() => undefined);
    }
  }
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "upload":
      return <svg {...common}><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" /></svg>;
    case "audio":
      return <svg {...common}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>;
    case "lock":
      return <svg {...common}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /><path d="m9.5 15 1.7 1.7 3.5-3.7" /></svg>;
    case "download":
      return <svg {...common}><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M5 16v4h14v-4" /></svg>;
    case "zip":
      return <svg {...common}><path d="M5 3h10l4 4v14H5z" /><path d="M14 3v5h5M10 8h3m-3 3h3m-3 3h3m-2 0v4" /></svg>;
    case "play":
      return <svg {...common}><path d="m8 5 11 7-11 7z" /></svg>;
    case "check":
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
    case "alert":
      return <svg {...common}><path d="M12 9v4m0 4h.01" /><path d="M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3l-7.6-13.1a2 2 0 0 0-3.4 0Z" /></svg>;
    case "close":
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case "spark":
      return <svg {...common}><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="9" /></svg>;
  }
}

function Waveform({ subdued = false }: { subdued?: boolean }) {
  return (
    <div className={`waveform${subdued ? " waveform--subdued" : ""}`} aria-hidden="true">
      {Array.from({ length: 40 }, (_, index) => {
        const height = 13 + ((index * 37 + 11) % 39);
        return <i key={index} style={{ height: `${height}%` }} />;
      })}
    </div>
  );
}

function ChunkCard({
  chunk,
  state,
  onRetry,
}: {
  chunk: PlannedChunk & { fileName: string };
  state: ChunkResult;
  onRetry: () => void;
}) {
  const [audioURL, setAudioURL] = useState<string | null>(null);
  useEffect(() => {
    if (!state.blob) {
      setAudioURL(null);
      return;
    }
    const url = URL.createObjectURL(state.blob);
    setAudioURL(url);
    return () => URL.revokeObjectURL(url);
  }, [state.blob]);

  function downloadChunk() {
    if (!state.blob) return;
    const url = URL.createObjectURL(state.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = chunk.fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  const stateLabel = {
    pending: "Ready to split",
    processing: "Creating chunk",
    complete: "Ready",
    failed: "Needs retry",
  }[state.state];

  return (
    <article className={`chunk-card chunk-card--${state.state}`}>
      <div className="chunk-card__number">{String(chunk.index).padStart(2, "0")}</div>
      <div className="chunk-card__main">
        <div className="chunk-card__heading">
          <div>
            <div className="chunk-card__title">Chunk {chunk.index}</div>
            <div className="chunk-card__time">
              {formatDuration(chunk.startSeconds)} <span>→</span> {formatDuration(chunk.endSeconds)}
            </div>
          </div>
          <span className={`state-pill state-pill--${state.state}`}>
            {state.state === "complete" && <Icon name="check" size={14} />}
            {state.state === "processing" && <i className="mini-spinner" />}
            {stateLabel}
          </span>
        </div>
        <Waveform subdued={state.state !== "complete"} />
        {state.blob && audioURL && (
          <div className="chunk-card__player">
            <audio controls preload="none" src={audioURL} aria-label={`Preview chunk ${chunk.index}`} />
          </div>
        )}
        {state.error && <p className="chunk-card__error">{state.error}</p>}
        <div className="chunk-card__footer">
          <span className="chunk-card__filename" title={chunk.fileName}>{chunk.fileName}</span>
          <div className="chunk-card__actions">
            {state.state === "failed" && <button className="text-button" onClick={onRetry}>Retry</button>}
            {state.blob && (
              <button className="download-button" onClick={downloadChunk}>
                <Icon name="download" size={16} /> Download
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function WaveSliceApp() {
  const [source, setSource] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [metadataState, setMetadataState] = useState<MetadataState>("empty");
  const [metadataError, setMetadataError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [chunkMinutes, setChunkMinutes] = useState(59);
  const [overlapMinutes, setOverlapMinutes] = useState(1);
  const [settingsError, setSettingsError] = useState("");
  const [results, setResults] = useState<Record<number, ChunkResult>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentChunkIndex, setCurrentChunkIndex] = useState<number | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [retryStart, setRetryStart] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  const [zipError, setZipError] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const engineRef = useRef<AudioEngine | null>(null);
  const runningRef = useRef(false);
  const cancelRef = useRef(false);
  const metadataRequestRef = useRef(0);
  const metadataPendingRef = useRef(false);

  useEffect(() => () => {
    const engine = engineRef.current;
    if (engine) {
      engine.ffmpeg.terminate();
      engineRef.current = null;
    }
  }, []);

  const plannedChunks = useMemo(() => {
    if (!duration || chunkMinutes < 1 || overlapMinutes < 0 || overlapMinutes >= chunkMinutes) return [];
    try {
      return planChunks(duration, chunkMinutes, overlapMinutes);
    } catch {
      return [];
    }
  }, [duration, chunkMinutes, overlapMinutes]);

  const completedCount = Object.values(results).filter((result) => result.state === "complete" && result.blob).length;
  const allComplete = plannedChunks.length > 0 && completedCount === plannedChunks.length;
  const invalidSettings = chunkMinutes < 1 || overlapMinutes < 0 || overlapMinutes >= chunkMinutes;
  const largeFile = Boolean(source && (source.size > 500 * 1024 * 1024 || (duration && duration > 6 * 60 * 60)));
  const outputBaseName = source ? makeOutputBaseName(source.name) : "audio";

  function resetResultsIfNeeded(): boolean {
    const hasChunks = Object.values(results).some((result) => result.blob);
    if (hasChunks && !window.confirm("Changing this will remove the chunks already created. Continue?")) return false;
    if (Object.keys(results).length > 0) {
      setResults({});
      setNotice("");
    }
    return true;
  }

  function clearEngineSource() {
    const engine = engineRef.current;
    if (engine?.ready && engine.sourceReady) {
      void engine.ffmpeg.deleteFile(engine.sourcePath).catch(() => undefined);
      engine.sourceReady = false;
    }
  }

  async function chooseSource(file?: File) {
    if (!file) return;
    if (runningRef.current) {
      setSelectionError("Cancel the active split before choosing another audio file.");
      return;
    }
    if (isZipping) {
      setSelectionError("Wait for ZIP creation to finish before changing the audio file.");
      return;
    }
    if (metadataState === "reading" || metadataPendingRef.current) {
      setSelectionError("Wait for the current file inspection to finish before choosing another audio file.");
      return;
    }
    if (!SUPPORTED_EXTENSIONS.has(fileExtension(file.name))) {
      setSelectionError("Choose an MP3, WAV, M4A, AAC, OGG, or WebM audio file.");
      return;
    }
    if (source && source.name === file.name && source.size === file.size && source.lastModified === file.lastModified) {
      setSelectionError("");
      return;
    }
    if (!resetResultsIfNeeded()) return;

    setSelectionError("");
    clearEngineSource();
    setSource(file);
    setDuration(null);
    setMetadataError("");
    setMetadataState("reading");
    metadataPendingRef.current = true;
    setSettingsError("");
    setResults({});
    setNotice("");
    setZipError("");
    setRetryStart(false);
    const request = ++metadataRequestRef.current;

    try {
      const audioDuration = await inspectDurationLocally(file, engineRef.current, (engine) => { engineRef.current = engine; });
      if (request !== metadataRequestRef.current) return;
      setDuration(audioDuration);
      setMetadataState("ready");
      metadataPendingRef.current = false;
      setSelectionError("");
      setNotice("");
    } catch (error) {
      if (request !== metadataRequestRef.current) return;
      setMetadataState("error");
      metadataPendingRef.current = false;
      setMetadataError(error instanceof Error ? error.message : "This file could not be read as audio. Try another file.");
      setSelectionError("");
      setNotice("");
    }
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    void chooseSource(file);
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
    void chooseSource(event.dataTransfer.files[0]);
  }

  function changeChunkMinutes(value: number) {
    if (!Number.isInteger(value) || value < 1) {
      setSettingsError("Chunk length must be at least 1 whole minute.");
      return;
    }
    if (!resetResultsIfNeeded()) return;
    setChunkMinutes(value);
    setSettingsError("");
    setNotice("");
    setZipError("");
    setRetryStart(false);
  }

  function changeOverlapMinutes(value: number) {
    if (!Number.isInteger(value) || value < 0 || value >= chunkMinutes) {
      setSettingsError("Overlap must be a whole number from 0 up to (but not including) the chunk length.");
      return;
    }
    if (!resetResultsIfNeeded()) return;
    setOverlapMinutes(value);
    setSettingsError("");
    setNotice("");
    setZipError("");
    setRetryStart(false);
  }

  async function startSplit(startAt = 1) {
    if (!source || !duration || !plannedChunks.length || invalidSettings || runningRef.current) return;
    runningRef.current = true;
    cancelRef.current = false;
    setCancelPending(false);
    setIsProcessing(true);
    setRetryStart(false);
    setNotice("");
    setProgressMessage("Preparing your audio…");
    setZipError("");

    try {
      let engine = engineRef.current;
      if (!engine?.ready) {
        setProgressMessage("Loading audio processor…");
        setNotice("Loading FFmpeg in your browser. This may take a moment on first use.");
        engine = await createAudioEngine();
        engineRef.current = engine;
        if (cancelRef.current) {
          engine.ffmpeg.terminate();
          engineRef.current = null;
          return;
        }
        await loadAudioEngine(engine);
        if (cancelRef.current) return;
      }

      setNotice("");
      setProgressMessage("Preparing the source audio…");
      await writeAudioSource(engine, source, fileExtension(source.name));
      if (cancelRef.current) return;

      const completedIndexes = new Set(
        Object.entries(results)
          .filter(([, result]) => result.state === "complete" && result.blob)
          .map(([index]) => Number(index)),
      );
      let runFailed = false;
      const toProcess = plannedChunks.filter((chunk) => chunk.index >= startAt);
      for (const chunk of toProcess) {
        if (cancelRef.current) break;
        if (completedIndexes.has(chunk.index)) continue;
        const outputPath = `output-${chunk.index}.mp3`;
        setCurrentChunkIndex(chunk.index);
        setProgressMessage(`Creating chunk ${chunk.index} of ${plannedChunks.length}…`);
        setResults((previous) => ({ ...previous, [chunk.index]: { state: "processing" } }));

        try {
          const code = await engine.ffmpeg.exec(
            makeTranscodeArguments(engine.sourcePath, outputPath, chunk.startSeconds, chunk.endSeconds - chunk.startSeconds),
          );
          if (cancelRef.current) break;
          if (code !== 0) throw new Error("Audio conversion returned an error.");
          const fileData = await engine.ffmpeg.readFile(outputPath);
          if (typeof fileData === "string") throw new Error("Audio conversion returned an invalid output.");
          const audioData = new Uint8Array(fileData.byteLength);
          audioData.set(fileData);
          const blob = new Blob([audioData.buffer], { type: "audio/mpeg" });
          setResults((previous) => ({ ...previous, [chunk.index]: { state: "complete", blob } }));
          completedIndexes.add(chunk.index);
        } catch (error) {
          if (cancelRef.current) break;
          const reason = isMemoryFailure(error)
            ? MEMORY_ERROR
            : "This chunk could not be created. Check that the file plays correctly, then retry.";
          setResults((previous) => ({ ...previous, [chunk.index]: { state: "failed", error: reason } }));
          setNotice(`Chunk ${chunk.index} could not be created. Completed chunks are still available.`);
          runFailed = true;
          break;
        } finally {
          if (engine.ffmpeg.loaded) await engine.ffmpeg.deleteFile(outputPath).catch(() => undefined);
        }
      }

      if (!cancelRef.current) {
        if (!runFailed && plannedChunks.every((chunk) => completedIndexes.has(chunk.index))) {
          await engine.ffmpeg.deleteFile(engine.sourcePath).catch(() => undefined);
          engine.sourceReady = false;
          engine.ffmpeg.terminate();
          engineRef.current = null;
          setNotice("All chunks are ready to preview or download.");
        } else if (!runFailed) {
          setNotice("Split run finished. Retry any chunk that needs attention.");
        }
      }
    } catch (error) {
      if (!cancelRef.current) {
        setRetryStart(true);
        setNotice(isMemoryFailure(error)
          ? MEMORY_ERROR
          : "The audio processor could not start. Reload the page or try again.");
        const engine = engineRef.current;
        if (engine && !engine.ready) {
          engine.ffmpeg.terminate();
          engineRef.current = null;
        }
      }
    } finally {
      setIsProcessing(false);
      setCancelPending(false);
      setCurrentChunkIndex(null);
      runningRef.current = false;
      if (cancelRef.current) {
        setProgressMessage("Split canceled. Chunks already created are kept.");
        setNotice("Split canceled. Chunks already created are kept.");
      } else {
        setProgressMessage("");
      }
      cancelRef.current = false;
    }
  }

  function cancelSplit() {
    if (!runningRef.current || cancelRef.current) return;
    cancelRef.current = true;
    setCancelPending(true);
    setProgressMessage("Stopping audio processing…");
    const engine = engineRef.current;
    if (engine) {
      engine.ffmpeg.terminate();
      engineRef.current = null;
    }
    setResults((previous) => {
      const next = { ...previous };
      for (const [index, result] of Object.entries(next)) {
        if (result.state === "processing") next[Number(index)] = { state: "pending" };
      }
      return next;
    });
  }

  async function downloadAllZip() {
    if (!allComplete || isZipping) return;
    setIsZipping(true);
    setZipProgress(0);
    setZipError("");
    try {
      const zip = new JSZip();
      for (const chunk of plannedChunks) {
        const result = results[chunk.index];
        if (!result?.blob) throw new Error("A completed chunk is missing.");
        zip.file(makeChunkFileName(outputBaseName, chunk), result.blob);
      }
      const archive = await zip.generateAsync(
        { type: "blob", compression: "STORE" },
        (metadata) => setZipProgress(Math.floor(metadata.percent)),
      );
      const url = URL.createObjectURL(archive);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${outputBaseName}_chunks.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
      setZipProgress(100);
    } catch {
      setZipError("The ZIP could not be created. Your individual chunks are still available to download.");
    } finally {
      setIsZipping(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="WaveSlice home">
          <span className="brand__mark"><i /><i /><i /><i /><i /></span>
          <span className="brand__word">wave<span>slice</span></span>
        </a>
        <div className="topbar__right">
          <span className="local-badge"><span /> 100% LOCAL</span>
          <a className="topbar__link" href="#how-it-works">How it works</a>
        </div>
      </header>

      <main id="top" className="page-content">
        <section className="hero">
          <div className="eyebrow"><span className="eyebrow__line" /> LONG RECORDING, CLEAR CUTS</div>
          <h1>Big audio.<br /><span>Small, useful pieces.</span></h1>
          <p className="hero__description">Split long recordings into easy-to-handle chunks. Your audio stays right here on your device.</p>
          <div className="hero__wave"><Waveform /></div>
        </section>

        <section className={`workspace${isDragging ? " workspace--dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false); }} onDrop={onDrop}>
          <div className="workspace__topline">
            <div className="step-label"><span>01</span> ADD YOUR AUDIO</div>
            <span className="privacy-note"><Icon name="lock" size={16} /> Nothing is uploaded</span>
          </div>

          {!source ? (
            <div className="dropzone">
              <div className="dropzone__icon"><Icon name="upload" size={25} /></div>
              <div className="dropzone__copy">
                <h2>Drop an audio file here</h2>
                <p>or choose one from your device</p>
              </div>
              <label className="button button--dark choose-button">
                Choose file <span className="button__arrow">↗</span>
                <input ref={inputRef} aria-label="Choose File" type="file" accept=".mp3,.wav,.m4a,.aac,.ogg,.webm,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/webm" onChange={onInputChange} />
              </label>
              <p className="dropzone__formats">MP3, WAV, M4A, AAC, OGG, WEBM <span>·</span> processed in your browser</p>
            </div>
          ) : (
            <div className="source-card">
              <div className="source-card__icon"><Icon name="audio" size={23} /></div>
              <div className="source-card__details">
                <strong title={source.name}>{source.name}</strong>
                <div className="source-card__meta">
                  <span>{metadataState === "ready" ? `Duration: ${formatDuration(duration ?? 0)}` : metadataState === "reading" ? "Reading duration…" : "Duration unavailable"}</span>
                  <i />
                  <span>Size: {formatBytes(source.size)}</span>
                </div>
                {metadataState === "error" && <p className="inline-error"><Icon name="alert" size={15} /> {metadataError}</p>}
              </div>
              <button className="icon-button" disabled={isProcessing || isZipping || metadataPendingRef.current} aria-label="Remove audio file" title="Remove file" onClick={() => {
                if (isProcessing || isZipping || metadataPendingRef.current) return;
                if (Object.values(results).some((result) => result.blob) && !window.confirm("Remove this audio file and all completed chunks?")) return;
                clearEngineSource();
                engineRef.current?.ffmpeg.terminate();
                engineRef.current = null;
                setSource(null); setDuration(null); setMetadataState("empty"); setResults({}); setMetadataError(""); setSelectionError(""); setSettingsError(""); setNotice(""); setZipError(""); setRetryStart(false);
              }}>
                <Icon name="close" size={19} />
              </button>
            </div>
          )}
          {selectionError && <p className="upload-error"><Icon name="alert" size={16} /> {selectionError}</p>}
          {largeFile && <div className="large-warning"><Icon name="alert" size={16} /><span>This is a large file. Processing may use substantial browser memory. You can continue, but smaller files may work better on this device.</span></div>}
          {metadataState === "ready" && <p className="privacy-copy">Your audio is processed locally in your browser. Files are never uploaded to our server.</p>}
        </section>

        {source && metadataState === "ready" && (
          <section className="settings-section">
            <div className="workspace__topline">
              <div className="step-label"><span>02</span> SET YOUR CUT</div>
              <span className="settings-caption">Change these any time before processing</span>
            </div>
            <div className="settings-card">
              <div className="setting-field">
                <label htmlFor="chunk-length">Chunk length</label>
                <div className="number-input"><input id="chunk-length" type="number" min="1" step="1" value={chunkMinutes} disabled={isProcessing || isZipping} onChange={(event) => changeChunkMinutes(Number(event.target.value))} /><span>minutes</span></div>
              </div>
              <div className="setting-divider"><span>−</span></div>
              <div className="setting-field">
                <label htmlFor="overlap">Overlap</label>
                <div className="number-input"><input id="overlap" type="number" min="0" max={Math.max(0, chunkMinutes - 1)} step="1" value={overlapMinutes} disabled={isProcessing || isZipping} onChange={(event) => changeOverlapMinutes(Number(event.target.value))} /><span>minutes</span></div>
              </div>
              <div className="setting-step"><span>STEP BETWEEN STARTS</span><strong>{Math.max(0, chunkMinutes - overlapMinutes)} min</strong></div>
              <div className="settings-summary"><span>{plannedChunks.length} {plannedChunks.length === 1 ? "chunk" : "chunks"}</span><i /> final chunk may be shorter</div>
            </div>
            {(invalidSettings || settingsError) && <p className="inline-error settings-error"><Icon name="alert" size={15} /> {settingsError || "Overlap must be less than chunk length, and chunk length must be at least 1 minute."}</p>}
          </section>
        )}

        {source && metadataState === "ready" && (
          <section className="results-section">
            <div className="results-heading">
              <div>
                <div className="step-label"><span>03</span> YOUR CHUNKS</div>
                <h2>{allComplete ? "Ready when you are." : "A clean cut, every time."}</h2>
              </div>
              <div className="results-heading__actions">
                {allComplete && <button className="button button--outline zip-button" onClick={() => void downloadAllZip()} disabled={isZipping || isProcessing}>
                  <Icon name="zip" size={18} /> {isZipping ? `Building ZIP ${zipProgress}%` : "Download all ZIP"}
                </button>}
                {!allComplete && (
                  <button className="button button--accent split-button" onClick={() => void startSplit()} disabled={isProcessing || isZipping || invalidSettings || Boolean(settingsError) || metadataState !== "ready"}>
                    {isProcessing ? <><i className="button-spinner" /> Processing…</> : retryStart ? "Try again" : completedCount ? "Resume split" : "Split audio"}
                    {!isProcessing && <span className="button__arrow">↗</span>}
                  </button>
                )}
              </div>
            </div>

            {plannedChunks.length > 1 && <div className="chunk-rule"><span><Icon name="spark" size={15} /> {chunkMinutes} min length</span><i /><span>{overlapMinutes} min overlap</span><i /><span>{plannedChunks.length} outputs</span></div>}

            {isProcessing && (
              <div className="processing-panel" role="status" aria-live="polite">
                <div className="processing-panel__top"><span><i className="mini-spinner" /> {progressMessage || "Processing audio…"}</span><strong>Chunk {currentChunkIndex ?? "—"} / {plannedChunks.length}</strong></div>
                <div className="progress-track progress-track--active"><div className="progress-track__fill" style={{ width: `${Math.max(4, Math.round(completedCount / Math.max(1, plannedChunks.length) * 100))}%` }} /></div>
                <div className="processing-panel__bottom"><span>{completedCount} of {plannedChunks.length} chunks complete</span><button className="cancel-button" disabled={cancelPending} onClick={cancelSplit}>{cancelPending ? "Stopping…" : "Cancel"}</button></div>
              </div>
            )}

            {notice && !isProcessing && <div className={`notice${notice.includes("could not") || notice.includes("ran low") ? " notice--warning" : ""}`} role="status"><span>{notice.includes("could not") || notice.includes("ran low") ? <Icon name="alert" size={17} /> : <Icon name="check" size={17} />}</span>{notice}</div>}

            <div className="chunk-list">
              {plannedChunks.map((chunk) => (
                <ChunkCard
                  key={`${chunk.index}-${chunk.startSeconds}`}
                  chunk={{ ...chunk, fileName: makeChunkFileName(outputBaseName, chunk) }}
                  state={results[chunk.index] ?? { state: "pending" }}
                  onRetry={() => void startSplit(chunk.index)}
                />
              ))}
            </div>

            {zipError && <p className="inline-error zip-error"><Icon name="alert" size={15} /> {zipError}</p>}
            {isZipping && <div className="zip-progress"><span>Building your ZIP in this browser</span><div className="progress-track"><div className="progress-track__fill" style={{ width: `${zipProgress}%` }} /></div></div>}
          </section>
        )}

        <section id="how-it-works" className="privacy-card">
          <div className="privacy-card__icon"><Icon name="lock" size={21} /></div>
          <div><strong>Your recordings stay yours.</strong><p>WaveSlice runs in your browser. Your source audio and new chunks are never sent to a server.</p></div>
          <div className="privacy-card__stamp"><span>PRIVATE BY</span><b>design</b></div>
        </section>

        <footer className="footer"><span>WAVESLICE <i>·</i> MADE FOR LONG-FORM AUDIO</span><span>Nothing leaves this browser.</span></footer>
      </main>
    </div>
  );
}
