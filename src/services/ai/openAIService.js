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
      logger.error('OpenAI categorization error', {
        error: error.message,
        expenseId: expense.id,
        response: error.response?.data
      });
      return {
        categoryId: null,
        confidence: 0,
        reasoning: `Error: ${error.message}`
      };
    }
  }

  /**
   * Generate strategic insights using OpenAI
   * Phase 19: Strategic Insights - AI-Powered (FR-030-FR-035)
   * @param {Object} insightsData - All calculated insights data
   * @returns {Promise<Object>} Strategic insights object
   */
  async generateStrategicInsights(insightsData) {
    if (!this.enabled) {
      throw new Error('OpenAI API not configured');
    }

    try {
      const prompt = `Ты финансовый аналитик и бизнес-консультант, специализирующийся на анализе PNL отчетов для бизнеса в сфере коливингов и workation-кемпов. Твоя задача - не просто проанализировать цифры, а дать персонализированные стратегические рекомендации с учетом специфики бизнеса Comoon.

КОНТЕКСТ О БИЗНЕСЕ COMOON:
Comoon (https://comoon.io) - платформа для удаленных работников, которая организует три типа активностей:

1. КЕМПЫ ДЛЯ УДАЛЕНЩИКОВ:
   - Краткосрочные поездки (неделя-две) в разные локации
   - Формат: работа + отдых + комьюнити
   - Популярные направления: Испания, Португалия, Франция, Норвегия, Польша
   - Сезонность: лето (пик), зима (горнолыжные кемпы), праздники
   - Целевая аудитория: удаленные работники, фрилансеры, IT-специалисты, предприниматели

2. КОЛИВИНГИ НА МЕСЯЦ:
   - Долгосрочное совместное проживание и работа в одном месте
   - Более стабильный источник дохода
   - Меньше сезонности, но требует долгосрочного планирования

3. МЕРОПРИЯТИЯ:
   - События и активности для комьюнити
   - Могут быть как источником дохода, так и инструментом маркетинга

МОДЕЛЬ ПОСТУПЛЕНИЯ ДЕНЕГ:
- Выручка = продажа мест на кемпы + коливинги + мероприятия
- Расходы = аренда локаций + организация + маркетинг + команда + налоги
- Сезонность критична: летние месяцы обычно пиковые, зимние могут быть низкими (кроме горнолыжных направлений)
- География влияет на спрос: популярные направления (Испания, Португалия) vs менее популярные
- Формат влияет на цену: премиум локации (шато, виллы) vs стандартные

ВАЖНО О ВАЛЮТЕ (КРИТИЧЕСКИ ВАЖНО!):
- ВСЕ суммы в данных указаны в польских злотых (PLN), НЕ в долларах
- Валюта данных: ${insightsData.currency || 'PLN'} (${insightsData.currencyName || 'польские злотые'})
- При упоминании сумм в ответе ВСЕГДА указывай "PLN" или "злотых", НИКОГДА не используй "долларов", "$", "USD" или "долл."
- Пример правильного формата: "1,238,765.31 PLN" или "1,238,765.31 злотых"
- Пример неправильного формата: "1,238,765.31 долларов" или "$1,238,765.31"
- Если в данных указана сумма без валюты, это ВСЕГДА PLN, не доллары!

Данные для анализа (все суммы в ${insightsData.currency || 'PLN'}):
${JSON.stringify(insightsData, null, 2)}

ТВОЯ ЗАДАЧА:
Проанализируй данные НЕ ТОЛЬКО как финансовые показатели, но и с точки зрения бизнеса Comoon:
- Какие месяцы/кварталы показывают пики и спады? Связано ли это с сезонностью кемпов?
- Какой формат (кемпы/коливинги/мероприятия) может быть более прибыльным?
- Какие локации или направления могут быть более перспективными?
- Как оптимизировать расходы с учетом специфики бизнеса (аренда локаций, маркетинг)?
- Какие риски связаны с сезонностью и как их минимизировать?
- Как использовать данные о лучших/худших месяцах для планирования кемпов?
- Проанализируй маркетинговые метрики (MQL, маркетинговые расходы, конверсия): эффективны ли маркетинговые вложения? Какие каналы/месяцы показывают лучшую конверсию? Как оптимизировать маркетинговый бюджет?

Создай структурированный ответ в формате JSON. КРИТИЧЕСКИ ВАЖНО: заполни ВСЕ 9 полей ниже, не пропускай ни одного! Используй минимум 4-5 элементов в массивах!

{
  "summary": "Краткая общая сводка производительности за год с учетом специфики бизнеса Comoon (2-3 предложения). ВСЕГДА используй PLN, не USD!",
  "breakEvenStatus": "Оценка статуса безубыточности с учетом модели бизнеса (кемпы/коливинги/мероприятия). ВСЕГДА используй PLN, не USD!",
  "growthTrajectory": "Оценка траектории роста с анализом влияния форматов и сезонности. ВСЕГДА используй PLN, не USD!",
  "seasonalPatterns": "Детальный анализ сезонных паттернов с рекомендациями по планированию кемпов и коливингов. ВСЕГДА используй PLN, не USD!",
  "keyObservations": [
    "Наблюдение 1 с привязкой к специфике бизнеса (форматы, локации, сезонность). ВСЕГДА используй PLN, не USD!",
    "Наблюдение 2. ВСЕГДА используй PLN, не USD!",
    "Наблюдение 3. ВСЕГДА используй PLN, не USD!",
    "Наблюдение 4. ВСЕГДА используй PLN, не USD!",
    "Наблюдение 5. ВСЕГДА используй PLN, не USD!"
  ],
  "recommendations": [
    "Конкретная рекомендация для бизнеса Comoon (например: увеличить количество летних кемпов в Испании, развивать коливинги для стабильности дохода, оптимизировать маркетинг в низкие сезоны). ВСЕГДА используй PLN, не USD!",
    "Рекомендация 2. ВСЕГДА используй PLN, не USD!",
    "Рекомендация 3. ВСЕГДА используй PLN, не USD!",
    "Рекомендация 4. ВСЕГДА используй PLN, не USD!",
    "Рекомендация 5. ВСЕГДА используй PLN, не USD!"
  ],
  "vision": "Видение развития бизнеса Comoon на основе текущих показателей: куда движется бизнес, какие возможности открываются, какое будущее видится для платформы (минимум 3-4 предложения, подробно). ВСЕГДА используй PLN, не USD! ОБЯЗАТЕЛЬНОЕ ПОЛЕ - не пропускай!",
  "scalingOpportunities": [
    "Конкретная возможность масштабирования с учетом текущих данных (например: расширение в новые географические направления, увеличение частоты кемпов, развитие сети коливингов). ВСЕГДА используй PLN, не USD!",
    "Возможность 2. ВСЕГДА используй PLN, не USD!",
    "Возможность 3. ВСЕГДА используй PLN, не USD!",
    "Возможность 4. ВСЕГДА используй PLN, не USD!"
  ],
  "diversificationIdeas": [
    "Конкретная идея для диверсификации бизнеса, смежная с текущей моделью (например: корпоративные workation для команд, долгосрочные программы на 3-6 месяцев, партнерства с локациями). ВСЕГДА используй PLN, не USD!",
    "Идея 2. ВСЕГДА используй PLN, не USD!",
    "Идея 3. ВСЕГДА используй PLN, не USD!",
    "Идея 4. ВСЕГДА используй PLN, не USD!"
  ]
}

ПРОВЕРЬ ПЕРЕД ОТПРАВКОЙ:
1. Все 9 полей заполнены? (summary, breakEvenStatus, growthTrajectory, seasonalPatterns, keyObservations, recommendations, vision, scalingOpportunities, diversificationIdeas)
2. Нет ли в тексте слов "USD", "долларов", "$"? Если есть - замени на "PLN" или "злотых"
3. Все суммы указаны с "PLN" или "злотых"?
4. Массивы содержат минимум 4-5 элементов?

КРИТИЧЕСКИ ВАЖНО:
- НЕ просто пересказывай цифры - давай бизнес-инсайты
- Учитывай специфику кемпов, коливингов и мероприятий в каждой рекомендации
- Связывай финансовые показатели с бизнес-моделью
- 🚨 ВАЛЮТА: ВСЕГДА используй PLN (злотые) при упоминании сумм, НИКОГДА не используй доллары, "$", "USD" или "долл."
- Перед отправкой ответа проверь весь текст на наличие слов "доллар", "$", "USD" - если найдешь, ЗАМЕНИ на "PLN" или "злотых"

ПРИМЕРЫ ИНТЕРПРЕТАЦИИ ДАННЫХ:
- Если лучший месяц - летний (июнь-август): "Летние месяцы показывают пик выручки, что типично для кемпов. Рекомендуется увеличить количество летних кемпов в популярных направлениях (Испания, Португалия)"
- Если худший месяц - зимний (январь-февраль): "Низкая выручка в зимние месяцы может быть связана с отсутствием зимних кемпов. Рассмотрите организацию горнолыжных кемпов или развитие коливингов для стабилизации дохода"
- Если есть сезонность: "Обнаружена четкая сезонность с пиком летом. Для стабилизации дохода рекомендуется развивать коливинги на месяц, которые менее подвержены сезонности"
- Если расходы высокие: "Высокие расходы могут быть связаны с арендой премиум-локаций. Рассмотрите баланс между премиум и стандартными локациями для оптимизации маржинальности"
- Если рост выручки: "Рост выручки может быть связан с увеличением количества кемпов или популярностью определенных направлений. Проанализируйте, какие форматы и локации наиболее прибыльны"

ТРЕБОВАНИЯ К РЕКОМЕНДАЦИЯМ:
- Каждая рекомендация должна быть конкретной и применимой к бизнесу Comoon
- Указывай конкретные форматы (кемпы/коливинги/мероприятия), сезоны, направления
- Связывай рекомендации с данными (например: "Учитывая, что лучший месяц - октябрь, рассмотрите организацию осенних кемпов в популярных направлениях")
- Максимум 5-7 ключевых наблюдений
- Максимум 5-7 стратегических рекомендаций (каждая должна быть конкретной и применимой к бизнесу Comoon)

КРИТИЧЕСКИ ВАЖНО - ОБЯЗАТЕЛЬНЫЕ ПОЛЯ:
Ты ОБЯЗАН заполнить ВСЕ поля в JSON ответе, включая:
- "vision" - ОБЯЗАТЕЛЬНО заполни! Это видение развития бизнеса на основе текущих показателей (2-3 предложения)
- "scalingOpportunities" - ОБЯЗАТЕЛЬНО заполни массив из 4-5 возможностей масштабирования! Каждая возможность должна быть конкретной и реализуемой
- "diversificationIdeas" - ОБЯЗАТЕЛЬНО заполни массив из 4-5 идей диверсификации! Каждая идея должна быть смежной с текущей моделью бизнеса

ТРЕБОВАНИЯ К ВИДЕНИЮ И МАСШТАБИРОВАНИЮ:
- Видение (vision) - ОБЯЗАТЕЛЬНОЕ поле! Должно быть основано на текущих показателях и показывать потенциал развития Comoon. Минимум 2-3 предложения о том, куда движется бизнес, какие возможности открываются, какое будущее видится для платформы
- Возможности масштабирования (scalingOpportunities) - ОБЯЗАТЕЛЬНЫЙ массив! Должен содержать 4-5 конкретных и реализуемых возможностей (новые направления, форматы, партнерства, расширение сети коливингов, увеличение частоты кемпов)
- Идеи диверсификации (diversificationIdeas) - ОБЯЗАТЕЛЬНЫЙ массив! Должен содержать 4-5 идей, смежных с текущей моделью бизнеса (корпоративные workation для команд, долгосрочные программы на 3-6 месяцев, партнерства с локациями, образовательные компоненты, новые форматы мероприятий)

НЕ ПРОПУСКАЙ ЭТИ ПОЛЯ! Они критически важны для стратегического планирования.`;

      // Log prompt preview for debugging
      logger.info('Sending prompt to OpenAI', {
        promptLength: prompt.length,
        promptPreview: prompt.substring(0, 500),
        hasCurrencyInfo: prompt.includes('PLN') || prompt.includes('злотых'),
        hasVisionInstruction: prompt.includes('vision'),
        hasScalingInstruction: prompt.includes('scalingOpportunities'),
        hasDiversificationInstruction: prompt.includes('diversificationIdeas')
      });

      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        {
          model: this.model,
          messages: [
            {
              role: 'system',
              content: `Ты опытный финансовый аналитик и бизнес-консультант, специализирующийся на анализе PNL отчетов для бизнеса в сфере коливингов и workation-кемпов. Твоя задача - давать НЕ просто финансовую аналитику, а ПЕРСОНАЛИЗИРОВАННЫЕ бизнес-рекомендации с учетом специфики бизнеса. Всегда отвечай на русском языке в формате JSON.

🚨🚨🚨 КРИТИЧЕСКИ ВАЖНО О ВАЛЮТЕ - ПРОЧИТАЙ ВНИМАТЕЛЬНО! 🚨🚨🚨
- ВСЕ суммы в данных указаны в польских злотых (PLN), НЕ в долларах США (USD)
- ВСЕГДА используй "PLN" или "злотых" при упоминании сумм в ответе
- НИКОГДА не используй "долларов", "$", "USD", "долл.", "USD" или любые другие обозначения долларов
- Пример ПРАВИЛЬНОГО формата: "1,238,765.31 PLN" или "1,238,765.31 злотых"
- Пример НЕПРАВИЛЬНОГО формата: "1,238,765.31 долларов" или "$1,238,765.31" или "1,238,765.31 USD"
- Если ты используешь доллары в ответе - это КРИТИЧЕСКАЯ ОШИБКА!

КОНТЕКСТ О БИЗНЕСЕ COMOON:
Ты анализируешь финансовые показатели компании Comoon (https://comoon.io) - платформы для удаленных работников.

БИЗНЕС-МОДЕЛЬ (3 формата):
1. КЕМПЫ ДЛЯ УДАЛЕНЩИКОВ:
   - Краткосрочные поездки (неделя-две) в разные локации
   - Формат: работа + отдых + комьюнити
   - Популярные направления: Испания, Португалия, Франция, Норвегия, Польша
   - Сезонность: ЛЕТО (пик), зима (горнолыжные кемпы), праздники
   - Целевая аудитория: удаленные работники, фрилансеры, IT-специалисты, предприниматели

2. КОЛИВИНГИ НА МЕСЯЦ:
   - Долгосрочное совместное проживание и работа в одном месте
   - Более стабильный источник дохода
   - Меньше сезонности, но требует долгосрочного планирования

3. МЕРОПРИЯТИЯ:
   - События и активности для комьюнити
   - Могут быть как источником дохода, так и инструментом маркетинга

МОДЕЛЬ ПОСТУПЛЕНИЯ ДЕНЕГ:
- Выручка = продажа мест на кемпы + коливинги + мероприятия
- Расходы = аренда локаций + организация + маркетинг + команда + налоги
- Сезонность критична: летние месяцы обычно пиковые, зимние могут быть низкими (кроме горнолыжных направлений)
- География влияет на спрос: популярные направления (Испания, Португалия) vs менее популярные
- Формат влияет на цену: премиум локации (шато, виллы) vs стандартные

КРИТИЧЕСКИ ВАЖНО ДЛЯ АНАЛИЗА:
- НЕ просто пересказывай цифры - давай бизнес-инсайты
- Связывай финансовые показатели с бизнес-моделью (например: "низкая выручка в феврале может быть связана с отсутствием зимних кемпов")
- Давай конкретные рекомендации по форматам (кемпы/коливинги/мероприятия), сезонности, локациям
- Используй данные о лучших/худших месяцах для рекомендаций по планированию кемпов
- Учитывай расходы на аренду локаций и маркетинг при анализе прибыльности
- Каждая рекомендация должна быть применима к бизнесу Comoon, а не абстрактной`
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.8, // Higher temperature for more creative and personalized insights
          max_tokens: 4000, // Increased to ensure all fields including vision, scaling, and diversification are generated
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 seconds timeout for longer responses
        }
      );

      const content = response.data.choices[0].message.content;
      
      // Log raw response for debugging
      logger.info('OpenAI raw response received', {
        contentLength: content.length,
        contentPreview: content.substring(0, 500),
        hasUSD: content.includes('USD') || content.includes('долларов') || content.includes('$'),
        hasVision: content.includes('"vision"') || content.includes('vision'),
        hasScaling: content.includes('"scalingOpportunities"') || content.includes('scalingOpportunities'),
        hasDiversification: content.includes('"diversificationIdeas"') || content.includes('diversificationIdeas')
      });
      
      const result = JSON.parse(content);
      
      // Log parsed result for debugging
      logger.info('OpenAI response parsed', {
        hasSummary: !!result.summary,
        hasVision: !!result.vision,
        visionLength: result.vision?.length || 0,
        visionPreview: result.vision ? result.vision.substring(0, 100) : 'MISSING',
        scalingOpportunitiesCount: result.scalingOpportunities?.length || 0,
        diversificationIdeasCount: result.diversificationIdeas?.length || 0,
        allKeys: Object.keys(result),
        summaryHasUSD: result.summary?.includes('USD') || result.summary?.includes('долларов') || false
      });

      // Fix currency issues - replace USD/dollars with PLN in ALL text fields
      const fixCurrency = (text) => {
        if (!text || typeof text !== 'string') return text;
        let fixed = text;
        
        // More aggressive pattern matching - handle all number formats
        // Pattern: number (with or without commas, with or without decimals) followed by USD/dollars
        // Examples: "1,238,765.31 USD", "1234.56 USD", "1,000 USD"
        fixed = fixed.replace(/([\d,]+\.?\d*)\s*USD/gi, '$1 PLN');
        
        // Replace $123,456.78 -> 123,456.78 PLN
        fixed = fixed.replace(/\$([\d,]+\.?\d*)/g, '$1 PLN');
        
        // Replace "X долларов" -> "X злотых" (more aggressive)
        fixed = fixed.replace(/([\d,]+\.?\d*)\s*долларов/gi, '$1 злотых');
        fixed = fixed.replace(/([\d,]+\.?\d*)\s*долл\.?/gi, '$1 PLN');
        
        // Replace standalone USD (word boundary)
        fixed = fixed.replace(/\bUSD\b/gi, 'PLN');
        
        // Replace "долларов" -> "злотых" (standalone)
        fixed = fixed.replace(/\bдолларов\b/gi, 'злотых');
        fixed = fixed.replace(/\bдолл\.?\b/gi, 'PLN');
        
        // Replace "$" symbol -> "PLN"
        fixed = fixed.replace(/\$/g, 'PLN');
        
        // Additional patterns: "в размере X USD" -> "в размере X PLN"
        fixed = fixed.replace(/(в размере|составил|составила|составило|равен|равна|равно)\s+([\d,]+\.?\d*)\s*USD/gi, '$1 $2 PLN');
        
        return fixed;
      };

      // Fix currency in all text fields
      if (result.summary) result.summary = fixCurrency(result.summary);
      if (result.breakEvenStatus) result.breakEvenStatus = fixCurrency(result.breakEvenStatus);
      if (result.growthTrajectory) result.growthTrajectory = fixCurrency(result.growthTrajectory);
      if (result.seasonalPatterns) result.seasonalPatterns = fixCurrency(result.seasonalPatterns);
      if (result.vision) result.vision = fixCurrency(result.vision);
      if (Array.isArray(result.keyObservations)) {
        result.keyObservations = result.keyObservations.map(fixCurrency);
      }
      if (Array.isArray(result.recommendations)) {
        result.recommendations = result.recommendations.map(fixCurrency);
      }
      if (Array.isArray(result.scalingOpportunities)) {
        result.scalingOpportunities = result.scalingOpportunities.map(fixCurrency);
      }
      if (Array.isArray(result.diversificationIdeas)) {
        result.diversificationIdeas = result.diversificationIdeas.map(fixCurrency);
      }

      // Validate that critical fields are present
      if (!result.vision || result.vision.trim() === '') {
        logger.warn('AI did not generate vision field, prompting regeneration');
        result.vision = 'Видение будет сгенерировано при следующей регенерации.';
      }
      if (!Array.isArray(result.scalingOpportunities) || result.scalingOpportunities.length === 0) {
        logger.warn('AI did not generate scalingOpportunities, using placeholder');
        result.scalingOpportunities = ['Возможности масштабирования будут сгенерированы при следующей регенерации.'];
      }
      if (!Array.isArray(result.diversificationIdeas) || result.diversificationIdeas.length === 0) {
        logger.warn('AI did not generate diversificationIdeas, using placeholder');
        result.diversificationIdeas = ['Идеи диверсификации будут сгенерированы при следующей регенерации.'];
      }

      logger.info('OpenAI strategic insights generated', {
        hasSummary: !!result.summary,
        observationsCount: result.keyObservations?.length || 0,
        recommendationsCount: result.recommendations?.length || 0,
        hasVision: !!result.vision && result.vision.trim() !== '',
        visionPreview: result.vision ? result.vision.substring(0, 100) : 'MISSING',
        scalingOpportunitiesCount: result.scalingOpportunities?.length || 0,
        scalingOpportunitiesPreview: result.scalingOpportunities?.length > 0 ? result.scalingOpportunities[0].substring(0, 100) : 'MISSING',
        diversificationIdeasCount: result.diversificationIdeas?.length || 0,
        diversificationIdeasPreview: result.diversificationIdeas?.length > 0 ? result.diversificationIdeas[0].substring(0, 100) : 'MISSING',
        allFields: Object.keys(result)
      });

      return {
        generatedAt: new Date().toISOString(),
        generatedBy: 'ai',
        summary: result.summary || '',
        breakEvenStatus: result.breakEvenStatus || '',
        growthTrajectory: result.growthTrajectory || '',
        seasonalPatterns: result.seasonalPatterns || '',
        keyObservations: Array.isArray(result.keyObservations) ? result.keyObservations : [],
        recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
        vision: result.vision || '',
        scalingOpportunities: Array.isArray(result.scalingOpportunities) ? result.scalingOpportunities : [],
        diversificationIdeas: Array.isArray(result.diversificationIdeas) ? result.diversificationIdeas : []
      };
    } catch (error) {
      logger.error('OpenAI strategic insights generation error', {
        error: error.message,
        response: error.response?.data
      });
      throw error;
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

module.exports = OpenAIService;

