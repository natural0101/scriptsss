// === DataLens: "Все звонки" -> Скачать все звонки в all_dialogs.txt (через пагинацию) ===
(function () {
  const TITLE = 'Все звонки';
  const BTN_CLASS = 'dl-download-all-calls-btn';

  // ---------- Поиск виджета / таблицы ----------

  function findTitleEl() {
    const xpath = `//*[normalize-space(text())='${TITLE}']`;
    return document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue || null;
  }

  function findWidgetParts(titleEl) {
    if (!titleEl) return {};
    const widget =
      titleEl.closest('.d1-widget, .dl-widget, .dashkit-grid-item, [data-qa="dashkit-grid-item"]') ||
      titleEl.closest('[class*="widget"]') ||
      titleEl.parentElement;

    const header =
      (widget && widget.querySelector('.dl-widget__header, .d1-widget__header, [class*="header"]')) ||
      titleEl.parentElement;

    return { widget, header };
  }

  function findTable(widget) {
    if (!widget) return null;
    return (
      widget.querySelector('.d1-widget__container_table table') ||
      widget.querySelector('.dl-widget__container_table table') ||
      widget.querySelector('table')
    );
  }

  // ---------- Ячейка -> текст (включая ID из tooltip) ----------

  function cellToText(td) {
    // 1) tooltip с node_domain_*
    const tooltipEl = td.querySelector('[data-tooltip-content]');
    if (tooltipEl) {
      const raw = tooltipEl.getAttribute('data-tooltip-content') || '';
      if (raw) {
        try {
          const trimmed = raw.trim();
          if (trimmed.startsWith('{')) {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed.content === 'string' && parsed.content.trim()) {
              return parsed.content.trim();
            }
          } else {
            return trimmed;
          }
        } catch (e) {
          console.warn('Failed to parse data-tooltip-content', e);
        }
      }
    }

    // 2) ссылки
    const a = td.querySelector('a');
    if (a) {
      const text = (a.textContent || '').trim();
      const href = (a.getAttribute('href') || '').trim();
      if (/^https?:\/\//i.test(text)) return text;
      return text || href || '';
    }

    // 3) обычный текст
    return (td.textContent || '').trim();
  }

  function collectCallsFromTable(table) {
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const lines = [];

    for (const tr of rows) {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (!tds.length) continue;
      const rowText = tds.map(cellToText).join('\t');
      lines.push(rowText);
    }

    return lines;
  }

  function getTableSignature(table) {
    const tbody = table.querySelector('tbody') || table;
    return (tbody.innerText || tbody.textContent || '').slice(0, 300);
  }

  function waitForTableChange(table, prevSig, timeoutMs = 8000) {
    return new Promise(resolve => {
      const tbody = table.querySelector('tbody') || table;
      if (!tbody) {
        resolve();
        return;
      }

      let done = false;
      const getSig = () =>
        ((tbody.innerText || tbody.textContent || '').slice(0, 300) || '');

      const observer = new MutationObserver(() => {
        const sig = getSig();
        if (!done && sig && sig !== prevSig) {
          done = true;
          clearTimeout(timer);
          observer.disconnect();
          resolve();
        }
      });

      observer.observe(tbody, { childList: true, subtree: true, characterData: true });

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        observer.disconnect();
        resolve();
      }, timeoutMs);
    });
  }

  // ---------- Поиск кнопки "следующая страница" ----------

  function isDisabled(btn) {
    if (!btn) return true;
    if (btn.disabled) return true;
    if (btn.getAttribute('aria-disabled') === 'true') return true;
    const cls = btn.className || '';
    if (/\bdisabled\b/.test(cls)) return true;
    return false;
  }

  function findNextPageButton(widget) {
    if (!widget) return null;

    // 1) ищем элемент с текстом "Строки:" внутри этого виджета
    const rangeLabel = Array.from(widget.querySelectorAll('div, span, p'))
      .find(el => (el.textContent || '').includes('Строки:'));

    if (rangeLabel) {
      // поднимаемся вверх, пока не найдём родителя с кнопками
      let pager = rangeLabel.parentElement;
      while (pager && pager !== widget && !pager.querySelector('button')) {
        pager = pager.parentElement;
      }

      if (pager) {
        const buttons = Array.from(pager.querySelectorAll('button'));
        if (buttons.length) {
          // в типичной верстке: [назад] [1] [2] [вперёд] — берем последний как "вперёд"
          const nextBtn = buttons[buttons.length - 1];
          if (nextBtn && !isDisabled(nextBtn)) return nextBtn;
        }
      }
    }

    // 2) фолбек — если вдруг верстка другая
    const fallback =
      widget.querySelector('button[aria-label*="След"]') ||
      widget.querySelector('button[aria-label*="Next"]');
    if (fallback && !isDisabled(fallback)) return fallback;

    return null;
  }

  // ---------- Сбор всех страниц ----------

  async function collectAllPages() {
    const allLines = [];
    let pageIndex = 0;

    while (true) {
      const titleEl = findTitleEl();
      if (!titleEl) throw new Error('Не найден заголовок "Все звонки".');

      const { widget } = findWidgetParts(titleEl);
      const table = findTable(widget);
      if (!table) throw new Error('Не найдена таблица внутри виджета.');

      const pageLines = collectCallsFromTable(table);
      if (!pageLines.length) break;

      allLines.push(...pageLines);

      const nextBtn = findNextPageButton(widget);
      if (!nextBtn || isDisabled(nextBtn)) {
        break; // больше страниц нет
      }

      const prevSig = getTableSignature(table);
      nextBtn.click();
      await waitForTableChange(table, prevSig);

      pageIndex++;
      if (pageIndex > 2000) {
        console.warn('Стоп по количеству страниц');
        break;
      }
    }

    return allLines.join('\n');
  }

  // ---------- Скачивание файла ----------

  function downloadTextFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadCalls() {
    const btn = document.querySelector('.' + BTN_CLASS);
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Собираю...';
      }

      const allText = await collectAllPages();
      if (!allText.trim()) {
        throw new Error('Не удалось собрать строки (возможно, таблица пустая).');
      }

      downloadTextFile(allText, 'all_dialogs.txt');
    } catch (e) {
      console.error(e);
      alert('Ошибка: ' + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Скачать все звонки';
      }
    }
  }

  // ---------- Кнопка в виджете ----------

  function injectButton() {
    const titleEl = findTitleEl();
    if (!titleEl) return;

    const { widget, header } = findWidgetParts(titleEl);
    if (!widget || !header) return;

    if (header.querySelector('.' + BTN_CLASS)) return;

    const btn = document.createElement('button');
    btn.className = BTN_CLASS;
    btn.textContent = 'Скачать все звонки';

    Object.assign(btn.style, {
      marginLeft: '8px',
      padding: '6px 10px',
      fontSize: '12px',
      borderRadius: '8px',
      border: '1px solid #d1d5db',
      background: '#ffffff',
      cursor: 'pointer'
    });

    btn.addEventListener('click', downloadCalls);

    const rightHost =
      header.querySelector('[class*="actions"], [class*="toolbar"], [class*="controls"]') ||
      header;
    rightHost.appendChild(btn);
  }

  // ---------- Инициализация ----------

  function init() {
    injectButton();
    const mo = new MutationObserver(() => injectButton());
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
