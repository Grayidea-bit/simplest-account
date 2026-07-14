// main.ts — app bootstrap, state, and rendering. Vanilla TS, no framework.

import {
  ApiError,
  createCategory,
  createTransaction,
  CURRENCY_ORDER,
  currencySymbol,
  currentMonth,
  deleteCategory,
  deleteTransaction,
  dollarsToCents,
  formatCents,
  formatCurrencyCents,
  getCategories,
  getRates,
  getSummary,
  getTransactions,
  login,
  logout,
  monthLabel,
  patchCategory,
  patchTransaction,
  shiftMonth,
  todayIso,
  type Category,
  type RatesResponse,
  type Summary,
  type Transaction,
  type TxType,
} from './api';
import { renderDonut } from './chart';

const CURRENCY_STORAGE_KEY = 'sa_currency';

function loadStoredCurrency(): string {
  try {
    const stored = localStorage.getItem(CURRENCY_STORAGE_KEY);
    return stored && (CURRENCY_ORDER as readonly string[]).includes(stored) ? stored : 'TWD';
  } catch {
    return 'TWD';
  }
}

function storeCurrency(code: string): void {
  try {
    localStorage.setItem(CURRENCY_STORAGE_KEY, code);
  } catch {
    // localStorage unavailable (private mode etc.) — not fatal, just won't persist.
  }
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

interface AppState {
  categories: Category[];
  transactions: Transaction[];
  summary: Summary | null;
  rates: RatesResponse | null;
  month: string;
  quickAddType: TxType;
  quickAddCategoryId: number | null;
  quickAddCurrency: string;
  editingTxId: number | null;
}

const state: AppState = {
  categories: [],
  transactions: [],
  summary: null,
  rates: null,
  month: currentMonth(),
  quickAddType: 'expense',
  quickAddCategoryId: null,
  quickAddCurrency: loadStoredCurrency(),
  editingTxId: null,
};

/** Currency codes to offer, TWD first, drawn from /api/rates; falls back to TWD-only if rates failed to load. */
function currencyOptions(): string[] {
  const keys = state.rates ? Object.keys(state.rates.rates) : [];
  if (keys.length === 0) return ['TWD'];
  const known = CURRENCY_ORDER.filter((c) => keys.includes(c));
  const extra = keys.filter((k) => !(CURRENCY_ORDER as readonly string[]).includes(k)).sort();
  return known.length > 0 ? [...known, ...extra] : ['TWD'];
}

// ---------------------------------------------------------------------------
// dom helpers
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing element #${id}`);
  return found as T;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

let toastTimer: number | undefined;
function showToast(message: string, isError = false): void {
  const toast = el<HTMLDivElement>('toast');
  toast.textContent = message;
  toast.className = isError ? 'toast toast-error' : 'toast';
  toast.hidden = false;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

/** Runs an API call; on 401 flips to the login screen, on other errors toasts. Returns undefined on failure. */
async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.isUnauthorized) {
        showLoginView();
        return undefined;
      }
      showToast(err.message, true);
      return undefined;
    }
    showToast('Something went wrong.', true);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// view switching
// ---------------------------------------------------------------------------

function showLoginView(): void {
  el<HTMLDivElement>('app-view').hidden = true;
  el<HTMLDivElement>('login-view').hidden = false;
  el<HTMLDivElement>('category-modal').hidden = true;
}

function showAppView(): void {
  el<HTMLDivElement>('login-view').hidden = true;
  el<HTMLDivElement>('app-view').hidden = false;
}

// ---------------------------------------------------------------------------
// data loading
// ---------------------------------------------------------------------------

async function loadAll(): Promise<boolean> {
  const cats = await guarded(() => getCategories());
  if (cats === undefined) return false;
  state.categories = cats;
  ensureQuickAddCategory();

  await loadRates();
  renderQuickAddCurrency();

  const ok = await loadMonthData();
  if (!ok) return false;

  renderMonthHeader();
  renderCategoryChips();
  return true;
}

/** Fetches /api/rates for the currency picker. Failure degrades gracefully to TWD-only — no toast, no crash. */
async function loadRates(): Promise<void> {
  try {
    state.rates = await getRates();
  } catch {
    state.rates = null;
  }
}

async function loadMonthData(): Promise<boolean> {
  const [txs, summary] = await Promise.all([
    guarded(() => getTransactions(state.month)),
    guarded(() => getSummary(state.month)),
  ]);
  if (txs === undefined || summary === undefined) return false;
  state.transactions = txs;
  state.summary = summary;
  renderBalanceCard();
  renderChart();
  renderTransactionList();
  return true;
}

function ensureQuickAddCategory(): void {
  const options = state.categories.filter((c) => c.type === state.quickAddType);
  const stillValid = options.some((c) => c.id === state.quickAddCategoryId);
  if (!stillValid) {
    state.quickAddCategoryId = options.length > 0 ? options[0]!.id : null;
  }
}

function categoriesOfType(type: TxType): Category[] {
  return state.categories.filter((c) => c.type === type).sort((a, b) => a.sort_order - b.sort_order);
}

// ---------------------------------------------------------------------------
// month header
// ---------------------------------------------------------------------------

function renderMonthHeader(): void {
  el<HTMLDivElement>('month-label').textContent = state.month;
  const label = monthLabel(state.month); // "July 2026"
  el<HTMLDivElement>('month-sub').textContent = label.split(' ')[0] ?? '';
}

// ---------------------------------------------------------------------------
// balance card
// ---------------------------------------------------------------------------

function renderBalanceCard(): void {
  const card = el<HTMLDivElement>('balance-card');
  const s = state.summary;
  if (!s) {
    card.innerHTML = '';
    return;
  }
  const negative = s.balance < 0;
  card.innerHTML = `
    <div class="balance-row">
      <div class="balance-stat">
        <div class="balance-stat-label">Income</div>
        <div class="balance-stat-value income">${formatCents(s.income_total)}</div>
      </div>
      <div class="balance-stat">
        <div class="balance-stat-label">Expense</div>
        <div class="balance-stat-value expense">${formatCents(s.expense_total)}</div>
      </div>
    </div>
    <div class="balance-total-label">Balance</div>
    <div class="balance-total ${negative ? 'negative' : 'positive'}">${formatCents(s.balance)}</div>
  `;
}

// ---------------------------------------------------------------------------
// quick add — type toggle + chips
// ---------------------------------------------------------------------------

function renderTypeToggle(): void {
  const buttons = el<HTMLDivElement>('type-toggle').querySelectorAll<HTMLButtonElement>('.type-btn');
  buttons.forEach((btn) => {
    const isActive = btn.dataset.type === state.quickAddType;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
}

function renderQuickAddCurrency(): void {
  const select = el<HTMLSelectElement>('qa-currency');
  const symbolEl = el<HTMLSpanElement>('qa-currency-symbol');
  const options = currencyOptions();
  if (!options.includes(state.quickAddCurrency)) {
    state.quickAddCurrency = 'TWD';
  }
  select.innerHTML = options.map((c) => `<option value="${c}">${c}</option>`).join('');
  select.value = state.quickAddCurrency;
  select.disabled = options.length <= 1;
  symbolEl.textContent = currencySymbol(state.quickAddCurrency);
}

function renderCategoryChips(): void {
  const row = el<HTMLDivElement>('category-chips');
  const options = categoriesOfType(state.quickAddType);
  if (options.length === 0) {
    row.innerHTML = '<p class="chip-empty">No categories yet — add one via the gear icon.</p>';
    return;
  }
  row.innerHTML = options
    .map(
      (c) =>
        `<button type="button" class="chip ${c.id === state.quickAddCategoryId ? 'selected' : ''}" data-id="${c.id}" role="option" aria-selected="${c.id === state.quickAddCategoryId}">${escapeHtml(c.name)}</button>`,
    )
    .join('');
}

function wireQuickAddForm(): void {
  el<HTMLDivElement>('type-toggle').addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.type-btn');
    if (!target?.dataset.type) return;
    state.quickAddType = target.dataset.type as TxType;
    ensureQuickAddCategory();
    renderTypeToggle();
    renderCategoryChips();
  });

  el<HTMLDivElement>('category-chips').addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('.chip');
    if (!target?.dataset.id) return;
    state.quickAddCategoryId = Number(target.dataset.id);
    renderCategoryChips();
  });

  el<HTMLInputElement>('qa-date').value = todayIso();

  el<HTMLSelectElement>('qa-currency').addEventListener('change', () => {
    const select = el<HTMLSelectElement>('qa-currency');
    state.quickAddCurrency = select.value;
    storeCurrency(state.quickAddCurrency);
    el<HTMLSpanElement>('qa-currency-symbol').textContent = currencySymbol(state.quickAddCurrency);
  });

  el<HTMLFormElement>('quick-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = el<HTMLParagraphElement>('qa-error');
    errorEl.hidden = true;

    const amountInput = el<HTMLInputElement>('qa-amount');
    const dateInput = el<HTMLInputElement>('qa-date');
    const noteInput = el<HTMLInputElement>('qa-note');

    const cents = dollarsToCents(amountInput.value);
    if (cents === null || cents <= 0) {
      errorEl.textContent = 'Enter a valid amount, like 12.50.';
      errorEl.hidden = false;
      return;
    }
    if (state.quickAddCategoryId === null) {
      errorEl.textContent = 'Pick a category first.';
      errorEl.hidden = false;
      return;
    }
    if (!dateInput.value) {
      errorEl.textContent = 'Pick a date.';
      errorEl.hidden = false;
      return;
    }

    const note = noteInput.value.trim();
    const result = await guarded(() =>
      createTransaction({
        type: state.quickAddType,
        category_id: state.quickAddCategoryId!,
        amount_cents: cents,
        currency: state.quickAddCurrency,
        occurred_on: dateInput.value,
        ...(note ? { note } : {}),
      }),
    );
    if (result === undefined) return;

    amountInput.value = '';
    noteInput.value = '';
    amountInput.focus();

    if (result.occurred_on.slice(0, 7) === state.month) {
      await loadMonthData();
    }
    showToast('Entry added.');
  });
}

// ---------------------------------------------------------------------------
// transaction list
// ---------------------------------------------------------------------------

function formatShortDate(iso: string): string {
  const parts = iso.split('-');
  return `${parts[1] ?? '--'}-${parts[2] ?? '--'}`;
}

/** TWD rows keep the plain "$1,234.56" look; other currencies show their own symbol plus a dimmed TWD equivalent. */
function renderTxAmount(tx: Transaction): string {
  const sign = tx.type === 'income';
  if (tx.currency === 'TWD') {
    return `<div class="tx-amount ${sign ? 'income' : 'expense'}">${formatCents(tx.amount_cents, sign)}</div>`;
  }
  return `
    <div class="tx-amount-group">
      <div class="tx-amount ${sign ? 'income' : 'expense'}">${formatCurrencyCents(tx.amount_cents, tx.currency, sign)}</div>
      <div class="tx-amount-base">&#8776; ${formatCents(tx.base_cents)}</div>
    </div>
  `;
}

function renderTransactionList(): void {
  const container = el<HTMLDivElement>('tx-list');
  const emptyMsg = el<HTMLParagraphElement>('tx-empty');

  if (state.transactions.length === 0) {
    container.innerHTML = '';
    emptyMsg.hidden = false;
    return;
  }
  emptyMsg.hidden = true;

  container.innerHTML = state.transactions
    .map((tx) => {
      if (tx.id === state.editingTxId) {
        return renderEditRow(tx);
      }
      return `
        <div class="tx-row" data-id="${tx.id}">
          <div class="tx-date">${formatShortDate(tx.occurred_on)}</div>
          <div class="tx-mid">
            <div class="tx-category">${escapeHtml(tx.category_name)}</div>
            ${tx.note ? `<div class="tx-note">${escapeHtml(tx.note)}</div>` : ''}
          </div>
          ${renderTxAmount(tx)}
          <button type="button" class="tx-delete" data-id="${tx.id}" aria-label="Delete entry">&#10005;</button>
        </div>
      `;
    })
    .join('');
}

function renderEditRow(tx: Transaction): string {
  const options = categoriesOfType(tx.type)
    .map((c) => `<option value="${c.id}" ${c.id === tx.category_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`)
    .join('');
  const dollars = (tx.amount_cents / 100).toFixed(2);
  const baseOptions = currencyOptions();
  const currencyOpts = (baseOptions.includes(tx.currency) ? baseOptions : [...baseOptions, tx.currency])
    .map((c) => `<option value="${c}" ${c === tx.currency ? 'selected' : ''}>${c}</option>`)
    .join('');
  return `
    <div class="tx-edit-row" data-edit-id="${tx.id}">
      <div class="tx-edit-grid">
        <div class="field">
          <label>Category</label>
          <select class="tx-edit-category">${options}</select>
        </div>
        <div class="field">
          <label>Amount</label>
          <div class="amount-input-wrap tx-edit-amount-wrap">
            <div class="currency-picker">
              <span class="currency-picker-symbol tx-edit-currency-symbol">${currencySymbol(tx.currency)}</span>
              <span class="currency-picker-caret" aria-hidden="true">&#9662;</span>
              <select class="tx-edit-currency currency-picker-select" aria-label="Currency">${currencyOpts}</select>
            </div>
            <input type="text" inputmode="decimal" class="tx-edit-amount" value="${dollars}" />
          </div>
        </div>
        <div class="field">
          <label>Date</label>
          <input type="date" class="tx-edit-date" value="${tx.occurred_on}" />
        </div>
        <div class="field">
          <label>Note</label>
          <input type="text" class="tx-edit-note" maxlength="200" value="${escapeHtml(tx.note ?? '')}" />
        </div>
      </div>
      <div class="tx-edit-actions">
        <button type="button" class="tx-edit-save">Save</button>
        <button type="button" class="tx-edit-cancel">Cancel</button>
      </div>
    </div>
  `;
}

function wireTransactionList(): void {
  const container = el<HTMLDivElement>('tx-list');

  container.addEventListener('change', (e) => {
    const currencySel = (e.target as HTMLElement).closest<HTMLSelectElement>('.tx-edit-currency');
    if (!currencySel) return;
    const symbolEl = currencySel.closest('.currency-picker')?.querySelector<HTMLSpanElement>('.tx-edit-currency-symbol');
    if (symbolEl) symbolEl.textContent = currencySymbol(currencySel.value);
  });

  container.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    const deleteBtn = target.closest<HTMLButtonElement>('.tx-delete');
    if (deleteBtn?.dataset.id) {
      const id = Number(deleteBtn.dataset.id);
      if (window.confirm('Delete this entry?')) {
        const result = await guarded(() => deleteTransaction(id));
        if (result !== undefined) {
          if (state.editingTxId === id) state.editingTxId = null;
          await loadMonthData();
          showToast('Entry deleted.');
        }
      }
      return;
    }

    const saveBtn = target.closest<HTMLButtonElement>('.tx-edit-save');
    if (saveBtn) {
      const editRow = saveBtn.closest<HTMLDivElement>('.tx-edit-row');
      if (!editRow?.dataset.editId) return;
      const id = Number(editRow.dataset.editId);
      const categorySel = editRow.querySelector<HTMLSelectElement>('.tx-edit-category');
      const currencySel = editRow.querySelector<HTMLSelectElement>('.tx-edit-currency');
      const amountInput = editRow.querySelector<HTMLInputElement>('.tx-edit-amount');
      const dateInput = editRow.querySelector<HTMLInputElement>('.tx-edit-date');
      const noteInput = editRow.querySelector<HTMLInputElement>('.tx-edit-note');
      if (!categorySel || !currencySel || !amountInput || !dateInput || !noteInput) return;

      const cents = dollarsToCents(amountInput.value);
      if (cents === null || cents <= 0) {
        showToast('Enter a valid amount.', true);
        return;
      }
      const result = await guarded(() =>
        patchTransaction(id, {
          category_id: Number(categorySel.value),
          amount_cents: cents,
          currency: currencySel.value,
          occurred_on: dateInput.value,
          note: noteInput.value.trim() || null,
        }),
      );
      if (result !== undefined) {
        state.editingTxId = null;
        await loadMonthData();
        showToast('Entry updated.');
      }
      return;
    }

    const cancelBtn = target.closest<HTMLButtonElement>('.tx-edit-cancel');
    if (cancelBtn) {
      state.editingTxId = null;
      renderTransactionList();
      return;
    }

    // clicking anywhere else on a row (not the delete button, not inside the edit form) toggles edit
    const row = target.closest<HTMLDivElement>('.tx-row');
    if (row?.dataset.id) {
      const id = Number(row.dataset.id);
      state.editingTxId = state.editingTxId === id ? null : id;
      renderTransactionList();
    }
  });
}

// ---------------------------------------------------------------------------
// chart
// ---------------------------------------------------------------------------

function renderChart(): void {
  const container = el<HTMLDivElement>('chart-container');
  renderDonut(container, state.summary?.by_category ?? []);
}

// ---------------------------------------------------------------------------
// category modal
// ---------------------------------------------------------------------------

function openCategoryModal(): void {
  renderCategoryModal();
  el<HTMLDivElement>('category-modal').hidden = false;
}

function closeCategoryModal(): void {
  el<HTMLDivElement>('category-modal').hidden = true;
}

function renderCategoryModal(): void {
  renderCategoryGroup('expense');
  renderCategoryGroup('income');
}

function renderCategoryGroup(type: TxType): void {
  const list = el<HTMLDivElement>(`cat-list-${type}`);
  const items = categoriesOfType(type);
  if (items.length === 0) {
    list.innerHTML = '<p class="chip-empty">No categories yet.</p>';
    return;
  }
  list.innerHTML = items
    .map(
      (c, i) => `
      <div class="cat-item" data-id="${c.id}">
        <span class="cat-item-name" data-id="${c.id}" title="Click to rename">${escapeHtml(c.name)}</span>
        <div class="cat-item-actions">
          <button type="button" class="cat-item-btn cat-up" data-id="${c.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">&#9650;</button>
          <button type="button" class="cat-item-btn cat-down" data-id="${c.id}" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Move down">&#9660;</button>
          <button type="button" class="cat-item-btn danger cat-delete" data-id="${c.id}" aria-label="Delete category">&#10005;</button>
        </div>
      </div>
    `,
    )
    .join('');
}

function startRenameCategory(nameSpan: HTMLElement, category: Category): void {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cat-rename-input';
  input.value = category.name;
  input.maxLength = 40;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  let settled = false;
  const commit = async () => {
    if (settled) return;
    settled = true;
    const newName = input.value.trim();
    if (newName && newName !== category.name) {
      const result = await guarded(() => patchCategory(category.id, { name: newName }));
      if (result !== undefined) {
        const catIdx = state.categories.findIndex((c) => c.id === category.id);
        if (catIdx >= 0) state.categories[catIdx] = result;
      }
    }
    renderCategoryModal();
    renderCategoryChips();
  };
  const cancel = () => {
    if (settled) return;
    settled = true;
    renderCategoryModal();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });
}

async function moveCategory(id: number, direction: -1 | 1): Promise<void> {
  const category = state.categories.find((c) => c.id === id);
  if (!category) return;
  const group = categoriesOfType(category.type);
  const idx = group.findIndex((c) => c.id === id);
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= group.length) return;
  const neighbor = group[swapIdx]!;

  const a = await guarded(() => patchCategory(category.id, { sort_order: neighbor.sort_order }));
  const b = await guarded(() => patchCategory(neighbor.id, { sort_order: category.sort_order }));
  if (a === undefined || b === undefined) return;

  const cats = await guarded(() => getCategories());
  if (cats === undefined) return;
  state.categories = cats;
  renderCategoryModal();
  renderCategoryChips();
}

function wireCategoryModal(): void {
  el<HTMLButtonElement>('settings-btn').addEventListener('click', openCategoryModal);
  el<HTMLButtonElement>('modal-close').addEventListener('click', closeCategoryModal);

  const overlay = el<HTMLDivElement>('category-modal');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeCategoryModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeCategoryModal();
  });

  overlay.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    const nameSpan = target.closest<HTMLElement>('.cat-item-name');
    if (nameSpan?.dataset.id) {
      const category = state.categories.find((c) => c.id === Number(nameSpan.dataset.id));
      if (category) startRenameCategory(nameSpan, category);
      return;
    }

    const upBtn = target.closest<HTMLButtonElement>('.cat-up');
    if (upBtn?.dataset.id && !upBtn.disabled) {
      await moveCategory(Number(upBtn.dataset.id), -1);
      return;
    }
    const downBtn = target.closest<HTMLButtonElement>('.cat-down');
    if (downBtn?.dataset.id && !downBtn.disabled) {
      await moveCategory(Number(downBtn.dataset.id), 1);
      return;
    }

    const deleteBtn = target.closest<HTMLButtonElement>('.cat-delete');
    if (deleteBtn?.dataset.id) {
      const id = Number(deleteBtn.dataset.id);
      const category = state.categories.find((c) => c.id === id);
      if (!category) return;
      if (window.confirm(`Delete category "${category.name}"?`)) {
        const result = await guarded(() => deleteCategory(id));
        if (result !== undefined) {
          const cats = await guarded(() => getCategories());
          if (cats !== undefined) {
            state.categories = cats;
            ensureQuickAddCategory();
            renderCategoryModal();
            renderCategoryChips();
            showToast(result.deleted === 'hard' ? 'Category deleted.' : 'Category retired.');
          }
        }
      }
      return;
    }
  });

  overlay.querySelectorAll<HTMLFormElement>('.cat-add-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector<HTMLInputElement>('input[type="text"]');
      const type = form.dataset.type as TxType | undefined;
      if (!input || !type) return;
      const name = input.value.trim();
      if (!name) return;
      const result = await guarded(() => createCategory(name, type));
      if (result !== undefined) {
        input.value = '';
        const cats = await guarded(() => getCategories());
        if (cats !== undefined) {
          state.categories = cats;
          ensureQuickAddCategory();
          renderCategoryModal();
          renderCategoryChips();
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// month navigation
// ---------------------------------------------------------------------------

function wireMonthNav(): void {
  el<HTMLButtonElement>('prev-month').addEventListener('click', async () => {
    state.month = shiftMonth(state.month, -1);
    state.editingTxId = null;
    renderMonthHeader();
    await loadMonthData();
  });
  el<HTMLButtonElement>('next-month').addEventListener('click', async () => {
    state.month = shiftMonth(state.month, 1);
    state.editingTxId = null;
    renderMonthHeader();
    await loadMonthData();
  });
}

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

function wireLoginForm(): void {
  el<HTMLFormElement>('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = el<HTMLParagraphElement>('login-error');
    errorEl.hidden = true;
    const passcodeInput = el<HTMLInputElement>('passcode');

    try {
      await login(passcodeInput.value);
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 401
          ? 'Wrong passcode.'
          : err instanceof ApiError
            ? err.message
            : 'Could not reach the server.';
      errorEl.textContent = message;
      errorEl.hidden = false;
      passcodeInput.select();
      return;
    }

    passcodeInput.value = '';
    showAppView();
    const ok = await loadAll();
    if (!ok) showLoginView();
  });
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

function wireLogout(): void {
  el<HTMLButtonElement>('logout-btn').addEventListener('click', async () => {
    if (!window.confirm('Log out?')) return;
    try {
      await logout();
    } catch {
      // ignore — we're showing the login screen regardless
    }
    state.categories = [];
    state.transactions = [];
    state.summary = null;
    state.editingTxId = null;
    closeCategoryModal();
    showLoginView();
  });
}

async function boot(): Promise<void> {
  wireLoginForm();
  wireQuickAddForm();
  wireTransactionList();
  wireCategoryModal();
  wireMonthNav();
  wireLogout();
  renderTypeToggle();

  try {
    await getCategories();
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) {
      showLoginView();
      return;
    }
    // non-auth failure on boot: still show login as the safe default
    showLoginView();
    return;
  }

  showAppView();
  await loadAll();
}

void boot();
