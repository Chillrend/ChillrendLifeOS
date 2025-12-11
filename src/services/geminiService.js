const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

/**
 * Parses a todo input string to extract task details.
 * @param {string} input - The raw input from the user (e.g., "Buy milk tomorrow at 5pm")
 * @returns {Promise<{title: string, notes: string, due: string | null}>}
 */
const parseTodo = async (input) => {
    const prompt = `
    You are a personal assistant. specific functionality is parsing task details from natural language.
    Current Date: ${new Date().toISOString()}

    Input: "${input}"

    Extract the following in JSON format:
    - title: The main task description.
    - notes: Any additional details or context mentioned.
    - due: The due date/time in RFC3339 format if mentioned, otherwise null.

    Output JSON only.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        // Clean up markdown code blocks if present
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error("Gemini Parse Error:", error);
        // Fallback: just use input as title
        return { title: input, notes: "", due: null };
    }
};

/**
 * Parses financial transaction details.
 * @param {string} input - e.g., "Spent $50 on groceries at Walmart"
 * @param {string} type - 'expense' | 'income'
 * @returns {Promise<{amount: number, category: string, payee: string, notes: string, date: string}>}
 */
const parseTransaction = async (input, type = 'expense') => {
    const prompt = `
    You are a personal finance assistant.
    Current Date: ${new Date().toISOString()}
    Transaction Type: ${type}

    Input: "${input}"

    Extract the following in JSON format:
    - amount: number (absolute value).
    - category: best guess category (e.g., Food, Transport, Utilities, Tech, Income).
    - payee: who got the money (or who paid).
    - notes: description of the item.
    - date: YYYY-MM-DD (default to today if not specified).

    Output JSON only.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error("Gemini Parse Transaction Error:", error);
        return null;
    }
};

module.exports = {
    parseTodo,
    parseTransaction
};
