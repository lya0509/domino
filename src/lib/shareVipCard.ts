import { Platform } from 'react-native';

/**
 * Draws the VIP card as a 1080x1350 picture (good for WhatsApp, Instagram and
 * status) and shares it, or downloads it when the phone cannot share files.
 * A GIF background is drawn from its first frame: the shared picture is still.
 */
export interface VipCardPicture {
  name: string;
  initials?: string | null;
  avatarUrl?: string | null;
  mediaUrl?: string | null;
  tagline?: string | null;
  memberId: string;
  points?: number | null;
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

const W = 1080;
const H = 1350;
const GOLD = '#fbbf24';

const loadImage = (src: string | null | undefined): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new window.Image();
    // Supabase storage answers with CORS, so the canvas stays exportable
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

const drawCover = (ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) => {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
};

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const fitText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight: string, style = '') => {
  let s = size;
  do {
    ctx.font = `${style} ${weight} ${s}px system-ui, -apple-system, Roboto, sans-serif`;
    s -= 4;
  } while (ctx.measureText(text).width > maxWidth && s > 24);
};

const wrap = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else {
      line = test;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines;
};

export const drawVipCard = async (card: VipCardPicture): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Este navegador no puede dibujar la tarjeta.');

  const [media, avatar] = await Promise.all([loadImage(card.mediaUrl), loadImage(card.avatarUrl)]);

  // Background: the member's GIF or photo under a veil, or the card's dark gold
  ctx.fillStyle = '#11141b';
  ctx.fillRect(0, 0, W, H);
  if (media) {
    drawCover(ctx, media, 0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
  } else {
    const g = ctx.createRadialGradient(W / 2, 420, 60, W / 2, 420, 900);
    g.addColorStop(0, '#3a2a0a');
    g.addColorStop(1, '#11141b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Gold frame
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 10;
  ctx.shadowColor = 'rgba(251,191,36,0.6)';
  ctx.shadowBlur = 30;
  roundRect(ctx, 34, 34, W - 68, H - 68, 56);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 12;

  ctx.fillStyle = GOLD;
  ctx.font = '900 54px system-ui, -apple-system, Roboto, sans-serif';
  ctx.fillText('DOMINO DEL CAFETÍN', W / 2, 160);
  ctx.font = '900 40px system-ui, -apple-system, Roboto, sans-serif';
  ctx.fillText('♛  SOCIO VIP', W / 2, 225);

  // Profile photo or initials in a gold ring
  const cx = W / 2;
  const cy = 540;
  const r = 205;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avatar) {
    drawCover(ctx, avatar, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 0;
    ctx.font = '900 150px system-ui, -apple-system, Roboto, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText((card.initials || card.name.slice(0, 2)).toUpperCase(), cx, cy + 6);
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 12;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
  ctx.stroke();

  // Name and phrase
  ctx.fillStyle = '#ffffff';
  fitText(ctx, card.name, W - 200, 96, '900');
  ctx.fillText(card.name, W / 2, 870);

  if (card.tagline) {
    ctx.fillStyle = '#fde68a';
    ctx.font = 'italic 600 50px system-ui, -apple-system, Roboto, sans-serif';
    wrap(ctx, `“${card.tagline}”`, W - 240, 2).forEach((l, i) => ctx.fillText(l, W / 2, 950 + i * 62));
  }

  if (card.points != null) {
    ctx.fillStyle = GOLD;
    ctx.font = '800 48px system-ui, -apple-system, Roboto, sans-serif';
    ctx.fillText(`🪙 ${card.points} pts`, W / 2, 1110);
  }

  ctx.font = '700 34px system-ui, -apple-system, Roboto, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`#CAF-${card.memberId.substring(0, 8).toUpperCase()}`, W / 2, 1230);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo crear la imagen.'))), 'image/png'),
  );
};

const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

/** Share the picture (WhatsApp, Instagram...) or, with `downloadOnly`, save it. */
export const shareVipCard = async (card: VipCardPicture, downloadOnly = false): Promise<ShareOutcome> => {
  if (Platform.OS !== 'web') throw new Error('Compartir la tarjeta está disponible en la app web.');
  const blob = await drawVipCard(card);
  const filename = 'mi-tarjeta-vip.png';
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!downloadOnly && nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Mi tarjeta VIP', text: '¡Soy socio VIP del Domino del Cafetín! ♛' });
      return 'shared';
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'cancelled';
      // Some browsers refuse files at the last moment: fall back to saving it
    }
  }
  download(blob, filename);
  return 'downloaded';
};
