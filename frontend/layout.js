/**
 * Единая система макета и меню.
 * Один источник правды для навигации и роутов — подключается на всех страницах.
 * Меню рендерится в #layout-header; контент в #layout-main получает общий стиль (content-card, на всю ширину).
 * Добавить страницу: 1) в ROUTES.main добавить/расширить path; 2) в HTML — #layout-header, #layout-main, script layout.js.
 */
(function () {
  'use strict';

  // Роуты: главное меню и подменю (Бухгалтерия). path — массив путей или один путь для совпадения.
  var ROUTES = {
    main: [
      { id: 'reports', label: 'Отчеты', path: ['/vat-margin', '/vat-margin.html', '/vat-margin/product', '/vat-margin-product.html', '/stripe-event-report', '/stripe-event-report/'] },
      { id: 'cash', label: 'Cash Journal', path: ['/cash-journal', '/cash-journal.html'] },
      { id: 'pnl', label: 'PNL Отчет', path: ['/pnl-report', '/pnl-report.html'] },
      {
        id: 'accounting',
        label: 'Бухгалтерия',
        path: ['/accounting', '/accounting.html', '/expenses', '/expenses.html'],
        subRoutes: [
          { id: 'vat-flow', label: 'Расходы по потокам НДС', path: ['/accounting', '/accounting.html'] },
          { id: 'payments', label: 'Платежи', path: ['/expenses', '/expenses.html'] }
        ]
      },
      { id: 'marketing', label: 'Marketing', path: ['/analytics', '/analytics/', '/analytics/mql-report', '/analytics/mql-report.html'] },
      { id: 'settings', label: 'Настройки', path: ['/', ''] }
    ]
  };

  function normalizePath(pathname) {
    if (!pathname || pathname === '/') return '/';
    var p = pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    return p;
  }

  function pathMatches(routePath, current) {
    if (typeof routePath === 'string') return current === routePath || current === routePath + '.html';
    for (var i = 0; i < routePath.length; i++) {
      var r = routePath[i];
      if (r === current || (r && r.replace && r.replace(/\.html$/, '') === current.replace(/\.html$/, ''))) return true;
      if (current.indexOf(r) === 0) return true;
    }
    return false;
  }

  /**
   * Определяет текущий роут по pathname.
   * @returns {{ mainId: string, subId: string|null }}
   */
  function getCurrentRoute() {
    var pathname = typeof window !== 'undefined' && window.location ? window.location.pathname : '';
    var current = normalizePath(pathname);
    var mainId = '';
    var subId = null;
    for (var i = 0; i < ROUTES.main.length; i++) {
      var item = ROUTES.main[i];
      if (!pathMatches(item.path, current)) continue;
      mainId = item.id;
      if (item.subRoutes) {
        for (var j = 0; j < item.subRoutes.length; j++) {
          if (pathMatches(item.subRoutes[j].path, current)) {
            subId = item.subRoutes[j].id;
            break;
          }
        }
      }
      break;
    }
    if (!mainId && (current === '/' || current === '')) mainId = 'settings';
    return { mainId: mainId, subId: subId };
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderHeader() {
    var header = document.getElementById('layout-header');
    if (!header) return;
    var route = getCurrentRoute();
    var current = normalizePath(typeof window !== 'undefined' ? window.location.pathname : '');

    var navLinks = [];
    ROUTES.main.forEach(function (item) {
      var href = item.id === 'reports' ? '/vat-margin.html' : item.id === 'cash' ? '/cash-journal.html' : item.id === 'pnl' ? '/pnl-report.html' : item.id === 'accounting' ? '/accounting.html' : item.id === 'marketing' ? '/analytics/mql-report.html' : '/';
      var isActive = item.id === route.mainId;
      navLinks.push('<a href="' + escapeHtml(href) + '" class="nav-link' + (isActive ? ' active' : '') + '">' + escapeHtml(item.label) + '</a>');
    });

    header.innerHTML = '<div class="layout-header-inner">' +
      '<nav class="main-nav">' + navLinks.join('') + '</nav>' +
      '</div>';
    header.className = 'layout-header';

    var accountingItem = ROUTES.main.filter(function (r) { return r.id === 'accounting'; })[0];
    var subNavHtml = '';
    if (accountingItem && accountingItem.subRoutes && route.mainId === 'accounting') {
      var subLinks = accountingItem.subRoutes.map(function (sub) {
        var subHref = sub.id === 'vat-flow' ? '/accounting.html' : '/expenses.html';
        var subActive = sub.id === route.subId;
        return '<a href="' + escapeHtml(subHref) + '" class="accounting-subnav-link' + (subActive ? ' active' : '') + '">' + escapeHtml(sub.label) + '</a>';
      });
      subNavHtml = '<div class="accounting-subnav">' + subLinks.join('') + '</div>';
    }

    var subBar = document.getElementById('layout-subnav');
    if (!subBar) {
      subBar = document.createElement('div');
      subBar.id = 'layout-subnav';
      subBar.className = 'layout-subnav-bar';
      header.after(subBar);
    }
    subBar.innerHTML = subNavHtml ? '<div class="layout-subnav-inner">' + subNavHtml + '</div>' : '';
    subBar.style.display = subNavHtml ? '' : 'none';
  }

  /**
   * Обёртка контента: если есть #layout-main, добавляем классы для полной ширины и белой карточки.
   */
  function applyLayoutMain() {
    var main = document.getElementById('layout-main');
    if (!main) return;
    if (!main.classList.contains('content-card')) main.classList.add('content-card');
    if (!main.classList.contains('layout-main-fullwidth')) main.classList.add('layout-main-fullwidth');
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  function run() {
    renderHeader();
    applyLayoutMain();
  }

  window.Layout = {
    getCurrentRoute: getCurrentRoute,
    renderHeader: renderHeader,
    ROUTES: ROUTES
  };

  init();
})();
