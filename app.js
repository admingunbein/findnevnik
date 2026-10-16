(() => {
  'use strict';

  const L = window.FinLogic;
  const DB = window.FinDB;
  let expenses = [];
  let subscriptions = [];
  let currentView = 'home';
  let currentReportMonth = L.currentLocalDate().slice(0, 7);
  let toastTimer = null;

  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function showToast(message) {
    const t = $('toast');
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
  }

  function downloadBlob(filename, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function categoryOptions(selected) {
    return Object.entries(L.CATEGORIES).map(([key, c]) =>
      `<option value="${key}" ${selected === key ? 'selected' : ''}>${c.emoji} ${c.label}</option>`
    ).join('');
  }

  function transactionRow(e) {
    const c = L.CATEGORIES[e.category] || { emoji: '•', label: e.category };
    const meta = `${L.formatDateTimeRu(e.spentAt)}${e.comment ? ` · ${escapeHtml(e.comment)}` : ''}`;
    return `
      <button class="transaction-row" data-expense-id="${e.id}">
        <span class="transaction-icon">${c.emoji}</span>
        <span class="transaction-main">
          <span class="transaction-title">${c.label}${e.isComp ? '<span class="comp-badge">КОМ</span>' : ''}</span>
          <span class="transaction-meta">${meta}</span>
        </span>
        <span class="transaction-amount">${L.formatMoney(e.amountKopeks)}</span>
      </button>`;
  }

  async function refreshData() {
    expenses = await DB.getAll('expenses');
    subscriptions = await DB.getAll('subscriptions');
    expenses.sort((a, b) => (b.spentAt || '').localeCompare(a.spentAt || '') || (b.id || 0) - (a.id || 0));
  }

  async function processRecurringSubscriptions() {
    subscriptions = await DB.getAll('subscriptions');
    const today = L.currentLocalDate();
    const [ty, tm, td] = today.split('-').map(Number);

    for (const sub of subscriptions.filter(s => s.active !== false)) {
      let sy = sub.startYear;
      let sm = sub.startMonth;
      if (!sy || !sm) {
        const created = (sub.createdAt || today).slice(0, 10).split('-').map(Number);
        sy = created[0]; sm = created[1];
      }
      let cursor = `${sy}-${L.pad2(sm)}`;
      const current = `${ty}-${L.pad2(tm)}`;
      while (cursor <= current) {
        const [y, m] = cursor.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        const dueDay = Math.min(Number(sub.dayOfMonth), lastDay);
        const dueDate = `${y}-${L.pad2(m)}-${L.pad2(dueDay)}`;
        const recurringKey = `${sub.id}:${cursor}`;
        if (dueDate <= today) {
          const exists = await DB.getRecurringKey(recurringKey);
          if (!exists) {
            await DB.addExpense({
              category: 'subscriptions',
              amountKopeks: sub.amountKopeks,
              comment: sub.name,
              spentAt: `${dueDate}T09:00`,
              isComp: false,
              source: 'recurring',
              subscriptionId: sub.id,
              recurringKey,
              createdAt: new Date().toISOString(),
            });
          }
        }
        cursor = L.shiftMonth(cursor, 1);
      }
    }
  }

  function renderHome() {
    const month = L.currentLocalDate().slice(0, 7);
    const summary = L.summarizeMonth(expenses, month);
    $('homeMonthTotal').textContent = L.formatMoney(summary.total);
    $('homeMonthLabel').textContent = L.monthTitle(month);

    $('categoryGrid').innerHTML = Object.entries(L.CATEGORIES).map(([key, c]) => `
      <button class="category-btn" data-add-category="${key}">
        <span class="emoji">${c.emoji}</span>
        <span class="label">${c.label}</span>
      </button>`).join('');

    const recent = expenses.slice(0, 6);
    $('recentList').innerHTML = recent.length ? recent.map(transactionRow).join('') : '<div class="empty-state">Пока нет расходов</div>';
  }

  function getHistoryFilters() {
    return {
      query: $('filterQuery').value,
      category: $('filterCategory').value,
      month: $('filterMonth').value,
      dateFrom: $('filterDateFrom').value,
      dateTo: $('filterDateTo').value,
      compOnly: $('filterCompOnly').checked,
      minKopeks: L.parseMoneyToKopeks($('filterMin').value) || null,
      maxKopeks: L.parseMoneyToKopeks($('filterMax').value) || null,
    };
  }

  function renderHistory() {
    const filtered = L.filterExpenses(expenses, getHistoryFilters());
    const total = filtered.reduce((sum, e) => sum + e.amountKopeks, 0);
    $('historySummary').textContent = `${filtered.length} операций · исходная сумма ${L.formatMoney(total)}`;
    $('historyList').innerHTML = filtered.length ? filtered.map(transactionRow).join('') : '<div class="empty-state">Ничего не найдено</div>';
  }

  function renderReport() {
    $('reportMonth').value = currentReportMonth;
    const s = L.summarizeMonth(expenses, currentReportMonth);
    $('reportTotal').textContent = L.formatMoney(s.total);
    $('reportMonthTitle').textContent = L.monthTitle(currentReportMonth);
    $('reportCategoryCards').innerHTML = Object.entries(L.CATEGORIES).map(([key, c]) => `
      <div class="report-category-card">
        <b>${c.emoji} ${c.label}</b>
        <strong>${L.formatMoney(s.totals[key])}</strong>
      </div>`).join('');

    const comp = s.compensation;
    if (comp.raw > 0) {
      $('compensationReport').innerHTML = `
        <div class="comp-report">
          <h3>🏢 Компенсация ЕДА</h3>
          <div class="comp-stat-grid">
            <div class="comp-stat"><small>КОМ потрачено</small><b>${L.formatMoney(comp.raw)}</b></div>
            <div class="comp-stat"><small>Покрыто работой</small><b>${L.formatMoney(comp.covered)}</b></div>
            <div class="comp-stat"><small>Налог 13%</small><b>${L.formatMoney(comp.tax)}</b></div>
            <div class="comp-stat"><small>Сверх лимита</small><b>${L.formatMoney(comp.excess)}</b></div>
          </div>
          <div class="comp-days">
            ${comp.days.map(d => `<div class="comp-day"><span>${L.formatDateRu(d.day)} · ${L.formatMoney(d.raw)}</span><b>в расходах ${L.formatMoney(d.effective)}</b></div>`).join('')}
          </div>
        </div>`;
    } else {
      $('compensationReport').innerHTML = '';
    }

    const grouped = {};
    for (const key of Object.keys(L.CATEGORIES)) grouped[key] = [];
    for (const e of s.monthExpenses.sort((a, b) => (b.spentAt || '').localeCompare(a.spentAt || ''))) {
      if (grouped[e.category]) grouped[e.category].push(e);
    }
    $('reportDetails').innerHTML = Object.entries(L.CATEGORIES).map(([key, c]) => {
      const list = grouped[key];
      if (!list.length) return '';
      return `<div class="report-category-section"><h3>${c.emoji} ${c.label}</h3><div class="transaction-list">${list.map(transactionRow).join('')}</div></div>`;
    }).join('') || '<div class="empty-state">В этом месяце расходов нет</div>';
  }

  function renderSubscriptions() {
    const sorted = [...subscriptions].sort((a, b) => Number(a.dayOfMonth) - Number(b.dayOfMonth));
    $('subscriptionsList').innerHTML = sorted.length ? sorted.map(s => `
      <button class="subscription-row" data-sub-id="${s.id}">
        <span><b>${escapeHtml(s.name)}</b><small>${L.formatMoney(s.amountKopeks)} · ${s.dayOfMonth} числа${s.active === false ? ' · отключена' : ''}</small></span>
        <span>›</span>
      </button>`).join('') : '<div class="empty-state">Подписок пока нет</div>';
  }

  function renderAll() {
    renderHome();
    renderHistory();
    renderReport();
    renderSubscriptions();
  }

  function navigate(view) {
    currentView = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
    if (view === 'history') renderHistory();
    if (view === 'report') renderReport();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openNewExpense(category) {
    $('expenseModeLabel').textContent = 'НОВЫЙ РАСХОД';
    $('expenseTitle').textContent = `${L.CATEGORIES[category].emoji} ${L.CATEGORIES[category].label}`;
    $('expenseId').value = '';
    $('expenseAmount').value = '';
    $('expenseCategory').innerHTML = categoryOptions(category);
    $('expenseDate').value = L.currentLocalDate();
    $('expenseTime').value = L.currentLocalTime();
    $('expenseComment').value = '';
    $('expenseComp').checked = false;
    $('deleteExpenseBtn').classList.add('hidden');
    updateCompVisibility();
    $('expenseDialog').showModal();
    setTimeout(() => $('expenseAmount').focus(), 120);
  }

  async function openEditExpense(id) {
    const e = expenses.find(x => Number(x.id) === Number(id));
    if (!e) return;
    $('expenseModeLabel').textContent = 'РЕДАКТИРОВАНИЕ';
    $('expenseTitle').textContent = 'Операция';
    $('expenseId').value = e.id;
    $('expenseAmount').value = (e.amountKopeks / 100).toFixed(e.amountKopeks % 100 ? 2 : 0).replace('.', ',');
    $('expenseCategory').innerHTML = categoryOptions(e.category);
    const [datePart, timePart = '12:00'] = e.spentAt.split('T');
    $('expenseDate').value = datePart;
    $('expenseTime').value = timePart.slice(0, 5);
    $('expenseComment').value = e.comment || '';
    $('expenseComp').checked = !!e.isComp;
    $('deleteExpenseBtn').classList.remove('hidden');
    updateCompVisibility();
    $('expenseDialog').showModal();
  }

  function updateCompVisibility() {
    const isFood = $('expenseCategory').value === 'food';
    $('compToggleRow').classList.toggle('hidden', !isFood);
    if (!isFood) $('expenseComp').checked = false;
  }

  async function saveExpenseForm() {
    const amountKopeks = L.parseMoneyToKopeks($('expenseAmount').value);
    if (!amountKopeks) {
      showToast('Проверь сумму');
      return false;
    }
    const id = $('expenseId').value ? Number($('expenseId').value) : null;
    const old = id ? expenses.find(e => e.id === id) : null;
    const category = $('expenseCategory').value;
    const record = {
      ...(old || {}),
      category,
      amountKopeks,
      comment: $('expenseComment').value.trim(),
      spentAt: L.makeLocalDateTime($('expenseDate').value, $('expenseTime').value),
      isComp: category === 'food' ? $('expenseComp').checked : false,
      source: old?.source || 'manual',
      createdAt: old?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (id) {
      record.id = id;
      await DB.putExpense(record);
    } else {
      await DB.addExpense(record);
    }
    await refreshData();
    renderAll();
    showToast(id ? 'Расход обновлён' : 'Расход добавлен');
    return true;
  }

  async function deleteCurrentExpense() {
    const id = Number($('expenseId').value);
    if (!id) return;
    if (!confirm('Удалить эту операцию?')) return;
    await DB.deleteExpense(id);
    $('expenseDialog').close();
    await refreshData();
    renderAll();
    showToast('Операция удалена');
  }

  async function undoLastExpense() {
    const manual = expenses.filter(e => e.source !== 'recurring').sort((a, b) => (b.id || 0) - (a.id || 0));
    const last = manual[0];
    if (!last) return showToast('Нет операций для отмены');
    const c = L.CATEGORIES[last.category];
    if (!confirm(`Удалить последнюю операцию?\n\n${c.emoji} ${c.label}\n${L.formatMoney(last.amountKopeks)}${last.comment ? ` · ${last.comment}` : ''}`)) return;
    await DB.deleteExpense(last.id);
    await refreshData();
    renderAll();
    showToast('Последняя операция удалена');
  }

  async function quickAddFood() {
    const parsed = L.parseQuickFoodInput($('quickFoodInput').value);
    if (!parsed) return showToast('Например: 350 ком 16.10 обед');
    if (parsed.error) return showToast(parsed.error);
    await DB.addExpense({
      category: 'food',
      amountKopeks: parsed.amountKopeks,
      comment: parsed.comment || '',
      spentAt: L.makeLocalDateTime(parsed.date, L.currentLocalTime()),
      isComp: parsed.isComp,
      source: 'manual',
      createdAt: new Date().toISOString(),
    });
    $('quickFoodInput').value = '';
    await refreshData();
    renderAll();
    showToast(parsed.isComp ? `КОМ записан на ${L.formatDateRu(parsed.date)}` : 'Расход добавлен');
  }

  function openNewSubscription() {
    $('subscriptionFormTitle').textContent = 'Новая';
    $('subscriptionId').value = '';
    $('subscriptionName').value = '';
    $('subscriptionAmount').value = '';
    $('subscriptionDay').value = '';
    $('subscriptionActive').checked = true;
    $('deleteSubscriptionBtn').classList.add('hidden');
    $('subscriptionEditDialog').showModal();
  }

  function openEditSubscription(id) {
    const s = subscriptions.find(x => Number(x.id) === Number(id));
    if (!s) return;
    $('subscriptionFormTitle').textContent = 'Редактирование';
    $('subscriptionId').value = s.id;
    $('subscriptionName').value = s.name;
    $('subscriptionAmount').value = (s.amountKopeks / 100).toFixed(s.amountKopeks % 100 ? 2 : 0).replace('.', ',');
    $('subscriptionDay').value = s.dayOfMonth;
    $('subscriptionActive').checked = s.active !== false;
    $('deleteSubscriptionBtn').classList.remove('hidden');
    $('subscriptionEditDialog').showModal();
  }

  async function saveSubscriptionForm() {
    const amountKopeks = L.parseMoneyToKopeks($('subscriptionAmount').value);
    const day = Number($('subscriptionDay').value);
    const name = $('subscriptionName').value.trim();
    if (!name || !amountKopeks || day < 1 || day > 31) {
      showToast('Проверь название, сумму и число месяца');
      return false;
    }
    const id = $('subscriptionId').value ? Number($('subscriptionId').value) : null;
    const old = id ? subscriptions.find(s => s.id === id) : null;
    const today = L.currentLocalDate();
    let startMonth = today.slice(0, 7);
    const todayDay = Number(today.slice(8, 10));
    if (!old && todayDay > day) startMonth = L.shiftMonth(startMonth, 1);
    const [startYear, startM] = startMonth.split('-').map(Number);
    const record = {
      ...(old || {}),
      name,
      amountKopeks,
      dayOfMonth: day,
      active: $('subscriptionActive').checked,
      createdAt: old?.createdAt || new Date().toISOString(),
      startYear: old?.startYear || startYear,
      startMonth: old?.startMonth || startM,
      updatedAt: new Date().toISOString(),
    };
    if (id) { record.id = id; await DB.putSubscription(record); }
    else await DB.addSubscription(record);
    await refreshData();
    await processRecurringSubscriptions();
    await refreshData();
    renderAll();
    showToast('Подписка сохранена');
    return true;
  }

  async function deleteCurrentSubscription() {
    const id = Number($('subscriptionId').value);
    if (!id || !confirm('Удалить подписку? Исторические расходы останутся.')) return;
    await DB.deleteSubscription(id);
    $('subscriptionEditDialog').close();
    await refreshData();
    renderAll();
    showToast('Подписка удалена');
  }

  async function exportJson() {
    const payload = await DB.exportAll();
    downloadBlob(`findnevnik-backup-${L.currentLocalDate()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    showToast('JSON сохранён');
  }

  function exportCsv() {
    const csv = L.buildCsv(expenses);
    downloadBlob(`findnevnik-${L.currentLocalDate()}.csv`, csv, 'text/csv;charset=utf-8');
    showToast('CSV сохранён');
  }

  async function importJsonFile(file) {
    if (!file) return;
    if (!confirm('Импорт полностью заменит текущие данные. Продолжить?')) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await DB.importAll(payload);
      await refreshData();
      renderAll();
      showToast('Данные восстановлены');
    } catch (err) {
      console.error(err);
      alert('Не удалось импортировать резервную копию. Проверь файл.');
    } finally {
      $('importJsonInput').value = '';
    }
  }

  function resetFilters() {
    $('filterQuery').value = '';
    $('filterCategory').value = 'all';
    $('filterMonth').value = '';
    $('filterDateFrom').value = '';
    $('filterDateTo').value = '';
    $('filterCompOnly').checked = false;
    $('filterMin').value = '';
    $('filterMax').value = '';
    renderHistory();
  }

  function attachEvents() {
    document.addEventListener('click', (ev) => {
      const nav = ev.target.closest('[data-nav]');
      if (nav) return navigate(nav.dataset.nav);

      const add = ev.target.closest('[data-add-category]');
      if (add) return openNewExpense(add.dataset.addCategory);

      const tx = ev.target.closest('[data-expense-id]');
      if (tx) return openEditExpense(tx.dataset.expenseId);

      const sub = ev.target.closest('[data-sub-id]');
      if (sub) return openEditSubscription(sub.dataset.subId);
    });

    $('undoBtn').addEventListener('click', undoLastExpense);
    $('quickFoodAddBtn').addEventListener('click', quickAddFood);
    $('quickFoodInput').addEventListener('keydown', e => { if (e.key === 'Enter') quickAddFood(); });

    $('expenseCategory').addEventListener('change', updateCompVisibility);
    $('closeExpenseDialog').addEventListener('click', () => $('expenseDialog').close());
    $('deleteExpenseBtn').addEventListener('click', deleteCurrentExpense);
    $('expenseForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await saveExpenseForm()) $('expenseDialog').close();
    });

    const filterIds = ['filterQuery','filterCategory','filterMonth','filterDateFrom','filterDateTo','filterCompOnly','filterMin','filterMax'];
    filterIds.forEach(id => $(id).addEventListener(['filterCompOnly'].includes(id) ? 'change' : 'input', renderHistory));
    $('resetFiltersBtn').addEventListener('click', resetFilters);

    $('prevMonthBtn').addEventListener('click', () => { currentReportMonth = L.shiftMonth(currentReportMonth, -1); renderReport(); });
    $('nextMonthBtn').addEventListener('click', () => { currentReportMonth = L.shiftMonth(currentReportMonth, 1); renderReport(); });
    $('reportMonth').addEventListener('change', () => { if ($('reportMonth').value) currentReportMonth = $('reportMonth').value; renderReport(); });

    $('subscriptionsBtn').addEventListener('click', () => { renderSubscriptions(); $('subscriptionsDialog').showModal(); });
    $('closeSubscriptionsDialog').addEventListener('click', () => $('subscriptionsDialog').close());
    $('addSubscriptionBtn').addEventListener('click', openNewSubscription);
    $('closeSubscriptionEditDialog').addEventListener('click', () => $('subscriptionEditDialog').close());
    $('deleteSubscriptionBtn').addEventListener('click', deleteCurrentSubscription);
    $('subscriptionForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (await saveSubscriptionForm()) $('subscriptionEditDialog').close();
    });

    $('exportJsonBtn').addEventListener('click', exportJson);
    $('exportCsvBtn').addEventListener('click', exportCsv);
    $('importJsonInput').addEventListener('change', e => importJsonFile(e.target.files?.[0]));
  }

  function initSelects() {
    $('expenseCategory').innerHTML = categoryOptions('food');
    $('filterCategory').innerHTML = '<option value="all">Все категории</option>' + categoryOptions('');
  }

  async function init() {
    initSelects();
    attachEvents();
    await DB.openDb();
    await refreshData();
    await processRecurringSubscriptions();
    await refreshData();
    renderAll();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
    }
  }

  init().catch(err => {
    console.error(err);
    alert('Не удалось запустить FINДНЕВНИК. Попробуй обновить страницу.');
  });
})();
