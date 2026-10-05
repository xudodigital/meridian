// ZIP files without a library: deflate from node:zlib, CRC-32 from zlib.crc32, UTF-8 names (flag bit 11), no
// directory entries (unzip tools create folders from the paths). Used for "Download ZIP" of a website build.
//
// A build's ZIP is written to a file once (a build never changes) and served from there. Writing it reads one file at
// a time and deflates on zlib's thread pool, so a large site neither fills the memory nor stalls the server, and
// photos and icons, which are compressed already, are stored as they are.
import { existsSync } from 'node:fs';
import { open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { crc32, deflateRaw, deflateRawSync } from 'node:zlib';

export type ZipEntry = { name: string; data: Buffer; mtime?: Date };

const deflateRawAsync = promisify(deflateRaw);
/** Formats that are compressed already: deflating them again costs time and saves nothing. */
const PACKED = /\.(jpe?g|png|gif|webp|avif|ico|woff2?|zip|gz|br)$/i;
const LEVEL = 9;
const TOO_LARGE = 'This website is too large for a ZIP download.';

/** MS-DOS time and date (local time, 2-second steps), as ZIP stores them. */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** One file's local header with its name and data, and its central directory record. */
function record(name: string, data: Buffer, body: Buffer, mtime: Date, offset: number): { local: Buffer; central: Buffer } {
  const n = Buffer.from(name, 'utf8');
  const crc = crc32(data) >>> 0, method = body === data ? 0 : 8;
  const { time, date } = dosTime(mtime);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);                 // version needed: 2.0
  local.writeUInt16LE(0x0800, 6);             // UTF-8 file name
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
  const dir = Buffer.alloc(46);
  dir.writeUInt32LE(0x02014b50, 0);
  dir.writeUInt16LE(0x031e, 4);               // made by: Unix, 3.0 (so the mode below is read)
  dir.writeUInt16LE(20, 6);
  dir.writeUInt16LE(0x0800, 8);
  dir.writeUInt16LE(method, 10);
  dir.writeUInt16LE(time, 12); dir.writeUInt16LE(date, 14);
  dir.writeUInt32LE(crc, 16);
  dir.writeUInt32LE(body.length, 20); dir.writeUInt32LE(data.length, 24);
  dir.writeUInt16LE(n.length, 28);
  dir.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a regular file, rw-r--r--
  dir.writeUInt32LE(offset, 42);
  return { local: Buffer.concat([local, n, body]), central: Buffer.concat([dir, n]) };
}

/** The end of central directory record. */
function ending(count: number, size: number, offset: number): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return end;
}

/** The deflated data when it is smaller, else the data itself (stored). */
const smaller = (data: Buffer, packed: Buffer | null): Buffer => packed && packed.length < data.length ? packed : data;
const checkSize = (offset: number, count: number) => { if (offset > 0xffff_fff0 || count > 0xfff0) throw new Error(TOO_LARGE); };

/** A ZIP archive of the entries, in memory. Files that do not get smaller (photos) are stored as they are. */
export function zip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  checkSize(0, entries.length);
  for (const e of entries) {
    const body = smaller(e.data, PACKED.test(e.name) || !e.data.length ? null : deflateRawSync(e.data, { level: LEVEL }));
    const r = record(e.name, e.data, body, e.mtime ?? new Date(), offset);
    checkSize(offset + r.local.length, entries.length);
    parts.push(r.local);
    central.push(r.central);
    offset += r.local.length;
  }
  const cd = Buffer.concat(central);
  return Buffer.concat([...parts, cd, ending(entries.length, cd.length, offset)]);
}

/** Every file under `dir`, with paths relative to it ("a/b.html"), in a stable order. */
export async function filesUnder(dir: string, prefix = ''): Promise<{ name: string; path: string }[]> {
  const out: { name: string; path: string }[] = [];
  const list = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const d of list) {
    const full = join(dir, d.name), name = prefix + d.name;
    if (d.isDirectory()) out.push(...await filesUnder(full, name + '/'));
    else if (d.isFile()) out.push({ name, path: full });
  }
  return out;
}

/**
 * Writes a ZIP of a folder (its contents at the archive's root) to `out`, one file at a time: only the central
 * directory stays in memory. Written next to `out` first, so a half-written ZIP is never served.
 */
export async function writeZip(dir: string, out: string): Promise<void> {
  const files = await filesUnder(dir);
  checkSize(0, files.length);
  const tmp = `${out}.${process.pid}.tmp`;
  const fh = await open(tmp, 'w');
  try {
    const write = async (buf: Buffer) => {
      for (let at = 0; at < buf.length;) {
        const { bytesWritten } = await fh.write(buf, at, buf.length - at);
        if (!bytesWritten) throw new Error('Could not write the ZIP file.');
        at += bytesWritten;
      }
    };
    const central: Buffer[] = [];
    let offset = 0;
    for (const f of files) {
      const [data, info] = await Promise.all([readFile(f.path), stat(f.path)]);
      const body = smaller(data, PACKED.test(f.name) || !data.length ? null : await deflateRawAsync(data, { level: LEVEL }));
      const r = record(f.name, data, body, info.mtime, offset);
      checkSize(offset + r.local.length, files.length);
      await write(r.local);
      central.push(r.central);
      offset += r.local.length;
    }
    const cd = Buffer.concat(central);
    await write(Buffer.concat([cd, ending(files.length, cd.length, offset)]));
    await fh.close();
    await rename(tmp, out);
  } catch (e) {
    await fh.close().catch(() => undefined);
    await rm(tmp, { force: true });
    throw e;
  }
}

const making = new Map<string, Promise<string>>();
/**
 * The path of the ZIP of a build folder, written the first time it is asked for and kept as `out`. Two downloads at
 * once share one write. When the folder was deleted while the ZIP was being written, the ZIP is deleted too.
 */
export function cachedZip(dir: string, out: string): Promise<string> {
  if (existsSync(out)) return Promise.resolve(out);
  let p = making.get(out);
  if (!p) {
    p = writeZip(dir, out).then(async () => {
      if (existsSync(dir)) return out;
      await rm(out, { force: true });
      throw new Error('The build folder was removed while its ZIP was being written.');
    }).finally(() => { making.delete(out); });
    making.set(out, p);
  }
  return p;
}
