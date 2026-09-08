/**
 * Главная: авторизация оператора и список сессий параметризации.
 */
(function () {
    'use strict';

    let isAdmin = false;
    let homeOrdersWatcher = null;
    let sessionsPollTimer = null;
    const SESSIONS_POLL_MS = 12000;

    function $(id) {
        return document.getElementById(id);
    }

    function wbUrl(url) {
        const ev = window.TM07_BENCH_EVENTS;
        if (ev && typeof ev.withWorkstationQuery === 'function') {
            return ev.withWorkstationQuery(url || '/tm07-workbench.html');
        }
        return url || '/tm07-workbench.html';
    }

    function patchHomeWorkbenchLinks() {
        document.querySelectorAll('a[href*="tm07-workbench.html"]').forEach(function (a) {
            const href = a.getAttribute('href');
            if (!href) {
                return;
            }
            a.setAttribute('href', wbUrl(href));
        });
    }

    function stopHomeOrdersWatcher() {
        if (homeOrdersWatcher && typeof homeOrdersWatcher.stop === 'function') {
            homeOrdersWatcher.stop();
        }
        homeOrdersWatcher = null;
    }

    function stopSessionsAutoRefresh() {
        if (sessionsPollTimer) {
            clearInterval(sessionsPollTimer);
            sessionsPollTimer = null;
        }
    }

    function startSessionsAutoRefresh() {
        stopSessionsAutoRefresh();
        sessionsPollTimer = setInterval(function () {
            const events = window.TM07_BENCH_EVENTS;
            if ((events && events.hasOperator && events.hasOperator()) || isAdmin) {
                void loadSessions({ quiet: true });
            }
        }, SESSIONS_POLL_MS);
    }

    let homeNotifyItems = [];
    let homeNotifySeq = 0;

    function clearHomeNewOrders() {
        homeNotifyItems = [];
        const listEl = $('homeNewOrdersList');
        if (listEl) {
            listEl.innerHTML = '';
        }
        $('homeNewOrdersAlert')?.classList.add('d-none');
    }

    function renderHomeNotifyList() {
        const alertEl = $('homeNewOrdersAlert');
        const listEl = $('homeNewOrdersList');
        if (!alertEl || !listEl) {
            return;
        }
        if (!homeNotifyItems.length) {
            listEl.innerHTML = '';
            alertEl.classList.add('d-none');
            return;
        }
        listEl.innerHTML = homeNotifyItems
            .map(function (item) {
                const prefix = item.test
                    ? '<span class="badge text-bg-warning text-dark me-1">ТЕСТ</span> '
                    : '';
                const body =
                    item.test && item.message
                        ? item.message + ' · заказ <strong>' + item.number + '</strong>'
                        : 'Новый заказ в 1С: <strong>' +
                          item.number +
                          '</strong>' +
                          (item.kindLabel ? ' · ' + item.kindLabel : '') +
                          ' (кПроизводству).';
                const href = wbUrl(
                    item.number
                        ? '/tm07-workbench.html?order=' + encodeURIComponent(item.number)
                        : '/tm07-workbench.html'
                );
                return (
                    '<div class="alert alert-success border-0 shadow-sm mb-0 py-2" data-notify-id="' +
                    item.id +
                    '">' +
                    '<div class="d-flex flex-wrap align-items-center gap-2">' +
                    '<i class="bi bi-bell-fill"></i>' +
                    '<div class="flex-grow-1">' +
                    prefix +
                    body +
                    '</div>' +
                    '<a class="btn btn-success btn-sm" href="' +
                    href +
                    '"><i class="bi bi-box-arrow-in-right me-1"></i>К заказу</a>' +
                    '<button type="button" class="btn btn-outline-secondary btn-sm" data-dismiss-notify="' +
                    item.id +
                    '" title="Скрыть">Скрыть</button>' +
                    '</div></div>'
                );
            })
            .join('');
        alertEl.classList.remove('d-none');
    }

    function showHomeNewOrders(newOrders) {
        if (!newOrders || !newOrders.length) {
            return;
        }
        newOrders.forEach(function (o) {
            homeNotifySeq += 1;
            homeNotifyItems.push({
                id: 'hn-' + homeNotifySeq + '-' + Date.now(),
                number: o.number || '',
                test: !!o.test,
                message: o.message || '',
                kindLabel: o.kindLabel || '',
            });
        });
        renderHomeNotifyList();
        try {
            $('homeNewOrdersAlert')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (_e) {}
        try {
            if (typeof document !== 'undefined' && document.hidden) {
                const prev = document.title;
                const first = newOrders[0] && newOrders[0].number;
                document.title = '🔔 Новый заказ — ' + (first || 'ТМ-07');
                setTimeout(function () {
                    document.title = prev;
                }, 8000);
            }
        } catch (_e2) {}
    }

    function startHomeOrdersWatcher() {
        const O = window.Order1cOdata;
        if (!O || typeof O.startActiveOrdersWatcher !== 'function') {
            // Скрипт ещё не готов — повтор через секунду
            setTimeout(function () {
                const events = window.TM07_BENCH_EVENTS;
                if (events && events.hasOperator && events.hasOperator()) {
                    startHomeOrdersWatcher();
                }
            }, 1000);
            return;
        }
        if (homeOrdersWatcher) {
            return;
        }
        if (typeof O.bootstrapOdataConfig === 'function') {
            void O.bootstrapOdataConfig();
        }
        if (typeof O.ensureNotificationPermission === 'function') {
            void O.ensureNotificationPermission();
        }
        homeOrdersWatcher = O.startActiveOrdersWatcher({
            onNew: function (newOrders) {
                showHomeNewOrders(newOrders);
            },
            onError: function (e) {
                console.warn('[home] active orders watch', e);
            },
            onPushError: function (e, result) {
                if (result && (result.status === 401 || result.status === 403)) {
                    console.warn(
                        '[home] уведомления: нет сессии оператора на сервере — войдите заново',
                        e
                    );
                } else {
                    console.warn('[home] server notify', e);
                }
            },
        });
    }

    function operatorLabel(ctx) {
        if (!ctx) {
            return '';
        }
        if (ctx.lastName) {
            return ctx.firstName ? ctx.lastName + ' ' + ctx.firstName.charAt(0) + '.' : ctx.lastName;
        }
        return ctx.displayName || ctx.login || '';
    }

    function formatDt(iso) {
        if (!iso) {
            return '—';
        }
        try {
            const raw = String(iso).trim();
            // SQL без зоны: показываем как московское время без сдвига браузера.
            const m = raw.match(
                /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/
            );
            if (m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) {
                return m[3] + '.' + m[2] + '.' + m[1] + ', ' + m[4] + ':' + m[5];
            }
            const d = new Date(raw);
            if (Number.isNaN(d.getTime())) {
                return raw;
            }
            return d.toLocaleString('ru-RU', {
                timeZone: 'Europe/Moscow',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch (_e) {
            return String(iso);
        }
    }

    function sessionStageBadge(stage, label) {
        const map = {
            assembly: { cls: 'text-bg-warning text-dark', label: 'Сборка' },
            parametrization: { cls: 'text-bg-primary', label: 'Параметризация' },
            completed: { cls: 'text-bg-success', label: 'Завершена' },
        };
        const m = map[stage] || { cls: 'text-bg-secondary', label: label || stage || '—' };
        return '<span class="badge rounded-pill ' + m.cls + '">' + (label || m.label) + '</span>';
    }

    function sessionStateBadge(state) {
        if (state === 'active') {
            return '<span class="badge rounded-pill text-bg-primary">Активна</span>';
        }
        return '<span class="badge rounded-pill text-bg-light border text-body-secondary">Закрыта</span>';
    }

    function resumeAction(s) {
        const stage = s.sessionStage || '';
        const url = wbUrl(s.resumeUrl || '/tm07-workbench.html');
        const verify = stage === 'completed' || s.verifyMode;
        if (verify) {
            return (
                '<a class="btn btn-sm btn-success" href="' +
                url +
                '" title="Открыть сессию #' +
                s.id +
                ' для проверки корректора опросом">Проверить</a>'
            );
        }
        if (s.state === 'active') {
            return (
                '<a class="btn btn-sm btn-primary" href="' +
                url +
                '" title="Продолжить сессию #' +
                s.id +
                '">Продолжить</a>'
            );
        }
        return (
            '<a class="btn btn-sm btn-outline-secondary" href="' +
            url +
            '" title="Открыть сессию #' +
            s.id +
            ' без создания новой">Открыть</a>'
        );
    }

    function renderSessionsTable(sessions) {
        const body = $('homeSessionsBody');
        const empty = $('homeSessionsEmpty');
        if (!body) {
            return;
        }
        if (!sessions || !sessions.length) {
            body.innerHTML = '';
            if (empty) {
                empty.classList.remove('d-none');
            }
            return;
        }
        if (empty) {
            empty.classList.add('d-none');
        }
        body.innerHTML = sessions
            .map(function (s) {
                const op = s.operator || {};
                const opLabel =
                    op.lastName && op.firstName
                        ? op.lastName + ' ' + op.firstName.charAt(0) + '.'
                        : op.lastName || op.displayName || op.login || '—';
                const ws = (s.workstation && (s.workstation.name || s.workstation.code)) || '—';
                const param = s.parametrization || {};
                const corrSn = s.serialCorrector || param.serialCorrector || '';
                const serials = [];
                if (corrSn) {
                    serials.push(corrSn);
                }
                if (param.serialComplex) {
                    serials.push('компл. ' + param.serialComplex);
                }
                const serialText = serials.length ? serials.join(', ') : '—';
                const deleteBtn = isAdmin
                    ? '<button type="button" class="btn btn-sm btn-outline-danger ms-1" data-delete-session="' +
                      s.id +
                      '" title="Удалить сессию"><i class="bi bi-trash"></i></button>'
                    : '';

                return (
                    '<tr>' +
                    '<td class="font-monospace fw-semibold">' +
                    (s.orderNumber || '—') +
                    '</td>' +
                    '<td>' +
                    (s.orderStatus || '—') +
                    '</td>' +
                    '<td>' +
                    opLabel +
                    '</td>' +
                    '<td class="small">' +
                    ws +
                    '</td>' +
                    '<td>' +
                    sessionStateBadge(s.state) +
                    '</td>' +
                    '<td>' +
                    sessionStageBadge(s.sessionStage, s.sessionStageLabel) +
                    '</td>' +
                    '<td class="small font-monospace">' +
                    serialText +
                    '</td>' +
                    '<td class="small text-nowrap">' +
                    formatDt(s.openedAt) +
                    '</td>' +
                    '<td class="text-end text-nowrap">' +
                    resumeAction(s) +
                    deleteBtn +
                    '</td>' +
                    '</tr>'
                );
            })
            .join('');
    }

    function setLoading(loading) {
        const spin = $('homeSessionsLoading');
        if (spin) {
            spin.classList.toggle('d-none', !loading);
        }
    }

    function setError(msg) {
        const el = $('homeSessionsError');
        if (!el) {
            return;
        }
        if (msg) {
            el.textContent = msg;
            el.classList.remove('d-none');
        } else {
            el.textContent = '';
            el.classList.add('d-none');
        }
    }

    async function refreshAdminStatus() {
        const events = window.TM07_BENCH_EVENTS;
        if (events && typeof events.isAdminLoggedIn === 'function') {
            isAdmin = await events.isAdminLoggedIn();
        } else {
            try {
                const r = await fetch('/api/auth.php?action=status', { credentials: 'same-origin' });
                const j = await r.json();
                isAdmin = !!(j.success && j.loggedIn);
            } catch (_e) {
                isAdmin = false;
            }
        }
        const badge = $('homeAdminBadge');
        if (badge) {
            badge.classList.toggle('d-none', !isAdmin);
        }
        const delAll = $('homeDeleteAllSessionsBtn');
        if (delAll) {
            delAll.classList.toggle('d-none', !isAdmin);
        }
    }

    /** false — блок «Сбои печати / паспорта / сверки» временно скрыт (вернуть: true + убрать hidden у #homeOpsAlerts). */
    const OPS_ALERTS_ENABLED = false;

    function renderOpsAlerts(events) {
        const card = $('homeOpsAlerts');
        const list = $('homeOpsAlertsList');
        const countEl = $('homeOpsAlertsCount');
        if (!card || !list) {
            return;
        }
        if (!OPS_ALERTS_ENABLED) {
            card.classList.add('d-none');
            card.hidden = true;
            list.innerHTML = '';
            if (countEl) {
                countEl.textContent = '0';
            }
            return;
        }
        const failTypes = {
            nameplate_print: 'Печать шильдика',
            passport_generate: 'Паспорт',
            parametrization_verify: 'Сверка',
        };
        const fails = (events || []).filter(function (ev) {
            const code = ev.eventType || ev.code || '';
            const state = String(ev.eventState || ev.state || '').toLowerCase();
            return failTypes[code] && (state === 'fail' || state === 'error' || state === 'failed');
        }).slice(0, 8);

        if (!fails.length) {
            card.classList.add('d-none');
            list.innerHTML = '';
            if (countEl) {
                countEl.textContent = '0';
            }
            return;
        }
        card.hidden = false;
        card.classList.remove('d-none');
        if (countEl) {
            countEl.textContent = String(fails.length);
        }
        list.innerHTML = fails
            .map(function (ev) {
                const code = ev.eventType || ev.code || '';
                const label = failTypes[code] || code;
                const payload = ev.payload || {};
                const err = payload.error || payload.message || '';
                const order = payload.orderNumber || ev.orderNumber || '';
                const when = formatDt(ev.createdAt || ev.CREATED_AT);
                const sn = ev.serialCorrector || '';
                return (
                    '<li class="list-group-item d-flex flex-wrap justify-content-between gap-2">' +
                    '<div>' +
                    '<span class="badge text-bg-danger me-2">' +
                    label +
                    '</span>' +
                    '<span class="text-body-secondary">' +
                    when +
                    '</span>' +
                    (order ? ' · заказ <span class="font-monospace">' + order + '</span>' : '') +
                    (sn ? ' · S/N <span class="font-monospace">' + sn + '</span>' : '') +
                    (err ? '<div class="mt-1">' + String(err).slice(0, 160) + '</div>' : '') +
                    '</div>' +
                    '</li>'
                );
            })
            .join('');
    }

    async function loadOpsAlerts() {
        const events = window.TM07_BENCH_EVENTS;
        if (!events || typeof events.getLastEvents !== 'function') {
            renderOpsAlerts([]);
            return;
        }
        try {
            const rows = await events.getLastEvents({ limit: 40 });
            renderOpsAlerts(rows);
        } catch (_e) {
            renderOpsAlerts([]);
        }
    }

    async function loadSessions(opts) {
        const events = window.TM07_BENCH_EVENTS;
        if (!events || typeof events.listOrderSessions !== 'function') {
            return;
        }
        const quiet = !!(opts && opts.quiet);
        if (!quiet) {
            setLoading(true);
            setError('');
        }
        try {
            const filter = ($('homeSessionsFilter') || {}).value || 'all';
            const query = { limit: 50 };
            if (filter === 'active' || filter === 'closed') {
                query.state = filter;
            }
            const sessions = await events.listOrderSessions(query);
            renderSessionsTable(sessions);
            if (!quiet) {
                await loadOpsAlerts();
            }
        } catch (e) {
            if (!quiet) {
                setError(e.message || String(e));
                renderSessionsTable([]);
            }
        } finally {
            if (!quiet) {
                setLoading(false);
            }
        }
    }

    function showAuthGate(show) {
        $('homeAuthGate')?.classList.toggle('d-none', !show);
        $('homeDashboard')?.classList.toggle('d-none', show);
    }

    async function refreshHome() {
        const events = window.TM07_BENCH_EVENTS;
        await refreshAdminStatus();

        if (!events) {
            showAuthGate(!isAdmin);
            if (isAdmin) {
                await loadSessions();
                startSessionsAutoRefresh();
            }
            return;
        }

        let ctx = null;
        try {
            ctx = await events.refreshContext();
        } catch (_e) {}

        const operatorLoggedIn = events.hasOperator && events.hasOperator();
        showAuthGate(!operatorLoggedIn && !isAdmin);

        const labelEl = $('homeOperatorLabel');
        const wsEl = $('homeWorkstationLabel');
        if (operatorLoggedIn && labelEl) {
            labelEl.textContent = operatorLabel(ctx);
        } else if (labelEl && isAdmin) {
            labelEl.textContent = '— (вход не выполнен)';
        }
        if (operatorLoggedIn && wsEl) {
            const agent =
                typeof events.getSenselockAgentStatus === 'function'
                    ? events.getSenselockAgentStatus()
                    : null;
            const code =
                (typeof events.workstationCode === 'function' && events.workstationCode()) ||
                (ctx && ctx.workstationCode) ||
                '';
            if (agent && agent.present && agent.workstationCode) {
                wsEl.textContent = agent.workstationCode;
            } else if (agent && agent.offline) {
                wsEl.textContent = 'агент Senselock офлайн';
            } else if (agent && !agent.present) {
                wsEl.textContent = 'нет ключа Senselock';
            } else {
                wsEl.textContent = code || (ctx && ctx.workstationName) || 'Рабочее место';
            }
        } else if (wsEl && isAdmin) {
            wsEl.textContent = '—';
        }

        patchHomeWorkbenchLinks();

        if (operatorLoggedIn || isAdmin) {
            await loadSessions();
            startSessionsAutoRefresh();
        } else {
            stopSessionsAutoRefresh();
        }
        if (operatorLoggedIn) {
            startHomeOrdersWatcher();
        } else {
            stopHomeOrdersWatcher();
            clearHomeNewOrders();
        }
    }

    async function deleteSession(sessionId, orderNumber) {
        const events = window.TM07_BENCH_EVENTS;
        if (!events || typeof events.deleteOrderSession !== 'function') {
            throw new Error('Удаление недоступно');
        }
        const label = orderNumber ? 'заказ ' + orderNumber : 'сессию #' + sessionId;
        if (!window.confirm('Удалить сессию (' + label + ')? Это действие необратимо.')) {
            return;
        }
        await events.deleteOrderSession(sessionId);
        await loadSessions();
    }

    async function openLogin() {
        if (window.TM07_OPERATOR_AUTH && typeof window.TM07_OPERATOR_AUTH.open === 'function') {
            try {
                await window.TM07_OPERATOR_AUTH.open({});
                await refreshHome();
            } catch (_e) {}
            return;
        }
        const lastName = window.prompt('Фамилия:');
        if (!lastName) {
            return;
        }
        const firstName = window.prompt('Имя (необязательно):') || '';
        await window.TM07_BENCH_EVENTS.selectOperator({
            lastName: String(lastName).trim(),
            firstName: String(firstName).trim(),
        });
        await refreshHome();
    }

    function init() {
        if (!document.body.classList.contains('home-dashboard-page')) {
            return;
        }

        patchHomeWorkbenchLinks();

        $('homeLoginBtn')?.addEventListener('click', function () {
            void openLogin();
        });
        $('homeRefreshBtn')?.addEventListener('click', function () {
            void loadSessions();
            if (homeOrdersWatcher && typeof homeOrdersWatcher.refresh === 'function') {
                void homeOrdersWatcher.refresh();
            }
        });
        $('homeSessionsFilter')?.addEventListener('change', function () {
            void loadSessions();
        });
        $('homeLogoutBtn')?.addEventListener('click', function () {
            const events = window.TM07_BENCH_EVENTS;
            if (!events || typeof events.clearOperator !== 'function') {
                return;
            }
            stopHomeOrdersWatcher();
            stopSessionsAutoRefresh();
            void events.clearOperator().then(function () {
                void refreshHome();
            });
        });
        $('homeNewOrdersDismissBtn')?.addEventListener('click', function () {
            clearHomeNewOrders();
        });
        $('homeNewOrdersList')?.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-dismiss-notify]');
            if (!btn) {
                return;
            }
            const id = btn.getAttribute('data-dismiss-notify');
            homeNotifyItems = homeNotifyItems.filter(function (it) {
                return it.id !== id;
            });
            renderHomeNotifyList();
        });

        $('homeSessionsBody')?.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-delete-session]');
            if (!btn || !isAdmin) {
                return;
            }
            const sessionId = btn.getAttribute('data-delete-session');
            const row = btn.closest('tr');
            const orderNumber = row ? row.querySelector('td')?.textContent?.trim() : '';
            void deleteSession(sessionId, orderNumber).catch(function (err) {
                setError(err.message || String(err));
            });
        });

        $('homeDeleteAllSessionsBtn')?.addEventListener('click', function () {
            if (!isAdmin) {
                return;
            }
            const events = window.TM07_BENCH_EVENTS;
            if (!events || typeof events.deleteAllOrderSessions !== 'function') {
                setError('Удаление всех сессий недоступно');
                return;
            }
            if (
                !window.confirm(
                    'Удалить ВСЕ сессии параметризации? Это необратимо.'
                )
            ) {
                return;
            }
            void events
                .deleteAllOrderSessions()
                .then(function (data) {
                    setError('');
                    alert('Удалено сессий: ' + (data && data.deleted != null ? data.deleted : '?'));
                    return loadSessions();
                })
                .catch(function (err) {
                    setError(err.message || String(err));
                });
        });

        window.addEventListener('tm07-operator-changed', function () {
            void refreshHome();
        });
        window.addEventListener('tm07-senselock-agent', function () {
            void refreshHome();
        });
        window.addEventListener('tm07-order-session-changed', function () {
            const events = window.TM07_BENCH_EVENTS;
            if ((events && events.hasOperator()) || isAdmin) {
                void loadSessions({ quiet: true });
            }
        });
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState !== 'visible') {
                return;
            }
            const events = window.TM07_BENCH_EVENTS;
            if ((events && events.hasOperator && events.hasOperator()) || isAdmin) {
                void loadSessions({ quiet: true });
            }
            if (homeOrdersWatcher && typeof homeOrdersWatcher.refresh === 'function') {
                void homeOrdersWatcher.refresh();
            }
        });

        void (async function bootstrap() {
            if (window.TM07_BENCH_EVENTS && typeof window.TM07_BENCH_EVENTS.initBackend === 'function') {
                await window.TM07_BENCH_EVENTS.initBackend();
            }
            await refreshHome();
            const events = window.TM07_BENCH_EVENTS;
            if (events && !events.hasOperator() && !isAdmin) {
                setTimeout(function () {
                    void openLogin();
                }, 300);
            }
        })();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
