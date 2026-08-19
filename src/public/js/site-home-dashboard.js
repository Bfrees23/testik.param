/**
 * Главная: авторизация оператора и список сессий параметризации.
 */
(function () {
    'use strict';

    let isAdmin = false;

    function $(id) {
        return document.getElementById(id);
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
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) {
                return String(iso);
            }
            return d.toLocaleString('ru-RU', {
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
        const url = s.resumeUrl || '/tm07-workbench.html';
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

    function renderOpsAlerts(events) {
        const card = $('homeOpsAlerts');
        const list = $('homeOpsAlertsList');
        const countEl = $('homeOpsAlertsCount');
        if (!card || !list) {
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

    async function loadSessions() {
        const events = window.TM07_BENCH_EVENTS;
        if (!events || typeof events.listOrderSessions !== 'function') {
            return;
        }
        setLoading(true);
        setError('');
        try {
            const filter = ($('homeSessionsFilter') || {}).value || 'all';
            const query = { limit: 50 };
            if (filter === 'active' || filter === 'closed') {
                query.state = filter;
            }
            const sessions = await events.listOrderSessions(query);
            renderSessionsTable(sessions);
            await loadOpsAlerts();
        } catch (e) {
            setError(e.message || String(e));
            renderSessionsTable([]);
        } finally {
            setLoading(false);
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
            wsEl.textContent =
                (ctx && ctx.workstationName) || (ctx && ctx.workstationCode) || 'Рабочее место';
        } else if (wsEl && isAdmin) {
            wsEl.textContent = '—';
        }

        if (operatorLoggedIn || isAdmin) {
            await loadSessions();
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

        $('homeLoginBtn')?.addEventListener('click', function () {
            void openLogin();
        });
        $('homeRefreshBtn')?.addEventListener('click', function () {
            void loadSessions();
        });
        $('homeSessionsFilter')?.addEventListener('change', function () {
            void loadSessions();
        });
        $('homeLogoutBtn')?.addEventListener('click', function () {
            const events = window.TM07_BENCH_EVENTS;
            if (!events || typeof events.clearOperator !== 'function') {
                return;
            }
            void events.clearOperator().then(function () {
                void refreshHome();
            });
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
        window.addEventListener('tm07-order-session-changed', function () {
            const events = window.TM07_BENCH_EVENTS;
            if ((events && events.hasOperator()) || isAdmin) {
                void loadSessions();
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
