(function (global) {
  'use strict';

  const KEY_ACCOUNTS = 'authenticator_accounts';
  const KEY_SETTINGS = 'authenticator_settings';
  const KEY_META = 'authenticator_meta';
  const SCHEMA_VERSION = 2;

  const STORAGE = {
    KEY_ACCOUNTS,
    KEY_SETTINGS,
    KEY_META,
    SCHEMA_VERSION,

    async _ensureSchema() {
      try {
        const meta = await chrome.storage.sync.get(KEY_META);
        const current = (meta && meta[KEY_META] && meta[KEY_META].schemaVersion) || 0;
        if (current < SCHEMA_VERSION) {
          if (current < 1) {
            await this._migrateV0ToV1();
          }
          if (current < 2) {
            await this._migrateV1ToV2();
          }
          await chrome.storage.sync.set({
            [KEY_META]: { schemaVersion: SCHEMA_VERSION, migratedAt: Date.now() }
          });
        }
      } catch (e) {
        console.warn('[Storage] schema migration skipped', e);
      }
    },

    async _migrateV0ToV1() {
      const old = await chrome.storage.local.get([KEY_ACCOUNTS, KEY_SETTINGS]);
      if (old[KEY_ACCOUNTS] && Array.isArray(old[KEY_ACCOUNTS]) && old[KEY_ACCOUNTS].length > 0) {
        await chrome.storage.sync.set({ [KEY_ACCOUNTS]: old[KEY_ACCOUNTS] });
        await chrome.storage.local.remove(KEY_ACCOUNTS);
      }
      if (old[KEY_SETTINGS]) {
        await chrome.storage.sync.set({ [KEY_SETTINGS]: old[KEY_SETTINGS] });
        await chrome.storage.local.remove(KEY_SETTINGS);
      }
    },

    async _migrateV1ToV2() {
      const accounts = await this.getAccounts();
      let changed = false;
      for (const a of accounts) {
        if (!a.id) { a.id = this.genId(); changed = true; }
        if (!a.createdAt) { a.createdAt = Date.now(); changed = true; }
        if (!a.group) { a.group = ''; changed = true; }
        if (!Array.isArray(a.tags)) { a.tags = []; changed = true; }
        if (!a.loginUrl && a.sitePattern) {
          a.loginUrl = a.sitePattern;
          changed = true;
        }
      }
      if (changed) {
        await chrome.storage.sync.set({ [KEY_ACCOUNTS]: accounts });
      }
    },

    genId() {
      return 'acc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    },

    async init() {
      await this._ensureSchema();
    },

    async getAccounts() {
      const result = await chrome.storage.sync.get(KEY_ACCOUNTS);
      const arr = result[KEY_ACCOUNTS] || [];
      return Array.isArray(arr) ? arr : [];
    },

    async setAccounts(accounts) {
      await chrome.storage.sync.set({ [KEY_ACCOUNTS]: accounts });
    },

    async addAccount(account) {
      const accounts = await this.getAccounts();
      const now = Date.now();
      const newAccount = Object.assign(
        { id: this.genId(), createdAt: now, updatedAt: now },
        {
          serviceName: '',
          username: '',
          loginUrl: '',
          secret: '',
          issuer: '',
          algorithm: 'SHA-1',
          digits: 6,
          period: 30,
          group: '',
          tags: [],
          optSelector: ''
        },
        account
      );
      if (!newAccount.secret) throw new Error('缺少密钥(secret)');
      if (!TOTP || !TOTP.isValidBase32 || !TOTP.isValidBase32(newAccount.secret)) {
        const valid = /^[A-Za-z2-7\s=]+$/.test(newAccount.secret || '');
        if (!valid) throw new Error('密钥格式无效');
      }
      if (Array.isArray(newAccount.tags)) {
        newAccount.tags = this._uniqueTags(newAccount.tags);
      } else if (typeof newAccount.tags === 'string' && newAccount.tags) {
        newAccount.tags = this._uniqueTags(newAccount.tags.split(/[,，;；\s]+/).filter(Boolean));
      } else {
        newAccount.tags = [];
      }
      if (typeof newAccount.group === 'string') newAccount.group = newAccount.group.trim();
      if (!newAccount.username) throw new Error('请填写用户名，用于登录页自动关联');
      accounts.push(newAccount);
      await this.setAccounts(accounts);
      return newAccount;
    },

    async updateAccount(id, patch) {
      const accounts = await this.getAccounts();
      const idx = accounts.findIndex(a => a.id === id);
      if (idx < 0) throw new Error('身份不存在');
      const merged = Object.assign({}, accounts[idx], patch, { id, updatedAt: Date.now() });
      if (Array.isArray(merged.tags)) {
        merged.tags = this._uniqueTags(merged.tags);
      } else if (typeof merged.tags === 'string' && merged.tags) {
        merged.tags = this._uniqueTags(merged.tags.split(/[,，;；\s]+/).filter(Boolean));
      } else {
        merged.tags = [];
      }
      if (typeof merged.group === 'string') merged.group = merged.group.trim();
      accounts[idx] = merged;
      await this.setAccounts(accounts);
      return merged;
    },

    async deleteAccount(id) {
      const accounts = await this.getAccounts();
      const next = accounts.filter(a => a.id !== id);
      await this.setAccounts(next);
    },

    _uniqueTags(tags) {
      const seen = new Set();
      const out = [];
      for (const t of tags) {
        const v = String(t).trim();
        if (!v) continue;
        if (!seen.has(v.toLowerCase())) {
          seen.add(v.toLowerCase());
          out.push(v);
        }
      }
      return out;
    },

    async getSettings() {
      const result = await chrome.storage.sync.get(KEY_SETTINGS);
      return Object.assign(
        { autoFill: true, copyOnClick: true, sortBy: 'createdAt', hideExpiredWarning: false },
        result[KEY_SETTINGS] || {}
      );
    },

    async updateSettings(patch) {
      const current = await this.getSettings();
      const next = Object.assign({}, current, patch);
      await chrome.storage.sync.set({ [KEY_SETTINGS]: next });
      return next;
    },

    async saveSettings(settings) {
      return this.updateSettings(settings);
    },

    async getAllGroups() {
      const accounts = await this.getAccounts();
      const map = new Map();
      for (const a of accounts) {
        const g = (a.group || '').trim();
        if (!g) continue;
        map.set(g.toLowerCase(), (map.get(g.toLowerCase()) || 0) + 1);
      }
      const result = [];
      for (const a of accounts) {
        const g = (a.group || '').trim();
        if (!g) continue;
        if (!result.find(r => r.name.toLowerCase() === g.toLowerCase())) {
          result.push({ name: g, count: map.get(g.toLowerCase()) });
        }
      }
      result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      return result;
    },

    async getAllTags() {
      const accounts = await this.getAccounts();
      const count = new Map();
      const display = new Map();
      for (const a of accounts) {
        if (!Array.isArray(a.tags)) continue;
        for (const t of a.tags) {
          const k = String(t).trim();
          if (!k) continue;
          const low = k.toLowerCase();
          count.set(low, (count.get(low) || 0) + 1);
          if (!display.has(low)) display.set(low, k);
        }
      }
      const result = [];
      for (const [low, c] of count.entries()) {
        result.push({ name: display.get(low), count: c });
      }
      result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      return result;
    },

    async renameGroup(oldName, newName) {
      const oldTrim = String(oldName || '').trim();
      const newTrim = String(newName || '').trim();
      if (!oldTrim) return 0;
      const accounts = await this.getAccounts();
      let changed = 0;
      for (const a of accounts) {
        if ((a.group || '').trim() === oldTrim) {
          a.group = newTrim;
          a.updatedAt = Date.now();
          changed++;
        }
      }
      if (changed > 0) await this.setAccounts(accounts);
      return changed;
    },

    async deleteGroup(groupName, migrateTo) {
      const g = String(groupName || '').trim();
      if (!g) return 0;
      const accounts = await this.getAccounts();
      let changed = 0;
      for (const a of accounts) {
        if ((a.group || '').trim() === g) {
          a.group = migrateTo ? String(migrateTo).trim() : '';
          a.updatedAt = Date.now();
          changed++;
        }
      }
      if (changed > 0) await this.setAccounts(accounts);
      return changed;
    },

    async renameTag(oldName, newName) {
      const oldTrim = String(oldName || '').trim();
      const newTrim = String(newName || '').trim();
      if (!oldTrim) return 0;
      const accounts = await this.getAccounts();
      let changed = 0;
      for (const a of accounts) {
        if (!Array.isArray(a.tags)) a.tags = [];
        const tags = a.tags.map(String);
        const i = tags.findIndex(t => t.trim().toLowerCase() === oldTrim.toLowerCase());
        if (i >= 0) {
          tags[i] = newTrim;
          a.tags = this._uniqueTags(tags);
          a.updatedAt = Date.now();
          changed++;
        }
      }
      if (changed > 0) await this.setAccounts(accounts);
      return changed;
    },

    async getAllServices() {
      const accounts = await this.getAccounts();
      const map = new Map();
      const display = new Map();
      for (const a of accounts) {
        const s = String(a.serviceName || a.issuer || '').trim();
        if (!s) continue;
        const low = s.toLowerCase();
        map.set(low, (map.get(low) || 0) + 1);
        if (!display.has(low)) display.set(low, s);
      }
      const result = [];
      for (const [low, c] of map.entries()) {
        result.push({ name: display.get(low), count: c });
      }
      result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      return result;
    },

    async deleteTag(tagName, migrateTo) {
      const g = String(tagName || '').trim();
      if (!g) return 0;
      const accounts = await this.getAccounts();
      let changed = 0;
      for (const a of accounts) {
        if (!Array.isArray(a.tags)) a.tags = [];
        const tags = a.tags.map(String);
        const i = tags.findIndex(t => t.trim().toLowerCase() === g.toLowerCase());
        if (i >= 0) {
          if (migrateTo) {
            tags[i] = String(migrateTo).trim();
          } else {
            tags.splice(i, 1);
          }
          a.tags = this._uniqueTags(tags);
          a.updatedAt = Date.now();
          changed++;
        }
      }
      if (changed > 0) await this.setAccounts(accounts);
      return changed;
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
      if (!username) return [];
      const lower = username.toLowerCase().trim();
      const sameUser = accounts.filter(a =>
        a.username && a.username.toLowerCase().trim() === lower
      );
      if (sameUser.length === 0) return [];
      if (!url) return sameUser;

      const hostname = this.extractHostname(url);
      const exact = [];
      const root = [];
      const noUrl = [];
      for (const a of sameUser) {
        const p = a.loginUrl || a.sitePattern;
        if (!p) {
          noUrl.push(a);
        } else if (this.matchUrl(p, url, hostname)) {
          exact.push(a);
        } else {
          const ph = this.extractHostname(p);
          if (this.extractRootDomain(ph) === this.extractRootDomain(hostname)) {
            root.push(a);
          }
        }
      }
      if (exact.length > 0) return exact;
      if (root.length > 0) return root;
      return noUrl.length > 0 ? noUrl : sameUser;
    },

    async exportOtpaUris() {
      const accounts = await this.getAccounts();
      return accounts.map(a => UriSerializer.toOtpauthUri(a));
    },

    async _findDuplicateAccount(serviceName, username) {
      const accounts = await this.getAccounts();
      const sn = String(serviceName || '').trim().toLowerCase();
      const un = String(username || '').trim().toLowerCase();
      return accounts.find(a =>
        String(a.serviceName || a.issuer || '').trim().toLowerCase() === sn &&
        String(a.username || a.account || '').trim().toLowerCase() === un
      ) || null;
    },

    async importOtpaUris(text, options) {
      const parsed = UriSerializer.parseMany(text);
      let imported = 0;
      let skipped = 0;
      let updated = 0;
      const errors = [];
      for (const p of parsed) {
        try {
          const data = Object.assign({}, p);
          if (options && options.defaultGroup) data.group = options.defaultGroup;
          if (options && options.defaultTags && options.defaultTags.length) {
            data.tags = (p.tags || []).concat(options.defaultTags);
          }
          if (options && options.overrideLoginUrl && p.loginUrl == null) {
            data.loginUrl = options.overrideLoginUrl;
          }
          const dup = await this._findDuplicateAccount(
            data.serviceName || data.issuer || '',
            data.username || data.account || ''
          );
          if (dup) {
            const oldLogin = (dup.loginUrl || dup.sitePattern || '').trim();
            const newLogin = (data.loginUrl || data.sitePattern || '').trim();
            if (!oldLogin && newLogin) {
              await this.updateAccount(dup.id, { loginUrl: newLogin });
              updated++;
            } else {
              skipped++;
            }
            continue;
          }
          await this.addAccount(data);
          imported++;
        } catch (e) {
          errors.push({ data: p, message: e.message });
        }
      }
      return { imported, skipped, updated, errors, total: parsed.length };
    },

    async exportPlainJson() {
      return {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        accounts: await this.getAccounts(),
        settings: await this.getSettings()
      };
    },

    async importPlainJson(obj) {
      if (!obj || !Array.isArray(obj.accounts)) throw new Error('JSON格式不正确（缺少accounts数组）');
      let imported = 0, skipped = 0, updated = 0, errors = 0;
      for (const a of obj.accounts) {
        try {
          const data = {
            serviceName: a.serviceName || a.issuer || '',
            username: a.username || a.account || '',
            secret: a.secret || '',
            issuer: a.issuer || '',
            algorithm: a.algorithm || 'SHA-1',
            digits: parseInt(a.digits) || 6,
            period: parseInt(a.period) || 30,
            loginUrl: a.loginUrl || a.sitePattern || '',
            sitePattern: a.sitePattern || '',
            group: a.group || '',
            tags: Array.isArray(a.tags) ? a.tags : [],
            optSelector: a.optSelector || ''
          };
          const dup = await this._findDuplicateAccount(data.serviceName, data.username);
          if (dup) {
            const oldLogin = (dup.loginUrl || dup.sitePattern || '').trim();
            const newLogin = (data.loginUrl || data.sitePattern || '').trim();
            if (!oldLogin && newLogin) {
              await this.updateAccount(dup.id, { loginUrl: newLogin });
              updated++;
            } else {
              skipped++;
            }
            continue;
          }
          await this.addAccount(data);
          imported++;
        } catch (e) {
          errors++;
        }
      }
      return { imported, skipped, updated, errors, total: obj.accounts.length };
    },

    async importGoogleMigrationPayload(bytes) {
      const parsed = GoogleMigration.parse(bytes);
      return this.importOtpaUris(parsed.uris.join('\n'));
    },

    async exportData() {
      return this.exportPlainJson();
    },

    async importData(obj) {
      const result = await this.importPlainJson(obj);
      return result.imported;
    },

    async exportOtpaUrisText() {
      const uris = await this.exportOtpaUris();
      return uris.join('\n');
    },

    parseTextAndImport(text, options) {
      const t = String(text || '').trim();
      if (t.toLowerCase().startsWith('otpauth-migration://')) {
        return this.importGoogleMigrationPayload(t);
      }
      if (t.startsWith('{') || t.startsWith('[')) {
        try {
          const obj = JSON.parse(t);
          return this.importPlainJson(obj).then(r => ({
            imported: r.imported, skipped: r.skipped || 0, updated: r.updated || 0,
            errors: r.errors, total: r.total
          }));
        } catch (e) {
        }
      }
      return this.importOtpaUris(t, options);
    }
  };

  const UriSerializer = {
    normalizeAlgorithm(v) {
      const s = String(v || 'SHA1').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (s === 'SHA256') return 'SHA256';
      if (s === 'SHA512') return 'SHA512';
      return 'SHA1';
    },
    toWebCryptoAlg(s) {
      const n = this.normalizeAlgorithm(s);
      if (n === 'SHA256') return 'SHA-256';
      if (n === 'SHA512') return 'SHA-512';
      return 'SHA-1';
    },
    fromWebCryptoAlg(s) {
      return this.normalizeAlgorithm(s);
    },
    toOtpauthUri(account) {
      const labelParts = [];
      const issuer = (account.issuer || account.serviceName || '').trim();
      const username = (account.username || account.account || '').trim();
      if (issuer) labelParts.push(encodeURIComponent(issuer));
      if (username) labelParts.push(encodeURIComponent(username));
      if (labelParts.length === 0) labelParts.push(encodeURIComponent(account.id || 'account'));
      const label = labelParts.join(':');

      const params = new URLSearchParams();
      if (account.secret) params.set('secret', String(account.secret).trim().toUpperCase().replace(/\s+/g, ''));
      if (issuer) params.set('issuer', issuer);
      const alg = this.fromWebCryptoAlg(account.algorithm || 'SHA-1');
      if (alg !== 'SHA1') params.set('algorithm', alg);
      const digits = parseInt(account.digits) || 6;
      if (digits !== 6) params.set('digits', String(digits));
      const period = parseInt(account.period) || 30;
      if (period !== 30) params.set('period', String(period));

      const extParams = [];
      const loginUrl = (account.loginUrl || account.sitePattern || '').trim();
      if (loginUrl) extParams.push('site=' + encodeURIComponent(loginUrl));
      const serviceName = (account.serviceName || '').trim();
      if (serviceName && serviceName !== issuer) {
        extParams.push('service=' + encodeURIComponent(serviceName));
      }
      const group = (account.group || '').trim();
      if (group) extParams.push('group=' + encodeURIComponent(group));
      if (Array.isArray(account.tags) && account.tags.length) {
        extParams.push('tags=' + encodeURIComponent(account.tags.filter(Boolean).map(String).join(',')));
      }
      const optSelector = (account.optSelector || '').trim();
      if (optSelector) extParams.push('optSelector=' + encodeURIComponent(optSelector));

      let qs = params.toString();
      if (extParams.length) qs += (qs ? '&' : '') + extParams.join('&');
      return 'otpauth://totp/' + label + (qs ? '?' + qs : '');
    },
    parseOne(uri) {
      const s = String(uri || '').trim();
      if (!s) return null;
      if (!s.toLowerCase().startsWith('otpauth://totp/')) {
        if (s.toLowerCase().startsWith('otpauth://hotp/')) {
          throw new Error('暂不支持 HOTP（仅支持 TOTP 时间型）');
        }
        return null;
      }
      const rest = s.slice('otpauth://totp/'.length);
      const qIdx = rest.indexOf('?');
      const labelRaw = qIdx >= 0 ? decodeURIComponent(rest.slice(0, qIdx)) : decodeURIComponent(rest);
      const qs = qIdx >= 0 ? rest.slice(qIdx + 1) : '';
      const params = new URLSearchParams(qs);

      let issuer = params.get('issuer') || '';
      let username = '';
      let serviceName = '';
      if (labelRaw) {
        const colon = labelRaw.indexOf(':');
        if (colon >= 0) {
          const left = labelRaw.slice(0, colon).trim();
          const right = labelRaw.slice(colon + 1).trim();
          if (!issuer) issuer = left;
          username = right || left;
        } else {
          username = labelRaw.trim();
        }
      }
      if (!issuer) issuer = '';
      if (!username) username = issuer || '';
      serviceName = params.get('service') || issuer || '';

      const secret = (params.get('secret') || '').trim().toUpperCase().replace(/\s+/g, '');
      if (!secret) throw new Error('缺少 secret 参数');

      const algorithm = this.toWebCryptoAlg(params.get('algorithm') || 'SHA1');
      const digits = parseInt(params.get('digits')) || 6;
      const period = parseInt(params.get('period')) || 30;
      const loginUrl = params.get('site') || params.get('loginUrl') || '';
      const group = params.get('group') || '';
      const tagsRaw = params.get('tags') || '';
      const tags = tagsRaw ? tagsRaw.split(/[,，;；\s]+/).filter(Boolean) : [];
      const optSelector = params.get('optSelector') || '';

      return {
        type: 'totp',
        serviceName,
        issuer,
        username,
        account: username,
        secret,
        algorithm,
        digits,
        period,
        loginUrl,
        sitePattern: loginUrl,
        group,
        tags,
        optSelector
      };
    },
    parseMany(text) {
      const out = [];
      if (!text) return out;
      const candidates = [];
      const t = String(text);
      const m = t.match(/otpauth:\/\/[^\s"'<>\]\)]+/gi);
      if (m && m.length) {
        candidates.push(...m);
      }
      const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const l of lines) {
        if (/^otpauth:\/\//i.test(l)) candidates.push(l);
      }
      const seen = new Set();
      for (const c of candidates) {
        const key = c.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const p = this.parseOne(c);
          if (p) out.push(p);
        } catch (e) {
          console.warn('[UriSerializer] skip:', c, e.message);
        }
      }
      return out;
    }
  };

  const GoogleMigration = {
    _base32Decode(src) {
      const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      const s = String(src || '').toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
      let bits = '';
      for (let i = 0; i < s.length; i++) {
        const v = ALPHA.indexOf(s[i]);
        if (v < 0) continue;
        bits += v.toString(2).padStart(5, '0');
      }
      const bytes = [];
      for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.substring(i, i + 8), 2));
      }
      return new Uint8Array(bytes);
    },
    _readVarint(bytes, pos) {
      let result = 0;
      let shift = 0;
      let p = pos;
      while (p < bytes.length) {
        const b = bytes[p++];
        result |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      return { value: result, pos: p };
    },
    _readLengthDelimited(bytes, pos) {
      const { value: len, pos: p2 } = this._readVarint(bytes, pos);
      const end = p2 + len;
      const buf = bytes.slice(p2, end);
      return { value: buf, pos: end };
    },
    _decodeUtf8(bytes) {
      try {
        return new TextDecoder('utf-8').decode(bytes);
      } catch (e) {
        return String.fromCharCode.apply(null, Array.from(bytes));
      }
    },
    _parseMigrationPayload(bytes) {
      const otps = [];
      let pos = 0;
      while (pos < bytes.length) {
        const tagByte = bytes[pos++];
        const fieldNo = tagByte >>> 3;
        const wireType = tagByte & 0x7;
        if (wireType !== 2) {
          const vi = this._readVarint(bytes, pos - 1);
          pos = vi.pos;
          continue;
        }
        const { value: chunk, pos: p2 } = this._readLengthDelimited(bytes, pos);
        pos = p2;
        if (fieldNo === 1) {
          let ip = 0;
          const otp = {};
          while (ip < chunk.length) {
            const tb = chunk[ip++];
            const fn = tb >>> 3;
            const wt = tb & 0x7;
            if (wt === 2) {
              const r = this._readLengthDelimited(chunk, ip);
              ip = r.pos;
              const s = this._decodeUtf8(r.value);
              if (fn === 1) otp.secret_b32 = this._toBase32(r.value);
              else if (fn === 2) otp.name = s;
              else if (fn === 3) otp.issuer = s;
              else if (fn === 4) { if (r.value && r.value.length) otp.algorithm = r.value[0]; }
              else if (fn === 5) { if (r.value && r.value.length) otp.digits = r.value[0]; }
              else if (fn === 6) { if (r.value && r.value.length) otp.type = r.value[0]; }
              else if (fn === 7) otp.counter = 0;
            } else if (wt === 0) {
              const vi = this._readVarint(chunk, ip);
              ip = vi.pos;
              if (fn === 4) otp.algorithm = vi.value;
              else if (fn === 5) otp.digits = vi.value;
              else if (fn === 6) otp.type = vi.value;
              else if (fn === 7) otp.counter = vi.value;
            } else {
              const vi = this._readVarint(chunk, ip);
              ip = vi.pos;
            }
          }
          otps.push(otp);
        }
      }
      return otps;
    },
    _toBase32(bytes) {
      const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let out = '';
      let buffer = 0;
      let bits = 0;
      for (let i = 0; i < bytes.length; i++) {
        buffer = (buffer << 8) | (bytes[i] & 0xff);
        bits += 8;
        while (bits >= 5) {
          out += ALPHA[(buffer >>> (bits - 5)) & 0x1f];
          bits -= 5;
        }
      }
      if (bits > 0) {
        out += ALPHA[(buffer << (5 - bits)) & 0x1f];
      }
      while (out.length % 8) out += '=';
      return out;
    },
    parse(migrationUriOrBytes) {
      let bytes;
      if (typeof migrationUriOrBytes === 'string') {
        const s = migrationUriOrBytes.trim();
        if (s.toLowerCase().startsWith('otpauth-migration://')) {
          const u = new URL(s);
          const data = u.searchParams.get('data');
          if (!data) throw new Error('migration URI 缺少 data 参数');
          bytes = this._base32Decode(data.replace(/%20/g, '+').replace(/\s+/g, ''));
        } else {
          bytes = this._base32Decode(s);
        }
      } else if (migrationUriOrBytes instanceof Uint8Array) {
        bytes = migrationUriOrBytes;
      } else {
        throw new Error('Google Migration 参数类型不支持');
      }
      const otps = this._parseMigrationPayload(bytes);
      const algMap = { 1: 'SHA1', 2: 'SHA256', 3: 'SHA512', 4: 'MD5' };
      const digMap = { 1: 6, 2: 8 };
      const uris = [];
      const accounts = [];
      for (const o of otps) {
        const label = encodeURIComponent((o.issuer || '').trim() || 'account') +
          ':' + encodeURIComponent((o.name || '').trim() || 'account');
        const params = new URLSearchParams();
        params.set('secret', (o.secret_b32 || '').replace(/=+$/g, ''));
        if (o.issuer) params.set('issuer', o.issuer);
        const alg = algMap[o.algorithm] || 'SHA1';
        if (alg !== 'SHA1') params.set('algorithm', alg);
        const digits = digMap[o.digits] || 6;
        if (digits !== 6) params.set('digits', String(digits));
        params.set('period', '30');
        const uri = 'otpauth://totp/' + label + '?' + params.toString();
        uris.push(uri);
        accounts.push({
          serviceName: o.issuer || '',
          username: o.name || '',
          issuer: o.issuer || '',
          secret: (o.secret_b32 || '').replace(/=+$/g, ''),
          algorithm: alg === 'SHA1' ? 'SHA-1' : (alg === 'SHA256' ? 'SHA-256' : 'SHA-512'),
          digits,
          period: 30
        });
      }
      return { uris, accounts, count: otps.length };
    }
  };

  global.StorageManager = STORAGE;
  global.UriSerializer = UriSerializer;
  global.GoogleMigration = GoogleMigration;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StorageManager: STORAGE, UriSerializer, GoogleMigration };
  }
})(typeof window !== 'undefined' ? window : globalThis);
