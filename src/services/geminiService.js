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
 * Infers a date from a natural language string.
 * @param {string} text - The natural language date input (e.g., "yesterday").
 * @returns {Promise<string|null>} The date in YYYY-MM-DD format, or null on failure.
 */
const inferDate = async (text) => {
    const dateZodSchema = z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The inferred date in 'YYYY-MM-DD' format."),
    }).strict();

    const prompt = `
    You are a date parsing API. Your only function is to determine the exact date in YYYY-MM-DD format from a user's natural language input.
    
    **CRITICAL INSTRUCTIONS:**
    1.  Today's date is ${new Date().toISOString().split('T')[0]}.
    2.  Analyze the user's input and resolve it to a single, specific date.
    3.  Your output MUST be a JSON object with a single "date" field in "YYYY-MM-DD" format.

    **USER INPUT:** "${text}"
    `;

    const result = await generateAndValidateJson(
        prompt,
        zodToJsonSchema(dateZodSchema),
        dateZodSchema,
        'inferDate'
    );

    return result ? result.date : null;
};


/**
 * Refines a task's title and description and determines its properties.
 */
const refineTask = async (title, description) => {
    const states = ['Todo', 'In Progress', 'Paused', 'Done', 'Canceled'];
    const priorities = ['Urgent', 'High', 'Medium', 'Low'];
    const labels = ['Ideas', 'Incident', 'Ops', 'Development', 'Networking'];

    const taskRefinementZodSchema = z.object({
        title: z.string().describe('A clear, concise, and action-oriented title for the task.'),
        notes: z.string().describe('A well-structured breakdown of the task. Use markdown for clarity (e.g., bullet points, sub-tasks).'),
        state: z.enum(states).describe('The current state of the task. Default to "Todo" unless specified otherwise.'),
        priority: z.enum(priorities).optional().describe('The priority level of the task. Infer from the user\'s language (e.g., "now" -> "urgent"). Omit if no priority is mentioned.'),
        labels: z.array(z.enum(labels)).describe('A list of relevant labels. Infer from the task content.'),
    }).strict();

    const prompt = `
    You are a productivity expert API. Your job is to analyze a user's task, refine it, and categorize it.

    **CRITICAL INSTRUCTIONS:**
    1.  **Refine Title:** Create a new title that is clear, concise, and action-oriented.
    2.  **Structure Notes:** Break down the description into structured markdown notes.
    3.  **Determine State:** Choose the most appropriate state. Default to "Todo".
    4.  **Determine Priority:** Infer the priority from the user's language. If no priority is implied, OMIT the field.
    5.  **Determine Labels:** Select relevant labels that categorize the task.
    7.  Adhere strictly to the JSON schema and the available options.

    **Available Options:**
    - **States:** ${states.join(', ')}
    - **Priorities:** ${priorities.join(', ')}
    - **Labels:** ${labels.join(', ')}

    **USER'S TASK:**
    - **Title:** "${title}"
    - **Description:** "${description}"
    `;

    const result = await generateAndValidateJson(
        prompt,
        zodToJsonSchema(taskRefinementZodSchema, { target: 'openApi3' }),
        taskRefinementZodSchema,
        'refineTask'
    );

    if (!result) {
        return {
            title: title,
            notes: description,
            state: 'Todo',
            labels: [],
        };
    }

    return result;
};


/**
 * Generates a formatted daily work log for a timesheet.
 * @param {Array<object>} tasks - A list of completed or in-progress tasks.
 * @param {string} displayDate - The date for which the log is being generated (DD-MM-YYYY).
 * @returns {Promise<string|null>} The formatted daily log as a string, or null on failure.
 */
const createDailyLog = async (tasks, displayDate) => {
    const taskList = tasks.map(t => {
        // Strip HTML tags from the description to get plain text
        const notes = t.description_html ? t.description_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : 'No details provided.';
        return `Task: ${t.name} (Status: ${t.state.name})\nDetails: ${notes}`;
    }).join('\n\n');

    const prompt = `
    You are an expert assistant who creates daily work logs for a company timesheet.
    Your output will be copied directly into a WYSIWYG editor, so it must be plain text.

    **CRITICAL INSTRUCTIONS:**
    1.  **DO NOT USE MARKDOWN.** No bolding (**), no italics (*), no code blocks (\`\`\`).
    2.  Generate a concise, professional summary based on the tasks provided for ${displayDate}.
    3.  Start with a general title for the day's activities.
    4.  Use simple bullet points (e.g., a hyphen '-' or a bullet '•') for each major activity.
    5.  Incorporate key details from the task notes to make the summary informative.
    6.  For 'In Progress' tasks, use phrases like "Continued work on..." or "Advanced the project by...".
    7.  For 'Done' tasks, state the accomplishment clearly.

    **Data for ${displayDate}:**
    ${taskList || 'No tasks to report.'}

    **Generated Plain Text Log:**
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
6.  The amount is in number format
7.  Today's date is ${new Date().toISOString().split('T')[0]}. Use this if no date is mentioned in the input.

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
  inferDate,
  refineTask,
  createDailyLog,
  processTransaction,
  processTransfer,
  processBalanceQuery,
};
