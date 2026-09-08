/**
 * Кэш публичных настроек и OData (sessionStorage, 5 мин).
 * Bench-секреты (ЛКГ) — только в памяти вкладки, не в sessionStorage.
 */
(function () {
    'use strict';

    const TTL_MS = 5 * 60 * 1000;
    const KEY_PUBLIC = 'tm07_settings_public_v1';
    const KEY_ODATA = 'tm07_odata_config_v1';

    let publicInflight = null;
    let benchInflight = null;
    let odataInflight = null;
    /** @type {{expires:number, data:any}|null} */
    let benchMemory = null;

    function readCache(key) {
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            if (parsed && parsed.expires > Date.now() && parsed.data != null) {
                return parsed.data;
            }
        } catch (_e) {}
        return null;
    }

    function writeCache(key, data) {
        try {
            sessionStorage.setItem(
                key,
                JSON.stringify({
                    expires: Date.now() + TTL_MS,
                    data: data,
                })
            );
        } catch (_e) {}
    }

    function readBenchMemory() {
        if (benchMemory && benchMemory.expires > Date.now() && benchMemory.data != null) {
            return benchMemory.data;
        }
        benchMemory = null;
        return null;
    }

    function writeBenchMemory(data) {
        benchMemory = { expires: Date.now() + TTL_MS, data: data };
    }

    function invalidate() {
        try {
            sessionStorage.removeItem(KEY_PUBLIC);
            sessionStorage.removeItem('tm07_settings_bench_v1');
            sessionStorage.removeItem(KEY_ODATA);
        } catch (_e) {}
        benchMemory = null;
        publicInflight = null;
        benchInflight = null;
        odataInflight = null;
    }

    function wsHeaders() {
        const h = {};
        try {
            const fp =
                (window.TM07_BENCH_EVENTS &&
                    typeof window.TM07_BENCH_EVENTS.workstationFingerprint === 'function' &&
                    window.TM07_BENCH_EVENTS.workstationFingerprint()) ||
                localStorage.getItem('tm07_workstation_fp_v1') ||
                '';
            if (fp) {
                h['X-Workstation-Fingerprint'] = String(fp);
            }
        } catch (_e) {}
        return h;
    }

    async function getPublicSettings(force) {
        if (!force) {
            const cached = readCache(KEY_PUBLIC);
            if (cached) {
                return cached;
            }
            if (publicInflight) {
                return publicInflight;
            }
        }
        publicInflight = fetch('/api/admin-settings.php?action=public', {
            credentials: 'same-origin',
            headers: wsHeaders(),
        })
            .then(function (r) {
                return r.json();
            })
            .then(function (j) {
                if (!j.success || !j.settings) {
                    throw new Error(j.error || 'settings load failed');
                }
                writeCache(KEY_PUBLIC, j.settings);
                return j.settings;
            })
            .finally(function () {
                publicInflight = null;
            });
        return publicInflight;
    }

    /** Настройки с ключами ЛКГ — только при сессии оператора; кэш только в памяти. */
    async function getBenchSettings(force) {
        if (!force) {
            const cached = readBenchMemory();
            if (cached) {
                return cached;
            }
            if (benchInflight) {
                return benchInflight;
            }
        }
        benchInflight = fetch('/api/admin-settings.php?action=bench', {
            credentials: 'same-origin',
            headers: wsHeaders(),
        })
            .then(function (r) {
                return r.json().then(function (j) {
                    return { status: r.status, j: j };
                });
            })
            .then(function (pack) {
                if (!pack.j || !pack.j.success || !pack.j.settings) {
                    const err = new Error((pack.j && pack.j.error) || 'bench settings unavailable');
                    err.status = pack.status;
                    throw err;
                }
                writeBenchMemory(pack.j.settings);
                return pack.j.settings;
            })
            .finally(function () {
                benchInflight = null;
            });
        return benchInflight;
    }

    /** Bench-секреты если оператор вошёл, иначе публичные (без ЛКГ). */
    async function getDeviceSettings(force) {
        try {
            return await getBenchSettings(force);
        } catch (_e) {
            return getPublicSettings(force);
        }
    }

    async function getOdataConfig(force) {
        if (!force) {
            const cached = readCache(KEY_ODATA);
            if (cached) {
                return cached;
            }
            if (odataInflight) {
                return odataInflight;
            }
        }
        odataInflight = fetch('/api/odata-1c.php?action=config', { credentials: 'same-origin' })
            .then(function (r) {
                return r.json();
            })
            .then(function (j) {
                if (!j || j.ok === false) {
                    throw new Error((j && j.error) || 'odata config failed');
                }
                writeCache(KEY_ODATA, j);
                return j;
            })
            .finally(function () {
                odataInflight = null;
            });
        return odataInflight;
    }

    window.TM07_SETTINGS = {
        getPublicSettings: getPublicSettings,
        getBenchSettings: getBenchSettings,
        getDeviceSettings: getDeviceSettings,
        getOdataConfig: getOdataConfig,
        invalidate: invalidate,
    };
})();
