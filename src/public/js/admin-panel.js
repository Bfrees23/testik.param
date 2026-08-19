/**
 * �����-������: device_settings.json + ��������.
 */
(function () {
    'use strict';

    function $(id) {
        return document.getElementById(id);
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
                label: strVal('adm_mit_label') || '��� 8',
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
        setStatus('���������', false);
        $('adminStatus').className = 'alert alert-secondary border-0 py-2 small mb-3';
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
                    ? '��������: data/device_settings.json (��������� ����)'
                    : '��������: ���������� ���������';
            }
            setStatus('��������� ���������', false);
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    }

    async function saveSettings() {
        setStatus('����������', false);
        $('adminStatus').className = 'alert alert-secondary border-0 py-2 small mb-3';
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
            setStatus(j.message || '��������� �� �������', false);
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    }

    async function resetSettings() {
        if (!window.confirm('�������� ��������� � ���������� ����������?')) {
            return;
        }
        setStatus('�����', false);
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
            setStatus(j.message || '��������', false);
        } catch (e) {
            setStatus(e.message || String(e), true);
        }
    }

    async function loadCounters() {
        const sel = $('counterSelectAdmin');
        if (!sel) {
            return;
        }
        try {
            const r = await fetch('/api/counters.php?action=list', { credentials: 'same-origin' });
            const j = await r.json();
            if (!j.success) {
                return;
            }
            sel.innerHTML = '';
            (j.counters || []).forEach(function (c) {
                const opt = document.createElement('option');
                opt.value = String(c.id);
                opt.textContent = (c.name || '�') + (c.serial ? ' � ' + c.serial : '');
                sel.appendChild(opt);
            });
        } catch (_e) {}
    }

    async function saveCounter() {
        const payload = {
            id: intVal('counter_id', 0) || undefined,
            name: strVal('counter_name'),
            serial: strVal('counter_serial') || null,
            parameters: {},
        };
        if (!payload.name) {
            alert('������� �������� ��������');
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
            alert(j.error || '������ ����������');
            return;
        }
        await loadCounters();
    }

    async function deleteCounter() {
        const id = intVal('counter_id', 0);
        if (!id || !window.confirm('������� ������� #' + id + '?')) {
            return;
        }
        const r = await fetch('/api/counters.php?action=delete&id=' + id, {
            method: 'POST',
            credentials: 'same-origin',
            body: '{}',
        });
        const j = await r.json();
        if (!j.success) {
            alert(j.error || '������ ��������');
            return;
        }
        $('counter_id').value = '';
        $('counter_name').value = '';
        $('counter_serial').value = '';
        await loadCounters();
    }

    async function importDocx() {
        const r = await fetch('/api/counters.php?action=import-docx', {
            method: 'POST',
            credentials: 'same-origin',
            body: '{}',
        });
        const j = await r.json();
        if (!j.success) {
            alert(j.error || '������ �� ��������');
            return;
        }
        await loadCounters();
        alert(j.message || '������ ��������');
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
    $('importDocxBtn')?.addEventListener('click', function () {
        void importDocx();
    });
    $('resetCounterFormBtn')?.addEventListener('click', function () {
        ['counter_id', 'counter_name', 'counter_serial'].forEach(function (id) {
            const el = $(id);
            if (el) {
                el.value = '';
            }
        });
    });
    $('counterSelectAdmin')?.addEventListener('change', function (e) {
        const opt = e.target.selectedOptions[0];
        if (!opt) {
            return;
        }
        $('counter_id').value = opt.value;
        const parts = (opt.textContent || '').split(' � ');
        $('counter_name').value = parts[0] || '';
        $('counter_serial').value = parts[1] || '';
    });

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
                    '<tr><td colspan="5" class="text-danger">' +
                    (j.error || 'Не удалось загрузить операторов') +
                    '</td></tr>';
                return;
            }
            const list = Array.isArray(j.operators) ? j.operators : [];
            if (!list.length) {
                tbody.innerHTML =
                    '<tr><td colspan="5" class="text-body-secondary">Пока нет операторов — задайте PIN формой выше или через BENCH_OPERATOR_PINS</td></tr>';
                return;
            }
            tbody.innerHTML = list
                .map(function (op) {
                    const id = op.id;
                    const last = op.lastName || '';
                    const first = op.firstName || '';
                    const login = op.login || '';
                    const pinBadge = op.hasPin
                        ? '<span class="badge text-bg-success">задан</span>'
                        : '<span class="badge text-bg-warning text-dark">нет</span>';
                    return (
                        '<tr>' +
                        '<td>' +
                        last +
                        '</td><td>' +
                        first +
                        '</td><td class="font-monospace small">' +
                        login +
                        '</td><td>' +
                        pinBadge +
                        '</td><td class="text-end text-nowrap">' +
                        '<button type="button" class="btn btn-outline-secondary btn-sm adm-op-pick me-1" data-last="' +
                        String(last).replace(/"/g, '&quot;') +
                        '" data-first="' +
                        String(first).replace(/"/g, '&quot;') +
                        '" data-id="' +
                        id +
                        '">PIN</button>' +
                        '<button type="button" class="btn btn-outline-danger btn-sm adm-op-del" data-id="' +
                        id +
                        '" data-name="' +
                        String(op.displayName || last + ' ' + first).replace(/"/g, '&quot;') +
                        '">Удалить</button>' +
                        '</td></tr>'
                    );
                })
                .join('');
            tbody.querySelectorAll('.adm-op-pick').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    setVal('adm_op_last', btn.getAttribute('data-last') || '');
                    setVal('adm_op_first', btn.getAttribute('data-first') || '');
                    const pinEl = $('adm_op_pin');
                    if (pinEl) {
                        pinEl.focus();
                    }
                });
            });
            tbody.querySelectorAll('.adm-op-del').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    void deleteOperatorById(
                        btn.getAttribute('data-id'),
                        btn.getAttribute('data-name') || ''
                    );
                });
            });
        } catch (e) {
            tbody.innerHTML =
                '<tr><td colspan="5" class="text-danger">' + String(e.message || e) + '</td></tr>';
        }
    }

    async function deleteOperatorById(operatorId, displayName) {
        const msg = $('admOpPinMsg');
        const id = parseInt(String(operatorId || ''), 10);
        if (!id) {
            return;
        }
        if (
            !window.confirm(
                'Удалить оператора «' + (displayName || '#' + id) + '»? Сессии останутся, ссылка на оператора обнулится.'
            )
        ) {
            return;
        }
        try {
            const r = await fetch('/api/bench-db-status.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'deleteOperator', operatorId: id }),
            });
            const j = await r.json();
            if (msg) {
                msg.textContent = j.ok
                    ? 'Удалён: ' + ((j.operator && j.operator.displayName) || '#' + id)
                    : j.error || 'Ошибка';
                msg.className = 'small mt-2 mb-0 ' + (j.ok ? 'text-success' : 'text-danger');
            }
            if (j.ok) {
                await loadOperators();
            }
        } catch (e) {
            if (msg) {
                msg.textContent = String(e.message || e);
                msg.className = 'small mt-2 mb-0 text-danger';
            }
        }
    }

    async function deleteAllSessionsAdmin() {
        const msg = $('admSessionsMsg');
        if (
            !window.confirm('Удалить ВСЕ сессии параметризации? Это необратимо.')
        ) {
            return;
        }
        try {
            const r = await fetch('/api/bench-db-status.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'deleteAllSessions' }),
            });
            const j = await r.json();
            if (msg) {
                msg.textContent = j.ok
                    ? 'Удалено сессий: ' + (j.deleted != null ? j.deleted : '?')
                    : j.error || 'Ошибка (войдите в админку)';
                msg.className = 'small ' + (j.ok ? 'text-success' : 'text-danger');
            }
        } catch (e) {
            if (msg) {
                msg.textContent = String(e.message || e);
                msg.className = 'small text-danger';
            }
        }
    }

    async function saveOperatorPin() {
        const msg = $('admOpPinMsg');
        const lastName = strVal('adm_op_last');
        const firstName = strVal('adm_op_first');
        const pin = strVal('adm_op_pin');
        if (!lastName) {
            if (msg) {
                msg.textContent = 'Укажите фамилию';
                msg.className = 'small mt-2 mb-0 text-danger';
            }
            return;
        }
        if (!pin || pin.length < 3) {
            if (msg) {
                msg.textContent = 'PIN не короче 3 символов';
                msg.className = 'small mt-2 mb-0 text-danger';
            }
            return;
        }
        try {
            const r = await fetch('/api/bench-db-status.php', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'setOperatorPin',
                    lastName: lastName,
                    firstName: firstName,
                    pin: pin,
                }),
            });
            const j = await r.json();
            if (msg) {
                msg.textContent = j.ok
                    ? 'PIN сохранён для ' + ((j.operator && j.operator.displayName) || lastName)
                    : j.error || 'Ошибка';
                msg.className = 'small mt-2 mb-0 ' + (j.ok ? 'text-success' : 'text-danger');
            }
            if (j.ok) {
                const pinEl = $('adm_op_pin');
                if (pinEl) {
                    pinEl.value = '';
                }
                await loadOperators();
            }
        } catch (e) {
            if (msg) {
                msg.textContent = String(e.message || e);
                msg.className = 'small mt-2 mb-0 text-danger';
            }
        }
    }

    $('admOpPinSaveBtn')?.addEventListener('click', function () {
        void saveOperatorPin();
    });
    $('admDeleteAllSessionsBtn')?.addEventListener('click', function () {
        void deleteAllSessionsAdmin();
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
                    current: strVal('pwdCurrent'),
                    next: strVal('pwdNew'),
                }),
            });
            const j = await r.json();
            if (msg) {
                msg.textContent = j.success ? j.message || 'OK' : j.error || '������';
                msg.className = j.success ? 'text-success' : 'text-danger';
            }
            if (j.success) {
                $('pwdCurrent').value = '';
                $('pwdNew').value = '';
            }
        } catch (err) {
            if (msg) {
                msg.textContent = String(err);
                msg.className = 'text-danger';
            }
        }
    });

    void loadSettings();
    void loadCounters();
    void loadOperators();
})();
