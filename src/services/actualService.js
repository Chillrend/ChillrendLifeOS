const api = require('@actual-app/api');
const fs = require('fs');
const path = require('path');

// Ensure we have a data directory for Actual
const dataDir = path.join(__dirname, '../../actual-data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let isInitialized = false;

/**
 * @typedef {object} Transaction
 * @property {string} date - The transaction date in YYYY-MM-DD format.
 * @property {number} amount - The transaction amount in milliunits (e.g., $12.34 is 12340).
 * @property {string} [payee_name] - The name of the payee.
 * @property {string} [notes] - Any notes for the transaction.
 * @property {string} [category] - The ID of the category for the transaction.
 * @property {boolean} [cleared] - The cleared status of the transaction.
 */

/**
 * @typedef {object} Account
 * @property {string} id - The account's unique identifier.
 * @property {string} name - The name of the account.
 * @property {string} type - The type of the account (e.g., 'checking', 'savings').
 * @property {boolean} offbudget - Whether the account is an off-budget account.
 * @property {boolean} closed - Whether the account is closed.
 * @property {number} balance - The current balance of the account.
 */

/**
 * @typedef {object} Category
 * @property {string} id - The category's unique identifier.
 * @property {string} name - The name of the category.
 * @property {boolean} is_income - Whether this is an income category.
 * @property {string} group_id - The ID of the group this category belongs to.
 */

/**
 * @typedef {object} Payee
 * @property {string} id - The payee's unique identifier.
 * @property {string} name - The name of the payee.
 * @property {string} [transfer_acct] - If this is a transfer payee, the ID of the account it transfers to/from.
 * @property {boolean} [internal] - Whether this is an internal payee (e.g., for transfers).
 */

/**
 * Initializes the connection to the Actual Budget server.
 * This must be called before any other methods.
 * @returns {Promise<void>}
 */
const init = async () => {
  if (isInitialized) {
    return;
  }
  try {
    console.log('Initializing connection to Actual Budget server...');
    await api.init({
      dataDir,
      serverURL: process.env.ACTUAL_SERVER_URL,
      password: process.env.ACTUAL_PASSWORD,
    });

    // This replaces the need for runWithBudget in every call
    await api.downloadBudget(process.env.ACTUAL_SYNC_ID);

    isInitialized = true;
    console.log('Successfully connected to Actual Budget server.');
  } catch (error) {
    console.error(`Actual API Init Error: ${error.message}`);
    throw new Error(`Actual API Init Error: ${error.message}`);
  }
};

/**
 * Adds transactions to a specified account in Actual.
 * @param {string} accountId - The ID of the account to add the transaction to.
 * @param {Transaction[]} transactions - An array of transaction objects.
 * @param {object} [options] - Optional flags.
 * @param {boolean} runTransfer - Whether to process transfers automatically.
 * @returns {Promise<string[]>} The IDs of the added transactions.
 */
const addTransactions = async (accountId, transactions, runTransfers = false ) => {
  if (!isInitialized) {
    await init();
  }

  try {
    console.log(`Adding ${transactions.length} transaction(s) to account ${accountId} with options:`, { runTransfers });
    return await api.addTransactions(accountId, transactions, {runTransfers: runTransfers});
  } catch (error) {
    console.error(`Actual API Error (addTransactions): ${error.message}`);
    throw new Error(`Actual API Error (addTransactions): ${error.message}`);
  }
};

/**
 * Gets the budget for a specific month.
 * @param {string} date - The month to get the budget for, in YYYY-MM format.
 * @returns {Promise<object>} The budget data for the specified month.
 */
const getBudgetMonth = async (date) => {
  if (!isInitialized) {
    await init();
  }

  try {
    console.log(`Getting budget for month: ${date}`);
      return await api.getBudgetMonth(date);
  } catch (error) {
    console.error(`Actual API Error (getBudgetMonth): ${error.message}`);
    throw new Error(`Actual API Error (getBudgetMonth): ${error.message}`);
  }
};

/**
 * Gets all accounts.
 * @returns {Promise<Account[]>} A list of all accounts.
 */
const getAccounts = async () => {
  if (!isInitialized) {
    await init();
  }

  try {
    console.log('Getting all accounts...');
    const accounts = await api.getAccounts();
    return accounts;
  } catch (error) {
    console.error(`Actual API Error (getAccounts): ${error.message}`);
    throw new Error(`Actual API Error (getAccounts): ${error.message}`);
  }
};

/**
 * Gets all categories.
 * @returns {Promise<Category[]>} A list of all categories.
 */
const getCategories = async () => {
  if (!isInitialized) {
    await init();
  }

  try {
    console.log('Getting all categories...');
      return await api.getCategories();
  } catch (error) {
    console.error(`Actual API Error (getCategories): ${error.message}`);
    throw new Error(`Actual API Error (getCategories): ${error.message}`);
  }
};

/**
 * Gets all payees.
 * @returns {Promise<Payee[]>} A list of all payees.
 */
const getPayees = async () => {
  if (!isInitialized) {
    await init();
  }

  try {
    console.log('Getting all payees...');
      return await api.getPayees();
  } catch (error) {
    console.error(`Actual API Error (getPayees): ${error.message}`);
    throw new Error(`Actual API Error (getPayees): ${error.message}`);
  }
};

/**
 * Gets the balance for a single account by summing its transactions.
 * @param {string} accountId - The ID of the account.
 * @returns {Promise<number>} The balance of the account in cents.
 */
const getAccountBalance = async (accountId) => {
  if (!isInitialized) {
    await init();
  }

  try {
    console.log(`Getting balance for account: ${accountId}`);
    // The `balance` property on an account is not always up-to-date.
    // A reliable way to get the balance is to sum all of its transactions.
    const transactions = await api.getTransactions(accountId);
    const balance = transactions.reduce((total, transaction) => total + transaction.amount, 0);
    return balance;
  } catch (error) {
    console.error(`Actual API Error (getAccountBalance): ${error.message}`);
    throw new Error(`Actual API Error (getAccountBalance): ${error.message}`);
  }
};

/**
 * Calculates the total spending for a specific category in the current month.
 * @param {string} categoryId - The ID of the category to query.
 * @returns {Promise<number>} The total spending in the category in cents.
 */
const getCategorySpending = async (categoryId) => {
    if (!isInitialized) {
        await init();
    }

    try {
        console.log(`Calculating spending for category: ${categoryId}`);
        const today = new Date();
        const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        // Format date to YYYY-MM-DD string right here, as requested.
        const startDate = firstDayOfMonth.toISOString().split('T')[0];
        const endDate = lastDayOfMonth.toISOString().split('T')[0];

        const transactions = await api.getTransactions(null, startDate, endDate);
        
        const categorySpending = transactions.reduce((total, t) => {
            // Only sum negative amounts for the specified category (expenses)
            if (t.category === categoryId && t.amount < 0) {
                return total + t.amount;
            }
            return total;
        }, 0);

        // Return the absolute value since spending is a positive concept
        return Math.abs(categorySpending);
    } catch (error) {
        console.error(`Actual API Error (getCategorySpending): ${error.message}`);
        throw new Error(`Actual API Error (getCategorySpending): ${error.message}`);
    }
};

/**
 * Gets the budgeted amount for a specific category in the current month.
 * @param {string} categoryId - The ID of the category to query.
 * @returns {Promise<number>} The budgeted amount in cents.
 */
const getCategoryBudget = async (categoryId) => {
    if (!isInitialized) {
        await init();
    }

    try {
        console.log(`Getting budget for category: ${categoryId}`);
        const today = new Date();
        const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

        const budgetData = await api.getBudgetMonth(month);
        
        for (const group of budgetData.categoryGroups) {
            const category = group.categories.find(c => c.id === categoryId);
            if (category) {
                return category.budgeted || 0; // Return budgeted amount or 0 if not set
            }
        }
        
        return 0; // Return 0 if category not found in budget
    } catch (error) {
        console.error(`Actual API Error (getCategoryBudget): ${error.message}`);
        throw new Error(`Actual API Error (getCategoryBudget): ${error.message}`);
    }
};

/**
 * Formats a numeric amount into Indonesian Rupiah (IDR) currency string.
 * @param {number} amount - The amount to format.
 * @returns {string} The formatted currency string (e.g., "Rp 10.000,00").
 */
const formatToIDR = (amount) => {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
};

/**
 * Shuts down the connection to the Actual Budget server.
 */
const shutdown = async () => {
  if (isInitialized) {
    await api.shutdown();
    isInitialized = false;
    console.log('Connection to Actual Budget server shut down.');
  }
};

module.exports = {
  init,
  addTransactions,
  getBudgetMonth,
  getAccounts,
  getAccountBalance,
  getCategories,
  getCategorySpending,
  getCategoryBudget,
  getPayees,
  shutdown,
  utils: api.utils, // Exposing utils is helpful (e.g., for amountToInteger)
  formatToIDR,
};
