/**
 * Админ-панель: device_settings, стенды, прошивки, счётчики, операторы.
 */
(function () {
    'use strict';

    /** @type {Record<string, string>} */
    let pendingCounterParams = {};
    /** @type {Array<any>} */
    let workstationsCache = [];

    /**
     * Роль текущего администратора: 'config' | 'monitor' | null.
     * Берётся из /api/auth.php?action=status (сервер хранит в сессии).
     */
    let adminRole = null;

    /** Разделы, доступные роли «настройка рабочего места» (config). */
    const CONFIG_SECTIONS = ['admSecDevices', 'admSecWorkstations', 'admSecFirmware', 'admSecTools'];
    /** Разделы, доступные роли «мониторинг» (monitor). */
    const MONITOR_SECTIONS = [
        'admSecCounters',
        'admSecSensors',
        'admSecOps',
        'admSecParams',
        'admSecEvents',
        'admSecLogs',
        'admSecDb',
        'admSecOperators',
    ];

    function $(id) {
        return document.getElementById(id);
    }

    /** Применить роль: скрыть чужие разделы и их пункты навигации. */
    function applyAdminRole(role) {
        adminRole = role;
        const allowed = role === 'monitor' ? MONITOR_SECTIONS : CONFIG_SECTIONS;
        const allSections = CONFIG_SECTIONS.concat(MONITOR_SECTIONS);
        allSections.forEach(function (id) {
            const sec = $(id);
            if (sec) {
                sec.classList.toggle('d-none', allowed.indexOf(id) < 0);
            }
        });
        // Скрыть соответствующие пункты навигации (href="#admSec…")
        document.querySelectorAll('#adminSectionNav .nav-link').forEach(function (link) {
            const href = link.getAttribute('href') || '';
            const id = href.replace(/^#/, '');
            link.closest('li').classList.toggle('d-none', allowed.indexOf(id) < 0);
        });
        // Разделы «Смена пароля» и «Уведомления» — общие для обеих ролей.
        const meta = $('adminMeta');
        if (meta) {
            meta.textContent =
                'Роль: ' +
                (role === 'monitor' ? 'мониторинг (привязка, логи, сессии, БД)' : 'настройка рабочего места (приборы, стенды, прошивки)');
        }
    }

    function setStatus(text, isError) {
        const el = $('adminStatus');
        if (!el) {
            return;
        }
        el.textContent = text;
        el.className = 'alert py-2 small mb-3 border-0 ' + (isError ? 'alert-danger' : 'alert-success');
    }

    function setVal(id, value) {
        const el = $(id);
        if (el && value != null && value !== '') {
            el.value = String(value);
        }
    }

    function numVal(id, fallback) {
        const el = $(id);
        if (!el) {
            return fallback;
        }
        const n = parseFloat(String(el.value).replace(',', '.'));
        return Number.isFinite(n) ? n : fallback;
    }

    function intVal(id, fallback) {
        const el = $(id);
        if (!el) {
            return fallback;
        }
        const n = parseInt(String(el.value), 10);
        return Number.isFinite(n) ? n : fallback;
    }

    function strVal(id) {
        const el = $(id);
        return el ? String(el.value || '').trim() : '';
    }

    function applySettings(s) {
        if (!s) {
            return;
        }
        setVal('adm_version', s.version ?? 1);
        setVal('adm_usb_vid', s.usb && s.usb.vendorIdHex);
        setVal('adm_mit_baud', s.mit && s.mit.baudRate);
        setVal('adm_mit_pid', s.mit && s.mit.productIdHex);
        setVal('adm_mit_label', s.mit && s.mit.label);

        const m90 = s.m90 || {};
        setVal('adm_m90_baud', m90.baudRate);
        setVal('adm_m90_addr', m90.deviceAddress);
        setVal('adm_m90_type', m90.expectedDeviceType);
        const ch = Array.isArray(m90.channels) ? m90.channels : [];
        for (let i = 0; i < 3; i += 1) {
            const c = ch[i] || {};
            setVal('adm_m90_' + i + '_id', c.id);
            setVal('adm_m90_' + i + '_pid', c.productIdHex);
            setVal('adm_m90_' + i + '_sp', c.setpointC);
            setVal('adm_m90_' + i + '_lbl', c.label);
        }

        if (s.tm07) {
            setVal('adm_tm07_baud', s.tm07.defaultBaudRate);
            setVal('adm_tm07_addr', s.tm07.modbusAddress);
            setVal('adm_tm07_kao_pid', s.tm07.usbAdapterProductIdHex);
            setVal('adm_tm07_lkg', s.tm07.regLkgHex);
            setVal('adm_tm07_dt', s.tm07.regDatetimeHex);
            setVal('adm_tm07_wex', s.tm07.regWriteExampleHex);
            setVal('adm_tm07_sn_reg', s.tm07.regFactorySerialHex ?? '000F');
            setVal('adm_tm07_lkg_supplier', s.tm07.supplierLkgHex || (s.benchRegisters && s.benchRegisters.corrLkgHex));
            setVal('adm_tm07_lkg_mfg', s.tm07.manufacturerLkgHex);
            setVal('adm_tm07_lkg_delay', s.tm07.lkgDelayMs ?? 150);
            setVal('adm_tm07_lock_sup', s.tm07.supplierLockPassword ?? '-22');
        }

        if (s.pkd160) {
            setVal('adm_pkd_baud', s.pkd160.baudRate);
            setVal('adm_pkd_addr', s.pkd160.busAddress);
            setVal('adm_pkd_vid', s.pkd160.vendorIdHex);
            setVal('adm_pkd_pid', s.pkd160.productIdHex);
        }

        const br = s.benchRegisters || {};
        setVal('adm_reg_tr', br.corrRegTRead);
        setVal('adm_reg_tw', br.corrRegTWrite);
        setVal('adm_reg_pa', br.corrRegPabs);
        setVal('adm_reg_pd', br.corrRegPdiff);
        setVal('adm_reg_lkg', br.corrLkgHex);

        const sc = s.benchScenarioDefaults || {};
        setVal('adm_sc_ramp', sc.m90RampMinutes);
        setVal('adm_sc_stab', sc.stabilityMinutes);
        setVal('adm_sc_ttol', sc.tempToleranceC);
        setVal('adm_sc_flatm', sc.flatMinutes);
        setVal('adm_sc_flatt', sc.flatTolC);
        setVal('adm_sc_ptol', sc.pressureTolKpa);
        setVal('adm_sc_pkdt', sc.pkdTargetTolKpa);
        setVal('adm_sc_amin', sc.absPmin);
        setVal('adm_sc_amax', sc.absPmax);
        setVal('adm_sc_dmin', sc.diffPmin);
        setVal('adm_sc_dmax', sc.diffPmax);
    }

    function collectSettings() {
        const channels = [];
        for (let i = 0; i < 3; i += 1) {
            channels.push({
                id: strVal('adm_m90_' + i + '_id') || 'm90_' + i,
                productIdHex: strVal('adm_m90_' + i + '_pid') || '0x6045',
                setpointC: numVal('adm_m90_' + i + '_sp', 0),
                label: strVal('adm_m90_' + i + '_lbl') || 'M90 #' + (i + 1),
            });
        }
        return {
            version: intVal('adm_version', 1),
            usb: { vendorIdHex: strVal('adm_usb_vid') || '0x0403' },
            mit: {
                baudRate: intVal('adm_mit_baud', 9600),
                productIdHex: strVal('adm_mit_pid') || '0x6015',
                label: strVal('adm_mit_label') || 'МИТ 8',
            },
            m90: {
                baudRate: intVal('adm_m90_baud', 9600),
                deviceAddress: intVal('adm_m90_addr', 2),
                expectedDeviceType: intVal('adm_m90_type', 64),
                channels: channels,
            },
            tm07: {
                defaultBaudRate: intVal('adm_tm07_baud', 19200),
                modbusAddress: intVal('adm_tm07_addr', 1),
                usbAdapterProductIdHex: strVal('adm_tm07_kao_pid') || '0x604E',
                regLkgHex: strVal('adm_tm07_lkg') || '07B6',
                regDatetimeHex: strVal('adm_tm07_dt') || '008C',
                regWriteExampleHex: strVal('adm_tm07_wex') || '07B6',
                regFactorySerialHex: strVal('adm_tm07_sn_reg') || '000F',
                supplierLkgHex: strVal('adm_tm07_lkg_supplier'),
                manufacturerLkgHex: strVal('adm_tm07_lkg_mfg'),
                lkgDelayMs: intVal('adm_tm07_lkg_delay', 150),
                supplierLockPassword: strVal('adm_tm07_lock_sup') || '-22',
            },
            pkd160: {
                baudRate: intVal('adm_pkd_baud', 9600),
                busAddress: intVal('adm_pkd_addr', 1),
                vendorIdHex: strVal('adm_pkd_vid') || '0x04D8',
                productIdHex: strVal('adm_pkd_pid') || '0x000A',
            },
            benchRegisters: {
                corrRegTRead: strVal('adm_reg_tr') || '0120',
                corrRegTWrite: strVal('adm_reg_tw') || '0124',
                corrRegPabs: strVal('adm_reg_pa') || '0200',
                corrRegPdiff: strVal('adm_reg_pd') || '0202',
                corrLkgHex: strVal('adm_reg_lkg') || '',
            },
            benchScenarioDefaults: {
                m90RampMinutes: intVal('adm_sc_ramp', 10),
                stabilityMinutes: intVal('adm_sc_stab', 5),
                tempToleranceC: numVal('adm_sc_ttol', 0.5),
                flatMinutes: intVal('adm_sc_flatm', 5),
                flatTolC: numVal('adm_sc_flatt', 0.15),
                pressureTolKpa: numVal('adm_sc_ptol', 0.5),
                pkdTargetTolKpa: numVal('adm_sc_pkdt', 0.3),
                absPmin: numVal('adm_sc_amin', 0),
                absPmax: numVal('adm_sc_amax', 100),
                diffPmin: numVal('adm_sc_dmin', 0),
                diffPmax: numVal('adm_sc_dmax', 100),
            },
        };
    }

    async function loadSettings() {
        setStatus('Загрузка…', false);
        const st = $('adminStatus');
        if (st) {
            st.className = 'alert alert-secondary border-0 py-2 small mb-3';
        }
        try {
            const r = await fetch('/api/admin-settings.php?action=get', { credentials: 'same-origin' });
            const j = await r.json();
            if (!r.ok || !j.success) {
                if (r.status === 401) {
                    window.location.href = '/login.html';
                    return;
                }
                throw new Error(j.error || 'HTTP ' + r.status);
            }
            applySettings(j.settings);
            const meta = $('adminMeta');
            if (meta) {
                meta.textContent = j.hasCustomFile
                    ? 'Источник: data/device_settings.json (пользовательский файл)'
                    : 'Источник: встроенные умолчания';
            }
            setStatus('Настройки загружены', false);
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    }

    async function saveSettings() {
        setStatus('Сохранение…', false);
        try {
            const r = await fetch('/api/admin-settings.php?action=save', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: collectSettings() }),
            });
            const j = await r.json();
            if (!r.ok || !j.success) {
                throw new Error(j.error || 'HTTP ' + r.status);
            }
            if (window.TM07_SETTINGS && window.TM07_SETTINGS.invalidate) {
                window.TM07_SETTINGS.invalidate();
            }
            setStatus(j.message || 'Сохранено на сервере', false);
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    }

    async function resetSettings() {
        if (!window.confirm('Сбросить настройки к встроенным умолчаниям?')) {
            return;
        }
        try {
            const r = await fetch('/api/admin-settings.php?action=reset', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            const j = await r.json();
            if (!r.ok || !j.success) {
                throw new Error(j.error || 'HTTP ' + r.status);
            }
            if (window.TM07_SETTINGS && window.TM07_SETTINGS.invalidate) {
                window.TM07_SETTINGS.invalidate();
            }
            await loadSettings();
            setStatus(j.message || 'Сброшено', false);
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    }

    /** Ключевые шаги паспорта счётчика (без S/N). */
    const COUNTER_PARAM_FIELDS = [
        { step: '100', label: 'Имя (п.100)' },
        { step: '101', label: 'Тип / G (п.101)' },
        { step: '105', label: 'DN (п.105)' },
        { step: '106', label: 'Имп/м³ (п.106)' },
        { step: '108', label: 'Чувств. (п.108)' },
        { step: '109', label: 'Qmin (п.109)' },
        { step: '110', label: 'Qnom (п.110)' },
        { step: '111', label: 'Qmax (п.111)' },
        { step: '112', label: 'Qt (п.112)' },
        { step: '113', label: 'ΔPmax (п.113)' },
        { step: '114', label: 'Pmax (п.114)' },
        { step: '115', label: 'Tгаз min (п.115)' },
        { step: '116', label: 'Tгаз max (п.116)' },
        { step: '117', label: 'Tокр min (п.117)' },
        { step: '118', label: 'Tокр max (п.118)' },
        { step: '121', label: 'Мех. max (п.121)' },
    ];

    function renderCounterParams(params) {
        const panel = $('admCounterParamsPanel');
        const grid = $('admCounterParamsGrid');
        if (!panel || !grid) {
            return;
        }
        const p = params && typeof params === 'object' ? params : {};
        const hasAny = COUNTER_PARAM_FIELDS.some(function (f) {
            return p[f.step] != null && String(p[f.step]).trim() !== '';
        });
        if (!hasAny) {
            panel.classList.add('d-none');
            grid.innerHTML = '';
            return;
        }
        panel.classList.remove('d-none');
        grid.innerHTML = COUNTER_PARAM_FIELDS.map(function (f) {
            const val = p[f.step] != null ? String(p[f.step]) : '';
            return (
                '<div class="col-6 col-md-3 col-lg-2">' +
                '<label class="form-label mb-0 small">' +
                escapeHtml(f.label) +
                '</label>' +
                '<input type="text" class="form-control form-control-sm adm-counter-param" data-step="' +
                f.step +
                '" value="' +
                escapeHtml(val) +
                '">' +
                '</div>'
            );
        }).join('');
    }

    function collectCounterParamsFromForm() {
        const out = Object.assign({}, pendingCounterParams || {});
        document.querySelectorAll('.adm-counter-param').forEach(function (inp) {
            const step = inp.getAttribute('data-step');
            if (!step) {
                return;
            }
            const v = String(inp.value || '').trim();
            if (v === '') {
                delete out[step];
            } else {
                out[step] = v;
            }
        });
        pendingCounterParams = out;
        return out;
    }

    function counterGqSummary(params) {
        if (!params || typeof params !== 'object') {
            return '—';
        }
        const g = params['101'] || '';
        const qmin = params['109'] || '';
        const qmax = params['111'] || '';
        const parts = [];
        if (g) {
            parts.push(String(g));
        }
        if (qmin || qmax) {
            parts.push((qmin || '…') + '–' + (qmax || '…') + ' м³/ч');
        }
        return parts.length ? parts.join(' · ') : '—';
    }

    function setCounterMsg(text, isError) {
        const el = $('admCounterMsg');
        if (!el) {
            return;
        }
        el.textContent = text || '';
        el.className = 'small align-self-center ' + (isError ? 'text-danger' : 'text-body-secondary');
    }

    async function loadCounters() {
        const tbody = $('admCountersTbody');
        const sel = $('counterSelectAdmin');
        try {
            const r = await fetch('/api/counters.php?action=list', { credentials: 'same-origin' });
            const j = await r.json();
            if (!j.success) {
                if (tbody) {
                    tbody.innerHTML =
                        '<tr><td colspan="4" class="text-danger">' +
                        (j.error || 'Ошибка списка') +
                        '</td></tr>';
                }
                return;
            }
            const list = j.counters || [];
            if (sel) {
                sel.innerHTML = '';
                list.forEach(function (c) {
                    const opt = document.createElement('option');
                    opt.value = String(c.id);
                    opt.textContent = c.name || '—';
                    sel.appendChild(opt);
                });
            }
            if (tbody) {
                if (!list.length) {
                    tbody.innerHTML =
                        '<tr><td colspan="4" class="text-body-secondary">Пока нет сохранённых типоразмеров</td></tr>';
                } else {
                    tbody.innerHTML = list
                        .map(function (c) {
                            const gq =
                                counterGqSummary(c.parameters) !== '—'
                                    ? counterGqSummary(c.parameters)
                                    : [c.typeCode, c.qmin || c.qmax ? (c.qmin || '…') + '–' + (c.qmax || '…') : '']
                                          .filter(Boolean)
                                          .join(' · ') || '—';
                            return (
                                '<tr>' +
                                '<td>' +
                                c.id +
                                '</td>' +
                                '<td>' +
                                escapeHtml(c.name || '—') +
                                '</td>' +
                                '<td class="small">' +
                                escapeHtml(gq) +
                                '</td>' +
                                '<td><button type="button" class="btn btn-link btn-sm p-0 adm-counter-pick" data-id="' +
                                c.id +
                                '">изменить</button></td>' +
                                '</tr>'
                            );
                        })
                        .join('');
                    tbody.querySelectorAll('.adm-counter-pick').forEach(function (btn) {
                        btn.addEventListener('click', function () {
                            void pickCounter(parseInt(btn.getAttribute('data-id') || '0', 10));
                        });
                    });
                }
            }
            setCounterMsg('Источник: ' + (j.source || 'sqlite') + ' · ' + list.length + ' шт.', false);
        } catch (e) {
            if (tbody) {
                tbody.innerHTML =
                    '<tr><td colspan="4" class="text-danger">' + escapeHtml(e.message || String(e)) + '</td></tr>';
            }
        }
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    async function pickCounter(id) {
        if (!id) {
            return;
        }
        try {
            const r = await fetch('/api/counters.php?action=get&id=' + id, { credentials: 'same-origin' });
            const j = await r.json();
            if (!j.success || !j.counter) {
                setCounterMsg(j.error || 'Не найден', true);
                return;
            }
            const c = j.counter;
            setVal('counter_id', c.id);
            setVal('counter_name', c.name);
            pendingCounterParams = c.parameters && typeof c.parameters === 'object' ? c.parameters : {};
            renderCounterParams(pendingCounterParams);
            syncMeterSelectsFromParams(pendingCounterParams);
            const hint = $('admCounterTypeHint');
            if (hint) {
                hint.textContent = counterGqSummary(pendingCounterParams);
            }
            setCounterMsg('Редактирование #' + c.id, false);
        } catch (e) {
            setCounterMsg(e.message || String(e), true);
        }
    }

    async function saveCounter() {
        const parameters = collectCounterParamsFromForm();
        const payload = {
            id: intVal('counter_id', 0) || undefined,
            name: strVal('counter_name'),
            serial: null,
            parameters: parameters,
        };
        if (!payload.name) {
            setCounterMsg('Выберите типоразмер (название пустое)', true);
            return;
        }
        if (!parameters || !Object.keys(parameters).length) {
            setCounterMsg('Выберите типоразмер в списках выше', true);
            return;
        }
        const r = await fetch('/api/counters.php?action=save', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const j = await r.json();
        if (!j.success) {
            setCounterMsg(j.error || 'Ошибка сохранения', true);
            return;
        }
        if (j.id) {
            setVal('counter_id', j.id);
        }
        setCounterMsg('Типоразмер сохранён', false);
        await loadCounters();
    }

    async function deleteCounter() {
        const id = intVal('counter_id', 0);
        if (!id || !window.confirm('Удалить типоразмер #' + id + '?')) {
            return;
        }
        const r = await fetch('/api/counters.php?action=delete&id=' + id, {
            method: 'POST',
            credentials: 'same-origin',
            body: '{}',
        });
        const j = await r.json();
        if (!j.success) {
            setCounterMsg(j.error || 'Ошибка удаления', true);
            return;
        }
        resetCounterForm();
        setCounterMsg('Удалено', false);
        await loadCounters();
    }

    function resetCounterForm() {
        const idEl = $('counter_id');
        if (idEl) {
            idEl.value = '';
        }
        const nameEl = $('counter_name');
        if (nameEl) {
            nameEl.value = '';
        }
        pendingCounterParams = {};
        renderCounterParams({});
        const hint = $('admCounterTypeHint');
        if (hint) {
            hint.textContent = '';
        }
    }

    function syncMeterSelectsFromParams(params) {
        // best-effort: match type code (п.101) in current family options
        const typeSel = $('admMeterType');
        const code = params && params['101'] != null ? String(params['101']) : '';
        if (!typeSel || !code) {
            return;
        }
        for (let i = 0; i < typeSel.options.length; i += 1) {
            const opt = typeSel.options[i];
            if (opt.value === code || (opt.textContent && opt.textContent.indexOf(code) === 0)) {
                typeSel.selectedIndex = i;
                break;
            }
        }
    }

    function initMeterSelects() {
        const famSel = $('admMeterFamily');
        const typeSel = $('admMeterType');
        const C = window.TM07_COMPLEX_METER_TYPES;
        if (!famSel || !typeSel || !C || typeof C.listStandaloneTemplates !== 'function') {
            if (famSel) {
                famSel.innerHTML = '<option value="">Справочник типов недоступен</option>';
            }
            return;
        }
        const fams = C.listStandaloneTemplates() || [];
        famSel.innerHTML = fams
            .map(function (f) {
                return (
                    '<option value="' +
                    escapeHtml(f.passport) +
                    '">' +
                    escapeHtml((f.designation || '') + ' · ' + (f.group || f.passport)) +
                    '</option>'
                );
            })
            .join('');
        function fillTypes() {
            const passport = famSel.value;
            const fam = fams.find(function (f) {
                return f.passport === passport;
            });
            const opts = (fam && fam.options) || [];
            typeSel.innerHTML = opts
                .map(function (o) {
                    return (
                        '<option value="' +
                        escapeHtml(o.typeId) +
                        '">' +
                        escapeHtml(o.text) +
                        '</option>'
                    );
                })
                .join('');
            applySelectedMeterType();
        }
        famSel.addEventListener('change', fillTypes);
        typeSel.addEventListener('change', function () {
            applySelectedMeterType();
        });
        fillTypes();
    }

    function applySelectedMeterType() {
        const C = window.TM07_COMPLEX_METER_TYPES;
        const passport = strVal('admMeterFamily');
        const typeId = strVal('admMeterType');
        if (!C || !passport || !typeId) {
            return;
        }
        const type = C.findTypeById ? C.findTypeById(passport, typeId) : null;
        if (!type) {
            setCounterMsg('Типоразмер не найден', true);
            return;
        }
        const steps = C.meterStepValues ? C.meterStepValues(passport, type) : {};
        pendingCounterParams = {};
        Object.keys(steps || {}).forEach(function (k) {
            const v = steps[k];
            if (v == null || String(v).trim() === '') {
                return;
            }
            pendingCounterParams[String(k)] = String(v);
        });
        const code = type.code || type.id || typeId;
        const famLabel = C.familyLabel ? C.familyLabel(passport) : passport;
        const typeSel = $('admMeterType');
        const typeText =
            typeSel && typeSel.selectedIndex >= 0
                ? String(typeSel.options[typeSel.selectedIndex].textContent || '').trim()
                : code;
        setVal('counter_name', (famLabel || passport) + ' · ' + (typeText || code));
        renderCounterParams(pendingCounterParams);
        const hint = $('admCounterTypeHint');
        if (hint) {
            hint.textContent = counterGqSummary(pendingCounterParams);
        }
        setCounterMsg('Типоразмер: ' + counterGqSummary(pendingCounterParams), false);
    }

    async function loadWorkstations() {
        const tbody = $('admWsTbody');
        if (!tbody) {
            return;
        }
        try {
            const r = await fetch('/api/bench-db-status.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'listWorkstations' }),
            });
            const j = await r.json();
            if (!j.ok) {
                tbody.innerHTML =
                    '<tr><td colspan="5" class="text-danger">' + escapeHtml(j.error || 'Ошибка') + '</td></tr>';
                return;
            }
            workstationsCache = j.workstations || [];
            if (!workstationsCache.length) {
                tbody.innerHTML =
                    '<tr><td colspan="5" class="text-body-secondary">Пока нет зарегистрированных ПК</td></tr>';
                return;
            }
            tbody.innerHTML = workstationsCache
                .map(function (w) {
                    return (
                        '<tr>' +
                        '<td>' +
                        escapeHtml(w.name || '—') +
                        '</td>' +
                        '<td><code class="small">' +
                        escapeHtml(w.code || '') +
                        '</code></td>' +
                        '<td>' +
                        escapeHtml(w.hostname || '') +
                        '</td>' +
                        '<td>' +
                        (w.isActive ? 'да' : 'нет') +
                        (w.deviceUsb ? ' · USB' : '') +
                        '</td>' +
                        '<td><button type="button" class="btn btn-link btn-sm p-0 adm-ws-edit" data-id="' +
                        w.id +
                        '">настроить</button></td>' +
                        '</tr>'
                    );
                })
                .join('');
            tbody.querySelectorAll('.adm-ws-edit').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    openWsEditor(parseInt(btn.getAttribute('data-id') || '0', 10));
                });
            });
        } catch (e) {
            tbody.innerHTML =
                '<tr><td colspan="5" class="text-danger">' + escapeHtml(e.message || String(e)) + '</td></tr>';
        }
    }

    function openWsEditor(id) {
        const w = workstationsCache.find(function (x) {
            return Number(x.id) === id;
        });
        const box = $('admWsEditor');
        if (!w || !box) {
            return;
        }
        box.classList.remove('d-none');
        setVal('adm_ws_id', w.id);
        setVal('adm_ws_name', w.name || '');
        const active = $('adm_ws_active');
        if (active) {
            active.checked = w.isActive !== false;
        }
        const usb = w.deviceUsb || {};
        setVal('adm_ws_vid', usb.vendorIdHex || '');
        setVal('adm_ws_tm07_pid', usb.tm07ProductIdHex || '');
        setVal('adm_ws_mit_pid', usb.mitProductIdHex || '');
        setVal('adm_ws_pkd_pid', usb.pkdProductIdHex || '');
        setVal('adm_ws_kao_sn', usb.kaoSerialNumber || '');
        const title = $('admWsEditorTitle');
        if (title) {
            title.textContent = 'Стенд #' + w.id + ' · ' + (w.code || '');
        }
        const msg = $('admWsMsg');
        if (msg) {
            msg.textContent = '';
        }
    }

    async function saveWorkstation() {
        const id = intVal('adm_ws_id', 0);
        const msg = $('admWsMsg');
        if (!id) {
            return;
        }
        const deviceUsb = {
            vendorIdHex: strVal('adm_ws_vid'),
            tm07ProductIdHex: strVal('adm_ws_tm07_pid'),
            mitProductIdHex: strVal('adm_ws_mit_pid'),
            pkdProductIdHex: strVal('adm_ws_pkd_pid'),
            kaoSerialNumber: strVal('adm_ws_kao_sn'),
        };
        const hasUsb = Object.keys(deviceUsb).some(function (k) {
            return deviceUsb[k];
        });
        const body = {
            action: 'updateWorkstation',
            id: id,
            name: strVal('adm_ws_name'),
            isActive: !!( $('adm_ws_active') && $('adm_ws_active').checked ),
            deviceUsb: hasUsb ? deviceUsb : null,
        };
        try {
            const r = await fetch('/api/bench-db-status.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await r.json();
            if (!j.ok) {
                if (msg) {
                    msg.textContent = j.error || 'Ошибка';
                    msg.className = 'small text-danger align-self-center';
                }
                return;
            }
            if (window.TM07_SETTINGS && window.TM07_SETTINGS.invalidate) {
                window.TM07_SETTINGS.invalidate();
            }
            if (msg) {
                msg.textContent = 'Сохранено';
                msg.className = 'small text-success align-self-center';
            }
            await loadWorkstations();
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger align-self-center';
            }
        }
    }

    function fmtSize(n) {
        const x = Number(n) || 0;
        if (x < 1024) {
            return x + ' B';
        }
        if (x < 1024 * 1024) {
            return (x / 1024).toFixed(1) + ' KB';
        }
        return (x / (1024 * 1024)).toFixed(2) + ' MB';
    }

    async function loadFirmware() {
        const tbody = $('admFwTbody');
        if (!tbody) {
            return;
        }
        try {
            const r = await fetch('/api/tm07-firmware.php?action=list', { credentials: 'same-origin' });
            const j = await r.json();
            if (!j.ok) {
                tbody.innerHTML =
                    '<tr><td colspan="4" class="text-danger">' + escapeHtml(j.error || 'Ошибка') + '</td></tr>';
                return;
            }
            const files = j.files || [];
            if (!files.length) {
                tbody.innerHTML =
                    '<tr><td colspan="4" class="text-body-secondary">Нет .bin в папках прошивок</td></tr>';
                return;
            }
            tbody.innerHTML = files
                .map(function (f) {
                    return (
                        '<tr>' +
                        '<td><code class="small">' +
                        escapeHtml(f.name) +
                        '</code></td>' +
                        '<td>' +
                        escapeHtml(f.versionTag || f.version || '—') +
                        '</td>' +
                        '<td>' +
                        fmtSize(f.size) +
                        '</td>' +
                        '<td><button type="button" class="btn btn-link btn-sm text-danger p-0 adm-fw-del" data-name="' +
                        escapeHtml(f.name) +
                        '">удалить</button></td>' +
                        '</tr>'
                    );
                })
                .join('');
            tbody.querySelectorAll('.adm-fw-del').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    void deleteFirmware(btn.getAttribute('data-name') || '');
                });
            });
        } catch (e) {
            tbody.innerHTML =
                '<tr><td colspan="4" class="text-danger">' + escapeHtml(e.message || String(e)) + '</td></tr>';
        }
    }

    async function uploadFirmware() {
        const input = $('admFwFile');
        const msg = $('admFwMsg');
        if (!input || !input.files || !input.files[0]) {
            if (msg) {
                msg.textContent = 'Выберите файл .bin';
                msg.className = 'small text-danger mt-2 mb-0';
            }
            return;
        }
        const fd = new FormData();
        fd.append('file', input.files[0]);
        try {
            const r = await fetch('/api/tm07-firmware.php?action=upload', {
                method: 'POST',
                credentials: 'same-origin',
                body: fd,
            });
            const j = await r.json();
            if (!j.ok) {
                if (msg) {
                    msg.textContent = j.error || 'Ошибка загрузки';
                    msg.className = 'small text-danger mt-2 mb-0';
                }
                return;
            }
            if (msg) {
                msg.textContent = 'Загружено: ' + ((j.file && j.file.name) || '');
                msg.className = 'small text-success mt-2 mb-0';
            }
            input.value = '';
            await loadFirmware();
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger mt-2 mb-0';
            }
        }
    }

    async function deleteFirmware(name) {
        if (!name || !window.confirm('Удалить ' + name + '? (только из data/firmware)')) {
            return;
        }
        const msg = $('admFwMsg');
        try {
            const r = await fetch('/api/tm07-firmware.php?action=delete', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name }),
            });
            const j = await r.json();
            if (!j.ok) {
                if (msg) {
                    msg.textContent = j.error || 'Не удалось удалить';
                    msg.className = 'small text-danger mt-2 mb-0';
                }
                return;
            }
            if (msg) {
                msg.textContent = 'Удалено';
                msg.className = 'small text-body-secondary mt-2 mb-0';
            }
            await loadFirmware();
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger mt-2 mb-0';
            }
        }
    }

    async function loadOperators() {
        const tbody = $('admOperatorsTbody');
        if (!tbody) {
            return;
        }
        try {
            const r = await fetch('/api/bench-db-status.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'listOperators' }),
            });
            const j = await r.json();
            if (!j.ok) {
                tbody.innerHTML =
                    '<tr><td colspan="5" class="text-danger">' + escapeHtml(j.error || 'Ошибка') + '</td></tr>';
                return;
            }
            const ops = j.operators || [];
            if (!ops.length) {
                tbody.innerHTML =
                    '<tr><td colspan="5" class="text-body-secondary">Нет операторов</td></tr>';
                return;
            }
            tbody.innerHTML = ops
                .map(function (op) {
                    return (
                        '<tr>' +
                        '<td>' +
                        escapeHtml(op.lastName || '') +
                        '</td>' +
                        '<td>' +
                        escapeHtml(op.firstName || '') +
                        '</td>' +
                        '<td><code class="small">' +
                        escapeHtml(op.login || '') +
                        '</code></td>' +
                        '<td>' +
                        (op.hasPin ? 'да' : 'нет') +
                        '</td>' +
                        '<td class="text-nowrap">' +
                        '<button type="button" class="btn btn-link btn-sm p-0 me-2 adm-op-enter" data-login="' +
                        escapeHtml(op.login || '') +
                        '" title="Войти как оператор (без PIN)">Войти</button>' +
                        '<button type="button" class="btn btn-link btn-sm p-0 me-2 adm-op-pick" data-login="' +
                        escapeHtml(op.login || '') +
                        '" data-last="' +
                        escapeHtml(op.lastName || '') +
                        '" data-first="' +
                        escapeHtml(op.firstName || '') +
                        '">PIN</button>' +
                        '<button type="button" class="btn btn-link btn-sm text-danger p-0 adm-op-del" data-id="' +
                        op.id +
                        '" data-name="' +
                        escapeHtml(op.displayName || '') +
                        '">удалить</button>' +
                        '</td>' +
                        '</tr>'
                    );
                })
                .join('');
            tbody.querySelectorAll('.adm-op-enter').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    void enterAsOperator(btn.getAttribute('data-login') || '');
                });
            });
            tbody.querySelectorAll('.adm-op-pick').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    setVal('adm_op_login', btn.getAttribute('data-login') || '');
                    setVal('adm_op_last', btn.getAttribute('data-last') || '');
                    setVal('adm_op_first', btn.getAttribute('data-first') || '');
                    const pin = $('adm_op_pin');
                    if (pin) {
                        pin.focus();
                    }
                });
            });
            tbody.querySelectorAll('.adm-op-del').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    void deleteOperatorById(
                        parseInt(btn.getAttribute('data-id') || '0', 10),
                        btn.getAttribute('data-name') || ''
                    );
                });
            });
        } catch (e) {
            tbody.innerHTML =
                '<tr><td colspan="5" class="text-danger">' + escapeHtml(e.message || String(e)) + '</td></tr>';
        }
    }

    async function deleteOperatorById(operatorId, displayName) {
        if (!operatorId || !window.confirm('Удалить оператора «' + displayName + '»?')) {
            return;
        }
        const r = await fetch('/api/bench-db-status.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'deleteOperator', operatorId: operatorId }),
        });
        const j = await r.json();
        const msg = $('admOpPinMsg');
        if (!j.ok) {
            if (msg) {
                msg.textContent = j.error || 'Ошибка';
                msg.className = 'small text-danger mt-2 mb-0';
            }
            return;
        }
        if (msg) {
            msg.textContent = 'Оператор удалён';
            msg.className = 'small text-body-secondary mt-2 mb-0';
        }
        await loadOperators();
    }

    async function deleteAllSessionsAdmin() {
        if (!window.confirm('Удалить ВСЕ сессии заказов?')) {
            return;
        }
        const msg = $('admSessionsMsg');
        try {
            const r = await fetch('/api/bench-db-status.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'deleteAllSessions' }),
            });
            const j = await r.json();
            if (!j.ok) {
                if (msg) {
                    msg.textContent = j.error || 'Ошибка';
                    msg.className = 'small text-danger';
                }
                return;
            }
            if (msg) {
                msg.textContent = 'Удалено: ' + (j.deleted != null ? j.deleted : 'ok');
                msg.className = 'small text-success';
            }
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger';
            }
        }
    }

    function formatSerialIssuedAt(raw) {
        if (!raw) {
            return '—';
        }
        try {
            const d = new Date(raw);
            if (Number.isNaN(d.getTime())) {
                return String(raw);
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
            return String(raw);
        }
    }

    async function loadIssuedSerials(query) {
        const body = $('admSerialsBody');
        const msg = $('admSerialsMsg');
        if (body) {
            body.innerHTML = '<tr><td colspan="5" class="text-body-secondary">Загрузка…</td></tr>';
        }
        try {
            const r = await fetch('/api/bench-db-status.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'listSerials',
                    limit: 80,
                    q: query != null ? String(query) : strVal('admSerialQuery'),
                }),
            });
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка загрузки');
            }
            const list = Array.isArray(j.serials) ? j.serials : [];
            if (!body) {
                return;
            }
            if (!list.length) {
                body.innerHTML =
                    '<tr><td colspan="5" class="text-body-secondary">Нет записей</td></tr>';
                if (msg) {
                    msg.textContent = '';
                }
                return;
            }
            body.innerHTML = list
                .map(function (s) {
                    const sn = escapeHtml(s.serial || '');
                    const kind =
                        s.kind === 'complex'
                            ? 'комплекс'
                            : s.kind === 'corrector'
                              ? 'корректор'
                              : escapeHtml(s.kind || '—');
                    return (
                        '<tr>' +
                        '<td class="font-monospace fw-semibold">' +
                        sn +
                        '</td>' +
                        '<td>' +
                        kind +
                        '</td>' +
                        '<td class="font-monospace">' +
                        escapeHtml(s.orderNumber || '—') +
                        '</td>' +
                        '<td class="text-nowrap">' +
                        escapeHtml(formatSerialIssuedAt(s.issuedAt)) +
                        '</td>' +
                        '<td class="text-end">' +
                        '<button type="button" class="btn btn-outline-danger btn-sm" data-delete-serial="' +
                        sn +
                        '" title="Удалить из базы"><i class="bi bi-trash"></i></button>' +
                        '</td>' +
                        '</tr>'
                    );
                })
                .join('');
            if (msg) {
                msg.textContent = 'Показано: ' + list.length;
                msg.className = 'small text-body-secondary';
            }
        } catch (e) {
            if (body) {
                body.innerHTML =
                    '<tr><td colspan="5" class="text-danger">' +
                    escapeHtml(e.message || String(e)) +
                    '</td></tr>';
            }
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger';
            }
        }
    }

    async function deleteIssuedSerial(serial) {
        const sn = String(serial || '').trim();
        if (!sn) {
            return;
        }
        if (!window.confirm('Удалить серийный номер ' + sn + ' из базы?')) {
            return;
        }
        const msg = $('admSerialsMsg');
        try {
            const r = await fetch('/api/bench-db-status.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'deleteSerial', serial: sn }),
            });
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка удаления');
            }
            if (msg) {
                msg.textContent =
                    'Удалён ' +
                    (j.serial || sn) +
                    (j.clearedSessions ? ', сессий очищено: ' + j.clearedSessions : '') +
                    (j.clearedSensors ? ', датчиков: ' + j.clearedSensors : '');
                msg.className = 'small text-success';
            }
            await loadIssuedSerials(strVal('admSerialQuery'));
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger';
            }
        }
    }

    async function enterAsOperator(login) {
        const msg = $('admOpPinMsg');
        if (!login) {
            if (msg) {
                msg.textContent = 'У оператора нет логина';
                msg.className = 'small text-danger mt-2 mb-0';
            }
            return;
        }
        try {
            const r = await fetch('/api/bench-db-status.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'adminSelectOperator', login: login }),
            });
            const j = await r.json();
            if (!j.ok) {
                if (msg) {
                    msg.textContent = j.error || 'Ошибка';
                    msg.className = 'small text-danger mt-2 mb-0';
                }
                return;
            }
            if (msg) {
                msg.textContent = 'Вошли как оператор: ' + (j.operator && (j.operator.displayName || j.operator.login) || login);
                msg.className = 'small text-success mt-2 mb-0';
            }
            window.dispatchEvent(new CustomEvent('tm07-operator-changed'));
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger mt-2 mb-0';
            }
        }
    }

    async function saveOperatorPin() {
        const msg = $('admOpPinMsg');
        const body = {
            action: 'setOperatorPin',
            login: strVal('adm_op_login'),
            lastName: strVal('adm_op_last'),
            firstName: strVal('adm_op_first'),
            pin: strVal('adm_op_pin'),
        };
        if (!body.lastName || !body.pin) {
            if (msg) {
                msg.textContent = 'Нужны фамилия и PIN';
                msg.className = 'small text-danger mt-2 mb-0';
            }
            return;
        }
        try {
            const r = await fetch('/api/bench-db-status.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await r.json();
            if (!j.ok) {
                if (msg) {
                    msg.textContent = j.error || 'Ошибка';
                    msg.className = 'small text-danger mt-2 mb-0';
                }
                return;
            }
            if (msg) {
                msg.textContent = 'PIN сохранён';
                msg.className = 'small text-success mt-2 mb-0';
            }
            const pin = $('adm_op_pin');
            if (pin) {
                pin.value = '';
            }
            await loadOperators();
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger mt-2 mb-0';
            }
        }
    }

    let admDbOffset = 0;

    function setDbMsg(text, isError) {
        const el = $('admDbMsg');
        if (!el) {
            return;
        }
        el.textContent = text || '';
        el.className = 'small mb-2 ' + (isError ? 'text-danger' : 'text-body-secondary');
    }

    async function loadDbOverview() {
        const cards = $('admDbTableCards');
        const sel = $('admDbTableSelect');
        try {
            const r = await fetch('/api/admin-db-browse.php?action=overview', {
                credentials: 'same-origin',
            });
            const j = await r.json();
            if (!j.ok) {
                if (r.status === 401 || j.success === false) {
                    window.location.href = '/login.html';
                    return;
                }
                setDbMsg(j.error || 'Ошибка overview', true);
                return;
            }
            const drv = $('admDbDriver');
            if (drv) {
                drv.textContent = 'драйвер: ' + (j.driver || '—');
            }
            const tables = j.tables || [];
            if (cards) {
                cards.innerHTML = tables
                    .map(function (t) {
                        const n = t.count < 0 ? '?' : String(t.count);
                        return (
                            '<div class="col-6 col-md-3 col-lg-2">' +
                            '<button type="button" class="btn btn-outline-secondary btn-sm w-100 text-start adm-db-card" data-table="' +
                            escapeHtml(t.name) +
                            '">' +
                            '<div class="fw-semibold text-truncate">' +
                            escapeHtml(t.name.replace(/^TM07_/, '')) +
                            '</div>' +
                            '<div class="text-body-secondary">' +
                            n +
                            ' строк</div>' +
                            '</button></div>'
                        );
                    })
                    .join('');
                cards.querySelectorAll('.adm-db-card').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        const name = btn.getAttribute('data-table') || '';
                        if (sel) {
                            sel.value = name;
                        }
                        admDbOffset = 0;
                        void loadDbBrowse();
                    });
                });
            }
            if (sel) {
                const prev = sel.value;
                sel.innerHTML = tables
                    .map(function (t) {
                        return (
                            '<option value="' +
                            escapeHtml(t.name) +
                            '">' +
                            escapeHtml(t.name) +
                            ' (' +
                            (t.count < 0 ? '?' : t.count) +
                            ')</option>'
                        );
                    })
                    .join('');
                if (prev && tables.some(function (t) {
                    return t.name === prev;
                })) {
                    sel.value = prev;
                }
            }
            if (sel && sel.value) {
                void loadDbBrowse();
            } else {
                setDbMsg('Выберите таблицу или карточку выше', false);
            }
        } catch (e) {
            setDbMsg(e.message || String(e), true);
        }
    }

    async function loadDbBrowse() {
        const sel = $('admDbTableSelect');
        const thead = $('admDbThead');
        const tbody = $('admDbTbody');
        const pager = $('admDbPager');
        if (!sel || !sel.value) {
            return;
        }
        const limit = intVal('admDbLimit', 50);
        const table = sel.value;
        setDbMsg('Загрузка ' + table + '…', false);
        try {
            const url =
                '/api/admin-db-browse.php?action=browse&table=' +
                encodeURIComponent(table) +
                '&limit=' +
                limit +
                '&offset=' +
                admDbOffset;
            const r = await fetch(url, { credentials: 'same-origin' });
            const j = await r.json();
            if (!j.ok) {
                setDbMsg(j.error || 'Ошибка browse', true);
                return;
            }
            const cols = j.columns || [];
            const rows = j.rows || [];
            if (thead) {
                thead.innerHTML =
                    '<tr>' +
                    cols
                        .map(function (c) {
                            return '<th class="text-nowrap">' + escapeHtml(c) + '</th>';
                        })
                        .join('') +
                    '</tr>';
            }
            if (tbody) {
                if (!rows.length) {
                    tbody.innerHTML =
                        '<tr><td colspan="' +
                        Math.max(1, cols.length) +
                        '" class="text-body-secondary">Пусто</td></tr>';
                } else {
                    tbody.innerHTML = rows
                        .map(function (row) {
                            return (
                                '<tr>' +
                                cols
                                    .map(function (c) {
                                        let v = row[c];
                                        if (v == null) {
                                            v = '';
                                        } else if (typeof v === 'object') {
                                            v = JSON.stringify(v);
                                        }
                                        return (
                                            '<td class="small text-break" style="max-width:14rem;">' +
                                            escapeHtml(String(v)) +
                                            '</td>'
                                        );
                                    })
                                    .join('') +
                                '</tr>'
                            );
                        })
                        .join('');
                }
            }
            const total = Number(j.total) || 0;
            const from = total === 0 ? 0 : admDbOffset + 1;
            const to = Math.min(admDbOffset + rows.length, total);
            if (pager) {
                pager.textContent = from + '–' + to + ' из ' + total;
            }
            setDbMsg(table + ' · показано ' + rows.length, false);
        } catch (e) {
            setDbMsg(e.message || String(e), true);
        }
    }

    async function loadSensorBindings(query) {
        const tbody = $('admSensorTbody');
        const msg = $('admSensorMsg');
        const q = query != null ? String(query).trim() : strVal('admSensorQuery');
        if (!tbody) {
            return;
        }
        tbody.innerHTML = '<tr><td colspan="6" class="text-body-secondary">Загрузка…</td></tr>';
        try {
            let url = '/api/tm07-sensor-bind.php?action=list&limit=200';
            if (q) {
                // Точный поиск по корректору или датчику, иначе list?q=
                if (/^\d{10}$/.test(q) && q.indexOf('300') === 0) {
                    url = '/api/tm07-sensor-bind.php?action=byCorrector&serial=' + encodeURIComponent(q);
                } else if (/^\d{10}$/.test(q) && q.indexOf('400') === 0) {
                    url = '/api/tm07-sensor-bind.php?action=list&q=' + encodeURIComponent(q);
                } else if (q.length >= 3 && !/^(DA|DT|DD|TT)$/i.test(q)) {
                    // сначала bySensor
                    const r1 = await fetch(
                        '/api/tm07-sensor-bind.php?action=bySensor&serial=' + encodeURIComponent(q),
                        { credentials: 'same-origin' }
                    );
                    const j1 = await r1.json();
                    if (j1.ok && j1.found && j1.binding) {
                        renderSensorBindings([j1.binding], 'Датчик → корректор ' + j1.binding.serialCorrector);
                        return;
                    }
                    url = '/api/tm07-sensor-bind.php?action=list&q=' + encodeURIComponent(q);
                } else {
                    url = '/api/tm07-sensor-bind.php?action=list&q=' + encodeURIComponent(q);
                }
            }
            const r = await fetch(url, { credentials: 'same-origin' });
            const j = await r.json();
            if (!j.ok) {
                if (r.status === 401) {
                    window.location.href = '/login.html';
                    return;
                }
                tbody.innerHTML =
                    '<tr><td colspan="6" class="text-danger">' + escapeHtml(j.error || 'Ошибка') + '</td></tr>';
                return;
            }
            const list = j.sensors || j.bindings || [];
            renderSensorBindings(list, q ? 'Найдено: ' + list.length : 'Всего показано: ' + list.length);
        } catch (e) {
            tbody.innerHTML =
                '<tr><td colspan="6" class="text-danger">' + escapeHtml(e.message || String(e)) + '</td></tr>';
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger mb-2';
            }
        }
    }

    function renderSensorBindings(list, statusText) {
        const tbody = $('admSensorTbody');
        const msg = $('admSensorMsg');
        if (msg) {
            msg.textContent = statusText || '';
            msg.className = 'small text-body-secondary mb-2';
        }
        if (!tbody) {
            return;
        }
        if (!list.length) {
            tbody.innerHTML =
                '<tr><td colspan="6" class="text-body-secondary">Нет привязок</td></tr>';
            return;
        }
        tbody.innerHTML = list
            .map(function (b) {
                const id = b.id != null ? String(b.id) : '';
                return (
                    '<tr>' +
                    '<td><code>' +
                    escapeHtml(b.serialCorrector || '') +
                    '</code></td>' +
                    '<td>' +
                    escapeHtml(b.channel || '') +
                    '</td>' +
                    '<td><code>' +
                    escapeHtml(b.sensorSerial || '') +
                    '</code></td>' +
                    '<td>' +
                    escapeHtml(b.orderNumber || '—') +
                    '</td>' +
                    '<td class="small">' +
                    escapeHtml(b.createdAt || b.updatedAt || '') +
                    '</td>' +
                    '<td class="text-end">' +
                    (id
                        ? '<button type="button" class="btn btn-outline-danger btn-sm" data-unbind-sensor="' +
                          escapeHtml(id) +
                          '" title="Отвязать"><i class="bi bi-unlink"></i></button>'
                        : '') +
                    '</td>' +
                    '</tr>'
                );
            })
            .join('');
    }

    async function unbindSensor(id) {
        if (!id || !window.confirm('Отвязать датчик #' + id + '?')) {
            return;
        }
        const msg = $('admSensorMsg');
        try {
            const r = await fetch('/api/tm07-sensor-bind.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'unbind', id: parseInt(id, 10) }),
            });
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            if (msg) {
                msg.textContent = 'Отвязано';
                msg.className = 'small text-success mb-2';
            }
            await loadSensorBindings(strVal('admSensorQuery'));
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger mb-2';
            }
        }
    }

    function formatAdminDt(raw) {
        if (!raw) {
            return '—';
        }
        try {
            const d = new Date(raw);
            if (Number.isNaN(d.getTime())) {
                return String(raw);
            }
            return d.toLocaleString('ru-RU', {
                timeZone: 'Europe/Moscow',
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch (_e) {
            return String(raw);
        }
    }

    async function loadAdminSessions() {
        const body = $('admSessionsBody');
        const msg = $('admSessionsMsg');
        if (!body) {
            return;
        }
        body.innerHTML = '<tr><td colspan="8" class="text-body-secondary">Загрузка…</td></tr>';
        try {
            const filter = ($('admSessionsFilter') || {}).value || 'all';
            let url = '/api/bench-db-status.php?action=sessions&limit=80';
            if (filter === 'active' || filter === 'closed') {
                url += '&state=' + encodeURIComponent(filter);
            }
            const r = await fetch(url, { credentials: 'same-origin' });
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            const list = Array.isArray(j.sessions) ? j.sessions : [];
            if (!list.length) {
                body.innerHTML =
                    '<tr><td colspan="8" class="text-body-secondary">Нет сессий</td></tr>';
                return;
            }
            body.innerHTML = list
                .map(function (s) {
                    const op = s.operator || {};
                    const opLabel =
                        op.lastName || op.displayName || op.login || '—';
                    return (
                        '<tr>' +
                        '<td class="font-monospace">' +
                        escapeHtml(String(s.id || '')) +
                        '</td>' +
                        '<td class="font-monospace fw-semibold">' +
                        escapeHtml(s.orderNumber || '—') +
                        '</td>' +
                        '<td>' +
                        escapeHtml(s.state || '—') +
                        '</td>' +
                        '<td>' +
                        escapeHtml(s.sessionStageLabel || s.sessionStage || '—') +
                        '</td>' +
                        '<td class="font-monospace">' +
                        escapeHtml(s.serialCorrector || '—') +
                        '</td>' +
                        '<td>' +
                        escapeHtml(opLabel) +
                        '</td>' +
                        '<td class="text-nowrap">' +
                        escapeHtml(formatAdminDt(s.openedAt)) +
                        '</td>' +
                        '<td class="text-end text-nowrap">' +
                        '<a class="btn btn-outline-primary btn-sm me-1" href="' +
                        escapeHtml(s.resumeUrl || '/tm07-workbench.html') +
                        '">Открыть</a>' +
                        '<button type="button" class="btn btn-outline-danger btn-sm" data-delete-session="' +
                        escapeHtml(String(s.id || '')) +
                        '"><i class="bi bi-trash"></i></button>' +
                        '</td>' +
                        '</tr>'
                    );
                })
                .join('');
            if (msg) {
                msg.textContent = 'Показано: ' + list.length;
                msg.className = 'small text-body-secondary';
            }
        } catch (e) {
            body.innerHTML =
                '<tr><td colspan="8" class="text-danger">' +
                escapeHtml(e.message || String(e)) +
                '</td></tr>';
        }
    }

    async function deleteAdminSession(sessionId) {
        if (!sessionId || !window.confirm('Удалить сессию #' + sessionId + '?')) {
            return;
        }
        const msg = $('admSessionsMsg');
        try {
            const r = await fetch('/api/bench-db-status.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'deleteSession', sessionId: parseInt(sessionId, 10) }),
            });
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            if (msg) {
                msg.textContent = 'Сессия #' + sessionId + ' удалена';
                msg.className = 'small text-success';
            }
            await loadAdminSessions();
            await loadAdminHealth();
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger';
            }
        }
    }

    async function closeStaleSessionsAdmin() {
        const hours = intVal('admStaleHours', 8);
        if (!window.confirm('Закрыть active-сессии старше ' + hours + ' ч.?')) {
            return;
        }
        const msg = $('admSessionsMsg');
        try {
            const r = await fetch('/api/bench-db-status.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'closeStaleSessions', olderThanHours: hours }),
            });
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            if (msg) {
                msg.textContent = 'Закрыто: ' + (j.closed != null ? j.closed : 0);
                msg.className = 'small text-success';
            }
            await loadAdminSessions();
            await loadAdminHealth();
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger';
            }
        }
    }

    async function loadSerialCounters() {
        const body = $('admSerialCountersBody');
        if (!body) {
            return;
        }
        try {
            const r = await fetch('/api/admin-ops.php?action=serialCounters', {
                credentials: 'same-origin',
            });
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            const list = Array.isArray(j.counters) ? j.counters : [];
            if (!list.length) {
                body.innerHTML =
                    '<tr><td colspan="5" class="text-body-secondary">Пусто</td></tr>';
                return;
            }
            body.innerHTML = list
                .map(function (c) {
                    return (
                        '<tr data-prefix="' +
                        escapeHtml(c.prefix) +
                        '" data-month="' +
                        escapeHtml(c.monthKey) +
                        '">' +
                        '<td class="font-monospace">' +
                        escapeHtml(c.prefix) +
                        '</td>' +
                        '<td class="font-monospace">' +
                        escapeHtml(c.monthKey) +
                        '</td>' +
                        '<td><input type="number" class="form-control form-control-sm" style="max-width:7rem" data-seq-input value="' +
                        escapeHtml(String(c.lastSeq)) +
                        '" min="0"></td>' +
                        '<td class="font-monospace fw-semibold">' +
                        escapeHtml(String(c.nextSeq != null ? c.nextSeq : '—')) +
                        '</td>' +
                        '<td class="text-end"><button type="button" class="btn btn-outline-primary btn-sm" data-save-seq>Сохранить</button></td>' +
                        '</tr>'
                    );
                })
                .join('');
        } catch (e) {
            body.innerHTML =
                '<tr><td colspan="5" class="text-danger">' +
                escapeHtml(e.message || String(e)) +
                '</td></tr>';
        }
    }

    async function saveSerialCounter(prefix, monthKey, lastSeq) {
        const msg = $('admSerialCountersMsg');
        try {
            const r = await fetch('/api/admin-ops.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'setSerialCounter',
                    prefix: prefix,
                    monthKey: monthKey,
                    lastSeq: lastSeq,
                }),
            });
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            if (msg) {
                msg.textContent =
                    'Сохранено ' + prefix + '/' + monthKey + ' = ' + lastSeq;
                msg.className = 'small text-success';
            }
            await loadSerialCounters();
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger';
            }
        }
    }

    async function loadAdminEvents() {
        const body = $('admEventsBody');
        const msg = $('admEventsMsg');
        if (!body) {
            return;
        }
        body.innerHTML = '<tr><td colspan="6" class="text-body-secondary">Загрузка…</td></tr>';
        try {
            const q = new URLSearchParams({ action: 'list', limit: '80' });
            const sn = strVal('admEventsSerial');
            const stage = strVal('admEventsStage');
            if (sn) {
                q.set('serialCorrector', sn);
            }
            if (stage) {
                q.set('stage', stage);
            }
            const r = await fetch('/api/bench-events.php?' + q.toString(), {
                credentials: 'same-origin',
            });
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            const list = Array.isArray(j.events) ? j.events : [];
            if (!list.length) {
                body.innerHTML =
                    '<tr><td colspan="6" class="text-body-secondary">Нет событий</td></tr>';
                return;
            }
            body.innerHTML = list
                .map(function (ev) {
                    const op = ev.operator || {};
                    const ws = ev.workstation || {};
                    return (
                        '<tr>' +
                        '<td class="text-nowrap">' +
                        escapeHtml(formatAdminDt(ev.createdAt)) +
                        '</td>' +
                        '<td>' +
                        escapeHtml(ev.eventName || ev.eventType || '—') +
                        '</td>' +
                        '<td>' +
                        escapeHtml(ev.stage || '—') +
                        '</td>' +
                        '<td class="font-monospace">' +
                        escapeHtml(ev.serialCorrector || ev.serialComplex || '—') +
                        '</td>' +
                        '<td>' +
                        escapeHtml(op.displayName || op.login || '—') +
                        '</td>' +
                        '<td>' +
                        escapeHtml(ws.name || ws.code || '—') +
                        '</td>' +
                        '</tr>'
                    );
                })
                .join('');
            if (msg) {
                msg.textContent = 'Показано: ' + list.length;
            }
        } catch (e) {
            body.innerHTML =
                '<tr><td colspan="6" class="text-danger">' +
                escapeHtml(e.message || String(e)) +
                '</td></tr>';
        }
    }

    async function loadParamReport() {
        const box = $('admParamResults');
        const msg = $('admParamMsg');
        if (!box) {
            return;
        }
        const q = strVal('admParamQuery');
        if (!q) {
            if (msg) {
                msg.textContent = 'Введите S/N или номер заказа';
                msg.className = 'small text-warning';
            }
            return;
        }
        box.innerHTML = '<div class="text-body-secondary">Поиск…</div>';
        if (msg) {
            msg.textContent = '';
            msg.className = 'small text-body-secondary';
        }
        try {
            const r = await fetch(
                '/api/admin-ops.php?action=paramReport&q=' + encodeURIComponent(q),
                { credentials: 'same-origin' }
            );
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            const reports = Array.isArray(j.reports) ? j.reports : [];
            if (!reports.length) {
                box.innerHTML =
                    '<div class="text-body-secondary">Ничего не найдено по «' +
                    escapeHtml(q) +
                    '». Сверки появляются после записи параметров в корректор.</div>';
                return;
            }
            if (msg) {
                msg.textContent = 'Найдено сверок: ' + reports.length;
            }
            box.innerHTML = reports
                .map(function (rep, idx) {
                    const op = rep.orderPayload || {};
                    const row = op.row || {};
                    const title =
                        String(row['НаименованиеПолное_Номенклатуры'] || '').trim() ||
                        String(op.orderTextBlob || '').trim().slice(0, 120) ||
                        '';
                    const params = Array.isArray(rep.params) ? rep.params : [];
                    const mismatchOnlyId = 'admParamMismatchOnly_' + idx;
                    const tableId = 'admParamTable_' + idx;
                    let paramsHtml;
                    if (!params.length) {
                        paramsHtml =
                            '<div class="alert alert-warning py-2 mb-0">' +
                            escapeHtml(rep.hint || 'Нет снимка параметров в этом событии.') +
                            '</div>';
                    } else {
                        paramsHtml =
                            '<div class="form-check mb-2">' +
                            '<input class="form-check-input" type="checkbox" id="' +
                            mismatchOnlyId +
                            '" data-param-filter="' +
                            tableId +
                            '">' +
                            '<label class="form-check-label" for="' +
                            mismatchOnlyId +
                            '">Только расхождения</label>' +
                            '</div>' +
                            '<div class="table-responsive border rounded" style="max-height:22rem">' +
                            '<table class="table table-sm table-hover align-middle mb-0" id="' +
                            tableId +
                            '">' +
                            '<thead class="table-light sticky-top"><tr>' +
                            '<th>п.</th><th>Параметр</th><th>В заказе</th><th>В корректоре</th><th></th>' +
                            '</tr></thead><tbody>' +
                            params
                                .map(function (p) {
                                    const ok = !!p.ok;
                                    const compared = p.compared !== false;
                                    const rowClass = compared && !ok ? ' class="table-danger"' : '';
                                    return (
                                        '<tr data-ok="' +
                                        (ok ? '1' : '0') +
                                        '" data-compared="' +
                                        (compared ? '1' : '0') +
                                        '"' +
                                        rowClass +
                                        '>' +
                                        '<td class="font-monospace">' +
                                        escapeHtml(p.stepId || '') +
                                        '</td>' +
                                        '<td>' +
                                        escapeHtml(p.title || '') +
                                        '</td>' +
                                        '<td class="font-monospace">' +
                                        escapeHtml(p.order || '—') +
                                        '</td>' +
                                        '<td class="font-monospace">' +
                                        escapeHtml(p.device || '—') +
                                        '</td>' +
                                        '<td>' +
                                        (!compared
                                            ? '<span class="text-body-secondary">·</span>'
                                            : ok
                                              ? '<span class="text-success">OK</span>'
                                              : '<span class="text-danger">≠</span>') +
                                        '</td></tr>'
                                    );
                                })
                                .join('') +
                            '</tbody></table></div>';
                    }
                    return (
                        '<div class="border rounded p-3 mb-3 bg-body">' +
                        '<div class="d-flex flex-wrap gap-3 mb-2">' +
                        '<div><span class="text-body-secondary">Заказ</span><div class="fw-semibold font-monospace">' +
                        escapeHtml(rep.orderNumber || '—') +
                        '</div></div>' +
                        '<div><span class="text-body-secondary">S/N</span><div class="fw-semibold font-monospace">' +
                        escapeHtml(rep.serialCorrector || '—') +
                        (rep.serialComplex
                            ? ' <span class="text-body-secondary">/ ' +
                              escapeHtml(rep.serialComplex) +
                              '</span>'
                            : '') +
                        '</div></div>' +
                        '<div><span class="text-body-secondary">Сверка</span><div>' +
                        escapeHtml(formatAdminDt(rep.createdAt)) +
                        ' · ' +
                        escapeHtml(rep.eventState || '') +
                        ' · совп. ' +
                        escapeHtml(String(rep.match)) +
                        ' / расх. ' +
                        escapeHtml(String(rep.mismatch)) +
                        (params.length
                            ? ' · в опросе ' + params.length
                            : '') +
                        '</div></div>' +
                        '<div><span class="text-body-secondary">Оператор</span><div>' +
                        escapeHtml(
                            (rep.operator && (rep.operator.displayName || rep.operator.login)) || '—'
                        ) +
                        '</div></div>' +
                        '</div>' +
                        (title
                            ? '<div class="mb-2 text-body-secondary">' + escapeHtml(title) + '</div>'
                            : '') +
                        paramsHtml +
                        '</div>'
                    );
                })
                .join('');
        } catch (e) {
            box.innerHTML =
                '<div class="text-danger">' + escapeHtml(e.message || String(e)) + '</div>';
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger';
            }
        }
    }

    async function loadActionLogDates() {
        const sel = $('admLogDate');
        if (!sel) {
            return;
        }
        try {
            const r = await fetch('/api/admin-ops.php?action=actionLogDates', {
                credentials: 'same-origin',
            });
            const j = await r.json();
            const dates = Array.isArray(j.dates) ? j.dates : [];
            const today = new Date().toISOString().slice(0, 10);
            if (dates.indexOf(today) < 0) {
                dates.unshift(today);
            }
            sel.innerHTML = dates
                .map(function (d) {
                    return '<option value="' + escapeHtml(d) + '">' + escapeHtml(d) + '</option>';
                })
                .join('');
        } catch (_e) {
            const today = new Date().toISOString().slice(0, 10);
            sel.innerHTML = '<option value="' + today + '">' + today + '</option>';
        }
    }

    async function loadActionLogs() {
        const box = $('admLogsBox');
        const msg = $('admLogsMsg');
        if (!box) {
            return;
        }
        const date = ($('admLogDate') || {}).value || '';
        const tail = ($('admLogTail') || {}).value || '200';
        try {
            const r = await fetch(
                '/api/admin-ops.php?action=actionLogs&date=' +
                    encodeURIComponent(date) +
                    '&tail=' +
                    encodeURIComponent(tail),
                { credentials: 'same-origin' }
            );
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            const lines = Array.isArray(j.lines) ? j.lines : [];
            box.textContent = lines.length ? lines.join('\n') : '(пусто)';
            if (msg) {
                msg.textContent =
                    'Показано ' + (j.shown || lines.length) + ' из ' + (j.total || lines.length);
            }
        } catch (e) {
            box.textContent = e.message || String(e);
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger';
            }
        }
    }

    async function loadNotifyQueue() {
        const box = $('admNotifyQueueBox');
        if (!box) {
            return;
        }
        try {
            const r = await fetch('/api/admin-ops.php?action=notifyQueue', {
                credentials: 'same-origin',
            });
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            box.textContent = JSON.stringify(
                { seq: j.seq, items: j.items || [] },
                null,
                2
            );
        } catch (e) {
            box.textContent = e.message || String(e);
        }
    }

    async function clearNotifyQueue() {
        if (!window.confirm('Очистить очередь уведомлений?')) {
            return;
        }
        const msg = $('admNotifyMsg');
        try {
            const r = await fetch('/api/admin-ops.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'clearNotifyQueue' }),
            });
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            if (msg) {
                msg.textContent = 'Очередь очищена';
                msg.className = 'small text-success';
            }
            await loadNotifyQueue();
            await loadAdminHealth();
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger';
            }
        }
    }

    async function loadAdminHealth() {
        const el = $('admHealthBar');
        if (!el) {
            return;
        }
        try {
            const r = await fetch('/api/admin-ops.php?action=health', {
                credentials: 'same-origin',
            });
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            el.classList.remove('d-none');
            el.textContent =
                'БД: ' +
                (j.dbDriver || '—') +
                ' · сессий: ' +
                (j.sessionsTotal || 0) +
                ' (active ' +
                (j.sessionsActive || 0) +
                ') · S/N: ' +
                (j.serialsIssued || 0) +
                ' · очередь notify: ' +
                (j.notifyQueueItems || 0);
        } catch (_e) {
            el.classList.add('d-none');
        }
    }

    async function exportSettingsAdmin() {
        const msg = $('admToolsMsg');
        try {
            const r = await fetch('/api/admin-ops.php?action=exportSettings', {
                credentials: 'same-origin',
            });
            const j = await r.json();
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            const blob = new Blob([JSON.stringify(j.settings, null, 2)], {
                type: 'application/json',
            });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'device_settings-' + new Date().toISOString().slice(0, 10) + '.json';
            a.click();
            URL.revokeObjectURL(a.href);
            if (msg) {
                msg.textContent = 'Экспорт скачан';
                msg.className = 'small text-success';
            }
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger';
            }
        }
    }

    async function importSettingsAdmin(file) {
        const msg = $('admToolsMsg');
        if (!file) {
            return;
        }
        try {
            const text = await file.text();
            const settings = JSON.parse(text);
            if (!window.confirm('Заменить device_settings.json содержимым файла?')) {
                return;
            }
            const r = await fetch('/api/admin-ops.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'importSettings', settings: settings }),
            });
            const j = await r.json();
            if (!j.ok && j.success === false) {
                throw new Error(j.error || 'Ошибка');
            }
            if (!j.ok) {
                throw new Error(j.error || 'Ошибка');
            }
            if (msg) {
                msg.textContent = 'Настройки импортированы — обновите страницу';
                msg.className = 'small text-success';
            }
            await loadSettings();
        } catch (e) {
            if (msg) {
                msg.textContent = e.message || String(e);
                msg.className = 'small text-danger';
            }
        }
    }

    $('saveBtn')?.addEventListener('click', function () {
        void saveSettings();
    });
    $('resetServerBtn')?.addEventListener('click', function () {
        void resetSettings();
    });
    $('saveCounterBtn')?.addEventListener('click', function () {
        void saveCounter();
    });
    $('deleteCounterBtn')?.addEventListener('click', function () {
        void deleteCounter();
    });
    $('resetCounterFormBtn')?.addEventListener('click', function () {
        resetCounterForm();
        setCounterMsg('', false);
        applySelectedMeterType();
    });
    $('admWsSaveBtn')?.addEventListener('click', function () {
        void saveWorkstation();
    });
    $('admWsCancelBtn')?.addEventListener('click', function () {
        const box = $('admWsEditor');
        if (box) {
            box.classList.add('d-none');
        }
    });
    $('admFwUploadBtn')?.addEventListener('click', function () {
        void uploadFirmware();
    });
    $('admOpPinSaveBtn')?.addEventListener('click', function () {
        void saveOperatorPin();
    });
    $('admDeleteAllSessionsBtn')?.addEventListener('click', function () {
        void deleteAllSessionsAdmin().then(function () {
            void loadAdminSessions();
            void loadAdminHealth();
        });
    });
    $('admSessionsRefreshBtn')?.addEventListener('click', function () {
        void loadAdminSessions();
    });
    $('admSessionsFilter')?.addEventListener('change', function () {
        void loadAdminSessions();
    });
    $('admCloseStaleBtn')?.addEventListener('click', function () {
        void closeStaleSessionsAdmin();
    });
    $('admSessionsBody')?.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-delete-session]');
        if (!btn) {
            return;
        }
        void deleteAdminSession(btn.getAttribute('data-delete-session'));
    });
    $('admSerialSearchBtn')?.addEventListener('click', function () {
        void loadIssuedSerials(strVal('admSerialQuery'));
    });
    $('admSerialRefreshBtn')?.addEventListener('click', function () {
        const q = $('admSerialQuery');
        if (q) {
            q.value = '';
        }
        void loadIssuedSerials('');
    });
    $('admSerialQuery')?.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            void loadIssuedSerials(strVal('admSerialQuery'));
        }
    });
    $('admSerialsBody')?.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-delete-serial]');
        if (!btn) {
            return;
        }
        void deleteIssuedSerial(btn.getAttribute('data-delete-serial')).then(function () {
            void loadSerialCounters();
            void loadAdminHealth();
        });
    });
    $('admSerialCountersBody')?.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-save-seq]');
        if (!btn) {
            return;
        }
        const tr = btn.closest('tr');
        if (!tr) {
            return;
        }
        const inp = tr.querySelector('[data-seq-input]');
        void saveSerialCounter(
            tr.getAttribute('data-prefix') || '',
            tr.getAttribute('data-month') || '',
            parseInt(String((inp && inp.value) || '0'), 10) || 0
        );
    });
    $('admEventsRefreshBtn')?.addEventListener('click', function () {
        void loadAdminEvents();
    });
    $('admParamSearchBtn')?.addEventListener('click', function () {
        void loadParamReport();
    });
    $('admParamQuery')?.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            void loadParamReport();
        }
    });
    $('admParamResults')?.addEventListener('change', function (e) {
        const inp = e.target;
        if (!inp || !inp.getAttribute || !inp.getAttribute('data-param-filter')) {
            return;
        }
        const table = document.getElementById(inp.getAttribute('data-param-filter'));
        if (!table) {
            return;
        }
        const onlyBad = !!inp.checked;
        table.querySelectorAll('tbody tr').forEach(function (tr) {
            const ok = tr.getAttribute('data-ok') === '1';
            tr.style.display = onlyBad && ok ? 'none' : '';
        });
    });
    $('admLogsRefreshBtn')?.addEventListener('click', function () {
        void loadActionLogs();
    });
    $('admLogDate')?.addEventListener('change', function () {
        void loadActionLogs();
    });
    $('admNotifyQueueRefreshBtn')?.addEventListener('click', function () {
        void loadNotifyQueue();
    });
    $('admNotifyQueueClearBtn')?.addEventListener('click', function () {
        void clearNotifyQueue();
    });
    $('admExportSettingsBtn')?.addEventListener('click', function () {
        void exportSettingsAdmin();
    });
    $('admImportSettingsFile')?.addEventListener('change', function (e) {
        const f = e.target && e.target.files && e.target.files[0];
        void importSettingsAdmin(f);
        e.target.value = '';
    });
    $('admSensorTbody')?.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-unbind-sensor]');
        if (!btn) {
            return;
        }
        void unbindSensor(btn.getAttribute('data-unbind-sensor'));
    });
    $('admDbRefreshBtn')?.addEventListener('click', function () {
        void loadDbOverview();
    });
    $('admDbTableSelect')?.addEventListener('change', function () {
        admDbOffset = 0;
        void loadDbBrowse();
    });
    $('admDbLimit')?.addEventListener('change', function () {
        admDbOffset = 0;
        void loadDbBrowse();
    });
    $('admDbPrevBtn')?.addEventListener('click', function () {
        const limit = intVal('admDbLimit', 50);
        admDbOffset = Math.max(0, admDbOffset - limit);
        void loadDbBrowse();
    });
    $('admDbNextBtn')?.addEventListener('click', function () {
        const limit = intVal('admDbLimit', 50);
        admDbOffset += limit;
        void loadDbBrowse();
    });
    $('admSensorSearchBtn')?.addEventListener('click', function () {
        void loadSensorBindings(strVal('admSensorQuery'));
    });
    $('admSensorRefreshBtn')?.addEventListener('click', function () {
        const q = $('admSensorQuery');
        if (q) {
            q.value = '';
        }
        void loadSensorBindings('');
    });
    $('admSensorQuery')?.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            void loadSensorBindings(strVal('admSensorQuery'));
        }
    });
    $('pwdForm')?.addEventListener('submit', async function (e) {
        e.preventDefault();
        const msg = $('pwdMsg');
        try {
            const r = await fetch('/api/auth.php?action=changePassword', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currentPassword: strVal('pwdCurrent'),
                    newPassword: strVal('pwdNew'),
                }),
            });
            const j = await r.json();
            if (!j.success) {
                if (msg) {
                    msg.textContent = j.error || 'Ошибка';
                    msg.className = 'text-danger small';
                }
                return;
            }
            if (msg) {
                msg.textContent = 'Пароль изменён';
                msg.className = 'text-success small';
            }
            $('pwdCurrent').value = '';
            $('pwdNew').value = '';
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || String(err);
                msg.className = 'text-danger small';
            }
        }
    });

    $('admTestNotifyBtn')?.addEventListener('click', async function () {
        const msg = $('admNotifyMsg');
        if (msg) {
            msg.textContent = 'Отправка…';
            msg.className = 'small text-body-secondary';
        }
        try {
            const r = await fetch('/api/bench-notify.php?action=push', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderNumber: strVal('adm_notify_order') || 'ТМ00-ТЕСТ001',
                    kind: strVal('adm_notify_kind') || 'corrector',
                    message: 'Тестовое уведомление администратора',
                }),
            });
            const j = await r.json();
            if (!r.ok || (j && j.ok === false) || (j && j.success === false)) {
                throw new Error((j && (j.error || j.message)) || 'Ошибка отправки');
            }
            if (msg) {
                msg.textContent =
                    'Отправлено #' +
                    (j.item && j.item.id != null ? j.item.id : '?') +
                    ' · ' +
                    (j.item && j.item.orderNumber ? j.item.orderNumber : '') +
                    ' — у оператора всплывёт за ~5 с (вкладка главной или рабочего места должна быть открыта, оператор залогинен).';
                msg.className = 'small text-success';
            }
        } catch (err) {
            if (msg) {
                msg.textContent = err.message || String(err);
                msg.className = 'small text-danger';
            }
        }
    });

    async function initAdmin() {
        // Сначала узнаём роль из сессии, чтобы скрыть чужие разделы и не грузить лишнее.
        try {
            const r = await fetch('/api/auth.php?action=status', { credentials: 'same-origin' });
            const j = await r.json();
            if (!j.loggedIn) {
                window.location.href = '/login.html';
                return;
            }
            applyAdminRole(j.role === 'monitor' ? 'monitor' : 'config');
        } catch (_e) {
            // Если статус недоступен — по умолчанию config (настройка рабочего места).
            applyAdminRole('config');
        }

        const isMonitor = adminRole === 'monitor';
        const isConfig = adminRole === 'config';

        if (isConfig) {
            void loadSettings();
            void loadWorkstations();
            void loadFirmware();
        }
        if (isMonitor) {
            void loadCounters();
            void loadOperators();
            initMeterSelects();
            void loadDbOverview();
            void loadSensorBindings();
            void loadIssuedSerials('');
            void loadAdminSessions();
            void loadSerialCounters();
            void loadAdminEvents();
            void loadActionLogDates().then(function () {
                void loadActionLogs();
            });
            void loadNotifyQueue();
            void loadAdminHealth();
        }
    }

    void initAdmin();
})();
