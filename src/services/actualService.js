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
 * @returns {Promise<string[]>} The IDs of the added transactions.
 */
const addTransactions = async (accountId, transactions) => {
  if (!isInitialized) {
    await init();
  }

  try {
    console.log(`Adding ${transactions.length} transaction(s) to account ${accountId}`);
    // Note: The new service used `addTransactions`, but `importTransactions` is often better
    // as it can create payees and apply rules. We will use that one.
    const transactionIds = await api.importTransactions(accountId, transactions);
    return transactionIds;
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
    const budgetMonth = await api.getBudgetMonth(date);
    return budgetMonth;
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
 * Gets the balance for a single account.
 * @param {string} accountId - The ID of the account.
 * @returns {Promise<number>} The balance of the account in cents.
 */
const getAccountBalance = async (accountId) => {
  if (!isInitialized) {
    await init();
  }

  try {
    console.log(`Getting balance for account: ${accountId}`);
    // Note: This function doesn't exist in the base API, but can be calculated.
    // For now, we will return a placeholder.
    // A full implementation would query transactions for the account and sum them.
    const accounts = await getAccounts();
    const account = accounts.find((a) => a.id === accountId);
    if (!account) throw new Error('Account not found');
    // The `balance` property is not guaranteed, so this is an approximation.
      return await api.getAccountBalance(accountId);
  } catch (error) {
    console.error(`Actual API Error (getAccountBalance): ${error.message}`);
    throw new Error(`Actual API Error (getAccountBalance): ${error.message}`);
  }
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
  getPayees,
  shutdown,
  utils: api.utils, // Exposing utils is helpful (e.g., for amountToInteger)
};
