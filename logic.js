(function (global) {
  'use strict';

  const CATEGORIES = {
    food: { label: 'ЕДА', emoji: '🍔' },
    entertainment: { label: 'РАЗВЛЕЧЕНИЯ', emoji: '🎮' },
    subscriptions: { label: 'ПОДПИСКИ', emoji: '💳' },
    shopping: { label: 'ШОПИНГ', emoji: '🛍' },
    home: { label: 'БЫТ', emoji: '🏠' },
    other: { label: 'ДРУГОЕ', emoji: '📦' },
  };

  const COMP_DAILY_LIMIT_KOPEKS = 140000;
  const COMP_TAX_RATE = 0.13;

  function pad2(n) { return String(n).padStart(2, '0'); }

  function localDateKey(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.slice(0, 10);
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  function currentLocalDate() {
    const d = new Date();
    return localDateKey(d);
  }

  function currentLocalTime() {
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function makeLocalDateTime(dateStr, timeStr) {
    return `${dateStr}T${timeStr || '12:00'}`;
  }

  function parseMoneyToKopeks(raw) {
    if (typeof raw === 'number') return Math.round(raw * 100);
    if (!raw) return null;
    const normalized = String(raw)
      .trim()
      .replace(/\s/g, '')
      .replace(',', '.')
      .replace(/[^0-9.]/g, '');
    if (!normalized || !/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
    const value = Number(normalized);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100);
  }

  function formatMoney(kopeks) {
    const sign = kopeks < 0 ? '-' : '';
    const abs = Math.abs(Math.round(kopeks));
    const rub = Math.floor(abs / 100);
    const kop = abs % 100;
    const rubText = new Intl.NumberFormat('ru-RU').format(rub);
    return kop ? `${sign}${rubText},${pad2(kop)} ₽` : `${sign}${rubText} ₽`;
  }

  function formatDateRu(dateKey) {
    if (!dateKey) return '';
    const [y, m, d] = dateKey.split('-');
    return `${d}.${m}.${y}`;
  }

  function formatDateTimeRu(spentAt) {
    if (!spentAt) return '';
    const [datePart, timePart = ''] = spentAt.split('T');
    const [y, m, d] = datePart.split('-');
    return `${d}.${m}.${y}${timePart ? ` ${timePart.slice(0, 5)}` : ''}`;
  }

  function monthKeyFromDateTime(spentAt) {
    return (spentAt || '').slice(0, 7);
  }

  function monthTitle(monthKey) {
    if (!monthKey) return '';
    const [y, m] = monthKey.split('-').map(Number);
    const months = ['ЯНВАРЬ','ФЕВРАЛЬ','МАРТ','АПРЕЛЬ','МАЙ','ИЮНЬ','ИЮЛЬ','АВГУСТ','СЕНТЯБРЬ','ОКТЯБРЬ','НОЯБРЬ','ДЕКАБРЬ'];
    return `${months[m - 1]} ${y}`;
  }

  function shiftMonth(monthKey, delta) {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  }

  function getCompensationByDay(expenses) {
    const byDay = new Map();
    for (const e of expenses) {
      if (e.category !== 'food' || !e.isComp) continue;
      const key = localDateKey(e.spentAt);
      byDay.set(key, (byDay.get(key) || 0) + e.amountKopeks);
    }
    const result = new Map();
    for (const [day, raw] of byDay.entries()) {
      const covered = Math.min(raw, COMP_DAILY_LIMIT_KOPEKS);
      const excess = Math.max(raw - COMP_DAILY_LIMIT_KOPEKS, 0);
      const tax = Math.round(covered * COMP_TAX_RATE);
      result.set(day, {
        day,
        raw,
        covered,
        tax,
        excess,
        effective: tax + excess,
      });
    }
    return result;
  }

  function summarizeMonth(expenses, monthKey) {
    const monthExpenses = expenses.filter(e => monthKeyFromDateTime(e.spentAt) === monthKey);
    const totals = {};
    for (const key of Object.keys(CATEGORIES)) totals[key] = 0;

    let normalFood = 0;
    for (const e of monthExpenses) {
      if (e.category === 'food') {
        if (!e.isComp) normalFood += e.amountKopeks;
      } else if (totals[e.category] !== undefined) {
        totals[e.category] += e.amountKopeks;
      }
    }

    const compDays = getCompensationByDay(monthExpenses);
    let compRaw = 0, compCovered = 0, compTax = 0, compExcess = 0, compEffective = 0;
    for (const v of compDays.values()) {
      compRaw += v.raw;
      compCovered += v.covered;
      compTax += v.tax;
      compExcess += v.excess;
      compEffective += v.effective;
    }
    totals.food = normalFood + compEffective;
    const total = Object.values(totals).reduce((a, b) => a + b, 0);

    return {
      monthKey,
      monthExpenses,
      totals,
      total,
      compensation: {
        raw: compRaw,
        covered: compCovered,
        tax: compTax,
        excess: compExcess,
        effective: compEffective,
        days: Array.from(compDays.values()).sort((a, b) => a.day.localeCompare(b.day)),
      },
    };
  }

  function parseQuickFoodInput(text, today = currentLocalDate()) {
    if (!text) return null;
    const trimmed = text.trim();
    const amountMatch = trimmed.match(/^\s*([0-9][0-9\s]*(?:[.,][0-9]{1,2})?)/);
    if (!amountMatch) return null;
    const amountKopeks = parseMoneyToKopeks(amountMatch[1]);
    if (!amountKopeks) return null;

    let rest = trimmed.slice(amountMatch[0].length).trim();
    const isComp = /(^|\s)ком(?=\s|$)/i.test(rest);
    let date = today;
    const dateMatch = rest.match(/(^|\s)(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?(?=\s|$)/);
    if (dateMatch) {
      const nowYear = Number(today.slice(0, 4));
      const year = dateMatch[4] ? Number(dateMatch[4]) : nowYear;
      const month = Number(dateMatch[3]);
      const day = Number(dateMatch[2]);
      const probe = new Date(year, month - 1, day);
      if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
        return { error: 'Некорректная дата' };
      }
      date = `${year}-${pad2(month)}-${pad2(day)}`;
      rest = `${rest.slice(0, dateMatch.index)} ${rest.slice(dateMatch.index + dateMatch[0].length)}`.trim();
    }
    rest = rest.replace(/(^|\s)ком(?=\s|$)/i, ' ').replace(/\s+/g, ' ').trim();

    return { amountKopeks, isComp, date, comment: rest };
  }

  function monthRange(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return { start: `${monthKey}-01`, end: `${monthKey}-${pad2(last)}` };
  }

  function filterExpenses(expenses, filters = {}) {
    const q = (filters.query || '').trim().toLowerCase();
    return expenses
      .filter(e => !filters.category || filters.category === 'all' || e.category === filters.category)
      .filter(e => !filters.month || monthKeyFromDateTime(e.spentAt) === filters.month)
      .filter(e => !filters.dateFrom || localDateKey(e.spentAt) >= filters.dateFrom)
      .filter(e => !filters.dateTo || localDateKey(e.spentAt) <= filters.dateTo)
      .filter(e => !filters.compOnly || e.isComp)
      .filter(e => !filters.minKopeks || e.amountKopeks >= filters.minKopeks)
      .filter(e => !filters.maxKopeks || e.amountKopeks <= filters.maxKopeks)
      .filter(e => !q || (e.comment || '').toLowerCase().includes(q))
      .sort((a, b) => (b.spentAt || '').localeCompare(a.spentAt || '') || (b.id || 0) - (a.id || 0));
  }

  function csvEscape(value) {
    const s = value == null ? '' : String(value);
    if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function buildCsv(expenses) {
    const compDays = getCompensationByDay(expenses);
    const rows = [[
      'Дата','Время','Категория','Сумма, ₽','Комментарий','КОМ',
      'КОМ за день, ₽','Покрыто за день, ₽','Налог 13% за день, ₽',
      'Сверх лимита за день, ₽','Итоговый расход КОМ-дня, ₽','Источник'
    ]];

    const sorted = [...expenses].sort((a, b) => (a.spentAt || '').localeCompare(b.spentAt || ''));
    for (const e of sorted) {
      const [datePart, timePart = ''] = e.spentAt.split('T');
      const dayInfo = e.isComp ? compDays.get(datePart) : null;
      rows.push([
        formatDateRu(datePart),
        timePart.slice(0, 5),
        CATEGORIES[e.category]?.label || e.category,
        (e.amountKopeks / 100).toFixed(2).replace('.', ','),
        e.comment || '',
        e.isComp ? 'Да' : 'Нет',
        dayInfo ? (dayInfo.raw / 100).toFixed(2).replace('.', ',') : '',
        dayInfo ? (dayInfo.covered / 100).toFixed(2).replace('.', ',') : '',
        dayInfo ? (dayInfo.tax / 100).toFixed(2).replace('.', ',') : '',
        dayInfo ? (dayInfo.excess / 100).toFixed(2).replace('.', ',') : '',
        dayInfo ? (dayInfo.effective / 100).toFixed(2).replace('.', ',') : '',
        e.source || 'manual',
      ]);
    }
    return '\uFEFF' + rows.map(r => r.map(csvEscape).join(';')).join('\r\n');
  }

  global.FinLogic = {
    CATEGORIES,
    COMP_DAILY_LIMIT_KOPEKS,
    COMP_TAX_RATE,
    pad2,
    localDateKey,
    currentLocalDate,
    currentLocalTime,
    makeLocalDateTime,
    parseMoneyToKopeks,
    formatMoney,
    formatDateRu,
    formatDateTimeRu,
    monthKeyFromDateTime,
    monthTitle,
    shiftMonth,
    getCompensationByDay,
    summarizeMonth,
    parseQuickFoodInput,
    monthRange,
    filterExpenses,
    buildCsv,
  };
})(typeof window !== 'undefined' ? window : globalThis);
