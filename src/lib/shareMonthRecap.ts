import { Platform } from 'react-native';
import { MonthRecap } from './monthRecap';
import { fitText, roundRect, ShareOutcome, sharePicture } from './shareVipCard';

// "Mi mes en el cafetín" as a 1080x1350 picture for WhatsApp and status
const W = 1080;
const H = 1350;
const GOLD = '#fbbf24';

export const drawMonthRecap = async (recap: MonthRecap, name: string, accent = GOLD): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b1220');
  bg.addColorStop(1, '#1c1408');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  roundRect(ctx, 30, 30, W - 60, H - 60, 48);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = accent;
  ctx.font = '800 40px system-ui, -apple-system, Roboto, sans-serif';
  ctx.fillText('MI MES EN EL CAFETÍN', W / 2, 140);
  ctx.fillStyle = '#ffffff';
  fitText(ctx, recap.label, W - 160, 84, '900');
  ctx.fillText(recap.label, W / 2, 240);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  fitText(ctx, `♛ ${name}`, W - 160, 52, '700');
  ctx.fillText(`♛ ${name}`, W / 2, 315);

  // Big numbers
  const tile = (x: number, y: number, w: number, value: string, label: string) => {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    roundRect(ctx, x, y, w, 210, 28);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.font = '900 96px system-ui, -apple-system, Roboto, sans-serif';
    ctx.fillText(value, x + w / 2, y + 120);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '700 34px system-ui, -apple-system, Roboto, sans-serif';
    ctx.fillText(label, x + w / 2, y + 175);
  };
  const third = (W - 160 - 40) / 3;
  tile(80, 370, third, String(recap.played), 'partidas');
  tile(80 + third + 20, 370, third, String(recap.wins), 'victorias');
  tile(80 + (third + 20) * 2, 370, third, `${recap.domino.winRate}%`, 'en dominó');

  // Lines
  const lines: [string, string][] = [
    ['🁫 Dominó', `${recap.domino.wins} de ${recap.domino.played} ganadas`],
    ['🃏 UNO', `${recap.uno.wins} de ${recap.uno.played} ganadas`],
    ['♠ Póker', `${recap.poker.wins} de ${recap.poker.played} ganadas`],
    ['👟 Zapatos dados', String(recap.domino.zapatos)],
    ['🔥 Mejor racha', recap.bestStreak ? `${recap.bestStreak} seguidas` : '—'],
    ['🤝 Mejor pareja', recap.bestPartner ? `${recap.bestPartner.name} (${recap.bestPartner.count})` : '—'],
    ['😤 Rival más duro', recap.toughestRival ? `${recap.toughestRival.name} (${recap.toughestRival.count})` : '—'],
    ['🎯 Víctima favorita', recap.favoriteVictim ? `${recap.favoriteVictim.name} (${recap.favoriteVictim.count})` : '—'],
  ];
  let y = 680;
  for (const [left, right] of lines) {
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 40px system-ui, -apple-system, Roboto, sans-serif';
    ctx.fillText(left, 100, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    fitText(ctx, right, 460, 40, '800');
    ctx.fillText(right, W - 100, y);
    y += 72;
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '600 30px system-ui, -apple-system, Roboto, sans-serif';
  ctx.fillText('Domino del Cafetín · PeSiMistas', W / 2, H - 80);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo dibujar'))), 'image/png'));
};

export const shareMonthRecap = async (recap: MonthRecap, name: string, accent?: string, downloadOnly = false): Promise<ShareOutcome> => {
  if (Platform.OS !== 'web') throw new Error('Compartir el resumen está disponible en la app web.');
  const blob = await drawMonthRecap(recap, name, accent);
  return sharePicture(blob, `mi-mes-${recap.month}.png`, 'Mi mes en el cafetín', `Mi ${recap.label.toLowerCase()} en el Domino del Cafetín ♛`, downloadOnly);
};
