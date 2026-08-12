let timers = [];
let currentTags = [];
const optFilter = { service: '', group: '', tag: '' };

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await renderAccounts();
  await renderGroupsAndTags();
  bindEvents();
  setupTagInputs();
  setupFilterInputs();
});

function clearTimers() {
  timers.forEach(t => clearInterval(t));
  timers = [];
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatOtp(code) {
  if (!code) return '------';
  if (code.length === 6) return code.slice(0, 3) + ' ' + code.slice(3);
  if (code.length === 8) return code.slice(0, 4) + ' ' + code.slice(4);
  return code;
}

async function loadSettings() {
  const settings = await StorageManager.getSettings();
  document.getElementById('autoFill').checked = !!settings.autoFill;
  document.getElementById('autoCopy').checked = !!settings.autoCopy;
  document.getElementById('sortBy').value = settings.sortBy || 'createdAt';
  document.getElementById('defaultDigits').value = settings.defaultDigits || 6;
  document.getElementById('defaultPeriod').value = settings.defaultPeriod || 30;
}

async function saveSettings() {
  const settings = {
    autoFill: document.getElementById('autoFill').checked,
    autoCopy: document.getElementById('autoCopy').checked,
    sortBy: document.getElementById('sortBy').value,
    defaultDigits: parseInt(document.getElementById('defaultDigits').value),
    defaultPeriod: parseInt(document.getElementById('defaultPeriod').value)
  };
  await StorageManager.saveSettings(settings);
  showToast('设置已保存');
  renderAccounts();
}

async function renderGroupsAndTags() {
  const groups = await StorageManager.getAllGroups();
  const tags = await StorageManager.getAllTags();

  const groupsList = document.getElementById('groupsList');
  if (groups.length === 0) {
    groupsList.innerHTML = `<div class="empty-manage">暂无分组，在添加/编辑账号时输入分组名称即可自动创建</div>`;
  } else {
    groupsList.innerHTML = groups.map(g => `
      <div class="manage-item" data-type="group" data-name="${escapeHtml(g.name)}">
        <div class="manage-item-info">
          <span class="manage-item-name">📁 ${escapeHtml(g.name)}</span>
          <span class="manage-item-count">${g.count} 个账号</span>
        </div>
        <div class="manage-item-actions">
          <button class="btn btn-sm btn-secondary" data-action="rename">重命名</button>
          <button class="btn btn-sm btn-secondary" data-action="migrate">迁移</button>
          <button class="btn btn-sm btn-danger" data-action="delete">删除</button>
        </div>
      </div>
    `).join('');
  }

  const tagsList = document.getElementById('tagsList');
  if (tags.length === 0) {
    tagsList.innerHTML = `<div class="empty-manage">暂无标签，在添加/编辑账号时输入标签名称即可自动创建</div>`;
  } else {
    tagsList.innerHTML = tags.map(t => `
      <div class="manage-item" data-type="tag" data-name="${escapeHtml(t.name)}">
        <div class="manage-item-info">
          <span class="manage-item-name">🏷️ ${escapeHtml(t.name)}</span>
          <span class="manage-item-count">${t.count} 个账号</span>
        </div>
        <div class="manage-item-actions">
          <button class="btn btn-sm btn-secondary" data-action="rename">重命名</button>
          <button class="btn btn-sm btn-secondary" data-action="migrate">迁移</button>
          <button class="btn btn-sm btn-danger" data-action="delete">删除</button>
        </div>
      </div>
    `).join('');
  }

  document.querySelectorAll('.manage-item button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const item = btn.closest('.manage-item');
      const type = item.dataset.type;
      const name = item.dataset.name;
      const action = btn.dataset.action;
      handleManageAction(type, name, action);
    });
  });
}

function openManageModal(html) {
  document.getElementById('manageModalBody').innerHTML = html;
  document.getElementById('manageModal').classList.remove('hidden');
}

function closeManageModal() {
  document.getElementById('manageModal').classList.add('hidden');
}

async function handleManageAction(type, name, action) {
  const typeLabel = type === 'group' ? '分组' : '标签';

  if (action === 'rename') {
    document.getElementById('manageModalTitle').textContent = `重命名${typeLabel}`;
    const allItems = type === 'group'
      ? (await StorageManager.getAllGroups()).map(g => g.name)
      : (await StorageManager.getAllTags()).map(t => t.name);
    openManageModal(`
      <div class="form-group">
        <label>原${typeLabel}名</label>
        <input type="text" value="${escapeHtml(name)}" disabled>
      </div>
      <div class="form-group">
        <label>新${typeLabel}名 *</label>
        <input type="text" id="newName" placeholder="请输入新名称">
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="cancelManageBtn">取消</button>
        <button type="button" class="btn btn-primary" id="confirmManageBtn">确认重命名</button>
      </div>
    `);
    document.getElementById('cancelManageBtn').onclick = closeManageModal;
    document.getElementById('confirmManageBtn').onclick = async () => {
      const newName = document.getElementById('newName').value.trim();
      if (!newName) { showToast('请输入新名称', 'error'); return; }
      if (newName.toLowerCase() === name.toLowerCase()) { closeManageModal(); return; }
      const count = type === 'group'
        ? await StorageManager.renameGroup(name, newName)
        : await StorageManager.renameTag(name, newName);
      showToast(`已重命名，影响 ${count} 个账号`);
      closeManageModal();
      renderGroupsAndTags();
      renderAccounts();
    };

  } else if (action === 'delete') {
    document.getElementById('manageModalTitle').textContent = `删除${typeLabel}`;
    const allItems = type === 'group'
      ? (await StorageManager.getAllGroups()).map(g => g.name)
      : (await StorageManager.getAllTags()).map(t => t.name);
    const otherItems = allItems.filter(n => n.toLowerCase() !== name.toLowerCase());
    openManageModal(`
      <div class="form-group">
        <p>您正在删除 <strong>${typeLabel}：${escapeHtml(name)}</strong></p>
        <p class="input-hint" style="margin:8px 0;">删除后，关联的账号将不再显示此${typeLabel}。</p>
      </div>
      ${otherItems.length > 0 ? `
      <div class="form-group">
        <label>或选择迁移到其他${typeLabel}</label>
        <select id="migrateTo">
          <option value="">—— 仅删除，不迁移 ——</option>
          ${otherItems.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
        </select>
        <p class="input-hint">选择后，关联的账号会被移入该${typeLabel}，而不是清空</p>
      </div>
      ` : ''}
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="cancelManageBtn">取消</button>
        <button type="button" class="btn btn-danger" id="confirmManageBtn">确认删除</button>
      </div>
    `);
    document.getElementById('cancelManageBtn').onclick = closeManageModal;
    document.getElementById('confirmManageBtn').onclick = async () => {
      const migrateTo = document.getElementById('migrateTo') ? document.getElementById('migrateTo').value : '';
      if (!migrateTo && !confirm(`确认删除 ${typeLabel}「${name}」吗？此操作不可恢复。`)) return;
      const count = type === 'group'
        ? await StorageManager.deleteGroup(name, migrateTo || undefined)
        : await StorageManager.deleteTag(name, migrateTo || undefined);
      showToast(migrateTo ? `已迁移 ${count} 个账号到「${migrateTo}」` : `已删除，影响 ${count} 个账号`);
      closeManageModal();
      renderGroupsAndTags();
      renderAccounts();
    };

  } else if (action === 'migrate') {
    document.getElementById('manageModalTitle').textContent = `迁移${typeLabel}`;
    const allItems = type === 'group'
      ? (await StorageManager.getAllGroups()).map(g => g.name)
      : (await StorageManager.getAllTags()).map(t => t.name);
    const otherItems = allItems.filter(n => n.toLowerCase() !== name.toLowerCase());
    openManageModal(`
      <div class="form-group">
        <label>从 ${typeLabel}</label>
        <input type="text" value="${escapeHtml(name)}" disabled>
      </div>
      <div class="form-group">
        <label>迁移到 *</label>
        <div class="tag-input-wrapper" data-for="migrate-input">
          <input type="text" id="migrateTarget" placeholder="从下方选择或输入新名称" autocomplete="off">
          <div class="tag-dropdown hidden" data-dropdown="migrate-input">
            ${otherItems.map(n => `<div class="tag-option" data-value="${escapeHtml(n)}">${escapeHtml(n)}</div>`).join('')}
          </div>
        </div>
        <p class="input-hint">从下拉选择已有${typeLabel}，或输入新名称直接创建</p>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" id="cancelManageBtn">取消</button>
        <button type="button" class="btn btn-primary" id="confirmManageBtn">确认迁移</button>
      </div>
    `);
    const dropdown = document.querySelector('[data-dropdown="migrate-input"]');
    const migrateInput = document.getElementById('migrateTarget');
    dropdown.querySelectorAll('.tag-option').forEach(opt => {
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        migrateInput.value = opt.dataset.value;
        dropdown.classList.add('hidden');
      });
    });
    migrateInput.addEventListener('focus', () => dropdown.classList.remove('hidden'));
    migrateInput.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 150));
    document.getElementById('cancelManageBtn').onclick = closeManageModal;
    document.getElementById('confirmManageBtn').onclick = async () => {
      const newName = migrateInput.value.trim();
      if (!newName) { showToast('请选择或输入目标名称', 'error'); return; }
      if (newName.toLowerCase() === name.toLowerCase()) { closeManageModal(); return; }
      const count = type === 'group'
        ? await StorageManager.renameGroup(name, newName)
        : await StorageManager.renameTag(name, newName);
      showToast(`已迁移 ${count} 个账号到「${newName}」`);
      closeManageModal();
      renderGroupsAndTags();
      renderAccounts();
    };
  }
}

async function renderAccounts() {
  clearTimers();
  let accounts = await StorageManager.getAccounts();
  const tbody = document.getElementById('accountTbody');

  const fService = optFilter.service.trim().toLowerCase();
  const fGroup = optFilter.group.trim().toLowerCase();
  const fTag = optFilter.tag.trim().toLowerCase();
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

  if (accounts.length === 0) {
    const hasFilter = fService || fGroup || fTag;
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">${hasFilter ? '没有匹配的身份信息，请调整筛选条件' : '暂无身份信息，点击右上角「添加」按钮创建'}</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = accounts.map(acc => {
    const groupHtml = acc.group ? `<div class="cell-group">📁 ${escapeHtml(acc.group)}</div>` : '';
    const tagsHtml = (acc.tags && acc.tags.length)
      ? acc.tags.map(t => `<span class="mini-tag">${escapeHtml(t)}</span>`).join('')
      : '';
    return `
    <tr data-id="${acc.id}">
      <td>
        ${groupHtml}
        <div class="cell-tags">${tagsHtml}</div>
      </td>
      <td><strong>${escapeHtml(acc.serviceName)}</strong></td>
      <td>${escapeHtml(acc.username)}</td>
      <td>${acc.digits || 6}位</td>
      <td>${acc.period || 30}秒</td>
      <td>
        <div class="otp-cell" data-otp-wrap>
          <span data-otp>------</span>
          <div class="otp-actions">
            <button class="icon-btn" data-copy title="复制">📋</button>
          </div>
        </div>
      </td>
      <td>
        <div class="otp-actions">
          <button class="icon-btn" data-edit title="编辑">✏️</button>
          <button class="icon-btn delete" data-delete title="删除">🗑️</button>
        </div>
      </td>
    </tr>
  `;
  }).join('');

  for (const acc of accounts) {
    const row = tbody.querySelector(`tr[data-id="${acc.id}"]`);
    const digits = parseInt(acc.digits) || 6;
    const period = parseInt(acc.period) || 30;

    const updateCode = async () => {
      try {
        const code = await TOTP.generateTOTP(acc.secret, {
          digits, period, algorithm: acc.algorithm || 'SHA-1'
        });
        const otpEl = row.querySelector('[data-otp]');
        const wrapEl = row.querySelector('[data-otp-wrap]');
        otpEl.textContent = formatOtp(code);
        wrapEl.dataset.code = code;
        const remaining = TOTP.getRemainingSeconds(period);
        if (remaining <= 5) {
          wrapEl.classList.add('expiring');
        } else {
          wrapEl.classList.remove('expiring');
        }
      } catch (e) {
        row.querySelector('[data-otp]').textContent = '无效';
      }
    };

    await updateCode();
    timers.push(setInterval(updateCode, 1000));
  }

  tbody.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const code = btn.closest('[data-otp-wrap]').dataset.code;
      if (code) {
        await navigator.clipboard.writeText(code);
        showToast('已复制到剪贴板');
      }
    });
  });

  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      const acc = accounts.find(a => a.id === id);
      openEditModal(acc);
    });
  });

  tbody.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      if (confirm('确定删除此身份信息吗？此操作不可恢复。')) {
        await StorageManager.deleteAccount(id);
        showToast('已删除');
        renderGroupsAndTags();
        renderAccounts();
      }
    });
  });
}

function renderOptTags() {
  const container = document.getElementById('optTagsContainer');
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
      renderOptTags();
    });
  });
}

async function showOptDropdown(type, inputEl) {
  const dropdown = document.querySelector(`[data-dropdown="${type}"]`);
  if (!dropdown) return;
  let items = [];
  if (type === 'opt-group' || type === 'migrate-input') {
    const groups = await StorageManager.getAllGroups();
    items = groups.map(g => g.name);
  } else if (type === 'opt-service') {
    const services = await StorageManager.getAllServices();
    items = services.map(s => s.name);
  } else {
    const tags = await StorageManager.getAllTags();
    items = tags.map(t => t.name);
  }
  const filter = inputEl.value.trim().toLowerCase();
  const filtered = items.filter(i => !filter || i.toLowerCase().includes(filter));
  const isMigrate = type === 'migrate-input';
  if (filtered.length === 0) {
    if (!isMigrate) dropdown.classList.add('hidden');
    return;
  }
  dropdown.innerHTML = filtered.map(n =>
    `<div class="tag-option" data-value="${escapeHtml(n)}">${escapeHtml(n)}</div>`
  ).join('');
  if (!isMigrate) dropdown.classList.remove('hidden');
  dropdown.querySelectorAll('.tag-option').forEach(opt => {
    opt.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const val = opt.dataset.value;
      if (type === 'opt-group' || type === 'opt-service') {
        inputEl.value = val;
      } else if (type === 'opt-tags') {
        if (!currentTags.find(t => t.toLowerCase() === val.toLowerCase())) {
          currentTags.push(val);
          renderOptTags();
        }
        inputEl.value = '';
      } else if (type === 'migrate-input') {
        inputEl.value = val;
      }
      if (!isMigrate) dropdown.classList.add('hidden');
    });
  });
}

function setupTagInputs() {
  const serviceInput = document.getElementById('serviceName');
  const groupInput = document.getElementById('optGroup');
  const tagsInput = document.getElementById('optTagsInput');

  serviceInput.addEventListener('focus', () => showOptDropdown('opt-service', serviceInput));
  serviceInput.addEventListener('input', () => showOptDropdown('opt-service', serviceInput));
  serviceInput.addEventListener('blur', () => setTimeout(() => {
    const d = document.querySelector('[data-dropdown="opt-service"]');
    if (d) d.classList.add('hidden');
  }, 150));
  serviceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const d = document.querySelector('[data-dropdown="opt-service"]');
      if (d) d.classList.add('hidden');
    }
  });

  groupInput.addEventListener('focus', () => showOptDropdown('opt-group', groupInput));
  groupInput.addEventListener('input', () => showOptDropdown('opt-group', groupInput));
  groupInput.addEventListener('blur', () => setTimeout(() => {
    document.querySelector('[data-dropdown="opt-group"]').classList.add('hidden');
  }, 150));

  tagsInput.addEventListener('focus', () => showOptDropdown('opt-tags', tagsInput));
  tagsInput.addEventListener('input', () => showOptDropdown('opt-tags', tagsInput));
  tagsInput.addEventListener('blur', () => setTimeout(() => {
    document.querySelector('[data-dropdown="opt-tags"]').classList.add('hidden');
  }, 150));
  tagsInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = tagsInput.value.trim();
      if (v && !currentTags.find(t => t.toLowerCase() === v.toLowerCase())) {
        currentTags.push(v);
        renderOptTags();
      }
      tagsInput.value = '';
    }
  });
}

async function showOptFilterDropdown(type, inputEl) {
  let fieldKey = '';
  if (type === 'opt-filter-service') fieldKey = 'service';
  else if (type === 'opt-filter-group') fieldKey = 'group';
  else if (type === 'opt-filter-tags') fieldKey = 'tags';
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
      if (type === 'opt-filter-service') optFilter.service = val;
      else if (type === 'opt-filter-group') optFilter.group = val;
      else if (type === 'opt-filter-tags') optFilter.tag = val;
      dropdown.classList.add('hidden');
      renderAccounts();
    });
  });
}

function setupFilterInputs() {
  const fService = document.getElementById('optFilterService');
  const fGroup = document.getElementById('optFilterGroup');
  const fTags = document.getElementById('optFilterTags');
  const clearBtn = document.getElementById('optClearFilterBtn');

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      fService.value = '';
      fGroup.value = '';
      fTags.value = '';
      optFilter.service = '';
      optFilter.group = '';
      optFilter.tag = '';
      renderAccounts();
    });
  }

  fService.addEventListener('focus', () => showOptFilterDropdown('opt-filter-service', fService));
  fService.addEventListener('input', () => {
    optFilter.service = fService.value;
    showOptFilterDropdown('opt-filter-service', fService);
    renderAccounts();
  });
  fService.addEventListener('blur', () => {
    optFilter.service = fService.value;
    setTimeout(() => {
      const d = document.querySelector('[data-dropdown="opt-filter-service"]');
      if (d) d.classList.add('hidden');
    }, 150);
    renderAccounts();
  });

  fGroup.addEventListener('focus', () => showOptFilterDropdown('opt-filter-group', fGroup));
  fGroup.addEventListener('input', () => {
    optFilter.group = fGroup.value;
    showOptFilterDropdown('opt-filter-group', fGroup);
    renderAccounts();
  });
  fGroup.addEventListener('blur', () => {
    optFilter.group = fGroup.value;
    setTimeout(() => {
      const d = document.querySelector('[data-dropdown="opt-filter-group"]');
      if (d) d.classList.add('hidden');
    }, 150);
    renderAccounts();
  });

  fTags.addEventListener('focus', () => showOptFilterDropdown('opt-filter-tags', fTags));
  fTags.addEventListener('input', () => {
    optFilter.tag = fTags.value;
    showOptFilterDropdown('opt-filter-tags', fTags);
    renderAccounts();
  });
  fTags.addEventListener('blur', () => {
    optFilter.tag = fTags.value;
    setTimeout(() => {
      const d = document.querySelector('[data-dropdown="opt-filter-tags"]');
      if (d) d.classList.add('hidden');
    }, 150);
    renderAccounts();
  });
}

function openAddModal() {
  document.getElementById('modalTitle').textContent = '添加身份信息';
  document.getElementById('accountForm').reset();
  document.getElementById('accountId').value = '';
  currentTags = [];
  renderOptTags();
  document.getElementById('accountModal').classList.remove('hidden');
}

function openEditModal(acc) {
  document.getElementById('modalTitle').textContent = '编辑身份信息';
  document.getElementById('accountId').value = acc.id;
  document.getElementById('serviceName').value = acc.serviceName || '';
  document.getElementById('username').value = acc.username || '';
  document.getElementById('optGroup').value = acc.group || '';
  document.getElementById('secret').value = acc.secret || '';
  document.getElementById('algorithm').value = acc.algorithm || 'SHA-1';
  document.getElementById('digits').value = acc.digits || 6;
  document.getElementById('period').value = acc.period || 30;
  document.getElementById('sitePattern').value = acc.sitePattern || acc.loginUrl || '';
  currentTags = (acc.tags && Array.isArray(acc.tags)) ? [...acc.tags] : [];
  renderOptTags();
  document.getElementById('accountModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('accountModal').classList.add('hidden');
}

async function handleAccountSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('accountId').value;
  const secret = document.getElementById('secret').value.trim();
  const data = {
    serviceName: document.getElementById('serviceName').value.trim(),
    username: document.getElementById('username').value.trim(),
    secret,
    issuer: document.getElementById('serviceName').value.trim(),
    algorithm: document.getElementById('algorithm').value,
    digits: parseInt(document.getElementById('digits').value),
    period: parseInt(document.getElementById('period').value),
    group: document.getElementById('optGroup').value.trim(),
    tags: currentTags,
    sitePattern: document.getElementById('sitePattern').value.trim(),
    loginUrl: document.getElementById('sitePattern').value.trim()
  };

  if (!TOTP.isValidBase32(secret)) {
    showToast('密钥格式无效：仅允许 A-Z 与 2-7 字符（长度不限）', 'error');
    document.getElementById('secret').focus();
    return;
  }

  try {
    await TOTP.generateTOTP(data.secret, { digits: data.digits, period: data.period, algorithm: data.algorithm });
  } catch (err) {
    showToast('密钥无效: ' + (err.message || '请检查格式'), 'error');
    document.getElementById('secret').focus();
    return;
  }

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

  closeModal();
  renderGroupsAndTags();
  renderAccounts();
}

async function handleExportUri() {
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
    showToast('导出成功（TXT/otpauth URI格式）');
  } catch (err) {
    showToast('导出失败：' + err.message, 'error');
  }
}

async function handleExport() {
  const data = await StorageManager.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `authenticator-backup-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('导出成功');
}

async function handleImport(file) {
  try {
    const text = await file.text();
    const result = await StorageManager.parseTextAndImport(text);
    const imported = result.imported || 0;
    const skipped = result.skipped || 0;
    const updated = result.updated || 0;
    const errors = result.errors || [];
    const errCount = Array.isArray(errors) ? errors.length : (parseInt(errors) || 0);
    const total = result.total || 0;

    let msg = `新增 ${imported} 条`;
    if (updated > 0) msg += `，更新loginUrl ${updated} 条`;
    if (skipped > 0) msg += `，跳过重复 ${skipped} 条`;
    if (errCount > 0) msg += `，失败 ${errCount} 条`;
    msg += `（共 ${total} 条）`;

    const hasChange = imported > 0 || updated > 0;
    const hasSkipOnly = skipped > 0 && imported === 0 && updated === 0;
    showToast(msg, hasChange ? 'success' : (hasSkipOnly ? 'warn' : 'error'));
    renderGroupsAndTags();
    renderAccounts();
  } catch (err) {
    showToast('导入失败：' + err.message, 'error');
  }
}

async function handleClear() {
  if (!confirm('确定清除所有身份信息和设置吗？此操作不可恢复！')) return;
  if (!confirm('再次确认：真的要删除所有数据吗？')) return;
  await chrome.storage.sync.clear();
  showToast('所有数据已清除');
  loadSettings();
  renderGroupsAndTags();
  renderAccounts();
}

function bindEvents() {
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('addAccountBtn').addEventListener('click', openAddModal);
  document.getElementById('accountForm').addEventListener('submit', handleAccountSubmit);
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      closeModal();
      closeManageModal();
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', () => {
      closeModal();
      closeManageModal();
    });
  });
  document.getElementById('exportBtn').addEventListener('click', handleExport);
  document.getElementById('exportUriBtn').addEventListener('click', handleExportUri);
  document.getElementById('importFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) handleImport(f);
    e.target.value = '';
  });
  document.getElementById('clearBtn').addEventListener('click', handleClear);

  document.querySelectorAll('.manage-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.manage-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.manage-tab-content').forEach(c => {
        c.classList.toggle('active', c.id === 'manage-' + tab.dataset.tab);
      });
    });
  });
}
