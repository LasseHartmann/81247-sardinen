export interface CompressedMediaResult {
  dataUrl: string;
  mimeType: string;
  approxBytes: number;
  synthetic: boolean;
}

const MAX_IMAGE_DATA_URL_LENGTH = 60_000; // <= 60 KB Base64-String

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

/**
 * Erzeugt ein klar gekennzeichnetes synthetisches Demo-Foto (Himmel, Bodenstruktur oder Gruppen-Selfie)
 * unterhalb von 35 KB für Geräte ohne Kamera oder den lokalen Demo-Modus.
 */
export function createSyntheticDemoPhoto(
  kind: 'SKY' | 'GROUND' | 'SELFIE'
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

    ctx.fillStyle = '#14532d';
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(30 + i * 36, i % 2 === 0 ? 25 : 215, 48, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'SELFIE') {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 320, 240);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(85 + i * 75, 70, 24, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = '#44403c';
    ctx.fillRect(0, 0, 320, 240);
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
      : kind === 'SELFIE'
        ? 'DEMO-FOTO: GRUPPEN-SELFIE'
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
