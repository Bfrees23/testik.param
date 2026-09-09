/**
 * Автосохранение рабочего места параметризации (localStorage).
 * Восстанавливает заказ, поля параметров, QR-датчики, S/N счётчика после F5.
 */
(function () {
    'use strict';

    const LS_KEY = 'tm07_workbench_state_v1';
    const ORDER_LS_KEY = 'order1c_param_lastOrder';
    const DEBOUNCE_MS = 700;
    const MAX_LOG_CHARS = 14000;

    let saveTimer = null;
    let restoring = false;

    function $(id) {
        return document.getElementById(id);
    }

    function isPersistPage() {
        return !!document.getElementById('paramTbody');
    }

    function collectFieldValues() {
        const out = {};
        document.querySelectorAll('input.param-val[id^="val_"]').forEach(function (inp) {
            if (inp.disabled) {
                return;
            }
            const v = String(inp.value || '').trim();
            if (!v) {
                return;
            }
            const m = /^val_(\d+)$/.exec(inp.id);
            if (m) {
                out[m[1]] = inp.value;
            }
        });
        return out;
    }

    function readOrderCache() {
        const orderKey =
            window.TM07Order1cToParam && window.TM07Order1cToParam.STORAGE_KEY
                ? window.TM07Order1cToParam.STORAGE_KEY
                : ORDER_LS_KEY;
        try {
            const raw = sessionStorage.getItem(orderKey) || localStorage.getItem(orderKey);
            if (raw) {
                return JSON.parse(raw);
            }
        } catch (_e) {}
        return null;
    }

    function truncateLog(html) {
        if (!html || html.length <= MAX_LOG_CHARS) {
            return html || '';
        }
        return '…<br>' + html.slice(-MAX_LOG_CHARS);
    }

    function collectSnapshot() {
        const conn = ($('paramConnStatus') || {}).textContent || '';
        const connOk =
            (/\bподключено\b/i.test(conn) || /\bcom открыт\b/i.test(conn)) && !/отключ/i.test(conn);

        return {
            version: 1,
            savedAt: Date.now(),
            orderNumber: ($('paramOrder1cNumber') || {}).value || '',
            orderStatusText: ($('paramOrder1cStatus') || {}).textContent || '',
            orderStatusBadge: ($('paramOrder1cOrderStatus') || {}).textContent || '',
            orderCache: readOrderCache(),
            modbusAddr: ($('paramAddr') || {}).value || '',
            modbusBaud: ($('paramBaud') || {}).value || '',
            meterSerial: ($('paramMeterSerial') || {}).value || '',
            scannedSensors: Object.assign(
                { DA: null, DD: null, DT: null, TT: null },
                window.__wbScannedSensors || {}
            ),
            fieldValues: collectFieldValues(),
            wbStatus: ($('paramWbAutoStatus') || {}).textContent || '',
            preparedOrder: window.__tm07PreparedOrder || '',
            logTail: truncateLog(($('paramLog') || {}).innerHTML || ''),
            kaoWasConnected: connOk || window.__tm07KaoWasConnected === true,
            kaoFilterKao: window.__tm07KaoFilterKao !== false,
        };
    }

    function saveNow() {
        if (restoring || !isPersistPage()) {
            return;
        }
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(collectSnapshot()));
        } catch (e) {
            console.warn('[TM07-state] save failed', e);
        }
    }

    function scheduleSave() {
        if (restoring) {
            return;
        }
        if (saveTimer) {
            clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(saveNow, DEBOUNCE_MS);
    }

    function restoreFieldValues(values) {
        if (!values || typeof values !== 'object') {
            return 0;
        }
        let n = 0;
        Object.keys(values).forEach(function (sid) {
            const inp = $('val_' + sid);
            if (!inp || inp.disabled) {
                return;
            }
            inp.value = values[sid];
            n += 1;
            if (window.TM07_param_formatStepValue && inp.dataset.stepId) {
                /* hint refresh below */
            }
        });
        document.querySelectorAll('.param-datetime-hint').forEach(function (hint) {
            const m = /^valhint_(\d+)$/.exec(hint.id || '');
            if (m && typeof window.TM07_PARAM_KAO !== 'undefined') {
                /* datetime hints updated by kao on input — trigger via val field */
                const inp = $('val_' + m[1]);
                if (inp) {
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        });
        return n;
    }

    function persistOrderCacheToStores(orderCache) {
        if (!orderCache || !orderCache.row) {
            return;
        }
        const orderKey =
            window.TM07Order1cToParam && window.TM07Order1cToParam.STORAGE_KEY
                ? window.TM07Order1cToParam.STORAGE_KEY
                : ORDER_LS_KEY;
        try {
            const json = JSON.stringify(orderCache);
            sessionStorage.setItem(orderKey, json);
            localStorage.setItem(orderKey, json);
        } catch (_e) {}
    }

    function restore() {
        if (!isPersistPage()) {
            return false;
        }
        let state;
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) {
                return false;
            }
            state = JSON.parse(raw);
        } catch (_e) {
            return false;
        }
        if (!state || state.version !== 1) {
            return false;
        }

        restoring = true;
        try {
            if (state.orderCache) {
                persistOrderCacheToStores(state.orderCache);
            }

            const orderEl = $('paramOrder1cNumber');
            if (orderEl && state.orderNumber) {
                orderEl.value = state.orderNumber;
            }

            const addr = $('paramAddr');
            if (addr && state.modbusAddr) {
                addr.value = state.modbusAddr;
            }
            const baud = $('paramBaud');
            if (baud && state.modbusBaud) {
                baud.value = state.modbusBaud;
            }

            const restoredFields = restoreFieldValues(state.fieldValues);

            if (state.scannedSensors) {
                window.__wbScannedSensors = Object.assign(
                    { DA: null, DD: null, DT: null, TT: null },
                    state.scannedSensors
                );
            }

            const meter = $('paramMeterSerial');
            if (meter && state.meterSerial) {
                meter.value = state.meterSerial;
            }

            const orderSt = $('paramOrder1cStatus');
            if (orderSt && state.orderStatusText) {
                orderSt.textContent = state.orderStatusText;
            }

            const badge = $('paramOrder1cOrderStatus');
            if (badge && state.orderStatusBadge && state.orderStatusBadge !== 'Статус: —') {
                badge.textContent = state.orderStatusBadge;
                badge.classList.remove('text-bg-secondary');
                badge.classList.add('text-bg-success');
            }

            const wbSt = $('paramWbAutoStatus');
            if (wbSt && state.wbStatus) {
                wbSt.textContent = state.wbStatus;
            }

            const log = $('paramLog');
            if (log && state.logTail) {
                log.innerHTML = state.logTail;
            }

            window.__tm07PreparedOrder = state.preparedOrder || state.orderNumber || '';

            const Ops = window.TM07_WORKBENCH_OPS;
            if (Ops) {
                if (typeof Ops.syncMeterSerialFromStep === 'function') {
                    Ops.syncMeterSerialFromStep();
                }
                if (typeof Ops.paintSensorBadges === 'function') {
                    Ops.paintSensorBadges();
                }
                if (typeof Ops.paintMeterBadge === 'function') {
                    Ops.paintMeterBadge();
                }
                if (typeof Ops.paintWorkflowSteps === 'function') {
                    Ops.paintWorkflowSteps();
                }
            }

            if (restoredFields > 0 || state.orderNumber) {
                const le = $('paramLog');
                if (le) {
                    const t = new Date().toLocaleTimeString();
                    le.innerHTML +=
                        '[' +
                        t +
                        '] [STATE] Восстановлено после обновления (' +
                        restoredFields +
                        ' пол., заказ ' +
                        (state.orderNumber || '—') +
                        ').<br>';
                    le.scrollTop = le.scrollHeight;
                }
            }

            window.dispatchEvent(
                new CustomEvent('tm07-workbench-restored', {
                    detail: state,
                })
            );
            return true;
        } finally {
            restoring = false;
        }
    }

    function bindPersistence() {
        if (!isPersistPage()) {
            return;
        }

        document.addEventListener(
            'input',
            function (e) {
                const t = e.target;
                if (!t || !t.id) {
                    return;
                }
                if (
                    t.classList.contains('param-val') ||
                    /^(paramOrder1cNumber|paramMeterSerial|paramAddr|paramQrSensor(_[A-Z]{2})?)$/.test(t.id)
                ) {
                    scheduleSave();
                }
            },
            true
        );

        document.addEventListener(
            'change',
            function (e) {
                const t = e.target;
                if (t && (t.id === 'paramBaud' || t.classList.contains('param-val'))) {
                    scheduleSave();
                }
            },
            true
        );

        window.addEventListener('tm07-session-reset', function () {
            if (!restoring) {
                saveNow();
            }
        });

        ['tm07-order-applied', 'tm07-qr-scanned', 'tm07-meter-serial-applied'].forEach(function (ev) {
            window.addEventListener(ev, scheduleSave);
        });

        window.addEventListener('beforeunload', saveNow);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') {
                saveNow();
            }
        });

        ['paramOrder1cStatus', 'paramWbAutoStatus', 'paramConnStatus'].forEach(function (id) {
            const node = $(id);
            if (node) {
                new MutationObserver(scheduleSave).observe(node, {
                    childList: true,
                    characterData: true,
                    subtree: true,
                });
            }
        });
    }

    function isNewSessionPage() {
        try {
            const sp = new URLSearchParams(window.location.search);
            return sp.get('newSession') === '1' || sp.get('new') === '1';
        } catch (_e) {
            return false;
        }
    }

    function init() {
        if (!isPersistPage()) {
            return;
        }
        if (isNewSessionPage()) {
            localStorage.removeItem(LS_KEY);
        } else {
            restore();
        }
        bindPersistence();
        window.TM07_WORKBENCH_STATE = {
            save: saveNow,
            restore: restore,
            clear: function () {
                localStorage.removeItem(LS_KEY);
            },
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
