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
            '<p class="small text-body-secondary">Укажите фамилию, имя и свой PIN. Конфигурация этого ПК будет записана как рабочее место.</p>' +
            '<div id="benchOperatorModalError" class="alert alert-danger py-2 small d-none" role="alert"></div>' +
            '<div class="mb-3">' +
            '<label class="form-label" for="benchOpLastName">Фамилия <span class="text-danger">*</span></label>' +
            '<input type="text" class="form-control" id="benchOpLastName" autocomplete="family-name" required autofocus>' +
            '</div>' +
            '<div class="mb-0">' +
            '<label class="form-label" for="benchOpFirstName">Имя</label>' +
            '<input type="text" class="form-control" id="benchOpFirstName" autocomplete="given-name">' +
            '</div>' +
            '<div class="mb-0 mt-3 d-none" id="benchOpPinWrap">' +
            '<label class="form-label" for="benchOpPin">PIN оператора</label>' +
            '<input type="password" class="form-control" id="benchOpPin" autocomplete="current-password" inputmode="numeric">' +
            '</div>' +
            '</div>' +
            '<div class="modal-footer">' +
            '<button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Отмена</button>' +
            '<button type="button" class="btn btn-primary" id="benchOperatorModalSubmit">Войти</button>' +
            '</div></div></div></div>';
        document.body.appendChild(wrap.firstElementChild);
        return document.getElementById('benchOperatorModal');
    }

    async function resolvePinRequired(opts) {
        if (opts && (opts.operatorPinRequired || (opts.status && opts.status.operatorPinRequired))) {
            return true;
        }
        try {
            const fp =
                window.TM07_BENCH_EVENTS && typeof window.TM07_BENCH_EVENTS.workstationFingerprint === 'function'
                    ? window.TM07_BENCH_EVENTS.workstationFingerprint()
                    : '';
            const st = await fetch(
                '/api/bench-db-status.php?action=status&fingerprint=' + encodeURIComponent(fp || ''),
                { credentials: 'same-origin' }
            ).then(function (r) {
                return r.json();
            });
            return !!(st && st.operatorPinRequired);
        } catch (_e) {
            return false;
        }
    }

    function openOperatorModal(options) {
        const opts = options || {};
        ensureModal();
        const err = document.getElementById('benchOperatorModalError');
        const lastEl = document.getElementById('benchOpLastName');
        const firstEl = document.getElementById('benchOpFirstName');
        const pinWrap = document.getElementById('benchOpPinWrap');
        const pinEl = document.getElementById('benchOpPin');
        const submitBtn = document.getElementById('benchOperatorModalSubmit');
        if (err) {
            err.classList.add('d-none');
            err.textContent = '';
        }
        if (lastEl && opts.lastName) {
            lastEl.value = opts.lastName;
        } else if (lastEl && !opts.keepValues) {
            lastEl.value = '';
        }
        if (firstEl && opts.firstName) {
            firstEl.value = opts.firstName;
        } else if (firstEl && !opts.keepValues) {
            firstEl.value = '';
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
                lastEl.removeEventListener('keydown', onKey);
                firstEl.removeEventListener('keydown', onKey);
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
                const lastName = (lastEl.value || '').trim();
                const firstName = (firstEl.value || '').trim();
                const pin = pinEl ? (pinEl.value || '').trim() : '';
                if (!lastName) {
                    err.textContent = 'Фамилия обязательна.';
                    err.classList.remove('d-none');
                    lastEl.focus();
                    return;
                }
                submitBtn.disabled = true;
                try {
                    const data = await window.TM07_BENCH_EVENTS.selectOperator({
                        lastName: lastName,
                        firstName: firstName,
                        pin: pin,
                    });
                    settled = true;
                    cleanup();
                    modal.hide();
                    resolve(data);
                } catch (e) {
                    err.textContent = e.message || String(e);
                    err.classList.remove('d-none');
                    if (pinWrap && !pinWrap.classList.contains('d-none') && pinEl) {
                        pinEl.focus();
                    }
                } finally {
                    submitBtn.disabled = false;
                }
            }

            void resolvePinRequired(opts).then(function (pinRequired) {
                if (pinWrap) {
                    pinWrap.classList.toggle('d-none', !pinRequired);
                }
            });

            submitBtn.addEventListener('click', onSubmit);
            modalEl.addEventListener('hidden.bs.modal', onHidden);
            lastEl.addEventListener('keydown', onKey);
            firstEl.addEventListener('keydown', onKey);
            if (pinEl) pinEl.addEventListener('keydown', onKey);
            modal.show();
            window.setTimeout(function () {
                lastEl.focus();
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
                const fp =
                    typeof window.TM07_BENCH_EVENTS.workstationFingerprint === 'function'
                        ? window.TM07_BENCH_EVENTS.workstationFingerprint()
                        : '';
                status = await fetch(
                    '/api/bench-db-status.php?action=status&fingerprint=' + encodeURIComponent(fp || ''),
                    { credentials: 'same-origin' }
                ).then(function (r) {
                    return r.json();
                });
            } catch (_e) {}
            return openOperatorModal(
                Object.assign({}, ctx || {}, status ? { operatorPinRequired: status.operatorPinRequired, status: status } : {})
            );
        },
    };
})();
