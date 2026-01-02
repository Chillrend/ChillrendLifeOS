const { GoogleGenAI } = require('@google/genai');
const { z } = require('zod');
const { zodToJsonSchema } = require('zod-to-json-schema');

// Initialize the new client
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/**
 * A helper function to call the Gemini model with a JSON schema.
 * @param {string} prompt - The prompt to send to the model.
 * @param {object} jsonSchema - The JSON schema for the response.
 * @param {z.ZodSchema} zodSchema - The Zod schema for validation.
 * @param {string} functionName - The name of the calling function for error logging.
 * @returns {Promise<object|null>} The validated JSON response from the model or null on failure.
 */
const generateAndValidateJson = async (prompt, jsonSchema, zodSchema, functionName) => {
    try {
        const result = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseJsonSchema: jsonSchema,
            },
        });

        // In the new SDK, 'text' is a property, not a function
        const rawText = result.text;

        console.log("Raw Response: ", rawText);

        const responseJson = JSON.parse(rawText);

        return zodSchema.parse(responseJson);
    } catch (error) {
        const errorMessage = error instanceof z.ZodError ? `Zod validation error` : `Gemini API error`;
        console.error(`[${functionName}] ${errorMessage}:`, error.message);
        if (error instanceof z.ZodError) console.error("Failed JSON:", error.message);
        return null;
    }
};

/**
 * Extracts task details from a natural language input.
 */
const parseTodo = async (text) => {
    const todoZodSchema = z.object({
        title: z.string().describe('The main title of the task.'),
        notes: z.string().optional().describe('Additional details or a description for the task.'),
        due: z.string().optional().describe("The due date in 'YYYY-MM-DD' format. If not specified, it can be omitted."),
    }).strict();

    const prompt = `
    You are a task management assistant API. Your only function is to extract task details from a user's input and format it into a JSON object.

    **CRITICAL INSTRUCTIONS:**
    1.  You MUST adhere strictly to the JSON schema provided.
    2.  ONLY output the fields defined in the schema: \`title\`, \`notes\`, \`due\`.
    3.  The 'title' is the primary action or subject of the task.
    4.  The 'notes' field should contain any supplementary details.
    5.  The 'due' date should be in 'YYYY-MM-DD' format.
    6.  Today's date is ${new Date().toISOString().split('T')[0]}. Use this as a reference for terms like "tomorrow".

    **USER INPUT:** "${text}"
    `;

    return generateAndValidateJson(
        prompt,
        zodToJsonSchema(todoZodSchema, { target: 'openApi3' }),
        todoZodSchema,
        'parseTodo'
    );
};

/**
 * Generates a formatted daily work log for a timesheet.
 * @param {Array<object>} tasks - A list of completed or in-progress tasks.
 * @param {Array<object>} comments - A list of comments made today, grouped by task.
 * @returns {Promise<string|null>} The formatted daily log as a string, or null on failure.
 */
const createDailyLog = async (tasks, comments) => {
    const taskList = tasks.map(t => `- ${t.name} (${t.state.name})`).join('\n');
    const commentList = comments.map(c => `Task: ${c.task}\n${c.comments.map(text => `  - ${text}`).join('\n')}`).join('\n\n');

    const prompt = `
    You are an expert assistant who creates daily work logs for timesheets.
    Based on the provided list of tasks and comments from today, generate a concise and professional summary of the work done in markdown format.

    **Formatting Rules:**
    - Use markdown bullet points for the summary.
    - Group related activities under a single task heading if appropriate.
    - Summarize the key accomplishments and progress for the day.
    - Be clear, professional, and to the point.

    **Today's Data:**

    **Tasks (Completed or In Progress):**
    ${taskList || 'No tasks updated.'}

    **Comments Added Today:**
    ${commentList || 'No comments made.'}

    **Generated Daily Log:**
    `;

    try {
        const result = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        const log = result.text;
        if (!log) {
             throw new Error("Empty response from Gemini.");
        }
        return log;

    } catch (error) {
        console.error(`[createDailyLog] Gemini API error:`, error.message);
        return null;
    }
};


/**
 * Extracts expense or income details from a text input.
 */
const processTransaction = async (text, type, accountNames, categoryNames) => {
    const transactionZodSchema = z.object({
        description: z.string().describe('A clear, concise description of the transaction.'),
        amount: z.number().positive().describe("The numeric amount, parsed from formats like '20k' to 20000."),
        category: z.enum(categoryNames).describe('The most appropriate category from the provided list.'),
        account: z.enum(accountNames).describe('The account used for the transaction. MUST be one of the available accounts.'),
        payee_name: z.string().optional().describe('The person or business involved (e.g., store for an expense). If not present, this can be omitted.'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The date in 'YYYY-MM-DD' format. Default to today if not specified."),
    }).strict();

    const prompt = `
You are a highly precise financial assistant API. Your ONLY function is to extract details from a user's input and format it into a JSON object.

**CRITICAL INSTRUCTIONS:**
1.  You MUST adhere strictly to the JSON schema provided.
2.  ONLY output the fields defined in the schema: \`description\`, \`amount\`, \`category\`, \`account\`, \`payee_name\`, \`date\`.
3.  The 'payee_name' is the merchant or person (e.g., 'Gojek', 'Starbucks'), or an Institution if it's an income (e.g Work, Investment Return).
4.  The 'description' is a summary.
5.  The user's input is usually in Indonesian.
6.  The transaction type is '${type}'.
7.  The amount is in number format
8.  Today's date is ${new Date().toISOString().split('T')[0]}. Use this if no date is mentioned in the input.

**AVAILABLE DATA:**
- Available Accounts: ${accountNames.join(', ')}
- Available Categories: ${categoryNames.join(', ')}

**USER INPUT:** "${text}"
`;

    return generateAndValidateJson(
        prompt,
        zodToJsonSchema(transactionZodSchema, {target: 'openApi3'}),
        transactionZodSchema,
        'processTransaction'
    );
};

/**
 * Extracts transfer details from a text input.
 */
const processTransfer = async (text, accountNames) => {
  const transferZodSchema = z.object({
    description: z.string().describe('A clear, concise summary of the transfer event.'),
    amount: z.number().positive().describe("The numeric amount of the transfer, parsed from formats like '20k' to 20000."),
    source_account: z.enum(accountNames).describe('The account the money is being moved FROM. This MUST be one of the available accounts.'),
    destination_account: z.enum(accountNames).describe('The account the money is being moved TO. This MUST be one of the available accounts.'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The date of the transfer in 'YYYY-MM-DD' format. Default to today if not specified."),
  }).strict();

  const prompt = `
You are a highly precise financial assistant API. Your ONLY function is to extract details about a transfer between accounts and format it into a JSON object.

**CRITICAL INSTRUCTIONS:**
1.  You MUST adhere strictly to the JSON schema provided.
2.  ONLY output the fields defined in the schema: \`description\`, \`amount\`, \`source_account\`, \`destination_account\`, \`date\`.
3.  The 'source_account' is where the money comes FROM.
4.  The 'destination_account' is where the money goes TO.
5.  The user's input is usually in Indonesian.
6.  The 'amount' is in number format
7.  Today's date is ${new Date().toISOString().split('T')[0]}. Use this if no date is mentioned in the input.

**AVAILABLE DATA:**
- Available Accounts: ${accountNames.join(', ')}

**USER INPUT:** "${text}"`;

  return generateAndValidateJson(prompt, zodToJsonSchema(transferZodSchema), transferZodSchema, 'processTransfer');
};

/**
 * Extracts details for a balance query from text.
 */
const processBalanceQuery = async (text, accountNames, categoryNames) => {
  const balanceQueryZodSchema = z.object({
    query_type: z.enum(['account', 'category', 'summary']).describe("The user's intent. 'account' for a specific account's balance, 'category' for spending in a category, or 'summary' for an overview of all accounts."),
    name: z.string().optional().describe("The specific name of the account or category being asked about. Can be 'all' for a summary."),
  }).strict();

  const prompt = `
You are a highly precise financial query API. Your ONLY function is to analyze the user's message and extract query details into a structured JSON object.

**CRITICAL INSTRUCTIONS:**
1.  You MUST adhere strictly to the JSON schema provided.
2.  ONLY output the fields defined in the schema: \`query_type\` and \`name\`.
3.  Determine the 'query_type' based on the user's question:
    - Use 'account' for questions about a specific account's balance.
    - Use 'category' for questions about spending in a specific category.
    - Use 'summary' for requests for a general overview or all account balances.
4.  The 'name' field should contain the specific account or category name mentioned, return empty string if 'summary' is selected.
5.  The user's input is usually in Indonesian.

**AVAILABLE DATA:**
- Available Accounts: ${accountNames.join(', ')}
- Available Categories: ${categoryNames.join(', ')}

**USER INPUT:** "${text}"`;

  return generateAndValidateJson(
    prompt,
    zodToJsonSchema(balanceQueryZodSchema),
    balanceQueryZodSchema,
    'processBalanceQuery'
  );
};

module.exports = {
  parseTodo,
  createDailyLog,
  processTransaction,
  processTransfer,
  processBalanceQuery,
};
