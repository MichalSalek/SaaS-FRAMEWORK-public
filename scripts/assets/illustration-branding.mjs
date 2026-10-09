// Code-native SVG export: the original artwork and brand asset remain intact.
export function brandedIllustrationSvg({
  image,
  logo,
  width,
  height,
  corner = 'top-right',
}) {
  const margin = Math.round(width * 0.016);
  const logoWidth = Math.round(width * 0.15);
  const logoHeight = Math.round((logoWidth * 315) / 1114);
  const padding = Math.round(width * 0.008);
  const boxWidth = logoWidth + padding * 2;
  const boxHeight = logoHeight + padding * 2;
  const x = corner.endsWith('right') ? width - margin - boxWidth : margin;
  const y = corner.startsWith('bottom') ? height - margin - boxHeight : margin;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image width="${width}" height="${height}" href="data:image/webp;base64,${image.toString('base64')}"/><rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" rx="${padding}" fill="#fffaf3"/><image x="${x + padding}" y="${y + padding}" width="${logoWidth}" height="${logoHeight}" href="data:image/png;base64,${logo.toString('base64')}"/></svg>`
  );
}
