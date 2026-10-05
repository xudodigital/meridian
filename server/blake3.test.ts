// BLAKE3 against the official test vectors, and the Cloudflare Pages asset keys built on it. Run with `npm run test:server`.
// Vectors: github.com/BLAKE3-team/BLAKE3, test_vectors/test_vectors.json (input byte i is i % 251; the first 32 bytes
// of each "hash"). The lengths cover one block, block edges, one chunk, chunk edges and deeper trees.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blake3, blake3Hex } from './blake3.ts';
import { assetHash } from './cfpages.ts';

const input = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

const VECTORS: [number, string][] = [
  [0, 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262'],
  [1, '2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213'],
  [63, 'e9bc37a594daad83be9470df7f7b3798297c3d834ce80ba85d6e207627b7db7b'],
  [64, '4eed7141ea4a5cd4b788606bd23f46e212af9cacebacdc7d1f4c6dc7f2511b98'],
  [65, 'de1e5fa0be70df6d2be8fffd0e99ceaa8eb6e8c93a63f2d8d1c30ecb6b263dee'],
  [1024, '42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7'],
  [1025, 'd00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444'],
  [2048, 'e776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a'],
  [2049, '5f4d72f40d7a5f82b15ca2b2e44b1de3c2ef86c426c95c1af0b6879522563030'],
  [3073, '7124b49501012f81cc7f11ca069ec9226cecb8a2c850cfe644e327d22d3e1cd3'],
  [8193, 'bab6c09cb8ce8cf459261398d2e7aef35700bf488116ceb94a36d0f5f1b7bc3b'],
  [31744, '62b6960e1a44bcc1eb1a611a8d6235b6b4b78f32e7abc4fb4c6cdcce94895c47'],
  [102400, 'bc3e3d41a1146b069abffad3c0d44860cf664390afce4d9661f7902e7943e085'],
];

describe('blake3', () => {
  for (const [n, hash] of VECTORS) it(`matches the official vector for ${n} bytes`, () => assert.equal(blake3Hex(input(n)), hash));

  it('hashes a string as its UTF-8 bytes', () => {
    assert.equal(blake3Hex('abc'), '6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85');
    assert.equal(blake3Hex('Cà phê'), blake3Hex(Buffer.from('Cà phê', 'utf8')));
  });

  it('gives 32 bytes and the same answer for a view into a larger buffer', () => {
    const whole = input(3000), view = whole.subarray(500, 2500);
    assert.equal(blake3(view).length, 32);
    assert.equal(blake3Hex(view), blake3Hex(Uint8Array.from(view)));
  });
});

describe('Pages asset keys (wrangler hashFile)', () => {
  const bytes = (s: string) => Buffer.from(s, 'utf8');
  it('match the keys wrangler gives the three example files', () => {
    assert.equal(assetHash(bytes('<h1>Hello</h1>'), 'index.html'), '8deb79e268ae1932009657bb3e496c87');
    assert.equal(assetHash(bytes('User-agent: *\nAllow: /\n'), 'robots.txt'), '4c17b5bc571cafcb56cb7fe5e9d8ee40');
    assert.equal(assetHash(bytes(''), 'a.css'), '9e7a27539226d700e116522ee435029d');
  });
  it('keep the extension as written, and use none for dotfiles and names without one', () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
    assert.equal(assetHash(jpeg, 'media/PHOTO.JPG'), '70345fc3a88a3ffbb97564fb4b4ad000');
    assert.equal(assetHash(jpeg, 'media/photo.jpg'), '3a150a46404fe986c896451846dc08fe');
    assert.equal(assetHash(bytes('x'), '.nojekyll'), 'c89c27f28e24f706b72c408fe1d6537a');
    assert.equal(assetHash(bytes('MIT'), 'LICENSE'), '0e41d6a9dce44edda9ea3c4da577767b');
  });
  it('depend on the content only, not on the folder or a non-ASCII name', () => {
    assert.equal(assetHash(bytes('Cà phê'), 'cà-phê.txt'), '949159a86e006a0ceb60e945186e795f');
    assert.equal(assetHash(bytes('Cà phê'), 'kopi/notes.txt'), '949159a86e006a0ceb60e945186e795f');
  });
});
