// ZIP method 0 (STORE). No compression/rewriting of original bytes.
const table = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function header(length: number): { bytes: Uint8Array<ArrayBuffer>; view: DataView<ArrayBuffer> } {
  const bytes = new Uint8Array(length);
  return { bytes, view: new DataView(bytes.buffer) };
}
export function storeZip(entries: ReadonlyMap<string, Uint8Array<ArrayBuffer>>): Blob {
  if (entries.size > 65535) throw new Error('ZIP 형식의 파일 수 한도를 초과했습니다.');
  const chunks: BlobPart[] = [],
    central: BlobPart[] = [];
  let offset = 0,
    centralSize = 0;
  for (const [path, bytes] of entries) {
    if (!path.startsWith('jjal-export/') || path.includes('\\') || path.split('/').includes('..'))
      throw new Error('안전하지 않은 ZIP 경로입니다.');
    const name = new TextEncoder().encode(path),
      crc = crc32(bytes);
    const local = header(30),
      v = local.view;
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint16(12, 0x21, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, bytes.length, true);
    v.setUint32(22, bytes.length, true);
    v.setUint16(26, name.length, true);
    chunks.push(local.bytes, name, bytes);
    const entry = header(46),
      c = entry.view;
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, bytes.length, true);
    c.setUint32(24, bytes.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(entry.bytes, name);
    centralSize += 46 + name.length;
    offset += 30 + name.length + bytes.length;
  }
  const end = header(22),
    v = end.view;
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, entries.size, true);
  v.setUint16(10, entries.size, true);
  v.setUint32(12, centralSize, true);
  v.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end.bytes], { type: 'application/zip' });
}
