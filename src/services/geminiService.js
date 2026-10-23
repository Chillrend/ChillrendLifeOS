const { GoogleGenAI } = require('@google/genai');
const { z } = require('zod');
const { zodToJsonSchema } = require('zod-to-json-schema');
const { generateAndValidateJsonWithRetry } = require('../utils/jsonParser');

// Initialize the new client
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Get models from environment
const PARSER_MODEL = process.env.GEMINI_PARSER_MODEL || 'gemini-2.5-flash';
const GENERAL_MODEL = process.env.GEMINI_GENERAL_MODEL || 'gemini-2.5-flash';

/**
 * Infers a date from a natural language string.
 * @param {string} text - The natural language date input (e.g., "yesterday").
 * @returns {Promise<string|null>} The date in YYYY-MM-DD format, or null on failure.
 */
const inferDate = async (text) => {
    const dateZodSchema = z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The inferred date in 'YYYY-MM-DD' format."),
    });

    const prompt = `
    You are a date parsing API. Your only function is to determine the exact date in YYYY-MM-DD format from a user's natural language input.
    
    **CRITICAL INSTRUCTIONS:**
    1.  Today's date is ${new Date().toISOString().split('T')[0]}.
    2.  Analyze the user's input and resolve it to a single, specific date.
    3.  Your output MUST be a JSON object with a single "date" field in "YYYY-MM-DD" format.

    **USER INPUT:** "${text}"
    `;

    try {
        const result = await generateAndValidateJsonWithRetry(
            genAI,
            PARSER_MODEL,
            prompt,
            zodToJsonSchema(dateZodSchema),
            dateZodSchema
        );
        return result ? result.date : null;
    } catch (error) {
        console.error('[inferDate] Error:', error.message);
        return null;
    }
};

/**
 * Refines a task's title and description and determines its properties.
 */
const refineTask = async (title, description) => {
    const priorities = ['urgent', 'high', 'medium', 'low'];

    const taskRefinementZodSchema = z.object({
        title: z.string().describe('A clear, concise, and action-oriented title for the task. Use exactly the key "title", do not use synonyms like "refinedTitle".'),
        notes: z.string().describe('A well-structured breakdown of the task. Use markdown for clarity (e.g., bullet points, sub-tasks).'),
        priority: z.enum(priorities).optional().describe('The priority level of the task. Infer from the user\'s language. Must be all lowercase: "urgent", "high", "medium", or "low".'),
        tags: z.array(z.string()).describe('A list of tags or keywords that fit this task. (e.g., "Ideas", "Incident", "Ops", "Development", "Networking"). Infer from content.'),
        isSufficient: z.boolean().describe('True if the user provided enough information to create a meaningful task. False if the task is too vague or lacks context.'),
        questions: z.array(z.string()).describe('If isSufficient is false, provide 1-3 specific questions to ask the user to gather the missing information. If true, this should be an empty array.'),
    });

    const prompt = `
    You are a productivity expert API. Your job is to analyze a user's task, refine it, and categorize it.

    **CRITICAL INSTRUCTIONS:**
    1.  **Refine Title:** Create a new title that is clear, concise, and action-oriented. You MUST output this exactly under the key "title". Do NOT use "refinedTitle" or any other synonyms.
    2.  **Structure notes:** Break down the description into structured markdown notes. YOU MUST strictly use this format with these exact headers:
        **Objective:** [1-2 sentences explaining the goal]
        **Action Items:** [Bullet points of steps to take]
        **Context:** [Any background info, if applicable]
    3.  **Grill the User:** If the input is too vague (e.g. "do the thing", "fix bug"), set isSufficient to false and ask targeted questions.
    4.  **Determine Priority & Tags:** Infer priority ("urgent", "high", "medium", "low") and relevant tags.
    5.  **Schema Match:** Adhere strictly to the JSON Schema.

    **USER'S TASK:**
    - **Title:** "${title}"
    - **Description:** "${description}"
    `;

    try {
        return await generateAndValidateJsonWithRetry(
            genAI,
            PARSER_MODEL,
            prompt,
            zodToJsonSchema(taskRefinementZodSchema, { target: 'openApi3' }),
            taskRefinementZodSchema
        );
    } catch (error) {
        console.error('[refineTask] Error:', error.message);
        return {
            title: title,
            notes: description,
            priority: 'low',
            tags: [],
        };
    }
};

/**
 * Generates a formatted daily work log for a timesheet.
 * @param {Array<object>} tasks - A list of completed or in-progress tasks.
 * @param {string} displayDate - The date for which the log is being generated (DD-MM-YYYY).
 * @returns {Promise<string|null>} The formatted daily log as a string, or null on failure.
 */
const createDailyLog = async (tasks, displayDate) => {
    const taskList = tasks.map(t => {
        // Strip markdown/html from notes if present
        const notes = t.description ? t.description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : 'No details provided.';
        return `Task: ${t.title} (Status: ${t.statusName || 'Unknown'})\nDetails: ${notes}`;
    }).join('\n\n');

    const prompt = `
    You are an expert assistant who creates daily work logs for a company timesheet.
    Your output will be copied directly into a WYSIWYG editor, so it must be plain text.

    **CRITICAL INSTRUCTIONS:**
    1.  **DO NOT USE MARKDOWN.** No bolding (**), no italics (*), no code blocks (\`\`\`).
    2.  Generate a concise, professional summary based on the tasks provided for ${displayDate} in (DD-MM-YYYY).
    3.  Start with a general title for the day's activities.
    4.  Use simple bullet points (e.g., a hyphen '-' or a bullet '•') for each major activity.
    5.  Incorporate key details from the task notes to make the summary informative and reflect the latest progress.
    6.  For tasks in progress, describe the work being done. Use phrases like "Continued work on..." or "Advanced the project by...".
    7.  For done tasks, state the accomplishment clearly.

    **Data for ${displayDate} (In DD-MM-YYYY):**
    ${taskList || 'No tasks to report.'}

    **Generated Plain Text Log:**
    `;

    try {
        const result = await genAI.models.generateContent({
            model: GENERAL_MODEL,
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
    });

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

    return generateAndValidateJsonWithRetry(
        genAI,
        PARSER_MODEL,
        prompt,
        zodToJsonSchema(transactionZodSchema, {target: 'openApi3'}),
        transactionZodSchema
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
  });

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

  return generateAndValidateJsonWithRetry(
    genAI,
    PARSER_MODEL,
    prompt,
    zodToJsonSchema(transferZodSchema),
    transferZodSchema
  );
};

/**
 * Extracts details for a balance query from text.
 */
const processBalanceQuery = async (text, accountNames, categoryNames) => {
  const balanceQueryZodSchema = z.object({
    query_type: z.enum(['account', 'category', 'summary']).describe("The user's intent. 'account' for a specific account's balance, 'category' for spending in a category, or 'summary' for an overview of all accounts."),
    name: z.string().optional().describe("The specific name of the account or category being asked about. Can be 'all' for a summary."),
  });

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

  return generateAndValidateJsonWithRetry(
    genAI,
    PARSER_MODEL,
    prompt,
    zodToJsonSchema(balanceQueryZodSchema),
    balanceQueryZodSchema
  );
};

/**
 * Maps a list of tasks to the most appropriate SKP values.
 * @param {Array<object>} tasks - The tasks to map.
 * @param {Array<object>} availableSkps - Array of { value: string, label: string }
 */
const mapTasksToSKP = async (tasks, availableSkps) => {
    const mappingSchema = z.object({
        mappings: z.array(z.object({
            taskTitle: z.string().describe("The original title of the task"),
            skpValue: z.string().describe("The most appropriate SKP value string from the available options")
        })).describe("List of task to SKP mappings")
    });

    const prompt = `
You are a precise JSON data mapper. Your ONLY job is to map tasks to an SKP value and output valid JSON.

**CRITICAL INSTRUCTIONS:**
1. You MUST output ONLY valid JSON. No markdown, no preamble.
2. The root must be an object with a "mappings" array.
3. Each item in the array must be an object with exactly two keys: "taskTitle" and "skpValue".
4. The "skpValue" MUST be chosen ONLY from the provided list of Available SKP IDs.

**EXPECTED JSON FORMAT:**
{
  "mappings": [
    {
      "taskTitle": "Task 1 Name",
      "skpValue": "ID_from_list"
    }
  ]
}

**AVAILABLE SKPs:**
${availableSkps.map(s => `- ID: "${s.value}", Description: "${s.label}"`).join('\n')}

**TASKS TO MAP:**
${tasks.map(t => `- Title: "${t.title}"\n  Description: "${t.description || 'No description'}"`).join('\n\n')}
`;

    try {
        const result = await generateAndValidateJsonWithRetry(
            genAI,
            PARSER_MODEL,
            prompt,
            undefined, // DO NOT pass zodToJsonSchema here, it breaks array of objects parsing for this specific schema structure in Gemini API
            mappingSchema
        );
        return result.mappings;
    } catch (error) {
        console.error('[mapTasksToSKP] Error:', error.message);
        // Fallback: return the first SKP for everything, or default
        const defaultSkp = availableSkps[0] ? availableSkps[0].value : (process.env.TIMESHEET_DEFAULT_SKP || "1");
        return tasks.map(t => ({ taskTitle: t.title, skpValue: defaultSkp }));
    }
};


/**
 * Summarizes a list of tasks into concise, impactful descriptions suitable for a daily log.
 * @param {Array<object>} tasks - The raw tasks from Vikunja (with title, description, and comments).
 * @returns {Promise<Array<object>>} - The tasks with summarized descriptions.
 */
const summarizeTasksForDailyLog = async (tasks) => {
    const summarizeSchema = z.object({
        tasks: z.array(z.object({
            title: z.string(),
            description: z.string().describe("A concise, impactful summary of what was done based on the original description and comments.")
        }))
    });

    const prompt = `
You are an expert technical writer creating a daily timesheet log.
I will provide a list of tasks with their original descriptions and any comments added to them.
Your job is to rewrite the "description" for each task to be extremely concise, impactful, and focused on the actual work accomplished.

**CRITICAL INSTRUCTIONS:**
1. Combine the original description and comments to understand the true progress.
2. The output description MUST be a single, plain text paragraph. NO Markdown (no bold, italics, bullets, etc.).
3. Keep it brief but impactful (e.g. "Implemented the new authentication flow and resolved edge cases identified during testing.")
4. Preserve the exact original title.
5. Return the array of tasks via the JSON schema.

**TASKS:**
${JSON.stringify(tasks, null, 2)}
`;

    try {
        const result = await generateAndValidateJsonWithRetry(
            genAI,
            PARSER_MODEL,
            prompt,
            undefined, // no direct openapi3 conversion here to avoid complex array structure issues
            summarizeSchema
        );
        
        // Merge the summarized descriptions back into the original task objects
        return tasks.map(originalTask => {
            const summaryTask = result.tasks.find(t => t.title === originalTask.title);
            return {
                ...originalTask,
                description: summaryTask ? summaryTask.description : originalTask.description
            };
        });
    } catch (error) {
        console.error('[summarizeTasksForDailyLog] Error:', error.message);
        return tasks; // Fallback to raw tasks if Gemini fails
    }
};

module.exports = {
  summarizeTasksForDailyLog,
  inferDate,
  refineTask,
  createDailyLog,
  mapTasksToSKP,
  processTransaction,
  processTransfer,
  processBalanceQuery,
};
