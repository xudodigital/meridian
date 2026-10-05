import qrcode from 'qrcode-generator';

/**
 * A QR code drawn as SVG from the module grid (qrcode-generator), for the 2-step setup link. Dark modules on a light
 * square with a quiet zone, so authenticator apps read it in both themes. No HTML string is injected.
 */
export function Qr({ text, label, size = 184 }: { text: string; label: string; size?: number }) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount(), quiet = 4, total = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return (
    <svg className="qr" role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${total} ${total}`} shapeRendering="crispEdges">
      <rect width={total} height={total} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
