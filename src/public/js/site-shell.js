/**
 * Единая шапка и подсветка активного пункта меню.
 */
(function () {
    const NAV = [
        { href: '/index.html', label: 'Главная', match: [/^\/index\.html$/, /^\/$/] },
        // {
        //     href: '/tm07-parametrization-kao.html',
        //     label: 'Параметризация',
        //     match: [/^\/tm07-parametrization-kao/],
        // },
        { href: '/tm07-workbench.html', label: 'Рабочее место', match: [/^\/tm07-workbench\.html$/] },
        // { href: '/order-1c.html', label: 'Заказ 1С', match: [/^\/order-1c\.html$/] },
    ];

    function isActive(item) {
        const path = window.location.pathname;
        return item.match.some((re) => re.test(path));
    }

    function renderHeader() {
        const host = document.querySelector('[data-bench-header]');
        if (!host) return;

        const links = NAV.map((item) => {
            const active = isActive(item);
            return `<li><a class="bench-nav-link${active ? ' is-active' : ''}" href="${item.href}"${
                active ? ' aria-current="page"' : ''
            }>${item.label}</a></li>`;
        }).join('');

        host.innerHTML = `
            <div class="container-xl bench-header-inner">
                <a class="bench-logo" href="/index.html">
                    <span class="bench-logo-mark" aria-hidden="true">07</span>
                    <span class="bench-logo-text">ПК-ТМ</span>
                </a>
                <button class="bench-nav-toggle" type="button" aria-label="Меню" aria-expanded="false" data-bench-nav-toggle>
                    <span></span><span></span><span></span>
                </button>
                <div class="bench-nav-panel" data-bench-nav-panel>
                    <ul class="bench-nav">${links}</ul>
                    <div class="bench-nav-auth" id="navAuthSlot"></div>
                </div>
            </div>`;

        const toggle = host.querySelector('[data-bench-nav-toggle]');
        const panel = host.querySelector('[data-bench-nav-panel]');
        if (toggle && panel) {
            toggle.addEventListener('click', () => {
                const open = panel.classList.toggle('is-open');
                toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
            panel.querySelectorAll('.bench-nav-link').forEach((a) => {
                a.addEventListener('click', () => {
                    panel.classList.remove('is-open');
                    toggle.setAttribute('aria-expanded', 'false');
                });
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderHeader);
    } else {
        renderHeader();
    }
})();
