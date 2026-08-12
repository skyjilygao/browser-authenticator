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

(function () {
  'use strict';

  const state = {
    accounts: [],
    settings: { autoFill: true },
    lastUsername: '',
    filledFields: new WeakSet(),
    filledCodes: new Map()
  };

  const USERNAME_SELECTORS = [
    'input[name="username"]',
    'input[name="user"]',
    'input[name="userid"]',
    'input[name="user_id"]',
    'input[name="login"]',
    'input[name="login_id"]',
    'input[name="email"]',
    'input[name="mail"]',
    'input[type="email"]',
    'input[id*="username" i]',
    'input[id*="userid" i]',
    'input[id*="user_id" i]',
    'input[id*="login" i]',
    'input[id*="email" i]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[placeholder*="用户名" i]',
    'input[placeholder*="账号" i]',
    'input[placeholder*="邮箱" i]',
    'input[placeholder*="email" i]',
    'input[placeholder*="username" i]'
  ];

  const OTP_SELECTORS = [
    'input[name="otp"]',
    'input[name="totp"]',
    'input[name="code"]',
    'input[name="token"]',
    'input[name="verification"]',
    'input[name="verify"]',
    'input[name="verifycode"]',
    'input[name="verification_code"]',
    'input[name="twofactor"]',
    'input[name="two_factor"]',
    'input[name="2fa"]',
    'input[name="authcode"]',
    'input[name="auth_code"]',
    'input[name="passcode"]',
    'input[id*="otp" i]',
    'input[id*="totp" i]',
    'input[id*="2fa" i]',
    'input[id*="twofactor" i]',
    'input[id*="two_factor" i]',
    'input[id*="verification" i]',
    'input[id*="verify" i]',
    'input[id*="code" i]',
    'input[id*="token" i]',
    'input[id*="passcode" i]',
    'input[id*="authcode" i]',
    'input[autocomplete="one-time-code"]',
    'input[inputmode="numeric"][maxlength="6"]',
    'input[inputmode="numeric"][maxlength="8"]',
    'input[type="text"][maxlength="6"]',
    'input[type="text"][maxlength="8"]',
    'input[placeholder*="验证码" i]',
    'input[placeholder*="动态" i]',
    'input[placeholder*="OTP" i]',
    'input[placeholder*="6位" i]',
    'input[placeholder*="code" i]'
  ];

  function loadData() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(['authenticator_accounts', 'authenticator_settings'], (result) => {
          state.accounts = result.authenticator_accounts || [];
          if (result.authenticator_settings) {
            state.settings = { ...state.settings, ...result.authenticator_settings };
          }
          resolve();
        });
      } catch (e) {
        resolve();
      }
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.authenticator_accounts) {
        state.accounts = changes.authenticator_accounts.newValue || [];
      }
      if (changes.authenticator_settings) {
        state.settings = { ...state.settings, ...(changes.authenticator_settings.newValue || {}) };
      }
    }
  });

  function findInputs(selectors) {
    const found = [];
    for (const sel of selectors) {
      try {
        const inputs = document.querySelectorAll(sel);
        inputs.forEach(inp => {
          if (inp && inp.offsetParent !== null && !found.includes(inp)) {
            found.push(inp);
          }
        });
      } catch (e) {}
    }
    return found;
  }

  function findUsernameInputs() {
    return findInputs(USERNAME_SELECTORS);
  }

  function findOtpInputs() {
    return findInputs(OTP_SELECTORS);
  }

  function extractHostname(urlOrHost) {
    if (!urlOrHost) return '';
    try {
      if (/^https?:\/\//i.test(urlOrHost)) {
        return new URL(urlOrHost).hostname.toLowerCase();
      }
      return urlOrHost.trim().toLowerCase();
    } catch (e) {
      return urlOrHost.trim().toLowerCase();
    }
  }

  function extractRootDomain(hostname) {
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
  }

  function matchUrl(accountUrlPattern, currentUrl, currentHostname) {
    if (!accountUrlPattern) return false;
    const pattern = String(accountUrlPattern).trim().toLowerCase();
    if (!pattern) return false;

    const host = (currentHostname || '').toLowerCase();
    const url = (currentUrl || '').toLowerCase();

    try {
      const hasWildcard = pattern.includes('*');

      if (pattern.startsWith('http://') || pattern.startsWith('https://')) {
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

      const urlWithoutProtocol = url.replace(/^https?:\/\//, '');
      if (hasWildcard) {
        const re = new RegExp(
          '^' + pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*') + '$'
        );
        return re.test(urlWithoutProtocol) || re.test(host);
      }
      const base = pattern.replace(/\/$/, '');
      return urlWithoutProtocol === base || urlWithoutProtocol.startsWith(base + '/') ||
             urlWithoutProtocol.startsWith(pattern) ||
             (host === base || host.startsWith(base + '.'));
    } catch (e) {
      return false;
    }
  }

  function findAccountsByUsername(username) {
    if (!username) return [];
    const lower = username.toLowerCase().trim();
    const currentUrl = location.href;
    const currentHost = location.hostname;

    console.groupCollapsed('%c[Authenticator] autoFill 查询', 'color:#667eea;font-weight:bold');
    console.log('用户名:', username);
    console.log('当前页面 URL:', currentUrl);
    console.log('当前 hostname:', currentHost);

    const sameUser = state.accounts.filter(a =>
      a.username && a.username.toLowerCase().trim() === lower
    );
    console.log(`按用户名匹配到 ${sameUser.length} 个账号:`, sameUser.map(a => ({
      id: a.id, serviceName: a.serviceName, username: a.username,
      loginUrl: a.loginUrl || a.sitePattern || ''
    })));

    if (sameUser.length === 0) {
      console.log('[Authenticator] 没有匹配用户名的账号，跳过');
      console.groupEnd();
      return [];
    }

    const exactUrl = [];

    for (const a of sameUser) {
      const pattern = a.loginUrl || a.sitePattern;
      const entry = { id: a.id, serviceName: a.serviceName, pattern: pattern || '(无)' };
      if (pattern && matchUrl(pattern, currentUrl, currentHost)) {
        exactUrl.push(a);
        console.log('  - exactUrl (命中):', entry);
      } else {
        console.log('  - SKIPPED (URL 不匹配):', entry);
      }
    }

    let result = [];
    if (exactUrl.length > 0) {
      result = exactUrl;
      console.log('[Authenticator] 采用 exactUrl:', exactUrl.map(a => a.serviceName));
    } else {
      console.log('[Authenticator] 没有匹配URL的账号 → 不填充');
    }

    console.log('[Authenticator] 最终结果:', result.map(a => ({ id: a.id, serviceName: a.serviceName, loginUrl: a.loginUrl || a.sitePattern || '' })));
    console.groupEnd();
    return result;
  }

  function fillInput(input, value) {
    if (!input || state.filledCodes.get(input) === value) return;
    input.value = value;
    state.filledCodes.set(input, value);

    try {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      if (typeof input.oninput === 'function') input.oninput({ target: input });
      if (typeof input.onchange === 'function') input.onchange({ target: input });
    } catch (e) {}

    showFillBadge(input);
  }

  function showFillBadge(input) {
    try {
      const rect = input.getBoundingClientRect();
      const badge = document.createElement('div');
      badge.textContent = '🔐 已自动填充';
      badge.style.cssText = `
        position: fixed;
        top: ${rect.top + window.scrollY - 26}px;
        left: ${rect.left + window.scrollX}px;
        background: linear-gradient(135deg, #10b981, #059669);
        color: white;
        padding: 3px 10px;
        border-radius: 6px;
        font-size: 11px;
        font-family: -apple-system, sans-serif;
        z-index: 2147483647;
        box-shadow: 0 2px 8px rgba(16,185,129,0.4);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s, transform 0.3s;
        transform: translateY(4px);
      `;
      document.body.appendChild(badge);
      requestAnimationFrame(() => {
        badge.style.opacity = '1';
        badge.style.transform = 'translateY(0)';
      });
      setTimeout(() => {
        badge.style.opacity = '0';
        badge.style.transform = 'translateY(-4px)';
        setTimeout(() => badge.remove(), 400);
      }, 2500);
    } catch (e) {}
  }

  async function autoFillForUsername(username) {
    if (!state.settings.autoFill) return;
    const matches = findAccountsByUsername(username);
    if (matches.length === 0) {
      console.log('%c[Authenticator] 无匹配账号，不填充', 'color:#94a3b8');
      return;
    }

    const account = matches[0];
    try {
      const code = await TOTP.generateTOTP(account.secret, {
        digits: parseInt(account.digits) || 6,
        period: parseInt(account.period) || 30
      });
      console.log('%c[Authenticator] 即将填充验证码', 'color:#10b981;font-weight:bold',
        { serviceName: account.serviceName, username: account.username,
          loginUrl: account.loginUrl || account.sitePattern || '', code });

      const otpInputs = findOtpInputs();
      console.log('[Authenticator] 找到 OTP 输入框数量:', otpInputs.length);
      for (const inp of otpInputs) {
        if (inp && inp.offsetParent !== null) {
          fillInput(inp, code);
        }
      }

      if (otpInputs.length === 0) {
        scheduleRetryFill(account, code);
        console.log('[Authenticator] 当前页面没找到 OTP 输入框，启动定时重试填充（最多10次 × 800ms）');
      }
    } catch (e) {
      console.error('[Authenticator] 生成验证码失败:', e);
    }
  }

  function scheduleRetryFill(account, code) {
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      if (attempts > 10) {
        clearInterval(timer);
        return;
      }
      const otpInputs = findOtpInputs();
      for (const inp of otpInputs) {
        if (inp && inp.offsetParent !== null && !state.filledCodes.has(inp)) {
          fillInput(inp, code);
          clearInterval(timer);
          return;
        }
      }
    }, 800);
  }

  function setupUsernameListeners() {
    const inputs = findUsernameInputs();
    for (const input of inputs) {
      if (state.filledFields.has(input)) continue;
      state.filledFields.add(input);

      if (input.value) {
        handleUsernameChange(input.value);
      }

      input.addEventListener('change', (e) => {
        handleUsernameChange(e.target.value);
      });
      input.addEventListener('blur', (e) => {
        handleUsernameChange(e.target.value);
      });
    }
  }

  function setupGlobalClickListener() {
    document.addEventListener('click', (e) => {
      const target = e.target;
      const isUsernameInput = target && target.tagName === 'INPUT' && (
        USERNAME_SELECTORS.some(sel => {
          try { return target.matches(sel); } catch (e) { return false; }
        })
      );

      if (!isUsernameInput) {
        const inputs = findUsernameInputs();
        for (const input of inputs) {
          if (document.activeElement !== input) {
            handleUsernameChange(input.value);
          }
        }
      }
    }, true);
  }

  function handleUsernameChange(value) {
    const v = value.trim();
    if (v && v !== state.lastUsername) {
      console.log('%c[Authenticator] 用户名变更:', 'color:#667eea',
        state.lastUsername ? `${state.lastUsername} → ${v}` : v);
      state.lastUsername = v;
      autoFillForUsername(v);
    }
  }

  function observeDOM() {
    const observer = new MutationObserver(() => {
      setupUsernameListeners();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function setupMessageListener() {
    try {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg && msg.type === 'FILL_OTP' && msg.code) {
          const otpInputs = findOtpInputs();
          for (const inp of otpInputs) {
            if (inp && inp.offsetParent !== null) {
              fillInput(inp, msg.code);
            }
          }
          sendResponse({ filled: otpInputs.length });
        }
        return true;
      });
    } catch (e) {}
  }

  async function init() {
    await loadData();
    console.log('%c[Authenticator] 插件初始化 (content script)', 'color:#764ba2;font-weight:bold',
      { url: location.href, autoFill: state.settings.autoFill, accountsCount: state.accounts.length });
    setupUsernameListeners();
    setupGlobalClickListener();
    observeDOM();
    setupMessageListener();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
