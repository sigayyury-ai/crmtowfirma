// API_BASE уже объявлен в vat-margin-script.js, используем его
// Если не определен, определяем локально
const FACEBOOK_ADS_API_BASE = (typeof API_BASE !== 'undefined') ? API_BASE : '/api';

let facebookAdsState = {
  initialized: false,
  activeTab: 'import',
  mappings: [],
  unmappedCampaigns: [],
  importBatches: []
};

function initFacebookAdsTab() {
  console.log('Facebook Ads: Initializing tab', { alreadyInitialized: facebookAdsState.initialized });
  
  // Always bind events (in case tab was closed and reopened)
  bindFacebookAdsEvents();

  if (facebookAdsState.initialized) {
    console.log('Facebook Ads: Tab already initialized, reloading data');
    // Reload data even if already initialized
    loadFacebookAdsData();
    return;
  }
  
  facebookAdsState.initialized = true;

  // Load initial data
  loadFacebookAdsData();
}


function bindFacebookAdsEvents() {
  // CSV import
  const csvInput = document.getElementById('facebook-ads-csv-input');
  if (csvInput) {
    console.log('Facebook Ads: Binding CSV input event');
    csvInput.addEventListener('change', handleCsvImport);
  } else {
    console.warn('Facebook Ads: CSV input element not found');
  }

  // Refresh button
  const refreshBtn = document.getElementById('facebook-ads-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', loadFacebookAdsData);
  }

  // Create mapping button
  const createMappingBtn = document.getElementById('facebook-ads-create-mapping');
  if (createMappingBtn) {
    createMappingBtn.addEventListener('click', () => showCreateMappingModal());
  }

  // Mapping modal
  const mappingModal = document.getElementById('facebook-ads-mapping-modal');
  const mappingClose = document.getElementById('facebook-ads-mapping-close');
  const mappingCancel = document.getElementById('facebook-ads-mapping-cancel');
  const mappingSave = document.getElementById('facebook-ads-mapping-save');
  const productSearch = document.getElementById('mapping-product-search');

  if (mappingClose) {
    mappingClose.addEventListener('click', closeMappingModal);
  }
  if (mappingCancel) {
    mappingCancel.addEventListener('click', closeMappingModal);
  }
  if (mappingSave) {
    mappingSave.addEventListener('click', saveMapping);
  }
  if (mappingModal) {
    mappingModal.addEventListener('click', (e) => {
      if (e.target === mappingModal) {
        closeMappingModal();
      }
    });
  }

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mappingModal && mappingModal.style.display === 'block') {
      closeMappingModal();
    }
  });

  // Product search with debounce
  if (productSearch) {
    let searchTimeout;
    productSearch.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();
      const suggestionsDiv = document.getElementById('mapping-product-suggestions');
      
      if (query.length < 2) {
        suggestionsDiv.style.display = 'none';
        return;
      }

      searchTimeout = setTimeout(() => {
        filterProducts(query);
      }, 300);
    });
  }

  // Campaign name input - load suggestions when user types
  const campaignNameInput = document.getElementById('mapping-campaign-name');
  if (campaignNameInput) {
    let campaignSearchTimeout;
    campaignNameInput.addEventListener('input', async (e) => {
      clearTimeout(campaignSearchTimeout);
      const campaignName = e.target.value.trim();
      
      if (campaignName.length < 3) {
        const suggestionsDiv = document.getElementById('mapping-suggestions');
        if (suggestionsDiv) {
          suggestionsDiv.style.display = 'none';
        }
        return;
      }

      campaignSearchTimeout = setTimeout(async () => {
        await loadMappingSuggestions(campaignName);
      }, 500);
    });
  }
}

function filterProducts(query) {
  const suggestionsDiv = document.getElementById('mapping-product-suggestions');
  if (!suggestionsDiv) return;

  const queryLower = query.toLowerCase();
  
  const filtered = mappingModalState.products.filter(p => 
    p.name.toLowerCase().includes(queryLower) ||
    (p.normalized_name && p.normalized_name.toLowerCase().includes(queryLower))
  );

  if (filtered.length === 0) {
    suggestionsDiv.style.display = 'none';
    return;
  }

  suggestionsDiv.innerHTML = '';
  filtered.slice(0, 10).forEach(product => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.textContent = product.name;
    item.onclick = () => selectProductFromSearch(product.id, product.name);
    suggestionsDiv.appendChild(item);
  });

  suggestionsDiv.style.display = 'block';
}

// Close suggestions when clicking outside
document.addEventListener('click', (e) => {
  const suggestionsDiv = document.getElementById('mapping-product-suggestions');
  const productSearch = document.getElementById('mapping-product-search');
  
  if (suggestionsDiv && productSearch && 
      !suggestionsDiv.contains(e.target) && 
      e.target !== productSearch) {
    suggestionsDiv.style.display = 'none';
  }
});

function selectProductFromSearch(productId, productName) {
  const productSelect = document.getElementById('mapping-product-select');
  const productSearch = document.getElementById('mapping-product-search');
  const suggestionsDiv = document.getElementById('mapping-product-suggestions');

  productSelect.value = productId;
  productSearch.value = productName;
  suggestionsDiv.style.display = 'none';
}

window.selectProductFromSearch = selectProductFromSearch;

async function loadFacebookAdsData() {
  // Load all data at once (no tabs)
  console.log('Facebook Ads: Loading all data');
  await Promise.all([
    loadImportHistory(),
    loadMappedCampaigns(),
    loadUnmappedCampaigns()
  ]);
}

async function loadImportHistory() {
  const container = document.getElementById('facebook-ads-import-history');
  if (!container) return;

  container.innerHTML = '<div class="loading-indicator">Загрузка истории импортов...</div>';

  try {
    const response = await fetch(`${FACEBOOK_ADS_API_BASE}/facebook-ads/import-batches?limit=50`);
    const result = await response.json();

    if (!result.success) {
      container.innerHTML = `<div class="error">Ошибка: ${result.error}</div>`;
      return;
    }

    const batches = result.data || [];
    if (batches.length === 0) {
      container.innerHTML = '<div class="placeholder">Нет импортированных файлов</div>';
      return;
    }

    renderImportHistory(batches);
  } catch (error) {
    container.innerHTML = `<div class="error">Ошибка загрузки: ${error.message}</div>`;
  }
}

function renderImportHistory(batches) {
  const container = document.getElementById('facebook-ads-import-history');
  if (!container) return;

  const table = document.createElement('table');
  table.className = 'data-table';

  // Header
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Дата</th>
      <th>Файл</th>
      <th>Всего строк</th>
      <th>Обработано</th>
      <th>Размечено</th>
      <th>Неразмечено</th>
      <th>Статус</th>
    </tr>
  `;
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  batches.forEach((batch) => {
    const row = document.createElement('tr');
    const date = new Date(batch.created_at);
    const status = batch.processed_rows === batch.total_rows ? '✅' : '⚠️';
    
    row.innerHTML = `
      <td>${date.toLocaleString('ru-RU')}</td>
      <td>${escapeHtml(batch.file_name)}</td>
      <td>${batch.total_rows}</td>
      <td>${batch.processed_rows}</td>
      <td>${batch.mapped_rows}</td>
      <td>${batch.unmapped_rows}</td>
      <td>${status}</td>
    `;
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  container.innerHTML = '';
  container.appendChild(table);
}

async function loadMappedCampaigns() {
  const container = document.getElementById('facebook-ads-mapped-table');
  if (!container) return;

  container.innerHTML = '<div class="loading-indicator">Загрузка размеченных кампаний...</div>';

  try {
    console.log('Facebook Ads: Loading mapped campaigns');
    // Add cache buster to ensure fresh data
    const cacheBuster = `?_t=${Date.now()}`;
    const response = await fetch(`${FACEBOOK_ADS_API_BASE}/facebook-ads/mappings${cacheBuster}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    console.log('Facebook Ads: Mapped campaigns response', {
      success: result.success,
      count: result.data?.length,
      error: result.error,
      data: result.data
    });

    if (!result.success) {
      container.innerHTML = `<div class="error">Ошибка: ${result.error}</div>`;
      return;
    }

    const mappings = result.data || [];
    console.log('Facebook Ads: Mapped campaigns loaded', {
      count: mappings.length,
      sample: mappings.slice(0, 3)
    });

    if (mappings.length === 0) {
      container.innerHTML = '<div class="placeholder">Нет размеченных кампаний. Создайте маппинг для кампаний из раздела "Неразмеченные".</div>';
      return;
    }

    renderMappedCampaigns(mappings);
  } catch (error) {
    console.error('Facebook Ads: Error loading mapped campaigns', error);
    container.innerHTML = `<div class="error">Ошибка загрузки: ${error.message}</div>`;
  }
}

function renderMappedCampaigns(mappings) {
  const container = document.getElementById('facebook-ads-mapped-table');
  if (!container) return;

  console.log('Facebook Ads: Rendering mapped campaigns', {
    count: mappings.length,
    mappings: mappings.map(m => ({
      id: m.id,
      campaign_name: m.campaign_name,
      product_id: m.product_id,
      product: m.product
    }))
  });

  const table = document.createElement('table');
  table.className = 'data-table';

  // Header
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Кампания</th>
      <th>Продукт</th>
      <th>Создано</th>
      <th>Действия</th>
    </tr>
  `;
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  
  if (mappings.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="4" class="text-center">Нет размеченных кампаний</td>';
    tbody.appendChild(row);
  } else {
    mappings.forEach((mapping) => {
      const row = document.createElement('tr');
      const product = mapping.product || {};
      const date = mapping.created_at ? new Date(mapping.created_at) : new Date();
      
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-sm btn-secondary';
      editBtn.textContent = '✏️';
      editBtn.onclick = () => editMapping(mapping.id);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-sm btn-danger';
      deleteBtn.textContent = '🗑️';
      deleteBtn.onclick = () => deleteMapping(mapping.id);

      row.innerHTML = `
        <td>${escapeHtml(mapping.campaign_name || 'N/A')}</td>
        <td>${escapeHtml(product.name || 'N/A')}</td>
        <td>${date.toLocaleDateString('ru-RU')}</td>
        <td></td>
      `;
      
      const actionsCell = row.querySelector('td:last-child');
      actionsCell.appendChild(editBtn);
      actionsCell.appendChild(deleteBtn);
      tbody.appendChild(row);
    });
  }
  
  table.appendChild(tbody);

  container.innerHTML = '';
  container.appendChild(table);
}

async function loadUnmappedCampaigns() {
  const container = document.getElementById('facebook-ads-unmapped-table');
  if (!container) return;

  container.innerHTML = '<div class="loading-indicator">Загрузка неразмеченных кампаний...</div>';

  try {
    console.log('Facebook Ads: Loading unmapped campaigns');
    const response = await fetch(`${FACEBOOK_ADS_API_BASE}/facebook-ads/mappings/unmapped`);
    const result = await response.json();

    console.log('Facebook Ads: Unmapped campaigns response', {
      success: result.success,
      count: result.data?.length,
      error: result.error
    });

    if (!result.success) {
      container.innerHTML = `<div class="error">Ошибка: ${result.error}</div>`;
      return;
    }

    const campaigns = result.data || [];
    console.log('Facebook Ads: Unmapped campaigns loaded', {
      count: campaigns.length,
      sample: campaigns.slice(0, 3)
    });

    if (campaigns.length === 0) {
      container.innerHTML = '<div class="placeholder">Все кампании размечены или нет импортированных данных</div>';
      return;
    }

    renderUnmappedCampaigns(campaigns);
  } catch (error) {
    console.error('Facebook Ads: Error loading unmapped campaigns', error);
    container.innerHTML = `<div class="error">Ошибка загрузки: ${error.message}</div>`;
  }
}

function renderUnmappedCampaigns(campaigns) {
  const container = document.getElementById('facebook-ads-unmapped-table');
  if (!container) return;

  const table = document.createElement('table');
  table.className = 'data-table';

  // Header
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Кампания</th>
      <th>Сумма (PLN)</th>
      <th>Действия</th>
    </tr>
  `;
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  campaigns.forEach((campaign) => {
    const row = document.createElement('tr');
    
    row.innerHTML = `
      <td>${escapeHtml(campaign.campaign_name)}</td>
      <td>${formatCurrency(campaign.total_amount_pln)}</td>
      <td></td>
    `;
    
    const createBtn = document.createElement('button');
    createBtn.className = 'btn btn-sm btn-primary';
    createBtn.textContent = '➕ Создать маппинг';
    createBtn.onclick = () => createMappingForCampaign(campaign.campaign_name);
    
    const actionsCell = row.querySelector('td:last-child');
    actionsCell.appendChild(createBtn);
    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  container.innerHTML = '';
  container.appendChild(table);
}

async function loadStatistics() {
  const container = document.getElementById('facebook-ads-statistics-content');
  if (!container) return;

  container.innerHTML = '<div class="loading-indicator">Загрузка статистики...</div>';

  // TODO: Implement statistics loading
  container.innerHTML = '<div class="placeholder">Статистика будет доступна после импорта данных</div>';
}

async function handleCsvImport(event) {
  const file = event.target.files[0];
  if (!file) {
    console.warn('Facebook Ads: No file selected');
    return;
  }

  console.log('Facebook Ads: Starting CSV import', { fileName: file.name, fileSize: file.size });

  const formData = new FormData();
  formData.append('file', file);

  // Show loading indicator
  const importHistoryContainer = document.getElementById('facebook-ads-import-history');
  if (importHistoryContainer) {
    importHistoryContainer.innerHTML = '<div class="loading-indicator">Импорт файла...</div>';
  }

  try {
    const response = await fetch(`${FACEBOOK_ADS_API_BASE}/facebook-ads/import`, {
      method: 'POST',
      body: formData
    });

    console.log('Facebook Ads: Import response status', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Facebook Ads: Import failed', { status: response.status, error: errorText });
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log('Facebook Ads: Import result', result);

    if (!result.success) {
      alert(`Ошибка импорта: ${result.error}`);
      if (importHistoryContainer) {
        importHistoryContainer.innerHTML = `<div class="error">Ошибка: ${result.error}</div>`;
      }
      return;
    }

    alert(`Импорт завершен!\nОбработано: ${result.data.processedRows}\nРазмечено: ${result.data.mappedRows}\nНеразмечено: ${result.data.unmappedRows}`);
    
    // Reload data
    await loadFacebookAdsData();
  } catch (error) {
    console.error('Facebook Ads: Import error', error);
    alert(`Ошибка импорта: ${error.message}`);
    if (importHistoryContainer) {
      importHistoryContainer.innerHTML = `<div class="error">Ошибка: ${error.message}</div>`;
    }
  } finally {
    // Reset input
    event.target.value = '';
  }
}

let mappingModalState = {
  campaignName: null,
  mappingId: null, // null for create, ID for edit
  products: [],
  suggestions: []
};

async function showCreateMappingModal(campaignName = null) {
  mappingModalState.campaignName = campaignName;
  mappingModalState.mappingId = null;

  const modal = document.getElementById('facebook-ads-mapping-modal');
  const title = document.getElementById('facebook-ads-mapping-title');
  const campaignInput = document.getElementById('mapping-campaign-name');
  const productSelect = document.getElementById('mapping-product-select');
  const productSearch = document.getElementById('mapping-product-search');
  const suggestionsDiv = document.getElementById('mapping-suggestions');
  const suggestionsList = document.getElementById('mapping-suggestions-list');

  // Set title and campaign name
  title.textContent = campaignName ? 'Создать маппинг кампании' : 'Создать маппинг';
  campaignInput.value = campaignName || '';
  campaignInput.disabled = false; // Always editable - user can enter campaign name manually

  // Clear previous state
  productSelect.innerHTML = '<option value="">Загрузка продуктов...</option>';
  productSearch.value = '';
  suggestionsDiv.style.display = 'none';
  suggestionsList.innerHTML = '';

  // Show modal
  modal.style.display = 'block';

  // Load products
  await loadProductsForMapping();

  // Load suggestions if campaign name provided
  if (campaignName) {
    await loadMappingSuggestions(campaignName);
  }
}

async function editMapping(mappingId) {
  try {
    // Load mapping details
    const response = await fetch(`${FACEBOOK_ADS_API_BASE}/facebook-ads/mappings`);
    const result = await response.json();

    if (!result.success) {
      alert(`Ошибка: ${result.error}`);
      return;
    }

    const mapping = result.data.find(m => m.id === mappingId);
    if (!mapping) {
      alert('Маппинг не найден');
      return;
    }

    mappingModalState.mappingId = mappingId;
    mappingModalState.campaignName = mapping.campaign_name;

    const modal = document.getElementById('facebook-ads-mapping-modal');
    const title = document.getElementById('facebook-ads-mapping-title');
    const campaignInput = document.getElementById('mapping-campaign-name');
    const productSelect = document.getElementById('mapping-product-select');

    title.textContent = 'Редактировать маппинг';
    campaignInput.value = mapping.campaign_name;
    campaignInput.disabled = true;

    // Show modal
    modal.style.display = 'block';

    // Load products
    await loadProductsForMapping();

    // Select current product
    if (mapping.product_id) {
      productSelect.value = mapping.product_id;
    }
  } catch (error) {
    alert(`Ошибка: ${error.message}`);
  }
}

async function deleteMapping(mappingId) {
  if (!confirm('Удалить маппинг?')) return;

  try {
    const response = await fetch(`${FACEBOOK_ADS_API_BASE}/facebook-ads/mappings/${mappingId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (!result.success) {
      alert(`Ошибка: ${result.error}`);
      return;
    }

    loadMappedCampaigns();
  } catch (error) {
    alert(`Ошибка: ${error.message}`);
  }
}

function createMappingForCampaign(campaignName) {
  showCreateMappingModal(campaignName);
}

async function loadProductsForMapping() {
  const productSelect = document.getElementById('mapping-product-select');
  
  try {
    const response = await fetch(`${FACEBOOK_ADS_API_BASE}/products/in-progress`);
    const result = await response.json();

    console.log('Facebook Ads: Products loaded', { count: result.data?.length });

    if (!result.success) {
      productSelect.innerHTML = '<option value="">Ошибка загрузки продуктов</option>';
      return;
    }

    const products = result.data || [];
    mappingModalState.products = products;

    productSelect.innerHTML = '<option value="">Выберите продукт...</option>';
    products.forEach(product => {
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = product.name;
      productSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading products:', error);
    productSelect.innerHTML = '<option value="">Ошибка загрузки продуктов</option>';
  }
}

async function loadMappingSuggestions(campaignName) {
  const suggestionsDiv = document.getElementById('mapping-suggestions');
  const suggestionsList = document.getElementById('mapping-suggestions-list');

  try {
    const encodedName = encodeURIComponent(campaignName);
    const response = await fetch(`${FACEBOOK_ADS_API_BASE}/facebook-ads/mappings/suggestions/${encodedName}`);
    const result = await response.json();

    if (!result.success || !result.data || result.data.length === 0) {
      suggestionsDiv.style.display = 'none';
      return;
    }

    mappingModalState.suggestions = result.data;

    suggestionsList.innerHTML = '';
    result.data.forEach((suggestion) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.style.cssText = 'padding: 10px; margin: 5px 0; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;';
      item.onclick = () => selectSuggestion(suggestion.productId);
      
      const strong = document.createElement('strong');
      strong.textContent = suggestion.productName;
      item.appendChild(strong);
      
      const score = document.createElement('span');
      score.style.cssText = 'float: right; color: #666;';
      score.textContent = `Совпадение: ${suggestion.score}%`;
      item.appendChild(score);
      
      suggestionsList.appendChild(item);
    });

    suggestionsDiv.style.display = 'block';
  } catch (error) {
    console.error('Error loading suggestions:', error);
    suggestionsDiv.style.display = 'none';
  }
}

function selectSuggestion(productId) {
  const productSelect = document.getElementById('mapping-product-select');
  productSelect.value = productId;
}

async function saveMapping() {
  const campaignNameInput = document.getElementById('mapping-campaign-name');
  const productSelect = document.getElementById('mapping-product-select');
  
  const campaignName = campaignNameInput ? campaignNameInput.value.trim() : '';
  const productId = productSelect ? productSelect.value : '';

  if (!campaignName) {
    alert('Название кампании обязательно. Введите название кампании из CSV файла.');
    if (campaignNameInput) {
      campaignNameInput.focus();
    }
    return;
  }

  if (!productId) {
    alert('Выберите продукт из списка');
    if (productSelect) {
      productSelect.focus();
    }
    return;
  }

  try {
    const url = mappingModalState.mappingId
      ? `${FACEBOOK_ADS_API_BASE}/facebook-ads/mappings/${mappingModalState.mappingId}`
      : `${FACEBOOK_ADS_API_BASE}/facebook-ads/mappings`;

    const method = mappingModalState.mappingId ? 'PUT' : 'POST';
    const body = mappingModalState.mappingId
      ? { productId: Number(productId) }
      : { campaignName: campaignName.trim(), productId: Number(productId) };

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const result = await response.json();

    console.log('Facebook Ads: Save mapping result', result);

    if (!result.success) {
      alert(`Ошибка: ${result.error}`);
      return;
    }

    // Close modal
    closeMappingModal();

    // Reload data with delay to ensure DB is updated
    setTimeout(async () => {
      console.log('Facebook Ads: Reloading data after mapping save');
      await Promise.all([
        loadMappedCampaigns(),
        loadUnmappedCampaigns()
      ]);
      console.log('Facebook Ads: Data reloaded');
    }, 500);

    alert('Маппинг успешно сохранен!');
  } catch (error) {
    console.error('Facebook Ads: Error saving mapping', error);
    alert(`Ошибка: ${error.message}`);
  }
}

function closeMappingModal() {
  const modal = document.getElementById('facebook-ads-mapping-modal');
  if (modal) {
    modal.style.display = 'none';
  }
  
  // Reset state
  mappingModalState = {
    campaignName: null,
    mappingId: null,
    products: [],
    suggestions: []
  };

  // Clear form
  const campaignInput = document.getElementById('mapping-campaign-name');
  const productSelect = document.getElementById('mapping-product-select');
  const productSearch = document.getElementById('mapping-product-search');
  const suggestionsDiv = document.getElementById('mapping-product-suggestions');
  
  if (campaignInput) campaignInput.value = '';
  if (productSelect) productSelect.value = '';
  if (productSearch) productSearch.value = '';
  if (suggestionsDiv) suggestionsDiv.style.display = 'none';
}

// Make functions global for onclick handlers
window.selectSuggestion = selectSuggestion;
window.editMapping = editMapping;
window.deleteMapping = deleteMapping;
window.createMappingForCampaign = createMappingForCampaign;

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'PLN',
    minimumFractionDigits: 2
  }).format(amount || 0);
}

