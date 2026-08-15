const DB_NAME = 'meu_dinheiro_web';
const DB_VERSION = 1;

const DEFAULT_CATEGORIES = [
  { name: 'Salário', icon: '💼', color: '#2e7d32', kind: 'income' },
  { name: 'Freelance', icon: '💻', color: '#00897b', kind: 'income' },
  { name: 'Outras entradas', icon: '➕', color: '#1565c0', kind: 'income' },
  { name: 'Alimentação', icon: '🍽️', color: '#ef6c00', kind: 'expense' },
  { name: 'Transporte', icon: '🚌', color: '#3949ab', kind: 'expense' },
  { name: 'Moradia', icon: '🏠', color: '#6d4c41', kind: 'expense' },
  { name: 'Lazer', icon: '🎮', color: '#8e24aa', kind: 'expense' },
  { name: 'Saúde', icon: '❤️', color: '#d81b60', kind: 'expense' },
  { name: 'Educação', icon: '🎓', color: '#00838f', kind: 'expense' },
  { name: 'Outros gastos', icon: '•••', color: '#546e7a', kind: 'expense' },
];

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Falha na transação local.'));
    tx.onabort = () => reject(tx.error || new Error('Transação local cancelada.'));
  });
}

export class FinanceDB {
  constructor() { this.db = null; }

  async init() {
    if (!('indexedDB' in window)) {
      throw new Error('Este navegador não oferece IndexedDB. Use Chrome, Edge, Firefox ou Safari atualizado.');
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        const accounts = db.createObjectStore('accounts', { keyPath: 'id', autoIncrement: true });
        accounts.createIndex('createdAt', 'createdAt');

        const categories = db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
        categories.createIndex('kind', 'kind');

        const transactions = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
        transactions.createIndex('occurredAt', 'occurredAt');
        transactions.createIndex('accountId', 'accountId');
        transactions.createIndex('categoryId', 'categoryId');
        transactions.createIndex('groupId', 'groupId');
        transactions.createIndex('type', 'type');

        const budgets = db.createObjectStore('budgets', { keyPath: 'id', autoIncrement: true });
        budgets.createIndex('categoryId', 'categoryId', { unique: true });

        db.createObjectStore('goals', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    this.db = await requestToPromise(request);
    this.db.onversionchange = () => this.db.close();
    await this.seedIfEmpty();
  }

  async seedIfEmpty() {
    const accountCount = await this.count('accounts');
    const categoryCount = await this.count('categories');
    if (accountCount > 0 && categoryCount > 0) return;

    const tx = this.db.transaction(['accounts', 'categories'], 'readwrite');
    if (accountCount === 0) {
      tx.objectStore('accounts').add({ name: 'Carteira', initialBalanceCents: 0, createdAt: new Date().toISOString() });
    }
    if (categoryCount === 0) {
      const store = tx.objectStore('categories');
      DEFAULT_CATEGORIES.forEach((category) => store.add(category));
    }
    await txDone(tx);
  }

  async count(storeName) {
    const tx = this.db.transaction(storeName, 'readonly');
    return requestToPromise(tx.objectStore(storeName).count());
  }

  async getAll(storeName) {
    const tx = this.db.transaction(storeName, 'readonly');
    return requestToPromise(tx.objectStore(storeName).getAll());
  }

  async get(storeName, id) {
    const tx = this.db.transaction(storeName, 'readonly');
    return requestToPromise(tx.objectStore(storeName).get(id));
  }

  async addAccount(name, initialBalanceCents = 0) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Informe um nome para a conta.');
    if (!Number.isSafeInteger(initialBalanceCents) || initialBalanceCents < 0) throw new Error('Saldo inicial inválido.');
    const tx = this.db.transaction('accounts', 'readwrite');
    tx.objectStore('accounts').add({ name: cleanName, initialBalanceCents, createdAt: new Date().toISOString() });
    await txDone(tx);
  }

  validateTransaction(input) {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error('Informe um valor maior que zero.');
    if (!Number.isInteger(input.accountId)) throw new Error('Selecione a conta.');
    if (!['income', 'expense', 'transfer'].includes(input.type)) throw new Error('Tipo de lançamento inválido.');
    if (input.type === 'transfer') {
      if (!Number.isInteger(input.destinationAccountId)) throw new Error('Selecione a conta de destino.');
      if (input.destinationAccountId === input.accountId) throw new Error('A conta de destino precisa ser diferente da origem.');
    } else if (!Number.isInteger(input.categoryId)) {
      throw new Error('Selecione uma categoria.');
    }
    if (!Number.isInteger(input.installmentTotal) || input.installmentTotal < 1 || input.installmentTotal > 60) {
      throw new Error('O número de parcelas deve ficar entre 1 e 60.');
    }
  }

  async addTransaction(input) {
    this.validateTransaction(input);
    const tx = this.db.transaction(['transactions', 'accounts', 'categories'], 'readwrite');
    const accounts = tx.objectStore('accounts');
    const categories = tx.objectStore('categories');
    const transactions = tx.objectStore('transactions');

    const source = await requestToPromise(accounts.get(input.accountId));
    if (!source) { tx.abort(); throw new Error('Conta de origem não encontrada.'); }
    if (input.type === 'transfer') {
      const dest = await requestToPromise(accounts.get(input.destinationAccountId));
      if (!dest) { tx.abort(); throw new Error('Conta de destino não encontrada.'); }
    } else {
      const category = await requestToPromise(categories.get(input.categoryId));
      if (!category || category.kind !== input.type) { tx.abort(); throw new Error('Categoria incompatível com o tipo do lançamento.'); }
    }

    const scheduledCount = input.fixedMonthly ? 12 : Math.min(60, Math.max(1, input.installmentTotal));
    const groupId = scheduledCount > 1 ? `g_${Date.now()}_${cryptoSafeId()}` : null;
    const createdAt = new Date().toISOString();

    for (let index = 0; index < scheduledCount; index++) {
      transactions.add({
        type: input.type,
        amountCents: input.amountCents,
        accountId: input.accountId,
        destinationAccountId: input.type === 'transfer' ? input.destinationAccountId : null,
        categoryId: input.type === 'transfer' ? null : input.categoryId,
        occurredAt: addMonthsISO(input.occurredAt, index),
        note: String(input.note || '').trim().slice(0, 160) || null,
        isFixed: Boolean(input.fixedMonthly),
        groupId,
        installmentNumber: input.installmentTotal > 1 ? index + 1 : null,
        installmentTotal: input.installmentTotal > 1 ? scheduledCount : null,
        createdAt,
      });
    }
    await txDone(tx);
  }

  async deleteTransaction(id, deleteGroup = false) {
    const tx = this.db.transaction('transactions', 'readwrite');
    const store = tx.objectStore('transactions');
    const item = await requestToPromise(store.get(id));
    if (item) {
      if (deleteGroup && item.groupId) {
        const index = store.index('groupId');
        const request = index.openCursor(IDBKeyRange.only(item.groupId));
        await new Promise((resolve, reject) => {
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve();
            cursor.delete();
            cursor.continue();
          };
        });
      } else {
        store.delete(id);
      }
    }
    await txDone(tx);
  }

  async upsertBudget(categoryId, limitCents) {
    if (!Number.isSafeInteger(limitCents) || limitCents <= 0) throw new Error('Informe um limite maior que zero.');
    const tx = this.db.transaction(['budgets', 'categories'], 'readwrite');
    const category = await requestToPromise(tx.objectStore('categories').get(categoryId));
    if (!category || category.kind !== 'expense') { tx.abort(); throw new Error('Selecione uma categoria de despesa.'); }
    const budgets = tx.objectStore('budgets');
    const existing = await requestToPromise(budgets.index('categoryId').get(categoryId));
    if (existing) budgets.put({ ...existing, limitCents });
    else budgets.add({ categoryId, limitCents });
    await txDone(tx);
  }

  async deleteBudget(id) {
    const tx = this.db.transaction('budgets', 'readwrite');
    tx.objectStore('budgets').delete(id);
    await txDone(tx);
  }

  async addGoal(name, targetCents, targetDate = null) {
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('Informe um nome para o cofrinho.');
    if (!Number.isSafeInteger(targetCents) || targetCents <= 0) throw new Error('Informe uma meta maior que zero.');
    const tx = this.db.transaction('goals', 'readwrite');
    tx.objectStore('goals').add({
      name: cleanName,
      targetCents,
      currentCents: 0,
      targetDate: targetDate || null,
      createdAt: new Date().toISOString(),
    });
    await txDone(tx);
  }

  async contributeGoal(id, amountCents) {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('Informe um valor maior que zero.');
    const tx = this.db.transaction('goals', 'readwrite');
    const store = tx.objectStore('goals');
    const goal = await requestToPromise(store.get(id));
    if (!goal) { tx.abort(); throw new Error('Cofrinho não encontrado.'); }
    goal.currentCents = Math.min(goal.targetCents, goal.currentCents + amountCents);
    store.put(goal);
    await txDone(tx);
  }

  async deleteGoal(id) {
    const tx = this.db.transaction('goals', 'readwrite');
    tx.objectStore('goals').delete(id);
    await txDone(tx);
  }

  async setSetting(key, value) {
    const tx = this.db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key, value });
    await txDone(tx);
  }

  async getSetting(key, fallback = null) {
    const tx = this.db.transaction('settings', 'readonly');
    const result = await requestToPromise(tx.objectStore('settings').get(key));
    return result?.value ?? fallback;
  }

  async getSnapshot() {
    const [accounts, categories, transactions, budgets, goals] = await Promise.all([
      this.getAll('accounts'), this.getAll('categories'), this.getAll('transactions'), this.getAll('budgets'), this.getAll('goals')
    ]);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nowMs = now.getTime();
    const nextMonthMs = nextMonth.getTime();

    const accountMap = new Map(accounts.map((x) => [x.id, x]));
    const categoryMap = new Map(categories.map((x) => [x.id, x]));
    const initialTotal = accounts.reduce((sum, a) => sum + a.initialBalanceCents, 0);

    let balanceCents = initialTotal;
    let projectedBalanceCents = initialTotal;
    let monthIncomeCents = 0;
    let monthExpenseCents = 0;
    const spendingMap = new Map();

    for (const tx of transactions) {
      const time = new Date(tx.occurredAt).getTime();
      const signed = tx.type === 'income' ? tx.amountCents : tx.type === 'expense' ? -tx.amountCents : 0;
      if (time <= nowMs) balanceCents += signed;
      if (time < nextMonthMs) projectedBalanceCents += signed;
      if (time >= monthStart.getTime() && time < nextMonthMs) {
        if (tx.type === 'income') monthIncomeCents += tx.amountCents;
        if (tx.type === 'expense') {
          monthExpenseCents += tx.amountCents;
          spendingMap.set(tx.categoryId, (spendingMap.get(tx.categoryId) || 0) + tx.amountCents);
        }
      }
    }

    const categorySpending = [...spendingMap.entries()]
      .map(([categoryId, amountCents]) => ({ category: categoryMap.get(categoryId), amountCents }))
      .filter((x) => x.category)
      .sort((a, b) => b.amountCents - a.amountCents);

    const cashFlow = [];
    for (let offset = 5; offset >= 0; offset--) {
      const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      let incomeCents = 0, expenseCents = 0;
      for (const tx of transactions) {
        const time = new Date(tx.occurredAt).getTime();
        if (time >= start.getTime() && time < end.getTime()) {
          if (tx.type === 'income') incomeCents += tx.amountCents;
          if (tx.type === 'expense') expenseCents += tx.amountCents;
        }
      }
      cashFlow.push({ label: monthLabel(start.getMonth()), incomeCents, expenseCents });
    }

    const recentTransactions = transactions
      .filter((tx) => new Date(tx.occurredAt).getTime() <= nowMs)
      .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt) || b.id - a.id)
      .slice(0, 8)
      .map((tx) => enrichTransaction(tx, accountMap, categoryMap));

    const allTransactions = transactions
      .slice()
      .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt) || b.id - a.id)
      .map((tx) => enrichTransaction(tx, accountMap, categoryMap));

    const budgetProgress = budgets.map((budget) => ({
      ...budget,
      category: categoryMap.get(budget.categoryId),
      spentCents: spendingMap.get(budget.categoryId) || 0,
    })).filter((b) => b.category).sort((a, b) => a.category.name.localeCompare(b.category.name, 'pt-BR'));

    const accountBalances = accounts.map((account) => {
      let amount = account.initialBalanceCents;
      for (const tx of transactions) {
        if (new Date(tx.occurredAt).getTime() > nowMs) continue;
        if (tx.type === 'income' && tx.accountId === account.id) amount += tx.amountCents;
        if (tx.type === 'expense' && tx.accountId === account.id) amount -= tx.amountCents;
        if (tx.type === 'transfer') {
          if (tx.accountId === account.id) amount -= tx.amountCents;
          if (tx.destinationAccountId === account.id) amount += tx.amountCents;
        }
      }
      return { ...account, balanceCents: amount };
    }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    return {
      accounts: accountBalances,
      categories,
      allTransactions,
      balanceCents,
      projectedBalanceCents,
      monthIncomeCents,
      monthExpenseCents,
      categorySpending,
      cashFlow,
      recentTransactions,
      budgets: budgetProgress,
      goals: goals.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    };
  }

  async exportBackup() {
    const data = {};
    for (const name of ['accounts', 'categories', 'transactions', 'budgets', 'goals', 'settings']) data[name] = await this.getAll(name);
    return { format: 'meu-dinheiro-backup', version: 1, exportedAt: new Date().toISOString(), data };
  }

  async importBackup(payload) {
    if (!payload || payload.format !== 'meu-dinheiro-backup' || payload.version !== 1 || !payload.data) {
      throw new Error('Arquivo de backup inválido ou incompatível.');
    }
    const stores = ['accounts', 'categories', 'transactions', 'budgets', 'goals', 'settings'];
    const tx = this.db.transaction(stores, 'readwrite');
    for (const name of stores) {
      const store = tx.objectStore(name);
      store.clear();
      for (const item of payload.data[name] || []) store.put(item);
    }
    await txDone(tx);
    await this.seedIfEmpty();
  }

  async reset() {
    const stores = ['accounts', 'categories', 'transactions', 'budgets', 'goals', 'settings'];
    const tx = this.db.transaction(stores, 'readwrite');
    stores.forEach((name) => tx.objectStore(name).clear());
    await txDone(tx);
    await this.seedIfEmpty();
  }
}

function enrichTransaction(tx, accountMap, categoryMap) {
  return {
    ...tx,
    accountName: accountMap.get(tx.accountId)?.name || 'Conta removida',
    destinationAccountName: tx.destinationAccountId ? accountMap.get(tx.destinationAccountId)?.name || 'Conta removida' : null,
    category: tx.categoryId ? categoryMap.get(tx.categoryId) || null : null,
  };
}

function addMonthsISO(isoOrDate, months) {
  const src = new Date(isoOrDate);
  const day = src.getDate();
  const result = new Date(src.getFullYear(), src.getMonth() + months, 1, 12, 0, 0, 0);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result.toISOString();
}

function monthLabel(monthIndex) {
  return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][monthIndex];
}

function cryptoSafeId() {
  if (globalThis.crypto?.getRandomValues) {
    const arr = new Uint32Array(2); crypto.getRandomValues(arr); return `${arr[0]}${arr[1]}`;
  }
  return `${Math.random().toString(36).slice(2)}${Date.now()}`;
}
