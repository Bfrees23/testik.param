/**
 * Авторизация оператора (фамилия + имя) и регистрация ПК как рабочего места.
 */
(function () {
    'use strict';

    function ensureModal() {
        let modal = document.getElementById('benchOperatorModal');
        if (modal) {
            return modal;
        }
        const wrap = document.createElement('div');
        wrap.innerHTML =
            '<div class="modal fade" id="benchOperatorModal" tabindex="-1" aria-labelledby="benchOperatorModalTitle" aria-hidden="true" data-bs-backdrop="static">' +
            '<div class="modal-dialog modal-dialog-centered">' +
            '<div class="modal-content">' +
            '<div class="modal-header">' +
            '<h5 class="modal-title" id="benchOperatorModalTitle">Вход оператора</h5>' +
            '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Закрыть"></button>' +
            '</div>' +
            '<div class="modal-body">' +
            '<p class="small text-body-secondary">Укажите логин и PIN оператора. Конфигурация этого ПК будет записана как рабочее место.</p>' +
            '<div id="benchOperatorModalError" class="alert alert-danger py-2 small d-none" role="alert"></div>' +
            '<div class="mb-3">' +
            '<label class="form-label" for="benchOpLogin">Логин <span class="text-danger">*</span></label>' +
            '<input type="text" class="form-control" id="benchOpLogin" autocomplete="username" required autofocus>' +
            '</div>' +
            '<div class="mb-0">' +
            '<label class="form-label" for="benchOpPin">PIN оператора <span class="text-danger">*</span></label>' +
            '<input type="password" class="form-control" id="benchOpPin" autocomplete="current-password" inputmode="numeric" required>' +
            '</div>' +
            '</div>' +
            '<div class="modal-footer">' +
            '<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Отмена</button>' +
            '<button type="button" class="btn btn-primary" id="benchOperatorModalSubmit">Войти</button>' +
            '</div></div></div></div>';
        document.body.appendChild(wrap.firstElementChild);
        return document.getElementById('benchOperatorModal');
    }

    function openOperatorModal(options) {
        const opts = options || {};
        ensureModal();
        const err = document.getElementById('benchOperatorModalError');
        const loginEl = document.getElementById('benchOpLogin');
        const pinEl = document.getElementById('benchOpPin');
        const submitBtn = document.getElementById('benchOperatorModalSubmit');
        if (err) {
            err.classList.add('d-none');
            err.textContent = '';
        }
        if (loginEl && opts.login) {
            loginEl.value = opts.login;
        } else if (loginEl && !opts.keepValues) {
            loginEl.value = '';
        }
        if (pinEl) {
            pinEl.value = '';
        }

        return new Promise(function (resolve, reject) {
            const modalEl = document.getElementById('benchOperatorModal');
            if (!modalEl || !window.bootstrap) {
                reject(new Error('Bootstrap Modal недоступен'));
                return;
            }
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl, { backdrop: 'static', keyboard: true });
            let settled = false;

            function cleanup() {
                submitBtn.removeEventListener('click', onSubmit);
                modalEl.removeEventListener('hidden.bs.modal', onHidden);
                loginEl.removeEventListener('keydown', onKey);
                if (pinEl) pinEl.removeEventListener('keydown', onKey);
            }

            function onHidden() {
                cleanup();
                if (!settled) {
                    settled = true;
                    reject(new Error('Вход отменён'));
                }
            }

            function onKey(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    void onSubmit();
                }
            }

            async function onSubmit() {
                if (!window.TM07_BENCH_EVENTS || settled) {
                    return;
                }
                const login = (loginEl.value || '').trim();
                const pin = pinEl ? (pinEl.value || '').trim() : '';
                if (!login) {
                    err.textContent = 'Укажите логин оператора.';
                    err.classList.remove('d-none');
                    loginEl.focus();
                    return;
                }
                if (!pin) {
                    err.textContent = 'Укажите PIN оператора.';
                    err.classList.remove('d-none');
                    pinEl.focus();
                    return;
                }
                submitBtn.disabled = true;
                try {
                    const data = await window.TM07_BENCH_EVENTS.selectOperator({
                        login: login,
                        pin: pin,
                    });
                    settled = true;
                    cleanup();
                    modal.hide();
                    resolve(data);
                } catch (e) {
                    err.textContent = e.message || String(e);
                    err.classList.remove('d-none');
                    if (pinEl) {
                        pinEl.focus();
                    }
                } finally {
                    submitBtn.disabled = false;
                }
            }

            submitBtn.addEventListener('click', onSubmit);
            modalEl.addEventListener('hidden.bs.modal', onHidden);
            loginEl.addEventListener('keydown', onKey);
            if (pinEl) pinEl.addEventListener('keydown', onKey);
            modal.show();
            window.setTimeout(function () {
                loginEl.focus();
            }, 250);
        });
    }

    window.TM07_OPERATOR_AUTH = {
        open: openOperatorModal,
        ensure: async function () {
            if (!window.TM07_BENCH_EVENTS) {
                throw new Error('Модуль TM07_BENCH_EVENTS не загружен');
            }
            const ctx = await window.TM07_BENCH_EVENTS.refreshContext(true);
            if (ctx && (ctx.lastName || ctx.login)) {
                return ctx;
            }
            let status = null;
            try {
                const ev = window.TM07_BENCH_EVENTS;
                let q = 'action=status';
                if (ev && typeof ev.statusQueryParams === 'function') {
                    q = new URLSearchParams(ev.statusQueryParams()).toString();
                } else {
                    const fp =
                        typeof ev.workstationFingerprint === 'function'
                            ? ev.workstationFingerprint()
                            : '';
                    q += '&fingerprint=' + encodeURIComponent(fp || '');
                }
                status = await fetch('/api/bench-db-status.php?' + q, {
                    credentials: 'same-origin',
                }).then(function (r) {
                    return r.json();
                });
            } catch (_e) {}
            return openOperatorModal(
                Object.assign({}, ctx || {}, status ? { operatorPinRequired: status.operatorPinRequired, status: status } : {})
            );
        },
    };
})();
