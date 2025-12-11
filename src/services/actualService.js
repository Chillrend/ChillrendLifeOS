const api = require('@actual-app/api');
const fs = require('fs');
const path = require('path');

let _budgetId = process.env.ACTUAL_SYNC_ID;
let _connected = false;

// Ensure we have a data directory for Actual
const dataDir = path.join(__dirname, '../../actual-data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Initialize connection to Actual Budget
 */
const initActual = async () => {
    if (_connected) return;

    try {
        await api.init({
            dataDir,
            serverURL: process.env.ACTUAL_SERVER_URL,
            password: process.env.ACTUAL_PASSWORD,
        });

        // If no ID provided, try to find one? 
        // For safety, we strictly rely on env var or fail, 
        // but we could list files if needed. 
        // For now, assume user provides ACTUAL_SYNC_ID in env.

        if (!_budgetId) {
            console.warn("ACTUAL_SYNC_ID not set. Attempting to download first available budget...");
            // This logic could be complex (requires auth), so better to fail or wait.
        }

        console.log('Actual Budget API Initialized');
        _connected = true;
    } catch (error) {
        console.error('Failed to initialize Actual API:', error);
        throw error;
    }
};

/**
 * Add a transaction to Actual
 * @param {Object} transaction - { date, amount, payee, notes, category, account }
 */
const addTransaction = async (transaction) => {
    if (!_connected) await initActual();
    if (!_budgetId) throw new Error("ACTUAL_SYNC_ID is missing in environment variables.");

    await api.runWithBudget(_budgetId, async () => {
        // 1. Resolve Account
        // For simplicity, we default to the first available checking/cash account if not specified
        // or we can look up by name.
        let accountId;
        const accounts = await api.getAccounts();

        if (transaction.account) {
            const match = accounts.find(a => a.name.toLowerCase().includes(transaction.account.toLowerCase()));
            if (match) accountId = match.id;
        }

        if (!accountId) {
            // Fallback: try to find an account named 'Cash' or 'Checking' or take the first on-budget one
            const fallback = accounts.find(a => a.offbudget === false && (a.closed === false));
            if (fallback) accountId = fallback.id;
            else throw new Error("No open budget account found.");
        }

        // 2. Resolve Category
        // Actual API requires category ID. We need to fuzzy match the string name.
        let categoryId = null;
        if (transaction.category) {
            const groups = await api.getCategories(); // Returns groups with categories
            for (const group of groups) {
                if (group.categories) {
                    const found = group.categories.find(c =>
                        c.name.toLowerCase() === transaction.category.toLowerCase()
                    );
                    if (found) {
                        categoryId = found.id;
                        break;
                    }
                }
            }
        }

        // 3. Resolve Payee
        // Actual handles string payees well (creates new if needed), 
        // but explicit ID is better. api.importTransactions handles this usually,
        // but api.addTransactions is lower level. 
        // We'll use api.importTransactions() as it handles Rules and Payee creation automatically!

        const finalAmount = api.utils.amountToInteger(transaction.amount);

        const record = {
            date: transaction.date || new Date().toISOString().split('T')[0],
            amount: finalAmount, // Input should be number, util converts to integer cents
            payee_name: transaction.payee,
            notes: transaction.notes,
            account: accountId,
            cleared: true,
        };

        if (categoryId) {
            record.category = categoryId;
        }

        await api.importTransactions(accountId, [record]);
        console.log(`Imported transaction: ${transaction.payee} - ${transaction.amount}`);
    });
};

/**
 * Get current month budget summary (Basic)
 */
const getBudgetSummary = async () => {
    if (!_connected) await initActual();
    if (!_budgetId) throw new Error("ACTUAL_SYNC_ID is missing.");

    let summary = {};

    await api.runWithBudget(_budgetId, async () => {
        // This is complex in Actual API v6. 
        // We'll just return account balances for now as a "summary".
        const accounts = await api.getAccounts();
        const activeAccounts = accounts.filter(a => !a.closed && !a.offbudget);

        // We need to fetch balances (not directly in getAccounts in some versions, depends on cache)
        // Ideally we query generic balance.
        // For this task, let's keep it simple: just list accounts.
        summary.accounts = activeAccounts.map(a => ({ name: a.name, id: a.id }));
    });

    return summary;
};

module.exports = {
    initActual,
    addTransaction,
    getBudgetSummary
};
