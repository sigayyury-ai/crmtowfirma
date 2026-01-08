/**
 * Конфигурация пайплайнов Pipedrive и их статусов
 * 
 * Каждый пайплайн имеет свои ID статусов для:
 * - FIRST_PAYMENT - Первый платеж
 * - SECOND_PAYMENT - Второй платеж  
 * - CAMP_WAITER - Все оплачено (Camp Waiter / COliving Waiter)
 */

const PIPELINE_CONFIGS = {
  // Пайплайн Camps
  CAMPS: {
    pipelineId: null, // Будет определено из deal.pipeline_id
    pipelineName: 'Camps',
    stageIds: {
      FIRST_PAYMENT: 18,
      SECOND_PAYMENT: 32,
      CAMP_WAITER: 27
    }
  },
  
  // Пайплайн COliving
  COLIVING: {
    pipelineId: 5, // Определено из сделок 1968 и 1735
    pipelineName: 'COliving',
    stageIds: {
      FIRST_PAYMENT: 37, // Определено из сделки 1968 (stageName: "First payment")
      SECOND_PAYMENT: 38, // Определено из сделок 1198, 1389 в пайплайне 5
      CAMP_WAITER: 39 // Определено из сделки 1735 (stageName: "Waiter")
    }
  }
};

/**
 * Определяет конфигурацию пайплайна по pipeline_id или pipeline name
 * @param {number|string} pipelineId - ID пайплайна из Pipedrive
 * @param {string} pipelineName - Название пайплайна (опционально)
 * @returns {object|null} Конфигурация пайплайна или null если не найден
 */
function getPipelineConfig(pipelineId, pipelineName = null) {
  // Если передан pipeline_id, ищем по нему
  if (pipelineId) {
    const config = Object.values(PIPELINE_CONFIGS).find(
      cfg => cfg.pipelineId === pipelineId || cfg.pipelineId === String(pipelineId)
    );
    if (config) {
      return config;
    }
  }
  
  // Если передан pipeline name, ищем по нему
  if (pipelineName) {
    const normalizedName = pipelineName.toLowerCase().trim();
    const config = Object.values(PIPELINE_CONFIGS).find(
      cfg => cfg.pipelineName.toLowerCase() === normalizedName
    );
    if (config) {
      return config;
    }
  }
  
  // По умолчанию возвращаем Camps (для обратной совместимости)
  return PIPELINE_CONFIGS.CAMPS;
}

/**
 * Получает ID статуса для пайплайна
 * @param {number|string} pipelineId - ID пайплайна
 * @param {string} stageType - Тип статуса: 'FIRST_PAYMENT', 'SECOND_PAYMENT', 'CAMP_WAITER'
 * @param {string} pipelineName - Название пайплайна (опционально)
 * @returns {number|null} ID статуса или null если не найден
 */
function getStageIdForPipeline(pipelineId, stageType, pipelineName = null) {
  const config = getPipelineConfig(pipelineId, pipelineName);
  if (!config || !config.stageIds) {
    return null;
  }
  
  return config.stageIds[stageType] || null;
}

/**
 * Получает все поддерживаемые ID статусов для пайплайна
 * @param {number|string} pipelineId - ID пайплайна
 * @param {string} pipelineName - Название пайплайна (опционально)
 * @returns {Set<number>} Set с ID статусов
 */
function getSupportedStageIdsForPipeline(pipelineId, pipelineName = null) {
  const config = getPipelineConfig(pipelineId, pipelineName);
  if (!config || !config.stageIds) {
    // По умолчанию возвращаем Camps
    return new Set(Object.values(PIPELINE_CONFIGS.CAMPS.stageIds));
  }
  
  return new Set(Object.values(config.stageIds).filter(id => id !== null));
}

module.exports = {
  PIPELINE_CONFIGS,
  getPipelineConfig,
  getStageIdForPipeline,
  getSupportedStageIdsForPipeline
};

