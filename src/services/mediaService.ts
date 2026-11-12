export interface CompressedMediaResult {
  dataUrl: string;
  mimeType: string;
  approxBytes: number;
  synthetic: boolean;
}

const MAX_IMAGE_DATA_URL_LENGTH = 60_000; // <= 60 KB Base64-String
const MAX_AUDIO_DATA_URL_LENGTH = 25_000; // <= 25 KB Base64-String

const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/webm',
  'audio/aac',
] as const;

/**
 * Ermittelt das erste vom aktuellen Mobil-Browser unterstützte Audio-Aufnahmeformat
 * (kompatibel mit Android Chrome sowie iOS Safari).
 */
export function detectSupportedAudioMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') {
    return null;
  }
  for (const mime of AUDIO_MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    } catch {
      // Nächsten Kandidaten prüfen
    }
  }
  return '';
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Bilddatei konnte nicht geladen werden.'));
    };
    img.src = objectUrl;
  });
}

/**
 * Skaliert ein Foto über HTML5 Canvas auf maximal 400 px längste Kante,
 * entfernt dadurch garantiert sämtliche EXIF-/GPS-Metadaten und reduziert
 * die JPEG-Qualität iterativ ab 0.5, bis die Data-URL <= 60 KB groß ist.
 */
export async function compressImageFileForClue(
  file: File
): Promise<CompressedMediaResult> {
  const img = await loadImageFromFile(file);
  let maxEdge = 400;

  while (maxEdge >= 160) {
    const ratio = Math.min(1, maxEdge / Math.max(img.width || 1, img.height || 1));
    const width = Math.max(1, Math.round(img.width * ratio));
    const height = Math.max(1, Math.round(img.height * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas-2D-Kontext ist auf diesem Gerät nicht verfügbar.');
    }
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const qualities = [0.5, 0.42, 0.34, 0.26, 0.18, 0.12];
    for (const q of qualities) {
      const dataUrl = canvas.toDataURL('image/jpeg', q);
      if (dataUrl.length <= MAX_IMAGE_DATA_URL_LENGTH) {
        return {
          dataUrl,
          mimeType: 'image/jpeg',
          approxBytes: dataUrl.length,
          synthetic: false,
        };
      }
    }

    maxEdge -= 80;
  }

  throw new Error(
    'Das Foto konnte nicht unter das 60-KB-Limit komprimiert werden. Bitte erneut aufnehmen.'
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Konvertierung in Base64 fehlgeschlagen.'));
      }
    };
    reader.onerror = () => reject(new Error('Lesefehler beim Audio-Export.'));
    reader.readAsDataURL(blob);
  });
}

export interface ActiveAudioRecordingHandle {
  stopEarly: () => void;
  resultPromise: Promise<CompressedMediaResult>;
}

/**
 * Nimmt maximal 10 Sekunden Umgebungsgeräusche mit niedriger Ziel-Bitrate (12 kbps) auf
 * und beendet Stream sowie Mikrofon-Berechtigung danach garantiert sauber.
 */
export async function startTenSecondAudioCapture(
  onSecondsElapsed?: (seconds: number) => void
): Promise<ActiveAudioRecordingHandle> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === 'undefined'
  ) {
    throw new Error(
      'Mikrofon-Aufnahme wird von diesem Browser nicht unterstützt.'
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      channelCount: 1,
    },
  });

  const supportedMime = detectSupportedAudioMimeType();
  const recorderOptions: MediaRecorderOptions = {
    audioBitsPerSecond: 12_000,
  };
  if (supportedMime) {
    recorderOptions.mimeType = supportedMime;
  }

  const recorder = new MediaRecorder(stream, recorderOptions);
  const chunks: BlobPart[] = [];
  let elapsed = 0;

  const timer = setInterval(() => {
    elapsed += 1;
    onSecondsElapsed?.(Math.min(10, elapsed));
  }, 1000);

  const cleanupTracks = () => {
    clearInterval(timer);
    for (const track of stream.getTracks()) {
      track.stop();
    }
  };

  const resultPromise = new Promise<CompressedMediaResult>((resolve, reject) => {
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        chunks.push(ev.data);
      }
    };

    recorder.onerror = () => {
      cleanupTracks();
      reject(new Error('Fehler während der Mikrofon-Aufnahme.'));
    };

    recorder.onstop = async () => {
      cleanupTracks();
      try {
        const finalMime = recorder.mimeType || supportedMime || 'audio/webm';
        const blob = new Blob(chunks, { type: finalMime });
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl.length > MAX_AUDIO_DATA_URL_LENGTH) {
          // Falls der Browser die Ziel-Bitrate ignoriert hat, kürzen wir auf sichere Chunk-Präfixe
          // oder liefern eine klare Fehlermeldung für kürzeren Clip:
          if (chunks.length > 1) {
            const halfBlob = new Blob(
              chunks.slice(0, Math.max(1, Math.floor(chunks.length / 2))),
              { type: finalMime }
            );
            const shorterUrl = await blobToDataUrl(halfBlob);
            if (shorterUrl.length <= MAX_AUDIO_DATA_URL_LENGTH) {
              resolve({
                dataUrl: shorterUrl,
                mimeType: finalMime,
                approxBytes: shorterUrl.length,
                synthetic: false,
              });
              return;
            }
          }
          reject(
            new Error(
              'Audioaufnahme überschreitet 25 KB (Geräte-Bitrate zu hoch). Bitte kürzer aufnehmen oder Demo-Audio senden.'
            )
          );
          return;
        }

        resolve({
          dataUrl,
          mimeType: finalMime,
          approxBytes: dataUrl.length,
          synthetic: false,
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Audio-Verarbeitung fehlgeschlagen.'));
      }
    };
  });

  recorder.start(1000);
  const autoStopTimeout = setTimeout(() => {
    if (recorder.state === 'recording') {
      recorder.stop();
    }
  }, 10_000);

  return {
    stopEarly: () => {
      clearTimeout(autoStopTimeout);
      if (recorder.state === 'recording') {
        recorder.stop();
      }
    },
    resultPromise,
  };
}

/**
 * Erzeugt ein klar gekennzeichnetes synthetisches Demo-Foto (Himmel/Blätterdach oder Bodenstruktur)
 * unterhalb von 35 KB für Geräte ohne Kamera oder den lokalen Demo-Modus.
 */
export function createSyntheticDemoPhoto(
  kind: 'SKY' | 'GROUND'
): CompressedMediaResult {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas nicht verfügbar.');
  }

  if (kind === 'SKY') {
    const grad = ctx.createLinearGradient(0, 0, 0, 240);
    grad.addColorStop(0, '#0ea5e9');
    grad.addColorStop(1, '#bae6fd');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 320, 240);

    // Stilisierte Baumkronen / Blätterdach an der Würm
    ctx.fillStyle = '#14532d';
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(30 + i * 36, i % 2 === 0 ? 25 : 215, 48, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = '#44403c';
    ctx.fillRect(0, 0, 320, 240);
    // Kies- & Waldbodenstruktur
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = i % 3 === 0 ? '#78716c' : i % 2 === 0 ? '#292524' : '#3f6212';
      ctx.beginPath();
      ctx.arc((i * 73) % 320, (i * 47) % 240, 4 + (i % 6), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = 'rgba(2, 6, 23, 0.82)';
  ctx.fillRect(10, 92, 300, 56);
  ctx.strokeStyle = '#06b6d4';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 92, 300, 56);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    kind === 'SKY'
      ? 'DEMO-FOTO: BLÄTTERDACH / HIMMEL'
      : 'DEMO-FOTO: KIES- & WALDBODEN',
    160,
    116
  );
  ctx.fillStyle = '#38bdf8';
  ctx.font = '12px sans-serif';
  ctx.fillText('81247 Sardinen • Synthetischer Hardware-Fallback', 160, 136);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.48);
  return {
    dataUrl,
    mimeType: 'image/jpeg',
    approxBytes: dataUrl.length,
    synthetic: true,
  };
}

/**
 * Erzeugt einen echten, im Browser abspielbaren Mini-WAV-Audioclip (~1,6 s bei 8 kHz 8-Bit Mono, ~17 KB <= 25 KB)
 * mit sanftem Natur-/Vogel-Klangmuster als Hardware-/Demo-Fallback.
 */
export function createSyntheticDemoAudio(): CompressedMediaResult {
  const sampleRate = 8000;
  const durationSec = 1.5;
  const numSamples = Math.floor(sampleRate * durationSec);
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + numSamples);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + numSamples, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true); // Format = 1
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // ByteRate (8-bit mono)
  view.setUint16(32, 1, true); // BlockAlign
  view.setUint16(34, 8, true); // BitsPerSample = 8
  writeAscii(36, 'data');
  view.setUint32(40, numSamples, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Sanftes Rauschen + zwei kurze Vogel-Zwitscher-Töne
    const chirpEnv =
      (t > 0.25 && t < 0.45) || (t > 0.85 && t < 1.05) ? 0.35 : 0.0;
    const freq = 1100 + 350 * Math.sin(t * 28);
    const wave = chirpEnv * Math.sin(2 * Math.PI * freq * t);
    const wind = 0.05 * Math.sin(2 * Math.PI * 190 * t);
    const unsignedSample = Math.max(
      0,
      Math.min(255, Math.round(128 + (wave + wind) * 100))
    );
    view.setUint8(headerSize + i, unsignedSample);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  const dataUrl = `data:audio/wav;base64,${base64}`;

  return {
    dataUrl,
    mimeType: 'audio/wav',
    approxBytes: dataUrl.length,
    synthetic: true,
  };
}
