(function (global) {
  'use strict';

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

    async hmacSha1(key, data) {
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign']
      );
      const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);
      return new Uint8Array(signature);
    },

    async generateTOTP(secret, options = {}) {
      const digits = options.digits || 6;
      const period = options.period || 30;
      const algorithm = options.algorithm || 'SHA-1';
      const timestamp = options.timestamp || Date.now();

      const keyBytes = typeof secret === 'string' ? this.base32Decode(secret) : secret;
      let time = Math.floor(timestamp / 1000 / period);
      const timeBytes = new Uint8Array(8);
      for (let i = 7; i >= 0; i--) {
        timeBytes[i] = time & 0xff;
        time = time >>> 8;
      }

      let hash;
      if (algorithm === 'SHA-1') {
        hash = await this.hmacSha1(keyBytes, timeBytes);
      } else if (algorithm === 'SHA-256') {
        hash = await this.hmacSha256(keyBytes, timeBytes);
      } else if (algorithm === 'SHA-512') {
        hash = await this.hmacSha512(keyBytes, timeBytes);
      } else {
        hash = await this.hmacSha1(keyBytes, timeBytes);
      }

      const offset = hash[hash.length - 1] & 0xf;
      const binary =
        ((hash[offset] & 0x7f) << 24) |
        ((hash[offset + 1] & 0xff) << 16) |
        ((hash[offset + 2] & 0xff) << 8) |
        (hash[offset + 3] & 0xff);

      const otp = binary % Math.pow(10, digits);
      return otp.toString().padStart(digits, '0');
    },

    getRemainingSeconds(period = 30) {
      return period - (Math.floor(Date.now() / 1000) % period);
    },

    generateSecret(length = 32) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let result = '';
      const array = new Uint8Array(length);
      crypto.getRandomValues(array);
      for (let i = 0; i < length; i++) {
        result += chars[array[i] % chars.length];
      }
      return result;
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TOTP;
  } else {
    global.TOTP = TOTP;
  }
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : this);
