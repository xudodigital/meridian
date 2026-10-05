// BLAKE3 (the plain hash with the default 32-byte output) in TypeScript, following the official reference
// implementation (github.com/BLAKE3-team/BLAKE3, reference_impl/reference_impl.rs, CC0-1.0 or Apache-2.0).
// Why it exists: Cloudflare Pages names every uploaded file by a BLAKE3 hash (cfpages.ts), and node:crypto has no
// BLAKE3. No keyed mode, no key derivation, no extended output, no SIMD or threads: the files of a static site hash
// in well under a second, and the network takes the time.

const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const PERMUTATION = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const CHUNK_START = 1, CHUNK_END = 2, PARENT = 4, ROOT = 8;
const CHUNK_LEN = 1024, BLOCK_LEN = 64;

/* The reference permutes the message words after each of the 7 rounds; reading them through a per-round order
   computed once gives the same words without moving them. */
const ROUNDS: number[][] = [];
for (let r = 0, order = [...Array(16).keys()]; r < 7; r++, order = PERMUTATION.map(i => order[i]!)) ROUNDS.push(order);

/* Scratch space. Hashing is synchronous, so one set of buffers serves every call. */
const state = new Uint32Array(16);
const words = new Uint32Array(16);
const pad = new Uint8Array(BLOCK_LEN);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/* Uint32Array stores wrap modulo 2^32, which is the addition BLAKE3 wants. */
function g(s: Uint32Array, a: number, b: number, c: number, d: number, x: number, y: number): void {
  s[a] = s[a]! + s[b]! + x; s[d] = rotr(s[d]! ^ s[a]!, 16);
  s[c] = s[c]! + s[d]!;     s[b] = rotr(s[b]! ^ s[c]!, 12);
  s[a] = s[a]! + s[b]! + y; s[d] = rotr(s[d]! ^ s[a]!, 8);
  s[c] = s[c]! + s[d]!;     s[b] = rotr(s[b]! ^ s[c]!, 7);
}

/** The compression function: leaves the 16-word state in `state`. `counter` may exceed 2^32 (64-bit chunk counter). */
function compress(cv: ArrayLike<number>, m: ArrayLike<number>, counter: number, blockLen: number, flags: number): Uint32Array {
  const s = state;
  for (let i = 0; i < 8; i++) s[i] = cv[i]!;
  s[8] = IV[0]!; s[9] = IV[1]!; s[10] = IV[2]!; s[11] = IV[3]!;
  s[12] = counter; s[13] = counter / 0x1_0000_0000; s[14] = blockLen; s[15] = flags;
  for (const o of ROUNDS) {
    g(s, 0, 4, 8, 12, m[o[0]!]!, m[o[1]!]!); g(s, 1, 5, 9, 13, m[o[2]!]!, m[o[3]!]!);
    g(s, 2, 6, 10, 14, m[o[4]!]!, m[o[5]!]!); g(s, 3, 7, 11, 15, m[o[6]!]!, m[o[7]!]!);
    g(s, 0, 5, 10, 15, m[o[8]!]!, m[o[9]!]!); g(s, 1, 6, 11, 12, m[o[10]!]!, m[o[11]!]!);
    g(s, 2, 7, 8, 13, m[o[12]!]!, m[o[13]!]!); g(s, 3, 4, 9, 14, m[o[14]!]!, m[o[15]!]!);
  }
  for (let i = 0; i < 8; i++) { s[i] = s[i]! ^ s[i + 8]!; s[i + 8] = s[i + 8]! ^ cv[i]!; }
  return s;
}

/** Reads up to 64 bytes at `at` as 16 little-endian words into `words`, zero-padded. */
function readBlock(data: Uint8Array, at: number, len: number): Uint32Array {
  let src = data, off = at;
  if (len < BLOCK_LEN) { pad.fill(0); pad.set(data.subarray(at, at + len)); src = pad; off = 0; }
  for (let i = 0; i < 16; i++, off += 4) words[i] = src[off]! | (src[off + 1]! << 8) | (src[off + 2]! << 16) | (src[off + 3]! << 24);
  return words;
}

/** What a node still needs for its last compression: its chaining value in, its last block, counter, length, flags. */
type Output = { cv: Uint32Array; block: Uint32Array; counter: number; len: number; flags: number };

const chainingValue = (o: Output): Uint32Array => compress(o.cv, o.block, o.counter, o.len, o.flags).slice(0, 8);

/** Runs every block of one chunk but the last, and returns the last as the chunk's output. */
function chunkOutput(data: Uint8Array, start: number, end: number, index: number): Output {
  const blocks = Math.max(1, Math.ceil((end - start) / BLOCK_LEN));
  let cv: Uint32Array = Uint32Array.from(IV);
  for (let b = 0; b < blocks - 1; b++) {
    cv = compress(cv, readBlock(data, start + b * BLOCK_LEN, BLOCK_LEN), index, BLOCK_LEN, b === 0 ? CHUNK_START : 0).slice(0, 8);
  }
  const at = start + (blocks - 1) * BLOCK_LEN, len = end - at;
  return { cv, block: readBlock(data, at, len).slice(), counter: index, len, flags: (blocks === 1 ? CHUNK_START : 0) | CHUNK_END };
}

function parentOutput(left: Uint32Array, right: Uint32Array): Output {
  const block = new Uint32Array(16); block.set(left); block.set(right, 8);
  return { cv: Uint32Array.from(IV), block, counter: 0, len: BLOCK_LEN, flags: PARENT };
}

/** The BLAKE3 hash (32 bytes) of the bytes, or of a string's UTF-8 bytes. */
export function blake3(input: Uint8Array | string): Uint8Array {
  const data = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  const chunks = Math.max(1, Math.ceil(data.length / CHUNK_LEN));
  /* Completed subtrees, merged whenever the count of chunks so far says two of them have the same size. */
  const stack: Uint32Array[] = [];
  for (let c = 0; c < chunks - 1; c++) {
    let cv = chainingValue(chunkOutput(data, c * CHUNK_LEN, (c + 1) * CHUNK_LEN, c));
    for (let total = c + 1; (total & 1) === 0; total >>= 1) cv = chainingValue(parentOutput(stack.pop()!, cv));
    stack.push(cv);
  }
  let out = chunkOutput(data, (chunks - 1) * CHUNK_LEN, data.length, chunks - 1);
  while (stack.length) out = parentOutput(stack.pop()!, chainingValue(out));
  /* The root's first output block is the hash; its counter is the output block number, 0. */
  const s = compress(out.cv, out.block, 0, out.len, out.flags | ROOT);
  const hash = new Uint8Array(32);
  for (let i = 0; i < 8; i++) { const w = s[i]!; hash[i * 4] = w; hash[i * 4 + 1] = w >>> 8; hash[i * 4 + 2] = w >>> 16; hash[i * 4 + 3] = w >>> 24; }
  return hash;
}

/** The BLAKE3 hash as 64 lowercase hex characters. */
export const blake3Hex = (input: Uint8Array | string): string => Buffer.from(blake3(input)).toString('hex');
