/**
 * Единая шапка и подсветка активного пункта меню.
 * Пункты с adminOnly видны только после входа администратора.
 * #navAuthSlot не пересоздаём при обновлении меню — иначе пропадает вход админа.
 */
(function () {
    const NAV = [
        { href: '/index.html', label: 'Главная', match: [/^\/index\.html$/, /^\/$/] },
        { href: '/tm07-workbench.html', label: 'Рабочее место', match: [/^\/tm07-workbench\.html$/] },
        {
            href: '/test-process-m90-15c.html',
            label: 'Калибровка',
            match: [/^\/test-process-m90-15c\.html$/],
            adminOnly: true,
        },
    ];

    let headerBuilt = false;

    function isActive(item) {
        const path = window.location.pathname;
        return item.match.some((re) => re.test(path));
    }

    function isCalibrationPage() {
        return /^\/test-process-m90-15c\.html$/.test(window.location.pathname);
    }

    function navLinksHtml(adminLoggedIn) {
        return NAV.filter(function (item) {
            return !item.adminOnly || adminLoggedIn;
        })
            .map(function (item) {
                const active = isActive(item);
                const adminCls = item.adminOnly ? ' bench-nav-link--admin' : '';
                return (
                    '<li><a class="bench-nav-link' +
                    adminCls +
                    (active ? ' is-active' : '') +
                    '" href="' +
                    item.href +
                    '"' +
                    (active ? ' aria-current="page"' : '') +
                    (item.adminOnly ? ' title="Только администратор"' : '') +
                    '>' +
                    item.label +
                    '</a></li>'
                );
            })
            .join('');
    }

    function bindNavToggle(host) {
        const toggle = host.querySelector('[data-bench-nav-toggle]');
        const panel = host.querySelector('[data-bench-nav-panel]');
        if (!toggle || !panel || toggle.dataset.bound === '1') {
            return;
        }
        toggle.dataset.bound = '1';
        toggle.addEventListener('click', function () {
            const open = panel.classList.toggle('is-open');
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        panel.addEventListener('click', function (e) {
            const a = e.target && e.target.closest ? e.target.closest('.bench-nav-link') : null;
            if (!a) {
                return;
            }
            panel.classList.remove('is-open');
            toggle.setAttribute('aria-expanded', 'false');
        });
    }

    function ensureHeaderShell() {
        const host = document.querySelector('[data-bench-header]');
        if (!host) {
            return null;
        }
        if (headerBuilt && host.querySelector('#navAuthSlot')) {
            return host;
        }
        host.innerHTML =
            '<div class="container-xl bench-header-inner">' +
            '<a class="bench-logo" href="/index.html">' +
            '<span class="bench-logo-mark" aria-hidden="true">07</span>' +
            '<span class="bench-logo-text">ПК-ТМ</span>' +
            '</a>' +
            '<button class="bench-nav-toggle" type="button" aria-label="Меню" aria-expanded="false" data-bench-nav-toggle>' +
            '<span></span><span></span><span></span>' +
            '</button>' +
            '<div class="bench-nav-panel" data-bench-nav-panel>' +
            '<ul class="bench-nav" data-bench-nav-links></ul>' +
            '<div class="bench-nav-auth" id="navAuthSlot"></div>' +
            '</div>' +
            '</div>';
        headerBuilt = true;
        bindNavToggle(host);
        try {
            window.dispatchEvent(new CustomEvent('tm07-header-ready'));
        } catch (_e) {}
        return host;
    }

    function renderNavLinks(adminLoggedIn) {
        const host = ensureHeaderShell();
        if (!host) {
            return;
        }
        const ul = host.querySelector('[data-bench-nav-links]');
        if (ul) {
            ul.innerHTML = navLinksHtml(!!adminLoggedIn);
        }
    }

    async function checkAdminLoggedIn() {
        try {
            const r = await fetch('/api/auth.php?action=status', { credentials: 'same-origin' });
            const j = await r.json();
            return !!(j.success && j.loggedIn);
        } catch (_e) {
            return false;
        }
    }

    async function init() {
        renderNavLinks(false);
        const admin = await checkAdminLoggedIn();
        renderNavLinks(admin);

        if (isCalibrationPage() && !admin) {
            const next = encodeURIComponent(
                window.location.pathname + window.location.search + window.location.hash
            );
            window.location.replace('/login.html?next=' + next);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            void init();
        });
    } else {
        void init();
    }

    window.TM07_SITE_SHELL = {
        refreshAdminNav: function () {
            return checkAdminLoggedIn().then(function (admin) {
                renderNavLinks(admin);
                return admin;
            });
        },
    };
})();
