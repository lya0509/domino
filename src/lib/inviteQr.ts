import qrcode from 'qrcode-generator';

/** Built on the device, so the invite still shows when an outside image service can't be reached. */
export const qrModules = (text: string): boolean[][] => {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => qr.isDark(row, col))
  );
};

export const qrPath = (modules: boolean[][]): string =>
  modules
    .flatMap((columns, y) => columns.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])))
    .join('');
