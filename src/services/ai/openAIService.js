const axios = require('axios');
const logger = require('../../utils/logger');

/**
 * Service for interacting with OpenAI API
 * Used for intelligent expense categorization
 */
class OpenAIService {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.baseURL = 'https://api.openai.com/v1';
    this.model = process.env.OPENAI_MODEL || 'gpt-4o-mini'; // Use cheaper model by default
    this.enabled = !!this.apiKey;
    
    if (this.enabled) {
      logger.info('OpenAI API configured', {
        model: this.model,
        baseURL: this.baseURL
      });
    } else {
      logger.warn('OpenAI API key not configured. AI categorization will be disabled.');
    }
  }

  /**
   * Categorize an expense using OpenAI
   * @param {Object} expense - Expense object with description, payer_name, amount, currency
   * @param {Array} availableCategories - Array of available expense categories
   * @returns {Promise<{categoryId: number|null, confidence: number, reasoning: string}>}
   */
  async categorizeExpense(expense, availableCategories) {
    if (!this.enabled) {
      return {
        categoryId: null,
        confidence: 0,
        reasoning: 'OpenAI API not configured'
      };
    }

    try {
      const { description, payer_name, amount, currency, category } = expense;
      
      // Build prompt with strict category list
      const categoriesList = availableCategories
        .map(cat => `- ID ${cat.id}: ${cat.name}${cat.description ? ` (${cat.description})` : ''}`)
        .join('\n');

      const categoryIds = availableCategories.map(cat => cat.id).join(', ');

      const prompt = `You are an expert accountant categorizing business expenses. Analyze the following transaction and suggest the most appropriate category.

IMPORTANT: You MUST use ONLY one of the categories from the list below. DO NOT create new categories or use category IDs that are not in the list.

Available categories (use ONLY these):
${categoriesList}

Valid category IDs: ${categoryIds}

Transaction details:
- Description: ${description || 'N/A'}
- Payer: ${payer_name || 'N/A'}
- Amount: ${amount} ${currency || 'PLN'}
- Bank category: ${category || 'N/A'}

Context hints for categorization:
- Gas stations (BP, Shell, Orlen, Statoil, etc.) → "Авто и обслуживание" (ID 42)
- Supermarkets (Lidl, Biedronka, Carrefour, etc.) → "Продукты и бытовые вещи" (ID 44)
- Software/SaaS (Google, Facebook, Pipedrive, etc.) → "Tools" (ID 33) or "Marketing & Advertising" (ID 20)
- Hotels/Booking → "Арентда домов" (ID 35)
- Taxes (ZUS, VAT, URZĄD SKARBOWY) → "Налоги" (ID 38) or "ВАТ" (ID 39) or "ЗУС" (ID 40)
- Restaurants/Cafes → "Услуги/Работы" (ID 29)
- Transportation (Ryanair, Rentalcars, etc.) → "Логистика" (ID 43)

Respond in JSON format:
{
  "categoryId": <number from the list above or null>,
  "confidence": <0-100>,
  "reasoning": "<brief explanation in English or Russian>"
}

CRITICAL RULES:
1. categoryId MUST be one of: ${categoryIds} or null
2. If no category matches well, set categoryId to null and confidence to 0
3. DO NOT invent new category IDs or use IDs not in the list
4. Analyze the description carefully - look for merchant names, service types, and transaction patterns
5. Use high confidence (80-100%) when you're certain about the category, lower (50-79%) when less certain`;

      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: 'system',
              content: `You are a financial categorization assistant. You MUST:
1. Use ONLY category IDs from the provided list: ${categoryIds}
2. Never invent new category IDs
3. If no category matches, return categoryId: null
4. Always respond with valid JSON only`
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3, // Lower temperature for more consistent results
          max_tokens: 200,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000 // 10 seconds timeout
        }
      );

      const content = response.data.choices[0].message.content;
      const result = JSON.parse(content);

      // Validate that categoryId exists in available categories
      const validCategoryIds = new Set(availableCategories.map(cat => cat.id));
      let categoryId = result.categoryId || null;
      
      // If categoryId is provided but not in the list, reject it
      if (categoryId !== null && !validCategoryIds.has(categoryId)) {
        logger.warn('OpenAI returned invalid categoryId, rejecting', {
          expenseId: expense.id,
          invalidCategoryId: categoryId,
          validCategoryIds: Array.from(validCategoryIds),
          reasoning: result.reasoning
        });
        categoryId = null;
      }

      logger.debug('OpenAI categorization result', {
        expenseId: expense.id,
        categoryId,
        confidence: result.confidence,
        reasoning: result.reasoning,
        validated: categoryId !== null || result.categoryId === null
      });

      return {
        categoryId,
        confidence: Math.min(Math.max(result.confidence || 0, 0), 100),
        reasoning: result.reasoning || ''
      };

    } catch (error) {
      // Handle different types of errors
      const statusCode = error.response?.status;
      const errorMessage = error.response?.data?.error?.message || error.message;
      
      if (statusCode === 401) {
        logger.warn('OpenAI API authentication failed - check API key', {
          expenseId: expense.id
        });
        // Disable OpenAI service if API key is invalid
        this.enabled = false;
      } else if (statusCode === 429) {
        logger.warn('OpenAI API rate limit exceeded', {
          expenseId: expense.id
        });
      } else {
        logger.error('OpenAI API error', {
          error: errorMessage,
          statusCode: statusCode,
          expenseId: expense.id,
          stack: error.stack
        });
      }

      // Return neutral result on error (don't throw)
      return {
        categoryId: null,
        confidence: 0,
        reasoning: statusCode === 401 
          ? 'OpenAI API key invalid or missing' 
          : `OpenAI error: ${errorMessage}`
      };
    }
  }

  /**
   * Batch categorize expenses (with rate limiting)
   * @param {Array} expenses - Array of expense objects
   * @param {Array} availableCategories - Array of available expense categories
   * @param {Object} options - Options: { batchSize: 5, delayMs: 1000 }
   * @returns {Promise<Array>} Array of categorization results
   */
  async categorizeExpensesBatch(expenses, availableCategories, options = {}) {
    if (!this.enabled) {
      return expenses.map(() => ({
        categoryId: null,
        confidence: 0,
        reasoning: 'OpenAI API not configured'
      }));
    }

    const { batchSize = 5, delayMs = 1000 } = options;
    const results = [];

    for (let i = 0; i < expenses.length; i += batchSize) {
      const batch = expenses.slice(i, i + batchSize);
      
      const batchPromises = batch.map(expense => 
        this.categorizeExpense(expense, availableCategories)
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Rate limiting: wait between batches
      if (i + batchSize < expenses.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  /**
   * Extract key patterns from expense descriptions for rule creation
   * @param {Array} expenses - Array of expense objects with same category
   * @returns {Promise<Array>} Array of suggested patterns
   */
  async extractPatterns(expenses) {
    if (!this.enabled || expenses.length === 0) {
      return [];
    }

    try {
      const descriptions = expenses
        .map(e => e.description || e.payer_name || '')
        .filter(d => d.trim())
        .slice(0, 10); // Limit to 10 examples

      const prompt = `Analyze these expense descriptions and suggest key patterns/keywords that can be used to automatically categorize similar expenses.

Expense descriptions:
${descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Respond in JSON format:
{
  "patterns": [
    {
      "type": "description" | "payer",
      "value": "<pattern or keyword>",
      "confidence": <0-100>
    }
  ]
}`;

      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are a pattern extraction assistant. Always respond with valid JSON only.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.2,
          max_tokens: 300,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      const content = response.data.choices[0].message.content;
      const result = JSON.parse(content);

      return result.patterns || [];

    } catch (error) {
      logger.error('OpenAI pattern extraction error', {
        error: error.message,
        expenseCount: expenses.length
      });
      return [];
    }
  }
}

module.exports = new OpenAIService();

