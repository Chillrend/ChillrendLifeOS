const { GoogleGenerativeAI } = require('@google/generative-ai');
const { z } = require('zod');
const { zodToJsonSchema } = require('zod-to-json-schema');

// Assuming apiKey is set in environment variables
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
    const modelWithSchema = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash', // Updated model
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
      },
    });

    const result = await modelWithSchema.generateContent(prompt);
    const responseJson = JSON.parse(result.response.text());

    return zodSchema.parse(responseJson);
  } catch (error) {
    const errorMessage = error instanceof z.ZodError ? `Zod validation error` : `Gemini API error`;
    console.error(`[${functionName}] ${errorMessage}:`, error.message);
    return null; // Return null on error
  }
};

/**
 * Extracts expense or income details from a text input.
 * @param {string} text - The user's input describing the transaction.
 * @param {'expense' | 'income'} type - The type of transaction.
 * @param {string[]} accountNames - A list of available account names.
 * @param {string[]} categoryNames - A list of available category names.
 * @returns {Promise<object|null>} A structured transaction object or null on failure.
 */
const processTransaction = async (text, type, accountNames, categoryNames) => {
  const transactionZodSchema = z.object({
    description: z.string().describe('A clear, concise description of the transaction.'),
    amount: z.number().positive().describe("The numeric amount, parsed from formats like '20k' to 20000."),
    category_name: z.enum(categoryNames).describe('The most appropriate category from the provided list.'),
    account_name: z.enum(accountNames).describe('The account used, chosen from the provided list.'),
    payee_name: z.string().optional().describe('The person or business involved (e.g., store for an expense).'),
    transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The date in 'YYYY-MM-DD' format. Default to today if not specified."),
  });

  const prompt = `
You are a financial assistant processing an '${type}'. Extract the details from the user's input in Indonesian.
Today's Date: ${new Date().toISOString().split('T')[0]}

Available Accounts: ${accountNames.join(', ')}
Available Categories: ${categoryNames.join(', ')}

User Input: "${text}"`;

  return generateAndValidateJson(
    prompt,
    zodToJsonSchema(transactionZodSchema),
    transactionZodSchema,
    'processTransaction'
  );
};

/**
 * Extracts transfer details from a text input.
 * @param {string} text - The user's input describing the transfer.
 * @param {string[]} accountNames - A list of available account names.
 * @returns {Promise<object|null>} A structured transfer object or null on failure.
 */
const processTransfer = async (text, accountNames) => {
  const transferZodSchema = z.object({
    description: z.string().describe('A clear, concise description of the transfer.'),
    amount: z.number().positive().describe("The numeric amount, parsed from formats like '20k' to 20000."),
    source_account_name: z.enum(accountNames).describe('The account money is coming FROM, chosen from the list.'),
    destination_account_name: z.enum(accountNames).describe('The account money is going TO, chosen from the list.'),
    transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The date in 'YYYY-MM-DD' format. Default to today if not specified."),
  });

  const prompt = `
You are a financial assistant processing a transfer. Extract the details from the user's input in Indonesian.
Today's Date: ${new Date().toISOString().split('T')[0]}

Available Accounts: ${accountNames.join(', ')}

User Input: "${text}"`;

  return generateAndValidateJson(prompt, zodToJsonSchema(transferZodSchema), transferZodSchema, 'processTransfer');
};

/**
 * Extracts details for a balance query from text.
 * @param {string} text - The user's query.
 * @param {string[]} accountNames - A list of available account names.
 * @param {string[]} categoryNames - A list of available category names.
 * @returns {Promise<object|null>} A structured query object or null on failure.
 */
const processBalanceQuery = async (text, accountNames, categoryNames) => {
  const balanceQueryZodSchema = z.object({
    query_type: z.enum(['account', 'category', 'summary']).describe("Type of query: 'account' for balance, 'category' for spending, 'summary' for overview."),
    name: z.string().optional().describe("The name of the account or category being asked about. Can be 'all' for a summary."),
  });

  const prompt = `
You are a financial query AI. Extract the query details from the user's message in Indonesian.

Available Accounts: ${accountNames.join(', ')}
Available Categories: ${categoryNames.join(', ')}

User Message: "${text}"`;

  return generateAndValidateJson(
    prompt,
    zodToJsonSchema(balanceQueryZodSchema),
    balanceQueryZodSchema,
    'processBalanceQuery'
  );
};

module.exports = {
  processTransaction,
  processTransfer,
  processBalanceQuery,
};
