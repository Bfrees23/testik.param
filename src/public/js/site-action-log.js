/**
 * Клиентский журнал действий → POST /api/site-action-log.php → site-actions-YYYY-MM-DD.txt
 */
(function () {
    'use strict';

    const ENDPOINT = '/api/site-action-log.php';
    const queue = [];
    let flushTimer = null;

    function currentPage() {
        try {
            return String(location.pathname + location.search);
        } catch (_e) {
            return '';
        }
    }

    function currentOrderNumber() {
        try {
            const events = window.TM07_BENCH_EVENTS;
            if (events && typeof events.getActiveOrderNumber === 'function') {
                return events.getActiveOrderNumber() || null;
            }
        } catch (_e) {}
        return null;
    }

    function scheduleFlush() {
        if (flushTimer) {
            return;
        }
        flushTimer = setTimeout(function () {
            flushTimer = null;
            flushQueue();
        }, 400);
    }

    function flushQueue() {
        while (queue.length) {
            const item = queue.shift();
            sendOne(item, false);
        }
    }

    function sendOne(item, useBeacon) {
        const payload = JSON.stringify(item);
        if (useBeacon && navigator.sendBeacon) {
            try {
                const blob = new Blob([payload], { type: 'application/json' });
                if (navigator.sendBeacon(ENDPOINT, blob)) {
                    return;
                }
            } catch (_e) {}
        }
        try {
            void fetch(ENDPOINT, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true,
            });
        } catch (_e) {}
    }

    /**
     * @param {string} category
     * @param {string} action
     * @param {object|null} [detail]
     */
    function logAction(category, action, detail) {
        if (!action) {
            return;
        }
        const item = {
            category: category || 'ui',
            action: action,
            page: currentPage(),
            detail: detail || null,
        };
        const order = currentOrderNumber();
        if (order) {
            item.orderNumber = order;
        }
        queue.push(item);
        scheduleFlush();
    }

    function bindUiEvents() {
        document.addEventListener('click', function (e) {
            const btn = e.target.closest('button, a.btn, [data-log-action]');
            if (!btn) {
                return;
            }
            const explicit = btn.getAttribute('data-log-action');
            if (explicit) {
                logAction('ui', explicit, { id: btn.id || null, text: (btn.textContent || '').trim().slice(0, 80) });
                return;
            }
            if (btn.tagName === 'BUTTON' || btn.classList.contains('btn')) {
                const id = btn.id || '';
                const text = (btn.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
                if (id || text) {
                    logAction('ui', 'click:' + (id || text), { id: id || null, text: text || null });
                }
            }
        });

        document.querySelectorAll('.bench-nav-link').forEach(function (a) {
            a.addEventListener('click', function () {
                logAction('nav', 'goto:' + (a.getAttribute('href') || ''), {
                    label: (a.textContent || '').trim(),
                });
            });
        });
    }

    function bindCustomEvents() {
        const map = [
            ['tm07-operator-changed', 'operator_changed'],
            ['tm07-order-session-changed', 'order_session_changed'],
            ['tm07-order-applied', 'order_applied'],
            ['tm07-qr-scanned', 'qr_scanned'],
            ['tm07-meter-serial-applied', 'meter_serial_applied'],
            ['tm07-parametrization-done', 'parametrization_done'],
        ];
        map.forEach(function (pair) {
            window.addEventListener(pair[0], function (ev) {
                const d = ev && ev.detail ? ev.detail : null;
                logAction('bench', pair[1], d && typeof d === 'object' ? d : null);
            });
        });
    }

    function init() {
        logAction('page', 'view', {
            title: document.title || '',
            referrer: document.referrer ? String(document.referrer).slice(0, 200) : null,
        });
        bindUiEvents();
        bindCustomEvents();
        window.addEventListener('pagehide', function () {
            flushQueue();
            if (queue.length) {
                queue.forEach(function (item) {
                    sendOne(item, true);
                });
                queue.length = 0;
            }
        });
    }

    window.TM07_SITE_LOG = {
        log: logAction,
        logAction: logAction,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
