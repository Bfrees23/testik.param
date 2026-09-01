/**
 * Показывает оператора, рабочее место и вход администратора в #navAuthSlot.
 */
(function () {
    function operatorLabel(st) {
        if (!st) return '';
        if (st.lastName) {
            return st.firstName ? st.lastName + ' ' + st.firstName.charAt(0) + '.' : st.lastName;
        }
        return st.displayName || st.login || '';
    }

    async function renderOperatorBlock() {
        if (!window.TM07_BENCH_EVENTS) {
            return '';
        }
        try {
            const st = await window.TM07_BENCH_EVENTS.refreshContext(true);
            const label = operatorLabel(st);
            const ws =
                st && st.workstationName
                    ? st.workstationName
                    : st && st.workstationCode
                      ? st.workstationCode
                      : '';
            const order =
                st && st.activeSession && st.activeSession.orderNumber
                    ? st.activeSession.orderNumber
                    : st && st.orderNumber
                      ? st.orderNumber
                      : '';
            if (label) {
                const wsTitle = ws ? ' · ' + ws : '';
                const orderTitle = order ? ' · заказ ' + order : '';
                return (
                    '<span class="bench-operator-badge small text-body-secondary me-2" title="Оператор' +
                    wsTitle +
                    orderTitle +
                    '">' +
                    label +
                    (order ? ' · ' + order : '') +
                    '</span>' +
                    '<button type="button" class="btn btn-link btn-sm py-0 px-1 me-1 text-body-secondary" id="navOperatorChangeBtn" title="Сменить оператора">сменить</button>' +
                    '<button type="button" class="btn btn-link btn-sm py-0 px-1 me-1 text-body-secondary" id="navOperatorLogoutBtn" title="Выйти из оператора">выйти</button>'
                );
            }
        } catch (_e) {}
        return '<button type="button" class="btn btn-outline-primary btn-sm py-0 px-2 me-2" id="navOperatorBtn">Оператор</button>';
    }

    async function openOperatorAuth(refreshFn) {
        if (window.TM07_OPERATOR_AUTH && window.TM07_OPERATOR_AUTH.open) {
            await window.TM07_OPERATOR_AUTH.open({});
        } else if (window.TM07_BENCH_EVENTS) {
            const lastName = window.prompt('Фамилия:');
            if (!lastName) return;
            const firstName = window.prompt('Имя (необязательно):') || '';
            await window.TM07_BENCH_EVENTS.selectOperator({
                lastName: String(lastName).trim(),
                firstName: String(firstName).trim(),
            });
        }
        if (typeof refreshFn === 'function') {
            refreshFn();
        }
    }

    async function refresh() {
        const slot = document.getElementById('navAuthSlot');
        if (!slot) {
            return;
        }
        try {
            const r = await fetch('/api/auth.php?action=status', { credentials: 'same-origin' });
            const j = await r.json();
            const opHtml = await renderOperatorBlock();
            if (j.success && j.loggedIn) {
                slot.innerHTML =
                    opHtml +
                    '<a class="nav-link py-1 d-inline" href="/admin.html">Админ</a>' +
                    '<button type="button" class="btn btn-outline-secondary btn-sm py-0 px-2 ms-1" id="navLogoutBtn">Выход</button>';
            } else {
                slot.innerHTML =
                    opHtml + '<a class="nav-link py-1 d-inline" href="/login.html">Админ</a>';
            }

            if (window.TM07_SITE_SHELL && typeof window.TM07_SITE_SHELL.refreshAdminNav === 'function') {
                void window.TM07_SITE_SHELL.refreshAdminNav();
            }

            const btn = document.getElementById('navLogoutBtn');
            if (btn) {
                btn.addEventListener('click', async function () {
                    try {
                        await fetch('/api/auth.php?action=logout', {
                            method: 'POST',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: '{}',
                        });
                    } catch (_e) {}
                    window.location.href = '/index.html';
                });
            }

            const opBtn = document.getElementById('navOperatorBtn');
            if (opBtn) {
                opBtn.addEventListener('click', function () {
                    void openOperatorAuth(refresh);
                });
            }
            const changeBtn = document.getElementById('navOperatorChangeBtn');
            if (changeBtn) {
                changeBtn.addEventListener('click', function () {
                    void openOperatorAuth(refresh);
                });
            }
            const logoutOpBtn = document.getElementById('navOperatorLogoutBtn');
            if (
                logoutOpBtn &&
                window.TM07_BENCH_EVENTS &&
                typeof window.TM07_BENCH_EVENTS.clearOperator === 'function'
            ) {
                logoutOpBtn.addEventListener('click', function () {
                    void window.TM07_BENCH_EVENTS.clearOperator().then(function () {
                        refresh();
                    });
                });
            }
        } catch (_e) {
            slot.innerHTML =
                '<a class="nav-link py-1" href="/login.html" title="API недоступен">Админ</a>';
        }
    }

    function start() {
        void refresh();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
    // Шапка может появиться чуть позже (site-shell) — дорисуем слот авторизации.
    window.addEventListener('tm07-header-ready', start);
    window.addEventListener('tm07-operator-changed', start);
    window.addEventListener('tm07-order-session-changed', start);

    window.TM07_SITE_NAV_AUTH = { refresh: refresh };
})();
