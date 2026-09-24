/**
 * 像素圖示（R12 §5）：以字元格描述圖形（`x`＝填色、其他＝透明），轉成 SVG path。
 * 同一列相鄰的格子合併成一段，搭配 `shape-rendering="crispEdges"` 與整數倍縮放，邊緣保持銳利。
 * 圖示一律用 code 繪製，不載入圖檔。
 */
export function pixelPath(rows: readonly string[]): string {
  const parts: string[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== 'x') {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x] === 'x') x++;
      parts.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
    }
  });
  return parts.join('');
}
