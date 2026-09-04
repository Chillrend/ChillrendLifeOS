const { z } = require('zod');

/**
 * Generates content and validates it against a Zod schema. If validation or parsing fails,
 * it retries by providing the original prompt, the failed output, and the error details to the model.
 * 
 * @param {object} genAI - The GoogleGenAI instance.
 * @param {string} modelName - The Gemini model name from environment variables.
 * @param {string} originalPrompt - The original instructions and context.
 * @param {object} jsonSchema - The JSON Schema used by Gemini responseJsonSchema.
 * @param {z.ZodSchema} zodSchema - The Zod schema used for final strict validation.
 * @param {number} maxRetries - Maximum number of self-fixing attempts (default is 3).
 * @returns {Promise<object>} The parsed and validated JSON object.
 */
async function generateAndValidateJsonWithRetry(genAI, modelName, originalPrompt, jsonSchema, zodSchema, maxRetries = 3) {
  let currentPrompt = originalPrompt;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      console.log(`[JSON Parser] Attempt ${attempt + 1}/${maxRetries + 1} using model ${modelName}...`);
      
      const result = await genAI.models.generateContent({
        model: modelName,
        contents: currentPrompt,
        config: {
          responseMimeType: 'application/json',
          responseJsonSchema: jsonSchema,
        },
      });

      const text = result.text;
      console.log(`[JSON Parser] Raw Text from Model:\n${text}`);

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (parseError) {
        throw new Error(`JSON Syntax Error: ${parseError.message}`);
      }

      const validationResult = zodSchema.safeParse(parsed);
      if (validationResult.success) {
        console.log(`[JSON Parser] Validation succeeded on attempt ${attempt + 1}.`);
        return validationResult.data;
      } else {
        const errors = validationResult.error.issues.map(err => `${err.path.join('.')}: ${err.message}`).join('; ');
        throw new Error(`Schema Validation Error: ${errors}`);
      }

    } catch (error) {
      console.error(`[JSON Parser] Attempt ${attempt + 1} failed: ${error.message}`);
      
      if (attempt >= maxRetries) {
        throw new Error(`Failed to generate valid JSON after ${maxRetries + 1} attempts. Last error: ${error.message}`);
      }

      attempt++;
      
      // Feed back the original instructions, the broken output, and the error to the model
      currentPrompt = `
You are correcting a previous malformed or invalid response.

--- ORIGINAL INSTRUCTIONS ---
${originalPrompt}
-----------------------------

--- YOUR PREVIOUS FAILED RESPONSE ---
${currentPrompt.includes('YOUR PREVIOUS FAILED RESPONSE') ? 'Refer to previous attempt text' : ''}
${error.message.includes('JSON Syntax Error') ? '(Malformed JSON)' : ''}
${currentPrompt}

--- VALIDATION ERROR DETECTED ---
${error.message}
---------------------------------

Please analyze the error and the original instructions. Regenerate the output ensuring it is a 100% syntactically correct JSON object that strictly adheres to the schema. Do not include markdown code block syntax (like \`\`\`json) or any other explanation outside the JSON.
`;
    }
  }
}

module.exports = {
  generateAndValidateJsonWithRetry
};
