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
    const timestamp = options.timestamp || Date.now();

    const keyBytes = typeof secret === 'string' ? this.base32Decode(secret) : secret;
    let time = Math.floor(timestamp / 1000 / period);
    const timeBytes = new Uint8Array(8);
    for (let i = 7; i >= 0; i--) {
      timeBytes[i] = time & 0xff;
      time = time >>> 8;
    }

    const hash = await this.hmacSha1(keyBytes, timeBytes);
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

const StorageManager = {
  KEY_ACCOUNTS: 'authenticator_accounts',
  KEY_SETTINGS: 'authenticator_settings',

  async getAccounts() {
    const result = await chrome.storage.sync.get(this.KEY_ACCOUNTS);
    return result[this.KEY_ACCOUNTS] || [];
  },

  extractHostname(urlOrHost) {
    if (!urlOrHost) return '';
    try {
      if (/^https?:\/\//i.test(urlOrHost)) {
        return new URL(urlOrHost).hostname.toLowerCase();
      }
      return urlOrHost.trim().toLowerCase();
    } catch (e) {
      return urlOrHost.trim().toLowerCase();
    }
  },

  extractRootDomain(hostname) {
    if (!hostname) return '';
    const h = hostname.replace(/^\./, '').toLowerCase();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h;
    const parts = h.split('.');
    if (parts.length <= 2) return h;
    const ccSLDs = ['co.uk','com.cn','net.cn','org.cn','gov.cn','com.au','co.jp','co.kr','com.br','co.in'];
    for (const sld of ccSLDs) {
      if (h.endsWith('.' + sld)) {
        return parts.slice(-(sld.split('.').length + 1)).join('.');
      }
    }
    return parts.slice(-2).join('.');
  },

  matchUrl(accountUrlPattern, currentUrl, currentHostname) {
    if (!accountUrlPattern) return true;
    const pattern = String(accountUrlPattern).trim().toLowerCase();
    if (!pattern) return true;

    const host = (currentHostname || '').toLowerCase();
    const url = (currentUrl || '').toLowerCase();

    try {
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(2);
        if (host === suffix) return true;
        if (host.endsWith('.' + suffix)) return true;
        return false;
      }
      if (pattern.startsWith('http://') || pattern.startsWith('https://')) {
        const hasWildcard = pattern.includes('*');
        if (hasWildcard) {
          const re = new RegExp(
            '^' + pattern
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*') + '$'
          );
          return re.test(url);
        }
        const base = pattern.replace(/\/$/, '');
        return url === base || url.startsWith(base + '/') || url.startsWith(pattern);
      }
      if (pattern === host) return true;
      if (host.endsWith('.' + pattern)) return true;
      if (url.includes(pattern)) return true;
      const root = this.extractRootDomain(host);
      const patternHost = this.extractHostname(pattern);
      const patternRoot = this.extractRootDomain(patternHost);
      if (root && patternRoot && root === patternRoot) return true;
      return false;
    } catch (e) {
      return host && host.includes(pattern.replace(/^\*\./, ''));
    }
  },

  async findAccountsByUsername(username, url) {
    const accounts = await this.getAccounts();
    console.groupCollapsed('%c[Authenticator BG] findAccountsByUsername', 'color:#667eea;font-weight:bold');
    console.log('username:', username);
    console.log('url:', url || '(未提供)');
    if (!username) {
      console.log('无用户名，返回空');
      console.groupEnd();
      return [];
    }
    const lower = username.toLowerCase().trim();
    const sameUser = accounts.filter(a =>
      a.username && a.username.toLowerCase().trim() === lower
    );
    console.log(`按用户名匹配到 ${sameUser.length} 个账号:`,
      sameUser.map(a => ({ id: a.id, serviceName: a.serviceName, loginUrl: a.loginUrl || a.sitePattern || '' })));
    if (sameUser.length === 0) { console.groupEnd(); return []; }
    if (!url) {
      const noUrlOnly = sameUser.filter(a => !(a.loginUrl || a.sitePattern));
      const res = noUrlOnly.length > 0 ? noUrlOnly : [];
      console.log('未提供 url，只返回 noUrl 账号:', res.map(a => a.serviceName));
      console.groupEnd();
      return res;
    }

    const hostname = this.extractHostname(url);
    const rootDomain = this.extractRootDomain(hostname);
    console.log('current hostname:', hostname, ' rootDomain:', rootDomain);
    const exact = [];
    const root = [];
    const noUrl = [];
    for (const a of sameUser) {
      const p = a.loginUrl || a.sitePattern;
      if (!p) { noUrl.push(a); console.log('  - noUrl:', a.serviceName); continue; }
      if (this.matchUrl(p, url, hostname)) { exact.push(a); console.log('  - exactUrl (命中):', a.serviceName, ' pattern:', p); continue; }
      const ph = this.extractHostname(p);
      const pr = this.extractRootDomain(ph);
      if (pr === rootDomain) { root.push(a); console.log('  - rootUrl (根域匹配):', a.serviceName, ' patternRoot:', pr); }
      else { console.log('  - SKIPPED:', a.serviceName, ' pattern:', p, ' patternRoot:', pr, ' ≠ rootDomain:', rootDomain); }
    }
    let result = [];
    if (exact.length > 0) result = exact;
    else if (root.length > 0) result = root;
    else if (noUrl.length > 0) result = noUrl;
    console.log('最终返回账号:', result.map(a => ({ id: a.id, serviceName: a.serviceName, loginUrl: a.loginUrl || a.sitePattern || '' })));
    console.groupEnd();
    return result;
  }
};

chrome.runtime.onInstalled.addListener(() => {
  console.log('身份验证器插件已安装');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'GENERATE_OTP' && msg.accountId) {
    (async () => {
      try {
        const accounts = await StorageManager.getAccounts();
        const acc = accounts.find(a => a.id === msg.accountId);
        if (acc) {
          const code = await TOTP.generateTOTP(acc.secret, {
            digits: parseInt(acc.digits) || 6,
            period: parseInt(acc.period) || 30
          });
          sendResponse({ code });
        } else {
          sendResponse({ error: 'Account not found' });
        }
      } catch (e) {
        sendResponse({ error: e.message });
      }
    })();
    return true;
  }

  if (msg && msg.type === 'GET_ACCOUNTS_BY_USERNAME' && msg.username) {
    (async () => {
      try {
        const accounts = await StorageManager.findAccountsByUsername(msg.username, msg.url);
        const results = [];
        for (const acc of accounts) {
          const code = await TOTP.generateTOTP(acc.secret, {
            digits: parseInt(acc.digits) || 6,
            period: parseInt(acc.period) || 30
          });
          results.push({
            id: acc.id,
            serviceName: acc.serviceName,
            username: acc.username,
            loginUrl: acc.loginUrl || acc.sitePattern || '',
            code
          });
        }
        sendResponse({ accounts: results });
      } catch (e) {
        sendResponse({ error: e.message, accounts: [] });
      }
    })();
    return true;
  }
});
