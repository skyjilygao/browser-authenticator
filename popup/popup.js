document.addEventListener('DOMContentLoaded', () => {
  const accountList = document.getElementById('accountList');
  const addBtn = document.getElementById('addBtn');
  const importBtn = document.getElementById('importBtn');
  const exportBtn = document.getElementById('exportBtn');
  const optionsBtn = document.getElementById('optionsBtn');
  const addModal = document.getElementById('addModal');
  const importModal = document.getElementById('importModal');
  const addForm = document.getElementById('addForm');

  let timers = [];
  let currentTags = [];
  let pendingImportText = '';
  let pendingImportFile = null;
  const popupFilter = { service: '', group: '', tag: '' };

  function showToast(msg, type = 'success') {
    console.log(`${msg}`)
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast ' + type;
    t.classList.remove('hidden');
    setTimeout(() => { t.classList.add('hidden'); }, 2000);
  }

  function clearTimers() {
    timers.forEach(t => clearInterval(t));
    timers = [];
  }

  function formatOtp(code) {
    if (code.length === 6) {
      return code.slice(0, 3) + ' ' + code.slice(3);
    } else if (code.length === 8) {
      return code.slice(0, 4) + ' ' + code.slice(4);
    }
    return code;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function createProgressSvg(period) {
    const r = 15;
    const c = 2 * Math.PI * r;
    return `
      <svg width="36" height="36" viewBox="0 0 36 36">
        <circle class="bg" cx="18" cy="18" r="${r}"></circle>
        <circle class="fg" cx="18" cy="18" r="${r}"
                stroke-dasharray="${c}" stroke-dashoffset="0"></circle>
      </svg>
    `;
  }

  async function renderAccounts() {
    clearTimers();
    let accounts = await StorageManager.getAccounts();
    const settings = await StorageManager.getSettings();
    const sortBy = settings.sortBy || 'createdAt';

    const fService = popupFilter.service.trim().toLowerCase();
    const fGroup = popupFilter.group.trim().toLowerCase();
    const fTag = popupFilter.tag.trim().toLowerCase();
    if (fService || fGroup || fTag) {
      accounts = accounts.filter(a => {
        if (fService && !(String(a.serviceName || a.issuer || '').toLowerCase().includes(fService))) return false;
        if (fGroup && !(String(a.group || '').toLowerCase() === fGroup)) return false;
        if (fTag) {
          const tags = (a.tags && Array.isArray(a.tags)) ? a.tags.map(t => String(t).toLowerCase()) : [];
          if (!tags.includes(fTag)) return false;
        }
        return true;
      });
    }

    accounts.sort((a, b) => {
      if (sortBy === 'serviceName') {
        return (a.serviceName || '').localeCompare(b.serviceName || '', 'zh-CN');
      } else if (sortBy === 'group') {
        return ((a.group || '') + (a.serviceName || '')).localeCompare((b.group || '') + (b.serviceName || ''), 'zh-CN');
      } else {
        return (b.createdAt || 0) - (a.createdAt || 0);
      }
    });

    if (accounts.length === 0) {
      const hasFilter = fService || fGroup || fTag;
      accountList.innerHTML = `
        <div class="empty-state">
          <p>${hasFilter ? '没有匹配的身份信息' : '暂无身份信息'}</p>
          <p class="hint">${hasFilter ? '请尝试调整筛选条件' : '点击右上角「+」添加'}</p>
        </div>
      `;
      return;
    }

    accountList.innerHTML = '';

    let currentGroup = null;
    for (const account of accounts) {
      if (sortBy === 'group' && (account.group || '') !== currentGroup) {
        currentGroup = account.group || '';
        const groupHeader = document.createElement('div');
        groupHeader.className = 'group-header';
        groupHeader.textContent = currentGroup || '未分组';
        accountList.appendChild(groupHeader);
      }

      const digits = parseInt(account.digits) || 6;
      const period = parseInt(account.period) || 30;
      const item = document.createElement('div');
      item.className = 'account-item';
      item.dataset.id = account.id;

      const tagsHtml = (account.tags && account.tags.length)
        ? account.tags.map(t => `<span class="mini-tag">${escapeHtml(t)}</span>`).join('')
        : '';
      const groupHtml = account.group ? `<span class="mini-group">📁 ${escapeHtml(account.group)}</span>` : '';

      item.innerHTML = `
        <div class="account-header">
          <div>
            <div class="account-service">${escapeHtml(account.serviceName || '未命名')}</div>
            <div class="account-username">${escapeHtml(account.username || '')}</div>
            ${(account.loginUrl || account.sitePattern) ? `<div class="account-url">🔗 ${escapeHtml(account.loginUrl || account.sitePattern)}</div>` : ''}
            <div class="meta-tags">${groupHtml}${tagsHtml}</div>
          </div>
          <div class="account-actions">
            <button class="action-btn edit" data-action="edit" title="编辑">✏️</button>
            <button class="action-btn delete" data-action="delete" title="删除">🗑</button>
          </div>
        </div>
        <div class="otp-section">
          <div class="otp-code" data-otp>-- -- --</div>
          <div class="progress-wrapper">
            <div class="progress-ring">
              ${createProgressSvg(period)}
              <div class="progress-text" data-seconds>${period}</div>
            </div>
            <button class="copy-btn" data-copy>复制</button>
          </div>
        </div>
      `;

      accountList.appendChild(item);

      const updateCode = async () => {
        try {
          const code = await TOTP.generateTOTP(account.secret, {
            digits, period, algorithm: account.algorithm || 'SHA-1'
          });
          const otpEl = item.querySelector('[data-otp]');
          const secondsEl = item.querySelector('[data-seconds]');
          const fg = item.querySelector('.fg');
          const copyBtn = item.querySelector('[data-copy]');

          otpEl.textContent = formatOtp(code);
          const remaining = TOTP.getRemainingSeconds(period);
          secondsEl.textContent = remaining;

          const r = 15;
          const c = 2 * Math.PI * r;
          const offset = c - (remaining / period) * c;
          fg.style.strokeDashoffset = offset;

          if (remaining <= 5) {
            otpEl.classList.add('expiring');
          } else {
            otpEl.classList.remove('expiring');
          }

          copyBtn.dataset.code = code;
        } catch (e) {
          item.querySelector('[data-otp]').textContent = '密钥无效';
        }
      };

      await updateCode();
      const timer = setInterval(updateCode, 1000);
      timers.push(timer);
    }

    accountList.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.closest('.account-item').dataset.id;
        if (confirm('确定删除此身份信息吗？')) {
          await StorageManager.deleteAccount(id);
          showToast('已删除');
          renderAccounts();
        }
      });
    });

    accountList.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.closest('.account-item').dataset.id;
        openEditModal(id);
      });
    });

    accountList.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const code = btn.dataset.code;
        if (code) {
          await navigator.clipboard.writeText(code);
          const original = btn.textContent;
          btn.textContent = '已复制';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove('copied');
          }, 1500);
        }
      });
    });
  }

  function renderTags() {
    const container = document.getElementById('tagsContainer');
    container.innerHTML = currentTags.map((t, i) => `
      <span class="tag-chip">
        ${escapeHtml(t)}
        <span class="tag-remove" data-idx="${i}">×</span>
      </span>
    `).join('');
    container.querySelectorAll('.tag-remove').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        currentTags.splice(idx, 1);
        renderTags();
      });
    });
  }

  async function showDropdown(type, inputEl) {
    const dropdown = document.querySelector(`[data-dropdown="${type}"]`);
    let items = [];
    if (type === 'group') {
      const groups = await StorageManager.getAllGroups();
      items = groups.map(g => g.name);
    } else if (type === 'service') {
      const services = await StorageManager.getAllServices();
      items = services.map(s => s.name);
    } else {
      const tags = await StorageManager.getAllTags();
      items = tags.map(t => t.name);
    }
    const filter = inputEl.value.trim().toLowerCase();
    const filtered = items.filter(i => !filter || i.toLowerCase().includes(filter));

    if (filtered.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }
    dropdown.innerHTML = filtered.map(n =>
      `<div class="tag-option" data-value="${escapeHtml(n)}">${escapeHtml(n)}</div>`
    ).join('');
    dropdown.classList.remove('hidden');

    dropdown.querySelectorAll('.tag-option').forEach(opt => {
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const val = opt.dataset.value;
        if (type === 'group' || type === 'service') {
          inputEl.value = val;
        } else {
          if (!currentTags.find(t => t.toLowerCase() === val.toLowerCase())) {
            currentTags.push(val);
            renderTags();
          }
          inputEl.value = '';
        }
        dropdown.classList.add('hidden');
      });
    });
  }

  function setupTagInputs() {
    const serviceInput = document.getElementById('serviceName');
    const groupInput = document.getElementById('groupInput');
    const tagsInput = document.getElementById('tagsInput');

    serviceInput.addEventListener('focus', () => showDropdown('service', serviceInput));
    serviceInput.addEventListener('input', () => showDropdown('service', serviceInput));
    serviceInput.addEventListener('blur', () => {
      setTimeout(() => {
        const d = document.querySelector('[data-dropdown="service"]');
        if (d) d.classList.add('hidden');
      }, 150);
    });
    serviceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const d = document.querySelector('[data-dropdown="service"]');
        if (d) d.classList.add('hidden');
      }
    });

    groupInput.addEventListener('focus', () => showDropdown('group', groupInput));
    groupInput.addEventListener('input', () => showDropdown('group', groupInput));
    groupInput.addEventListener('blur', () => {
      setTimeout(() => {
        document.querySelector('[data-dropdown="group"]').classList.add('hidden');
      }, 150);
    });
    groupInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.querySelector('[data-dropdown="group"]').classList.add('hidden');
      }
    });

    tagsInput.addEventListener('focus', () => showDropdown('tags', tagsInput));
    tagsInput.addEventListener('input', () => showDropdown('tags', tagsInput));
    tagsInput.addEventListener('blur', () => {
      setTimeout(() => {
        document.querySelector('[data-dropdown="tags"]').classList.add('hidden');
      }, 150);
    });
    tagsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = tagsInput.value.trim();
        if (v && !currentTags.find(t => t.toLowerCase() === v.toLowerCase())) {
          currentTags.push(v);
          renderTags();
        }
        tagsInput.value = '';
        document.querySelector('[data-dropdown="tags"]').classList.add('hidden');
      }
    });
  }

  async function showFilterDropdown(type, inputEl) {
    let fieldKey = '';
    if (type === 'filter-service') fieldKey = 'service';
    else if (type === 'filter-group') fieldKey = 'group';
    else if (type === 'filter-tags') fieldKey = 'tags';
    const dropdown = document.querySelector(`[data-dropdown="${type}"]`);
    if (!dropdown || !fieldKey) return;

    let items = [];
    if (fieldKey === 'group') {
      const groups = await StorageManager.getAllGroups();
      items = groups.map(g => g.name);
    } else if (fieldKey === 'service') {
      const services = await StorageManager.getAllServices();
      items = services.map(s => s.name);
    } else {
      const tags = await StorageManager.getAllTags();
      items = tags.map(t => t.name);
    }
    const filter = inputEl.value.trim().toLowerCase();
    const filtered = items.filter(i => !filter || i.toLowerCase().includes(filter));

    if (filtered.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }
    const curVal = inputEl.value.trim();
    let html = '';
    if (curVal) {
      html += `<div class="tag-option" data-value="">✕ 清除筛选</div>`;
    }
    html += filtered.map(n => `<div class="tag-option" data-value="${escapeHtml(n)}">${escapeHtml(n)}</div>`).join('');
    dropdown.innerHTML = html;
    dropdown.classList.remove('hidden');

    dropdown.querySelectorAll('.tag-option').forEach(opt => {
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const val = opt.dataset.value;
        inputEl.value = val;
        if (type === 'filter-service') popupFilter.service = val;
        else if (type === 'filter-group') popupFilter.group = val;
        else if (type === 'filter-tags') popupFilter.tag = val;
        dropdown.classList.add('hidden');
        renderAccounts();
      });
    });
  }

  function setupFilterInputs() {
    const fService = document.getElementById('filterService');
    const fGroup = document.getElementById('filterGroup');
    const fTags = document.getElementById('filterTags');
    const clearBtn = document.getElementById('clearFilterBtn');

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        fService.value = '';
        fGroup.value = '';
        fTags.value = '';
        popupFilter.service = '';
        popupFilter.group = '';
        popupFilter.tag = '';
        renderAccounts();
      });
    }

    fService.addEventListener('focus', () => showFilterDropdown('filter-service', fService));
    fService.addEventListener('input', () => {
      popupFilter.service = fService.value;
      showFilterDropdown('filter-service', fService);
      renderAccounts();
    });
    fService.addEventListener('blur', () => {
      popupFilter.service = fService.value;
      setTimeout(() => {
        const d = document.querySelector('[data-dropdown="filter-service"]');
        if (d) d.classList.add('hidden');
      }, 150);
      renderAccounts();
    });

    fGroup.addEventListener('focus', () => showFilterDropdown('filter-group', fGroup));
    fGroup.addEventListener('input', () => {
      popupFilter.group = fGroup.value;
      showFilterDropdown('filter-group', fGroup);
      renderAccounts();
    });
    fGroup.addEventListener('blur', () => {
      popupFilter.group = fGroup.value;
      setTimeout(() => {
        const d = document.querySelector('[data-dropdown="filter-group"]');
        if (d) d.classList.add('hidden');
      }, 150);
      renderAccounts();
    });

    fTags.addEventListener('focus', () => showFilterDropdown('filter-tags', fTags));
    fTags.addEventListener('input', () => {
      popupFilter.tag = fTags.value;
      showFilterDropdown('filter-tags', fTags);
      renderAccounts();
    });
    fTags.addEventListener('blur', () => {
      popupFilter.tag = fTags.value;
      setTimeout(() => {
        const d = document.querySelector('[data-dropdown="filter-tags"]');
        if (d) d.classList.add('hidden');
      }, 150);
      renderAccounts();
    });
  }

  function openAddModal() {
    document.getElementById('addModalTitle').textContent = '添加身份信息';
    document.getElementById('editAccountId').value = '';
    addForm.reset();
    currentTags = [];
    renderTags();
    addModal.classList.remove('hidden');
  }

  async function openEditModal(id) {
    const accounts = await StorageManager.getAccounts();
    const acc = accounts.find(a => a.id === id);
    if (!acc) return;
    document.getElementById('addModalTitle').textContent = '编辑身份信息';
    document.getElementById('editAccountId').value = acc.id;
    document.getElementById('serviceName').value = acc.serviceName || '';
    document.getElementById('username').value = acc.username || '';
    document.getElementById('loginUrl').value = acc.loginUrl || '';
    document.getElementById('groupInput').value = acc.group || '';
    document.getElementById('secret').value = acc.secret || '';
    document.getElementById('algorithm').value = acc.algorithm || 'SHA-1';
    document.getElementById('digits').value = acc.digits || 6;
    document.getElementById('period').value = acc.period || 30;
    document.getElementById('optSelector').value = acc.optSelector || '';
    currentTags = (acc.tags && Array.isArray(acc.tags)) ? [...acc.tags] : [];
    renderTags();
    addModal.classList.remove('hidden');
  }

  addBtn.addEventListener('click', openAddModal);

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      addModal.classList.add('hidden');
      importModal.classList.add('hidden');
    });
  });

  optionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('editAccountId').value;
    const serviceName = document.getElementById('serviceName').value.trim();
    const username = document.getElementById('username').value.trim();
    const loginUrl = document.getElementById('loginUrl').value.trim();
    const group = document.getElementById('groupInput').value.trim();
    const secret = document.getElementById('secret').value.trim();
    const algorithm = document.getElementById('algorithm').value;
    const digits = document.getElementById('digits').value;
    const period = document.getElementById('period').value;
    const optSelector = document.getElementById('optSelector').value.trim();

    if (!TOTP.isValidBase32(secret)) {
      showToast('密钥格式无效：Base32 只能包含 A-Z 与 2-7 字符', 'error');
      document.getElementById('secret').focus();
      return;
    }

    try {
      await TOTP.generateTOTP(secret, {
        digits: parseInt(digits), period: parseInt(period), algorithm
      });
    } catch (err) {
      showToast('密钥无效: ' + (err.message || '请检查Base32格式'), 'error');
      document.getElementById('secret').focus();
      return;
    }

    const data = {
      serviceName, username, loginUrl, secret,
      issuer: serviceName, algorithm,
      digits: parseInt(digits), period: parseInt(period),
      group, tags: currentTags, optSelector
    };

    try {
      if (id) {
        await StorageManager.updateAccount(id, data);
        showToast('已更新');
      } else {
        await StorageManager.addAccount(data);
        showToast('已添加');
      }
    } catch (err) {
      showToast(err.message || '保存失败', 'error');
      return;
    }

    addForm.reset();
    currentTags = [];
    renderTags();
    addModal.classList.add('hidden');
    renderAccounts();
  });

  setupTagInputs();
  setupFilterInputs();

  async function saveFormDraft() {
    const draft = {
      editAccountId: document.getElementById('editAccountId').value,
      serviceName: document.getElementById('serviceName').value,
      username: document.getElementById('username').value,
      loginUrl: document.getElementById('loginUrl').value,
      group: document.getElementById('groupInput').value,
      secret: document.getElementById('secret').value,
      algorithm: document.getElementById('algorithm').value,
      digits: document.getElementById('digits').value,
      period: document.getElementById('period').value,
      optSelector: document.getElementById('optSelector').value,
      tags: [...currentTags]
    };
    await chrome.storage.local.set({ authenticator_form_draft: draft });
  }

  async function restoreFormDraft() {
    const result = await chrome.storage.local.get(['authenticator_form_draft', 'authenticator_picked_selector']);
    const draft = result.authenticator_form_draft;
    const picked = result.authenticator_picked_selector;
    if (!draft) return;

    document.getElementById('editAccountId').value = draft.editAccountId || '';
    document.getElementById('serviceName').value = draft.serviceName || '';
    document.getElementById('username').value = draft.username || '';
    document.getElementById('loginUrl').value = draft.loginUrl || '';
    document.getElementById('groupInput').value = draft.group || '';
    document.getElementById('secret').value = draft.secret || '';
    document.getElementById('algorithm').value = draft.algorithm || 'SHA-1';
    document.getElementById('digits').value = draft.digits || 6;
    document.getElementById('period').value = draft.period || 30;
    document.getElementById('optSelector').value = draft.optSelector || '';
    currentTags = Array.isArray(draft.tags) ? [...draft.tags] : [];
    renderTags();

    document.getElementById('addModalTitle').textContent = draft.editAccountId ? '编辑身份信息' : '添加身份信息';
    addModal.classList.remove('hidden');

    if (picked && picked.selector) {
      document.getElementById('optSelector').value = picked.selector;
      showToast('已拾取输入框地址，请确认后保存');
    } else {
      showToast('已恢复未保存的表单草稿');
    }

    await chrome.storage.local.remove(['authenticator_form_draft', 'authenticator_picked_selector']);
  }

  document.getElementById('pickOtpBtn').addEventListener('click', async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || !tabs.length) {
        showToast('未找到当前活动页签', 'error');
        return;
      }
      const tab = tabs[0];
      if (!tab.url || !/^https?:/i.test(tab.url)) {
        showToast('当前页签不是普通网页，无法拾取', 'error');
        return;
      }
      await saveFormDraft();
      await chrome.tabs.sendMessage(tab.id, { type: 'PICK_OTP_INPUT' });
      showToast('请到登录页面点击动态密钥输入框');
    } catch (e) {
      showToast('拾取请求失败：' + (e && e.message ? e.message : '请确认已打开登录页'), 'error');
      await chrome.storage.local.remove('authenticator_form_draft');
    }
  });

  restoreFormDraft();

  importBtn.addEventListener('click', () => {
    pendingImportText = '';
    pendingImportFile = null;
    document.getElementById('importText').value = '';
    document.getElementById('qrResult').textContent = '';
    document.getElementById('importResult').classList.add('hidden');
    document.getElementById('qrPreview').classList.add('hidden');
    document.getElementById('importFileInput').value = '';
    switchImportTab('text');
    importModal.classList.remove('hidden');
  });

  function switchImportTab(tabName) {
    document.querySelectorAll('.import-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    document.querySelectorAll('.import-tab-content').forEach(c => {
      c.classList.toggle('active', c.id === 'tab-' + tabName);
    });
  }

  document.querySelectorAll('.import-tab').forEach(tab => {
    tab.addEventListener('click', () => switchImportTab(tab.dataset.tab));
  });

  exportBtn.addEventListener('click', async () => {
    try {
      const text = await StorageManager.exportOtpaUrisText();
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `authenticator-otpauth-${ts}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('导出成功（otpauth URI格式）');
    } catch (err) {
      showToast('导出失败：' + err.message, 'error');
    }
  });

  document.getElementById('qrFile').addEventListener('change', async (e) => {
    console.log('[QR] change event fired, files:', e.target.files);
    const file = e.target.files[0];
    if (!file) {
      console.log('[QR] no file selected, return');
      return;
    }
    console.log('[QR] selected file:', file.name, file.type, file.size, 'bytes');
    const reader = new FileReader();
    reader.onerror = (err) => {
      console.error('[QR] FileReader error:', err);
      showToast('读取文件失败：' + (err && err.message ? err.message : '未知错误'), 'error');
    };
    reader.onload = async (ev) => {
      console.log('[QR] FileReader onload, result length:', (ev.target.result || '').length);
      const img = new Image();
      img.onerror = (err) => {
        console.error('[QR] Image load error:', err);
        showToast('图片加载失败，无法识别', 'error');
      };
      img.onload = () => {
        console.log('[QR] Image onload, size:', img.width, 'x', img.height);
        const canvas = document.getElementById('qrCanvas');
        if (!canvas) {
          console.error('[QR] canvas #qrCanvas not found');
          showToast('缺少 canvas 元素，无法识别', 'error');
          return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.error('[QR] canvas 2d context unavailable');
          showToast('canvas 上下文获取失败', 'error');
          return;
        }
        const maxSize = 1024;
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          const ratio = Math.min(maxSize / w, maxSize / h);
          w = Math.floor(w * ratio);
          h = Math.floor(h * ratio);
          console.log('[QR] scaled down to', w, 'x', h);
        }
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        let imageData;
        try {
          imageData = ctx.getImageData(0, 0, w, h);
          console.log('[QR] getImageData OK, pixels:', imageData.data.length);
        } catch (err) {
          console.error('[QR] getImageData error:', err);
          showToast('读取图片像素失败：' + err.message, 'error');
          return;
        }
        if (typeof jsQR !== 'function') {
          console.error('[QR] jsQR is not loaded / not a function. typeof:', typeof jsQR);
          showToast('jsQR 库未加载，请检查扩展文件完整性', 'error');
          return;
        }
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert'
        });
        console.log('[QR] jsQR result:', code ? 'found data=' + code.data : 'null');
        const preview = document.getElementById('qrPreview');
        const previewImg = document.getElementById('qrPreviewImg');
        const resultEl = document.getElementById('qrResult');
        if (previewImg) previewImg.src = ev.target.result;
        if (preview) preview.classList.remove('hidden');
        if (code && code.data) {
          pendingImportText = code.data;
          if (resultEl) {
            resultEl.textContent = '识别成功：' + (code.data.length > 60 ? code.data.slice(0, 60) + '...' : code.data);
            resultEl.style.color = '#10b981';
          }
          showToast('二维码识别成功');
        } else {
          pendingImportText = '';
          if (resultEl) {
            resultEl.textContent = '未能识别二维码内容，请尝试更清晰的图片';
            resultEl.style.color = '#ef4444';
          }
          showToast('未能识别二维码内容', 'warning');
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  document.getElementById('importFileInput').addEventListener('change', (e) => {
    pendingImportFile = e.target.files[0] || null;
  });

  document.getElementById('doImportBtn').addEventListener('click', async () => {
    const activeTab = document.querySelector('.import-tab.active').dataset.tab;
    let text = '';
    try {
      if (activeTab === 'text') {
        text = document.getElementById('importText').value;
      } else if (activeTab === 'qr') {
        text = pendingImportText;
        if (!text) {
          showToast('请先选择二维码图片并识别成功', 'error');
          return;
        }
      } else if (activeTab === 'file') {
        if (!pendingImportFile) {
          showToast('请选择导入文件', 'error');
          return;
        }
        text = await pendingImportFile.text();
      }

      if (!text || !text.trim()) {
        showToast('没有可导入的内容', 'error');
        return;
      }

      const result = await StorageManager.parseTextAndImport(text);
      const resultEl = document.getElementById('importResult');
      const total = result.total || 0;
      const errors = result.errors || [];
      const errorCount = Array.isArray(errors) ? errors.length : (parseInt(errors) || 0);
      let imported = result.imported || 0;
      if (Array.isArray(imported)) imported = imported.length;
      const skipped = result.skipped || 0;
      const updated = result.updated || 0;
      const hasChange = imported > 0 || updated > 0;
      const hasNone = imported === 0 && updated === 0 && skipped === 0 && errorCount === total;

      let summaryClass = 'success';
      let summaryText = '✓ 导入完成';
      if (hasNone) {
        summaryClass = 'fail';
        summaryText = '✗ 导入失败';
      } else if (errorCount > 0) {
        summaryClass = 'warn';
        summaryText = '⚠ 部分成功导入';
      } else if (skipped > 0 || updated > 0) {
        summaryClass = 'warn';
        summaryText = '⚠ 导入完成（含跳过/更新）';
      }

      let html = `<div class="import-summary ${summaryClass}">${summaryText}</div>`;
      html += `<div class="import-stats">`;
      html += `<span class="stat-item">总计: <strong>${total}</strong></span>`;
      html += `<span class="stat-item ok">新增: <strong>${imported}</strong></span>`;
      if (updated > 0) {
        html += `<span class="stat-item" style="color:#3b82f6">更新loginUrl: <strong>${updated}</strong></span>`;
      }
      if (skipped > 0) {
        html += `<span class="stat-item" style="color:#64748b">跳过重复: <strong>${skipped}</strong></span>`;
      }
      if (errorCount > 0) {
        html += `<span class="stat-item err">失败: <strong>${errorCount}</strong></span>`;
      }
      html += `</div>`;
      if (errorCount > 0 && Array.isArray(errors)) {
        html += `<div class="import-errors">`;
        errors.slice(0, 5).forEach(err => {
          html += `<div class="error-item">${escapeHtml((err.data && err.data.username) || (err.data && err.data.serviceName) || '未命名')} - ${escapeHtml(err.message || '未知错误')}</div>`;
        });
        if (errors.length > 5) {
          html += `<div class="error-item">... 还有 ${errors.length - 5} 条错误</div>`;
        }
        html += `</div>`;
      }
      resultEl.innerHTML = html;
      resultEl.classList.remove('hidden');

      if (hasChange) {
        let toastMsg = `新增 ${imported} 条`;
        if (updated > 0) toastMsg += `，更新 ${updated} 条`;
        if (skipped > 0) toastMsg += `，跳过 ${skipped} 条`;
        if (errorCount > 0) toastMsg += `，失败 ${errorCount} 条`;
        showToast(toastMsg);
        renderAccounts();
        setTimeout(() => {
          importModal.classList.add('hidden');
        }, 2200);
      } else if (skipped > 0) {
        showToast(`共 ${skipped} 条已存在，全部跳过`);
        setTimeout(() => {
          importModal.classList.add('hidden');
        }, 1800);
      } else {
        const msg = (errors[0] && errors[0].message) ? errors[0].message : '没有可导入的记录，请检查内容格式';
        showToast('导入失败：' + msg, 'error');
      }
    } catch (err) {
      showToast('导入失败：' + err.message, 'error');
    }
  });

  renderAccounts();
});
