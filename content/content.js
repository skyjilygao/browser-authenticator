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
    filledCodes: new Map(),
    pickingActive: false
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
    'input[placeholder*="谷歌验证码" i]',
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

  function findOtpInputsBySelector(selector) {
    if (!selector || typeof selector !== 'string') return [];
    const found = [];
    try {
      const inputs = document.querySelectorAll(selector);
      inputs.forEach(inp => {
        if (inp && inp.offsetParent !== null && !found.includes(inp)) {
          found.push(inp);
        }
      });
    } catch (e) {
      console.warn('[Authenticator] 自定义 optSelector 查找失败:', selector, e.message);
    }
    return found;
  }

  function buildUniqueSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    const attr = (name) => (el.getAttribute ? el.getAttribute(name) : null);
    const esc = (v) => { try { return CSS.escape(v); } catch (e) { return String(v); } };
    const isUnique = (sel) => {
      try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; }
    };

    console.log('[Authenticator BuildSelector] 元素:', tag, 'id=', attr('id'), 'class=', attr('class'), 'placeholder=', attr('placeholder'));

    const ph = attr('placeholder');
    if (ph) {
      const sel = `${tag}[placeholder="${esc(ph)}"]`;
      console.log('[Authenticator BuildSelector] 尝试 placeholder:', sel, '命中', document.querySelectorAll(sel).length);
      if (isUnique(sel)) return sel;
    }

    const name = attr('name');
    if (name) {
      const sel = `${tag}[name="${esc(name)}"]`;
      console.log('[Authenticator BuildSelector] 尝试 name:', sel, '命中', document.querySelectorAll(sel).length);
      if (isUnique(sel)) return sel;
    }

    const ac = attr('autocomplete');
    if (ac) {
      const sel = `${tag}[autocomplete="${esc(ac)}"]`;
      console.log('[Authenticator BuildSelector] 尝试 autocomplete:', sel, '命中', document.querySelectorAll(sel).length);
      if (isUnique(sel)) return sel;
    }

    const type = attr('type');
    if (type && ph) {
      const sel = `${tag}[type="${esc(type)}"][placeholder="${esc(ph)}"]`;
      console.log('[Authenticator BuildSelector] 尝试 type+placeholder:', sel, '命中', document.querySelectorAll(sel).length);
      if (isUnique(sel)) return sel;
    }

    const classes = (el.className && typeof el.className === 'string')
      ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    if (classes.length) {
      const sel = `${tag}.${classes.map(esc).join('.')}`;
      console.log('[Authenticator BuildSelector] 尝试 class:', sel, '命中', document.querySelectorAll(sel).length);
      if (isUnique(sel)) return sel;

      if (ph) {
        const sel2 = `${tag}.${classes.map(esc).join('.')}[placeholder="${esc(ph)}"]`;
        console.log('[Authenticator BuildSelector] 尝试 class+placeholder:', sel2, '命中', document.querySelectorAll(sel2).length);
        if (isUnique(sel2)) return sel2;
      }
      if (name) {
        const sel3 = `${tag}.${classes.map(esc).join('.')}[name="${esc(name)}"]`;
        console.log('[Authenticator BuildSelector] 尝试 class+name:', sel3, '命中', document.querySelectorAll(sel3).length);
        if (isUnique(sel3)) return sel3;
      }
    }

    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      const nodeClasses = (node.className && typeof node.className === 'string')
        ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
      if (nodeClasses.length) {
        part += '.' + nodeClasses.map(esc).join('.');
      }
      const parent = node.parentNode;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(node) + 1;
          part += `:nth-of-type(${idx})`;
        }
      }
      parts.unshift(part);
      const candidate = parts.join(' > ');
      try {
        if (document.querySelectorAll(candidate).length === 1) {
          console.log('[Authenticator BuildSelector] 路径方式命中唯一:', candidate);
          return candidate;
        }
      } catch (e) {}
      node = parent;
    }
    const finalSel = parts.join(' > ');
    console.log('[Authenticator BuildSelector] 最终路径:', finalSel);
    return finalSel;
  }

  function enterPickMode(sendResponse) {
    if (state.pickingActive) {
      console.warn('[Authenticator Pick] 已在拾取模式中');
      if (sendResponse) sendResponse({ error: '已在拾取模式中' });
      return;
    }
    state.pickingActive = true;
    console.log('%c[Authenticator Pick] 进入拾取模式', 'color:#667eea;font-weight:bold');

    const overlay = document.createElement('div');
    overlay.id = '__authenticator_pick_overlay__';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(102,126,234,0.08); z-index: 2147483646;
      cursor: crosshair; pointer-events: auto;
    `;
    const tip = document.createElement('div');
    tip.style.cssText = `
      position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
      background: linear-gradient(135deg, #667eea, #764ba2); color: white;
      padding: 10px 20px; border-radius: 8px; font-size: 14px;
      font-family: -apple-system, sans-serif; z-index: 2147483647;
      box-shadow: 0 4px 16px rgba(102,126,234,0.4); pointer-events: none;
    `;
    tip.textContent = '🔐 请点击登录页面中的「动态密钥/验证码输入框」';
    const cancelTip = document.createElement('div');
    cancelTip.style.cssText = `
      position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
      background: rgba(239,68,68,0.9); color: white;
      padding: 6px 16px; border-radius: 6px; font-size: 12px;
      font-family: -apple-system, sans-serif; z-index: 2147483647;
      box-shadow: 0 2px 8px rgba(239,68,68,0.3); pointer-events: none;
    `;
    cancelTip.textContent = '按 Esc 取消拾取';
    document.body.appendChild(overlay);
    document.body.appendChild(tip);
    document.body.appendChild(cancelTip);

    function cleanup() {
      state.pickingActive = false;
      overlay.remove();
      tip.remove();
      cancelTip.remove();
      document.removeEventListener('keydown', onKey, true);
      console.log('[Authenticator Pick] 清理拾取模式');
    }

    function onKey(e) {
      console.log('[Authenticator Pick] keydown:', e.key);
      if (e.key === 'Escape') {
        cleanup();
        if (sendResponse) sendResponse({ cancelled: true });
        sendResponse = null;
      }
    }

    function onOverlayClick(e) {
      console.log('[Authenticator Pick] overlay click at', e.clientX, e.clientY, 'target=', e.target);
      overlay.style.display = 'none';
      const realTarget = document.elementFromPoint(e.clientX, e.clientY);
      overlay.style.display = '';
      console.log('[Authenticator Pick] elementFromPoint ->', realTarget, realTarget ? `(${realTarget.tagName})` : '(null)');

      if (!realTarget) {
        console.warn('[Authenticator Pick] 未获取到真实元素');
        return;
      }
      const isInput = realTarget.tagName === 'INPUT' || realTarget.tagName === 'TEXTAREA';
      if (!isInput) {
        console.log('[Authenticator Pick] 点击的不是 input/textarea:', realTarget.tagName, realTarget);
        tip.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
        tip.textContent = '✗ 请点击输入框（input/textarea），而非其他元素';
        setTimeout(() => {
          tip.style.background = 'linear-gradient(135deg, #667eea, #764ba2)';
          tip.textContent = '🔐 请点击登录页面中的「动态密钥/验证码输入框」';
        }, 1500);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const selector = buildUniqueSelector(realTarget);
      console.log('%c[Authenticator Pick] 拾取成功 selector:', 'color:#10b981;font-weight:bold', selector);
      console.log('[Authenticator Pick] 验证 selector 唯一性:', document.querySelectorAll(selector).length, '个匹配');
      cleanup();
      try {
        chrome.storage.local.set({ authenticator_picked_selector: { selector, url: location.href, pickedAt: Date.now() } });
        console.log('[Authenticator Pick] 已存入 storage.local');
      } catch (err) {
        console.error('[Authenticator Pick] 存入 storage.local 失败:', err);
      }
      if (sendResponse) {
        sendResponse({ selector, url: location.href });
        sendResponse = null;
      }
    }

    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', onOverlayClick);
    console.log('[Authenticator Pick] 事件监听已绑定 (overlay.click + document.keydown)');
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

      const customSelector = (account.optSelector || '').trim();
      let otpInputs = [];
      if (customSelector) {
        otpInputs = findOtpInputsBySelector(customSelector);
        console.log('[Authenticator] 使用自定义 optSelector:', customSelector, '找到', otpInputs.length, '个输入框');
      }
      if (otpInputs.length === 0) {
        otpInputs = findOtpInputs();
        if (customSelector) {
          console.log('[Authenticator] 自定义 selector 未命中，回退默认选择器，找到', otpInputs.length, '个');
        } else {
          console.log('[Authenticator] 找到 OTP 输入框数量:', otpInputs.length);
        }
      }
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
    const customSelector = (account && account.optSelector || '').trim();
    const timer = setInterval(async () => {
      attempts++;
      if (attempts > 10) {
        clearInterval(timer);
        return;
      }
      let otpInputs = [];
      if (customSelector) {
        otpInputs = findOtpInputsBySelector(customSelector);
      }
      if (otpInputs.length === 0) {
        otpInputs = findOtpInputs();
      }
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
          let otpInputs = [];
          const customSelector = (msg.optSelector || '').trim();
          if (customSelector) {
            otpInputs = findOtpInputsBySelector(customSelector);
          }
          if (otpInputs.length === 0) {
            otpInputs = findOtpInputs();
          }
          for (const inp of otpInputs) {
            if (inp && inp.offsetParent !== null) {
              fillInput(inp, msg.code);
            }
          }
          sendResponse({ filled: otpInputs.length });
        }
        if (msg && msg.type === 'PICK_OTP_INPUT') {
          enterPickMode(sendResponse);
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
