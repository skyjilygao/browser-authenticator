const zlib = require('zlib');

function hmacSha1Node(keyBytes, dataBytes) {
  const crypto = require('crypto');
  return Uint8Array.from(crypto.createHmac('sha1', Buffer.from(keyBytes)).update(Buffer.from(dataBytes)).digest());
}

const TOTP = {
  base32Chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
  base32Decode(encoded) {
    encoded = encoded.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
    if (encoded.length === 0) return new Uint8Array(0);
    for (let i = 0; i < encoded.length; i++) {
      if (this.base32Chars.indexOf(encoded[i]) < 0) {
        throw new Error('Base32 密钥包含非法字符: ' + encoded[i]);
      }
    }
    const n = encoded.length;
    const totalBits = n * 5;
    const bitBuffer = new Array(totalBits).fill(0);
    let bitIdx = 0;
    for (let i = 0; i < n; i++) {
      const val = this.base32Chars.indexOf(encoded[i]);
      for (let b = 4; b >= 0; b--) {
        bitBuffer[bitIdx++] = (val >> b) & 1;
      }
    }
    const outLen = Math.floor(totalBits / 8);
    const out = new Uint8Array(outLen);
    for (let i = 0; i < outLen; i++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) {
        byte = (byte << 1) | (bitBuffer[i * 8 + b] || 0);
      }
      out[i] = byte & 0xff;
    }
    return out;
  },
  isValidBase32(str) {
    if (!str || typeof str !== 'string') return false;
    const s = str.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
    if (s.length === 0) return false;
    return /^[A-Z2-7]+$/.test(s);
  },
  async generateTOTP(secret, options = {}) {
    const digits = options.digits || 6;
    const period = options.period || 30;
    const timestamp = options.timestamp || Date.now();

    const keyBytes = typeof secret === 'string' ? this.base32Decode(secret) : secret;
    let time = Math.floor(timestamp / 1000 / period);
    const timeBytes = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
      timeBytes[i] = time & 0xff;
      time = time >>> 8;
    }
    const hash = hmacSha1Node(keyBytes, timeBytes);
    const offset = hash[hash.length - 1] & 0xf;
    const binary =
      ((hash[offset] & 0x7f) << 24) |
      ((hash[offset + 1] & 0xff) << 16) |
      ((hash[offset + 2] & 0xff) << 8) |
      (hash[offset + 3] & 0xff);
    const otp = binary % Math.pow(10, digits);
    return otp.toString().padStart(digits, '0');
  }
};

(async () => {
  const secrets = [
    'KU5NYCERC223MKL6',
    'JBSWY3DPEHPK3PXP',
    'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    'HXDMVJECJJWSRB3HWIZR4IFUGFTMXBOZ',
  ];
  const ts = 1700000000000;
  for (const s of secrets) {
    console.log(`\n=== Secret: "${s}" (len=${s.length}) ===`);
    try {
      const kb = TOTP.base32Decode(s);
      console.log(`  Key decoded: ${kb.length} bytes = ${Buffer.from(kb).toString('hex')}`);
      let time = Math.floor(ts / 1000 / 30);
      const tb = new Uint8Array(8);
      let t = time;
      for (let i = 7; i >= 0; i--) {
        tb[i] = t & 0xff;
        t = t >>> 8;
      }
      const hash = hmacSha1Node(kb, tb);
      const offset = hash[hash.length - 1] & 0xf;
      const binary =
        ((hash[offset] & 0x7f) << 24) |
        ((hash[offset + 1] & 0xff) << 16) |
        ((hash[offset + 2] & 0xff) << 8) |
        (hash[offset + 3] & 0xff);
      const otp = binary % 1000000;
      const code = otp.toString().padStart(6, '0');
      console.log(`  Counter=${time}  OTP code = ${code}`);
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
    }
  }
  console.log('\n\n验证已知标准向量 (RFC 6238 Appendix B, 取末6位作6位码):');
  const rfcSecretBase32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const vectors = [
    { ts: 59 * 1000,          expect6: '287082', note: '1970-01-01 00:00:59 UTC' },
    { ts: 1111111109 * 1000,   expect6: '081804', note: '2005-03-18 01:58:29 UTC' },
    { ts: 1111111111 * 1000,   expect6: '050471', note: '2005-03-18 01:58:31 UTC' },
    { ts: 1234567890 * 1000,   expect6: '005924', note: '2009-02-13 23:31:30 UTC' },
    { ts: 2000000000 * 1000,   expect6: '279037', note: '2033-05-18 03:33:20 UTC' },
  ];
  let pass = 0;
  for (const v of vectors) {
    const code = await TOTP.generateTOTP(rfcSecretBase32, { digits: 6, period: 30, timestamp: v.ts });
    const ok = code === v.expect6;
    if (ok) pass++;
    console.log(`  ${v.note} expect=${v.expect6} got=${code} ${ok ? 'PASS' : 'FAIL'}`);
  }
  console.log(`RFC6238 vectors: ${pass}/${vectors.length} passed`);
})();
