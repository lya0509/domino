import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { qrModules, qrPath } from '../src/lib/inviteQr.ts';

const INVITE = 'https://domino-mauve.vercel.app/?invite=CAFETIN';

const scan = (modules) => {
  const scale = 4;
  const quiet = 4;
  const side = (modules.length + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let py = (y + quiet) * scale; py < (y + quiet + 1) * scale; py++) {
        for (let px = (x + quiet) * scale; px < (x + quiet + 1) * scale; px++) {
          pixels.fill(0, (py * side + px) * 4, (py * side + px) * 4 + 3);
        }
      }
    })
  );
  return jsQR(pixels, side, side)?.data;
};

test('the invite QR scans back to the same link', () => {
  assert.equal(scan(qrModules(INVITE)), INVITE);
});

test('the drawing has one square per dark module', () => {
  const modules = qrModules(INVITE);
  const dark = modules.flat().filter(Boolean).length;
  assert.equal(qrPath(modules).match(/M/g).length, dark);
});
