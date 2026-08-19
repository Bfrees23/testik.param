document.addEventListener('DOMContentLoaded', () => {
    let usbVendorId = 0x0403;
    const ARC_KEY = 'bench_tm07_autorc_';
    const SETTINGS_KEY = 'bench_tm07_settings_v1';
    const FIRST_INIT_DONE_KEY = 'bench_tm07_first_init_done_v1';
    const AUTO_CONNECT_ENABLED_KEY = 'bench_tm07_auto_connect_enabled_v1';
    const SCENARIO_STATE_KEY = 'bench_tm07_cycle_state_v1';
    const CORR_SERIAL_KEY = 'bench_tm07_corr_serial_v1';
    const PHASE_ORDER = ['m90_mit', 'cal_min', 'cal_max', 'temp_verify', 'impulse', 'pressure_abs', 'pressure_diff'];
    /** Соответствие фазы сценария макрошагу 1–7 (блок #benchMacroWorkflow, ТЗ) */
    const PHASE_TO_MACRO = {
        m90_mit: 2,
        cal_min: 3,
        cal_max: 3,
        temp_verify: 4,
        impulse: 5,
        pressure_abs: 6,
        pressure_diff: 6
    };
    const PHASE_LABELS = {
        m90_mit: '1) M90 + МИТ',
        cal_min: '2) Калибровка MIN',
        cal_max: '3) Калибровка MAX',
        temp_verify: '4) Поверка T',
        impulse: '5) Импульсы',
        pressure_abs: '6) P абс.',
        pressure_diff: '7) P перепада'
    };

    const DEFAULT_SETTINGS = {
        benchMitChannel: 'avg',
        benchCorrRegTRead: '0120',
        benchCorrRegTWrite: '0124',
        benchCorrRegPabs: '0200',
        benchCorrRegPdiff: '0202',
        benchCorrLkgHex: '',
        benchCorrLkgRegHex: '0493',
        benchCorrLockStatusHex: '0019',
        m90StabTime: '10',
        stabilityMinutes: '5',
        tempTolerance: '0.5',
        flatMinutes: '5',
        flatTol: '0.15',
        pressureTolKpa: '0.5',
        pkdTargetTol: '0.3',
        absPmin: '0',
        absPmax: '100',
        diffPmin: '0',
        diffPmax: '100',
        corrAddress: '1',
        corrBaud: '19200',
        corrReadAddr: '0078',
        corrReadCount: '4',
        corrWriteAddr: '0493',
        corrWriteHex: '',
        pkdDacInput: '4.00000'
    };

    const BENCH_SETTING_IDS = [
        'benchMitChannel',
        'benchCorrRegTRead',
        'benchCorrRegTWrite',
        'benchCorrRegPabs',
        'benchCorrRegPdiff',
        'benchCorrLkgHex',
        'benchCorrLkgRegHex',
        'benchCorrLockStatusHex',
        'm90StabTime',
        'stabilityMinutes',
        'tempTolerance',
        'flatMinutes',
        'flatTol',
        'pressureTolKpa',
        'pkdTargetTol',
        'absPmin',
        'absPmax',
        'diffPmin',
        'diffPmax',
        'corrAddress',
        'corrBaud',
        'corrReadAddr',
        'corrReadCount',
        'corrWriteAddr',
        'corrWriteHex',
        'pkdDacInput'
    ];

    function cloneDefaultBenchChannels() {
        return [
            { id: 'm90_6045', type: 'm90', name: 'M90 #1 (+20)', pid: 0x6045, setpoint: 20 },
            { id: 'mit_6015', type: 'mit', name: 'МИТ 8', pid: 0x6015 }
        ];
    }

    let channels = cloneDefaultBenchChannels();
    let m90ChannelOrder = channels.filter((c) => c.type === 'm90').map((c) => c.id);

    function parseHexUsbId(s) {
        const n = parseInt(String(s || '').replace(/^0x/i, ''), 16);
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    const devices = new Map();
    const channelStatus = new Map();

    const channelsList = document.getElementById('channelsList');
    const logEl = document.getElementById('log');
    const clearLogBtn = document.getElementById('clearLogBtn');
    const autoScrollLog = document.getElementById('autoScrollLog');
    const workflowStatusEl = document.getElementById('workflowStatus');
    const scenarioPhaseTitleEl = document.getElementById('scenarioPhaseTitle');
    const runFullBtn = document.getElementById('runFullBtn');
    const resumeScenarioBtn = document.getElementById('resumeScenarioBtn');
    const stopScenarioBtn = document.getElementById('stopScenarioBtn');
    const proceedOverlay = document.getElementById('proceedOverlay');
    const proceedBtn = document.getElementById('proceedBtn');
    const proceedHint = document.getElementById('proceedHint');
    const proceedCaption = document.getElementById('proceedCaption');
    const DEFAULT_PROCEED_BTN_LABEL = 'Продолжить';
    function setProceedButtonLabel(label) {
        if (!proceedBtn) return;
        const text = label != null && String(label).trim() !== '' ? String(label) : DEFAULT_PROCEED_BTN_LABEL;
        proceedBtn.innerHTML = `<i class="bi bi-check2-circle me-2"></i>${text}`;
    }

    const benchMitChannel = document.getElementById('benchMitChannel');
    const m90StabTimeInput = document.getElementById('m90StabTime');
    const stabilityMinutesInput = document.getElementById('stabilityMinutes');
    const tempToleranceInput = document.getElementById('tempTolerance');
    const flatMinutesInput = document.getElementById('flatMinutes');
    const flatTolInput = document.getElementById('flatTol');
    const pressureTolKpaInput = document.getElementById('pressureTolKpa');
    const pkdTargetTolInput = document.getElementById('pkdTargetTol');
    const absPminInput = document.getElementById('absPmin');
    const absPmaxInput = document.getElementById('absPmax');
    const diffPminInput = document.getElementById('diffPmin');
    const diffPmaxInput = document.getElementById('diffPmax');
    const saveBenchSettingsBtn = document.getElementById('saveBenchSettingsBtn');
    const loadBenchSettingsBtn = document.getElementById('loadBenchSettingsBtn');
    const resetBenchSettingsBtn = document.getElementById('resetBenchSettingsBtn');
    const benchSettingsHint = document.getElementById('benchSettingsHint');
    const exportLogBtn = document.getElementById('exportLogBtn');
    const cycleReportStatusEl = document.getElementById('cycleReportStatus');
    const cycleReportEl = document.getElementById('cycleReport');
    const autoReconnectToggleBtn = document.getElementById('autoReconnectToggleBtn');
    const autoReconnectHint = document.getElementById('autoReconnectHint');
    const benchCorrSerialInput = document.getElementById('benchCorrSerialInput');
    const benchReadSerialBtn = document.getElementById('benchReadSerialBtn');
    const benchCheckSerialBtn = document.getElementById('benchCheckSerialBtn');
    const benchSerialLookupStatus = document.getElementById('benchSerialLookupStatus');

    let latestMitChannels = [null, null, null];
    let mitHistory = [];
    let mitPollingIntervalId = null;
    let m90PollIntervalId = null;
    let scenarioRunning = false;
    let scenarioAborted = false;
    let activePhaseId = null;
    const phaseStopRequests = new Set();
    let currentFullPhaseIndex = 0;
    let fullScenarioActive = false;
    let reportStartedAt = null;
    let resolveProceed = null;
    let settingsDebounceTimer = null;

    function normalizeCorrSerial(raw) {
        const value = String(raw || '')
            .trim()
            .toUpperCase()
            .replace(/\s+/g, '');
        if (!/^[A-Z0-9._-]{3,40}$/.test(value)) return '';
        return value;
    }

    function setSerialLookupStatus(text, kind = 'info') {
        if (!benchSerialLookupStatus) return;
        benchSerialLookupStatus.textContent = text;
        const map = {
            info: 'small text-body-secondary mt-2',
            ok: 'small text-success mt-2',
            warn: 'small text-warning mt-2',
            error: 'small text-danger mt-2'
        };
        benchSerialLookupStatus.className = map[kind] || map.info;
    }

    function saveSerialToStorage(serial) {
        try {
            if (serial) localStorage.setItem(CORR_SERIAL_KEY, serial);
            else localStorage.removeItem(CORR_SERIAL_KEY);
        } catch (_e) {}
    }

    function getActiveCorrSerial() {
        const normalized = normalizeCorrSerial(benchCorrSerialInput?.value || '');
        return normalized || null;
    }

    function collectPhaseStates() {
        const out = {};
        PHASE_ORDER.forEach((id) => {
            out[id] = getPhaseState(id);
        });
        return out;
    }

    function calcNextPhaseIndexFromStates(phaseStates) {
        for (let i = 0; i < PHASE_ORDER.length; i += 1) {
            const st = phaseStates[PHASE_ORDER[i]];
            if (st !== 'done') return i;
        }
        return PHASE_ORDER.length;
    }

    async function saveProgressToDb(cycleStatus, lastPhase = null) {
        const serial = getActiveCorrSerial();
        if (!serial) return;
        const phaseStates = collectPhaseStates();
        const nextPhaseIndex = calcNextPhaseIndexFromStates(phaseStates);
        const reportSummary = cycleReportStatusEl?.textContent || '';
        try {
            const r = await fetch('/api/bench-cycle-progress.php?action=save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    serial,
                    phaseStates,
                    nextPhaseIndex,
                    lastPhase,
                    cycleStatus,
                    reportSummary
                })
            });
            const j = await r.json();
            if (!j.success) throw new Error(j.error || 'save failed');
            setSerialLookupStatus(`БД: SN ${serial}, следующий этап ${Math.min(nextPhaseIndex + 1, 7)}.`, 'ok');
        } catch (e) {
            log(`БД прогресса: ошибка сохранения для SN ${serial} — ${e.message}`);
            setSerialLookupStatus(`БД: ошибка сохранения SN ${serial}: ${e.message}`, 'error');
        }
    }

    function applyProgressFromDb(progress) {
        if (!progress || typeof progress !== 'object') return;
        const phaseStates = progress.phaseStates && typeof progress.phaseStates === 'object' ? progress.phaseStates : {};
        PHASE_ORDER.forEach((id) => {
            const st = phaseStates[id];
            if (typeof st === 'string') setPhaseState(id, st);
            else setPhaseState(id, 'pending');
        });
        const idxRaw = Number(progress.nextPhaseIndex);
        if (Number.isInteger(idxRaw) && idxRaw >= 0 && idxRaw < PHASE_ORDER.length) {
            saveScenarioState(idxRaw);
            updateResumeButton(idxRaw);
            setMacroWorkflowStep(macroStepFromResumeNextIndex(idxRaw));
        } else if (idxRaw >= PHASE_ORDER.length) {
            clearScenarioState();
            updateResumeButton(null);
            setMacroWorkflowStep(7);
        } else {
            clearScenarioState();
            updateResumeButton(null);
            setMacroWorkflowStep(1);
        }
    }

    async function lookupProgressBySerial(serial, apply = true) {
        const normalized = normalizeCorrSerial(serial);
        if (!normalized) throw new Error('Введите корректный серийный номер (3..40 символов: A-Z, 0-9, ._-).');
        const r = await fetch(`/api/bench-cycle-progress.php?action=get&serial=${encodeURIComponent(normalized)}`);
        const j = await r.json();
        if (!j.success) throw new Error(j.error || 'lookup failed');
        if (!j.found) {
            setSerialLookupStatus(`В БД нет данных для SN ${normalized}. Старт с 1 этапа.`, 'warn');
            return { found: false, serial: normalized };
        }
        if (apply) applyProgressFromDb(j.progress);
        const nextIdx = Number(j.progress?.nextPhaseIndex);
        const nextStep = Number.isInteger(nextIdx) ? Math.min(nextIdx + 1, 7) : 1;
        setSerialLookupStatus(`SN ${normalized}: данные найдены, следующий этап ${nextStep}.`, 'ok');
        log(`SN ${normalized}: восстановлен прогресс из БД (обновлено ${j.progress?.updatedAt || '—'}).`);
        return { found: true, serial: normalized, progress: j.progress };
    }

    async function readSerialFromDevice() {
        const k = getKorrektor();
        if (typeof k.identify !== 'function') throw new Error('Идентификация 0x11 недоступна в драйвере корректора');
        const resp = await k.identify();
        const len = Number(resp?.[2] || 0);
        if (len <= 0) throw new Error('Пустой ответ идентификации');
        const data = resp.slice(3, 3 + len);
        const snRaw = new TextDecoder().decode(data.slice(32, 52)).replace(/\0/g, '').trim();
        const sn = normalizeCorrSerial(snRaw);
        if (!sn) throw new Error(`Серийный номер не распознан: «${snRaw || 'пусто'}»`);
        if (benchCorrSerialInput) benchCorrSerialInput.value = sn;
        saveSerialToStorage(sn);
        setSerialLookupStatus(`Считан SN ${sn}. Проверяю БД...`, 'info');
        return sn;
    }

    function collectBenchSettings() {
        const out = {};
        BENCH_SETTING_IDS.forEach((id) => {
            const el = document.getElementById(id);
            if (el) out[id] = el.value;
        });
        return out;
    }

    function applyBenchSettings(data) {
        const merged = { ...DEFAULT_SETTINGS, ...data };
        BENCH_SETTING_IDS.forEach((id) => {
            const el = document.getElementById(id);
            if (!el || merged[id] === undefined) return;
            el.value = merged[id];
        });
    }

    function saveBenchSettingsToStorage(showLog) {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(collectBenchSettings()));
            if (showLog) log('Профиль стенда сохранён в браузере (localStorage).');
            if (benchSettingsHint) {
                benchSettingsHint.textContent = 'Сохранено.';
                setTimeout(() => {
                    if (benchSettingsHint) benchSettingsHint.textContent = 'Автосохранение через 1,5 с после правок.';
                }, 2500);
            }
        } catch (e) {
            if (showLog) log(`Сохранение настроек: ${e.message}`);
        }
    }

    function loadBenchSettingsFromStorage(showLog) {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) {
                if (showLog) log('В браузере нет сохранённого профиля.');
                return false;
            }
            const parsed = JSON.parse(raw);
            applyBenchSettings(parsed);
            if (showLog) log('Профиль стенда загружен из браузера.');
            return true;
        } catch (e) {
            if (showLog) log(`Загрузка настроек: ${e.message}`);
            return false;
        }
    }

    function resetBenchSettingsToDefaults(showLog) {
        applyBenchSettings(DEFAULT_SETTINGS);
        try {
            localStorage.removeItem(SETTINGS_KEY);
        } catch (_e) {}
        if (showLog) log('Параметры сброшены к значениям по умолчанию (сохранение в браузере очищено).');
    }

    function scheduleBenchSettingsDebouncedSave() {
        if (settingsDebounceTimer) clearTimeout(settingsDebounceTimer);
        settingsDebounceTimer = setTimeout(() => {
            settingsDebounceTimer = null;
            saveBenchSettingsToStorage(false);
        }, 1500);
    }

    function bindBenchSettingsPersistence() {
        BENCH_SETTING_IDS.forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const handler = () => scheduleBenchSettingsDebouncedSave();
            el.addEventListener('change', handler);
            el.addEventListener('input', handler);
        });
    }

    function exportJournalToFile() {
        const text = logEl ? logEl.innerText || logEl.textContent || '' : '';
        const pad = (n) => String(n).padStart(2, '0');
        const d = new Date();
        const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
        const header = `Журнал стенда ТМ-07 + M90 + МИТ + ПКД\r\nЭкспорт: ${d.toLocaleString()}\r\n\r`;
        const blob = new Blob([header + text], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `bench-journal_${stamp}.txt`;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        log('Журнал сохранён в файл.');
    }

    function log(message) {
        const timestamp = new Date().toLocaleTimeString();
        logEl.innerHTML += `[${timestamp}] ${message}<br>`;
        if (!autoScrollLog || autoScrollLog.checked) {
            logEl.scrollTop = logEl.scrollHeight;
        }
    }

    function setWorkflowStatus(message) {
        workflowStatusEl.textContent = message;
        log(message);
    }

    function setScenarioPhaseTitle(text) {
        if (scenarioPhaseTitleEl) scenarioPhaseTitleEl.textContent = text;
    }

    function setMacroWorkflowStep(activeStep) {
        const container = document.getElementById('benchMacroWorkflow');
        if (!container) return;
        const step = activeStep <= 0 ? 1 : Math.min(7, Math.max(1, activeStep));
        container.querySelectorAll('[data-macro-step]').forEach((el) => {
            const n = parseInt(el.dataset.macroStep, 10);
            const numEl = el.querySelector('.bench-op-step-num');
            el.classList.remove('is-done', 'is-current');
            if (numEl) {
                const muted = n > step || (step === 1 && n > 1);
                numEl.classList.toggle('is-muted', muted);
            }
            if (n < step) el.classList.add('is-done');
            else if (n === step) el.classList.add('is-current');
        });
    }

    function macroStepFromResumeNextIndex(nextIdx) {
        if (!Number.isInteger(nextIdx) || nextIdx < 0 || nextIdx >= PHASE_ORDER.length) return 1;
        const ph = PHASE_ORDER[nextIdx];
        return PHASE_TO_MACRO[ph] ?? 1;
    }

    function notifyMacroPhaseComplete(phaseId) {
        const m = PHASE_TO_MACRO[phaseId];
        if (m == null) return;
        setMacroWorkflowStep(Math.min(7, m + 1));
    }

    function syncMacroStepWithSavedResume() {
        const idx = loadScenarioState();
        if (Number.isInteger(idx)) setMacroWorkflowStep(macroStepFromResumeNextIndex(idx));
        else setMacroWorkflowStep(1);
    }

    function pidLabel(pid) {
        return `0x${pid.toString(16).toUpperCase()}`;
    }

    function ensureRunning() {
        if (!scenarioRunning || scenarioAborted) {
            throw new Error('Сценарий остановлен');
        }
        if (activePhaseId && phaseStopRequests.has(activePhaseId)) {
            throw new Error(`Фаза ${activePhaseId} остановлена`);
        }
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function readRampMinutes() {
        const v = parseInt(m90StabTimeInput?.value, 10);
        return Number.isNaN(v) || v <= 0 ? 10 : Math.min(60, v);
    }

    function readStabilityMinutes() {
        const v = parseInt(stabilityMinutesInput?.value, 10);
        return Number.isNaN(v) || v < 1 ? 5 : Math.min(60, v);
    }

    function readTempTolerance() {
        const v = parseFloat(tempToleranceInput?.value);
        return Number.isNaN(v) || v < 0.05 ? 0.5 : v;
    }

    function readFlatMinutes() {
        const v = parseInt(flatMinutesInput?.value, 10);
        return Number.isNaN(v) || v < 1 ? 5 : Math.min(60, v);
    }

    function readFlatTol() {
        const v = parseFloat(flatTolInput?.value);
        return Number.isNaN(v) || v < 0.01 ? 0.15 : v;
    }

    function readPressureTol() {
        const v = parseFloat(pressureTolKpaInput?.value);
        return Number.isNaN(v) || v <= 0 ? 0.5 : v;
    }

    function readPkdTargetTol() {
        const v = parseFloat(pkdTargetTolInput?.value);
        return Number.isNaN(v) || v <= 0 ? 0.3 : v;
    }

    function getMitRef() {
        const mode = benchMitChannel?.value || 'avg';
        if (mode === 'avg') {
            const vals = latestMitChannels.filter((x) => typeof x === 'number' && !Number.isNaN(x));
            if (!vals.length) return null;
            return vals.reduce((a, b) => a + b, 0) / vals.length;
        }
        const i = parseInt(mode, 10);
        const v = latestMitChannels[i];
        return typeof v === 'number' && !Number.isNaN(v) ? v : null;
    }

    function pushMitHistorySample() {
        const ref = getMitRef();
        if (ref === null) return;
        const cutoff = Date.now() - 45 * 60 * 1000;
        mitHistory = mitHistory.filter((x) => x.ts > cutoff);
        mitHistory.push({ ts: Date.now(), ref });
    }

    function getChannel(id) {
        return channels.find((ch) => ch.id === id);
    }

    function getConnectedM90Ids() {
        return m90ChannelOrder.filter((id) => channelStatus.get(id) === 'connected');
    }

    function isMitConnected() {
        return channelStatus.get('mit_6015') === 'connected';
    }

    function setStatus(id, status) {
        channelStatus.set(id, status);
        const statusEl = document.querySelector(`[data-status="${id}"]`);
        if (!statusEl) return;
        const map = {
            disconnected: 'Отключено',
            connecting: 'Подключение...',
            connected: 'Подключено',
            error: 'Ошибка'
        };
        const clsMap = {
            disconnected: 'badge rounded-pill text-bg-secondary',
            connecting: 'badge rounded-pill text-bg-warning text-dark',
            connected: 'badge rounded-pill text-bg-success',
            error: 'badge rounded-pill text-bg-danger'
        };
        statusEl.className = clsMap[status] || clsMap.disconnected;
        statusEl.textContent = map[status] || status;
    }

    function setPhaseState(phaseId, state) {
        const card = document.querySelector(`[data-phase="${phaseId}"]`);
        const badge = document.getElementById(`badge_${phaseId}`);
        if (card) card.dataset.phaseState = state;
        const labels = {
            pending: 'ожидание',
            running: 'выполняется',
            done: 'готово',
            failed: 'ошибка',
            stopped: 'остановлено'
        };
        const cls = {
            pending: 'text-bg-secondary',
            running: 'text-bg-warning text-dark',
            done: 'text-bg-success',
            failed: 'text-bg-danger',
            stopped: 'text-bg-dark'
        };
        if (badge) {
            badge.className = `ms-2 badge ${cls[state] || cls.pending}`;
            badge.textContent = labels[state] || state;
        }
    }

    function getPhaseState(phaseId) {
        const card = document.querySelector(`[data-phase="${phaseId}"]`);
        return card?.dataset?.phaseState || 'pending';
    }

    function saveScenarioState(nextPhaseIndex) {
        try {
            localStorage.setItem(
                SCENARIO_STATE_KEY,
                JSON.stringify({
                    nextPhaseIndex,
                    savedAt: Date.now()
                })
            );
        } catch (_e) {}
    }

    function isFirstInitDone() {
        try {
            return localStorage.getItem(FIRST_INIT_DONE_KEY) === '1';
        } catch (_e) {
            return false;
        }
    }

    function markFirstInitDone() {
        try {
            localStorage.setItem(FIRST_INIT_DONE_KEY, '1');
        } catch (_e) {}
    }

    function isAutoConnectEnabled() {
        try {
            const raw = localStorage.getItem(AUTO_CONNECT_ENABLED_KEY);
            if (raw === null) return true;
            return raw === '1';
        } catch (_e) {
            return true;
        }
    }

    function setAutoConnectEnabled(enabled) {
        try {
            localStorage.setItem(AUTO_CONNECT_ENABLED_KEY, enabled ? '1' : '0');
        } catch (_e) {}
    }

    function renderAutoConnectToggle() {
        if (!autoReconnectToggleBtn) return;
        const enabled = isAutoConnectEnabled();
        autoReconnectToggleBtn.textContent = `Автоподключение: ${enabled ? 'вкл' : 'выкл'}`;
        autoReconnectToggleBtn.className = `btn btn-sm ${enabled ? 'btn-outline-success' : 'btn-outline-secondary'}`;
        if (autoReconnectHint) {
            autoReconnectHint.textContent = enabled
                ? 'При старте страницы устройства подключаются автоматически.'
                : 'Автоподключение отключено. Только ручное подключение.';
        }
    }

    function clearScenarioState() {
        try {
            localStorage.removeItem(SCENARIO_STATE_KEY);
        } catch (_e) {}
    }

    function loadScenarioState() {
        try {
            const raw = localStorage.getItem(SCENARIO_STATE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const idx = Number(parsed?.nextPhaseIndex);
            if (!Number.isInteger(idx) || idx < 0 || idx >= PHASE_ORDER.length) return null;
            return idx;
        } catch (_e) {
            return null;
        }
    }

    function updateResumeButton(nextPhaseIndex) {
        if (!resumeScenarioBtn) return;
        if (Number.isInteger(nextPhaseIndex) && nextPhaseIndex >= 0 && nextPhaseIndex < PHASE_ORDER.length) {
            resumeScenarioBtn.disabled = false;
            resumeScenarioBtn.textContent = `Продолжить с ${nextPhaseIndex + 1} фазы`;
        } else {
            resumeScenarioBtn.disabled = true;
            resumeScenarioBtn.innerHTML = '<i class="bi bi-play-circle me-1"></i>Продолжить цикл';
        }
    }

    function renderCycleReport(statusText, detailsText) {
        if (cycleReportStatusEl) cycleReportStatusEl.textContent = statusText;
        if (cycleReportEl) cycleReportEl.textContent = detailsText;
    }

    function formatDuration(ms) {
        const totalSec = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        return `${h}ч ${m}м ${s}с`;
    }

    function buildCycleReport(statusLine, errorMessage = '') {
        const finishedAt = new Date();
        const startedAt = reportStartedAt ? new Date(reportStartedAt) : null;
        const lines = [];
        lines.push(`Статус: ${statusLine}`);
        lines.push(`Завершение: ${finishedAt.toLocaleString()}`);
        if (startedAt) {
            lines.push(`Начало: ${startedAt.toLocaleString()}`);
            lines.push(`Длительность: ${formatDuration(finishedAt.getTime() - startedAt.getTime())}`);
        }
        if (errorMessage) lines.push(`Причина: ${errorMessage}`);
        lines.push('');
        lines.push('Фазы:');
        PHASE_ORDER.forEach((id) => {
            const st = getPhaseState(id);
            lines.push(`- ${PHASE_LABELS[id] || id}: ${st}`);
        });
        lines.push('');
        lines.push('Параметры:');
        lines.push(`- Допуск T: ${readTempTolerance()} °C`);
        lines.push(`- Стабилизация M90: ${readStabilityMinutes()} мин`);
        lines.push(`- Плато МИТ: ${readFlatMinutes()} мин, порог ${readFlatTol()} °C`);
        lines.push(`- Допуск давления: ${readPressureTol()} кПа`);
        return lines.join('\n');
    }

    function createDeviceForChannel(channel) {
        if (channel.type === 'm90' && typeof window.M90Device === 'function') {
            return new window.M90Device();
        }
        if (channel.type === 'mit' && typeof window.MIT8Device === 'function') {
            return new window.MIT8Device();
        }
        return new window.SerialDevice();
    }

    function pidFilterFor(channel) {
        return [{ usbVendorId: usbVendorId, usbProductId: channel.pid }];
    }

    function getChannelCardEl(channelId) {
        return document.querySelector(`[data-channel-card="${channelId}"]`);
    }

    function bindMitDataHandler(device, channelId) {
        const card = getChannelCardEl(channelId);
        if (!card) return;
        const t0 = card.querySelector('[data-mit-ch="0"]');
        const t1 = card.querySelector('[data-mit-ch="1"]');
        const t2 = card.querySelector('[data-mit-ch="2"]');
        device.onDataUpdate = (channelsData) => {
            latestMitChannels = channelsData;
            if (t0) t0.textContent = channelsData[0] != null && typeof channelsData[0] === 'number' ? channelsData[0].toFixed(2) : '—';
            if (t1) t1.textContent = channelsData[1] != null && typeof channelsData[1] === 'number' ? channelsData[1].toFixed(2) : '—';
            if (t2) t2.textContent = channelsData[2] != null && typeof channelsData[2] === 'number' ? channelsData[2].toFixed(2) : '—';
            pushMitHistorySample();
        };
    }

    function bindM90DataHandler(device, channelId) {
        device.onDataUpdate = (result) => {
            const card = getChannelCardEl(channelId);
            if (!card) return;
            if (result.error) {
                log(`${getChannel(channelId)?.name || channelId}: М90 — ${result.error}`);
                return;
            }
            const tc = card.querySelector('[data-m90-tc]');
            const tk = card.querySelector('[data-m90-tk]');
            const sp = card.querySelector('[data-m90-sp]');
            const dt = card.querySelector('[data-m90-type]');
            const sn = card.querySelector('[data-m90-sn]');
            if (result.deviceType && dt) dt.textContent = result.deviceType;
            if (result.serialNumber && sn) sn.textContent = result.serialNumber;
            if (result.setpoint != null && sp) {
                sp.textContent = Number(result.setpoint).toFixed(2);
            }
            if (result.temperatureCelsius != null && tc) {
                tc.textContent = result.temperatureCelsius.toFixed(2);
            }
            if (result.temperatureKelvin != null && tk) {
                tk.textContent = `${result.temperatureKelvin.toFixed(2)} K`;
            }
        };
    }

    async function finalizeM90Connect(channel, device) {
        await sleep(500);
        try {
            log(`${channel.name}: проверка связи М90...`);
            const success = await device.checkConnection();
            if (success) {
                log(`${channel.name}: связь подтверждена, чтение температуры...`);
                const card = getChannelCardEl(channel.id);
                if (card) {
                    const dt = card.querySelector('[data-m90-type]');
                    if (dt) dt.textContent = 'ЭЛЕМЕР-КТ (тип 64)';
                }
                const temp = await device.obtainData();
                if (temp && temp.celsius != null && temp.celsius !== undefined) {
                    log(`${channel.name}: температура ${temp.celsius.toFixed(2)}°C`);
                    const card2 = getChannelCardEl(channel.id);
                    if (card2) {
                        const tc = card2.querySelector('[data-m90-tc]');
                        const tk = card2.querySelector('[data-m90-tk]');
                        const sp = card2.querySelector('[data-m90-sp]');
                        const sn = card2.querySelector('[data-m90-sn]');
                        if (tc) tc.textContent = temp.celsius.toFixed(2);
                        if (sp && temp.setpoint != null) sp.textContent = Number(temp.setpoint).toFixed(2);
                        if (tk && temp.kelvin != null && temp.kelvin !== undefined) {
                            tk.textContent = `${temp.kelvin.toFixed(2)} K`;
                        }
                        if (sn) sn.textContent = 'Не поддерживается';
                    }
                } else {
                    log(`${channel.name}: не удалось получить температуру`);
                }
            } else {
                log(`${channel.name}: проверка связи М90 не удалась`);
            }
        } catch (e) {
            log(`${channel.name}: ошибка после подключения М90 — ${e.message}`);
        }
    }

    function stopM90Polling() {
        if (m90PollIntervalId) {
            clearInterval(m90PollIntervalId);
            m90PollIntervalId = null;
        }
    }

    function maybeStartM90Polling() {
        if (!getConnectedM90Ids().length) {
            stopM90Polling();
            return;
        }
        if (m90PollIntervalId) return;
        m90PollIntervalId = setInterval(async () => {
            for (const id of m90ChannelOrder) {
                if (channelStatus.get(id) !== 'connected') continue;
                const dev = devices.get(id);
                if (!dev || typeof dev.obtainData !== 'function') continue;
                try {
                    const temp = await dev.obtainData();
                    const card = getChannelCardEl(id);
                    if (!card || !temp) continue;
                    const tc = card.querySelector('[data-m90-tc]');
                    const tk = card.querySelector('[data-m90-tk]');
                    const sp = card.querySelector('[data-m90-sp]');
                    if (temp.celsius != null && tc) tc.textContent = temp.celsius.toFixed(2);
                    if (temp.setpoint != null && sp) sp.textContent = Number(temp.setpoint).toFixed(2);
                    if (temp.kelvin != null && tk) tk.textContent = `${temp.kelvin.toFixed(2)} K`;
                } catch (_e) {}
            }
        }, 5000);
    }

    function renderChannels() {
        channelsList.innerHTML = '';
        channels.forEach((channel) => {
            setStatus(channel.id, 'disconnected');
            const wrapper = document.createElement('div');
            wrapper.className = 'card mb-2 border shadow-sm';
            wrapper.dataset.channelCard = channel.id;
            let extraBlock = '';
            if (channel.type === 'm90') {
                extraBlock = `
                    <div class="small mt-2 p-2 rounded bg-body-secondary border">
                        <div>Уставка (план): <strong>${channel.setpoint}</strong> °C</div>
                        <div>Уставка (факт): <strong><span data-m90-sp>—</span></strong> °C</div>
                        <div>Тип: <span data-m90-type>—</span></div>
                        <div class="font-monospace">T: <span data-m90-tc>—</span> °C · <span data-m90-tk>—</span></div>
                        <div class="text-muted">S/N: <span data-m90-sn>—</span></div>
                    </div>`;
            } else if (channel.type === 'mit') {
                extraBlock = `
                    <div class="small mt-2 p-2 rounded bg-body-secondary border">
                        Каналы: <span data-mit-ch="0">—</span> / <span data-mit-ch="1">—</span> / <span data-mit-ch="2">—</span> °C
                    </div>`;
            }
            wrapper.innerHTML = `
                <div class="card-body py-2">
                    <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
                        <div>
                            <strong>${channel.name}</strong>
                            <div class="small text-muted">VID ${pidLabel(usbVendorId)} / PID ${pidLabel(channel.pid)}</div>
                        </div>
                        <span class="badge rounded-pill text-bg-secondary" data-status="${channel.id}">Отключено</span>
                    </div>
                    <div class="d-flex flex-wrap gap-2 mt-2">
                        <button type="button" class="btn btn-primary btn-sm" data-connect-any="${channel.id}">Подключить</button>
                        <button type="button" class="btn btn-outline-primary btn-sm" data-connect-pid="${channel.id}">По PID</button>
                        <button type="button" class="btn btn-outline-danger btn-sm" data-disconnect="${channel.id}">Отключить</button>
                    </div>
                    ${extraBlock}
                </div>
            `;
            channelsList.appendChild(wrapper);
        });

        channelsList.querySelectorAll('[data-connect-any]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const ch = getChannel(btn.dataset.connectAny);
                if (ch) await connectChannel(ch, { skipRequestFilters: true });
            });
        });
        channelsList.querySelectorAll('[data-connect-pid]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const ch = getChannel(btn.dataset.connectPid);
                if (ch) await connectChannel(ch, { skipRequestFilters: false });
            });
        });
        channelsList.querySelectorAll('[data-disconnect]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const ch = getChannel(btn.dataset.disconnect);
                if (ch) await disconnectChannel(ch);
            });
        });
    }

    async function connectChannel(channel, options = {}) {
        if (!navigator.serial) {
            setStatus(channel.id, 'error');
            log('Web Serial недоступен.');
            return;
        }
        try {
            const dev = createDeviceForChannel(channel);
            if (channel.type === 'mit') bindMitDataHandler(dev, channel.id);
            if (channel.type === 'm90') bindM90DataHandler(dev, channel.id);
            setStatus(channel.id, 'connecting');
            log(`Порт: ${channel.name}...`);
            const filters = pidFilterFor(channel);
            const connectOpts = { filters, skipRequestFilters: Boolean(options.skipRequestFilters) };
            if (options.autoReconnect) {
                const ok = await dev.reconnectGranted(9600, { filters });
                if (!ok) {
                    setStatus(channel.id, 'disconnected');
                    return;
                }
            } else {
                await dev.connect(9600, connectOpts);
            }
            devices.set(channel.id, dev);
            setStatus(channel.id, 'connected');
            localStorage.setItem(ARC_KEY + channel.id, '1');
            if (channel.type === 'mit') {
                await dev.checkConnection();
                startMitPolling(channel, dev);
            }
            if (channel.type === 'm90') {
                await finalizeM90Connect(channel, dev);
                maybeStartM90Polling();
            }
            log(`${channel.name}: подключено.`);
        } catch (e) {
            setStatus(channel.id, 'error');
            log(`${channel.name}: ${e.message}`);
        }
    }

    async function initAllChannelsWithPrompt() {
        if (!navigator.serial) {
            log('Web Serial недоступен: первичная инициализация подключений невозможна.');
            return false;
        }
        let connectedCount = 0;
        for (const ch of channels) {
            try {
                await connectChannel(ch, { skipRequestFilters: false });
                if (channelStatus.get(ch.id) === 'connected') connectedCount += 1;
            } catch (_e) {}
        }
        if (connectedCount > 0) {
            markFirstInitDone();
            log(`Первичная инициализация завершена: подключено ${connectedCount}/${channels.length}. Далее будет автоподключение.`);
            return true;
        }
        log('Первичная инициализация: устройства не подключены. Повторите попытку после выбора портов.');
        return false;
    }

    function startMitPolling(channel, device) {
        if (mitPollingIntervalId) {
            clearInterval(mitPollingIntervalId);
            mitPollingIntervalId = null;
        }
        mitPollingIntervalId = setInterval(() => {
            if (!device || !device.isConnected) return;
            device.getTemperature().catch(() => {});
        }, 5000);
        device.getTemperature().catch(() => {});
    }

    function stopMitPolling() {
        if (mitPollingIntervalId) {
            clearInterval(mitPollingIntervalId);
            mitPollingIntervalId = null;
        }
    }

    async function pollMitOnce() {
        const ch = getChannel('mit_6015');
        const dev = devices.get('mit_6015');
        if (!ch || !dev) return;
        try {
            await dev.getTemperature();
        } catch (_e) {}
        pushMitHistorySample();
    }

    async function disconnectChannel(channel) {
        const dev = devices.get(channel.id);
        if (!dev) {
            setStatus(channel.id, 'disconnected');
            return;
        }
        try {
            await dev.disconnect();
            devices.delete(channel.id);
            setStatus(channel.id, 'disconnected');
            localStorage.removeItem(ARC_KEY + channel.id);
            if (channel.type === 'mit') {
                stopMitPolling();
                latestMitChannels = [null, null, null];
                mitHistory = [];
            }
            if (channel.type === 'm90') {
                const card = getChannelCardEl(channel.id);
                if (card) {
                    const tc = card.querySelector('[data-m90-tc]');
                    const tk = card.querySelector('[data-m90-tk]');
                    const sp = card.querySelector('[data-m90-sp]');
                    const dt = card.querySelector('[data-m90-type]');
                    const sn = card.querySelector('[data-m90-sn]');
                    if (tc) tc.textContent = '—';
                    if (tk) tk.textContent = '—';
                    if (sp) sp.textContent = '—';
                    if (dt) dt.textContent = '—';
                    if (sn) sn.textContent = '—';
                }
                if (!getConnectedM90Ids().length) stopM90Polling();
            }
        } catch (e) {
            setStatus(channel.id, 'error');
            log(`${channel.name}: отключение: ${e.message}`);
        }
    }

    function getConnectedDevice(id) {
        return devices.get(id) || null;
    }

    function parseHexReg(inputId) {
        const el = document.getElementById(inputId);
        const raw = (el?.value || '').trim();
        if (!raw) throw new Error(`Укажите регистр (${inputId})`);
        const v = parseInt(raw, 16);
        if (Number.isNaN(v) || v < 0 || v > 0xffff) throw new Error(`Неверный hex регистра: ${raw}`);
        return v;
    }

    function parseLkgHex() {
        const raw = document.getElementById('benchCorrLkgHex')?.value || '';
        const bytes = raw
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((x) => parseInt(x, 16))
            .filter((x) => Number.isFinite(x) && x >= 0 && x <= 255);
        if (bytes.length !== 4) throw new Error('Ключ ЛКГ: ровно 4 байта в hex');
        return bytes;
    }

    function getKorrektor() {
        const k = window.__benchKorrektor;
        if (!k) throw new Error('Подключите корректор ТМ-07 (блок ниже)');
        return k;
    }

    function parseLkgRegHex() {
        const raw = (document.getElementById('benchCorrLkgRegHex')?.value || '0493').trim();
        const v = parseInt(raw, 16);
        if (Number.isNaN(v) || v < 0 || v > 0xffff) throw new Error('Неверный hex адреса регистра ЛКГ');
        return v;
    }

    function parseBenchLockStatusReg() {
        const raw = (document.getElementById('benchCorrLockStatusHex')?.value || '0019').trim();
        const v = parseInt(raw, 16);
        if (Number.isNaN(v) || v < 0 || v > 0xffff) return 0x0019;
        return v;
    }

    const POST_LKG_MS = 150;

    async function logCalibrationLockHint(k) {
        if (typeof k.readHolding !== 'function') return { open: null };
        const reg = parseBenchLockStatusReg();
        try {
            const resp = await k.readHolding(reg, 1);
            const val = resp[3] | (resp[4] << 8);
            const open = (val & 1) === 1;
            log(
                `REG_STATUS_LOCK 0x${reg.toString(16)}: raw=0x${val.toString(16).padStart(4, '0')} (${val}) — бит0: калибр.замок ${open ? 'ОТКРЫТ' : 'ЗАКРЫТ'}`
            );
            if (!open) {
                log(
                    '→ Пока бит0=0, запись калибровки обычно даёт Modbus 0x03. Удерживайте SA2 ≥6 с; при открытом замке сверьте адрес REG_STATUS_LOCK в файле карты для map из идентификации.'
                );
            }
            return { open, reg, raw: val };
        } catch (e) {
            log(`REG_STATUS_LOCK 0x${reg.toString(16)}: не прочитан — ${e.message}. Укажите верный hex в «Статус замков».`);
            return { open: null, reg };
        }
    }

    async function writeCorrTemperatureCalibration(refC) {
        const k = getKorrektor();
        const regW = parseHexReg('benchCorrRegTWrite');
        const lkg = parseLkgHex();
        const lkgReg = parseLkgRegHex();
        const lh = await logCalibrationLockHint(k);
        try {
            await k.writeLkgKey(lkg, lkgReg);
        } catch (e) {
            throw new Error(`Запись ЛКГ 0x${lkgReg.toString(16)}: ${e.message}`);
        }
        await sleep(POST_LKG_MS);
        try {
            await k.writeFloat32LE(regW, refC);
        } catch (e) {
            let extra =
                /0x3|0x03/i.test(String(e.message)) || String(e.message).includes('недопустимое')
                    ? ' Проверьте: SA2; ключ ЛКГ; поля «Статус замков» и «Писать калибр. T» по карте map.'
                    : '';
            if (lh && lh.open === false) {
                extra = ` [замок ЗАКРЫТ по чтению 0x${lh.reg.toString(16)}] ${extra}`;
            }
            throw new Error(`Запись калибр. T float 0x${regW.toString(16)}: ${e.message}.${extra}`);
        }
        log(`Корректор: записана калибровочная T=${refC.toFixed(3)} °C -> 0x${regW.toString(16)} (ЛКГ 0x${lkgReg.toString(16)})`);
    }

    async function readCorrTemperature() {
        const k = getKorrektor();
        const reg = parseHexReg('benchCorrRegTRead');
        const v = await k.readFloat32LE(reg);
        return v;
    }

    async function readCorrPressureAbs() {
        const k = getKorrektor();
        const reg = parseHexReg('benchCorrRegPabs');
        return k.readFloat32LE(reg);
    }

    async function readCorrPressureDiff() {
        const k = getKorrektor();
        const reg = parseHexReg('benchCorrRegPdiff');
        return k.readFloat32LE(reg);
    }

    function showProceed(caption, hint, buttonLabel) {
        if (proceedCaption) proceedCaption.textContent = caption || 'Шаг';
        if (proceedHint) proceedHint.textContent = hint || '';
        setProceedButtonLabel(buttonLabel);
        if (proceedOverlay) proceedOverlay.classList.remove('d-none');
        return new Promise((resolve) => {
            resolveProceed = resolve;
        });
    }

    function hideProceed() {
        if (proceedOverlay) proceedOverlay.classList.add('d-none');
        setProceedButtonLabel(DEFAULT_PROCEED_BTN_LABEL);
    }

    async function waitForProceed(caption, hint, buttonLabel) {
        await showProceed(caption, hint, buttonLabel);
        hideProceed();
    }

    async function runM90AllRegulation() {
        const connected = getConnectedM90Ids();
        if (!connected.length) {
            log('Нет подключённых M90 — пропуск регуляции.');
            return;
        }
        const ramp = readRampMinutes();
        const stability = readStabilityMinutes();
        const controlMinutes = Math.min(60, Math.max(ramp, stability + 1));
        const tol = readTempTolerance();

        for (const id of connected) {
            ensureRunning();
            const dev = getConnectedDevice(id);
            const ch = getChannel(id);
            if (!dev || typeof dev.setCalibrationTemperatureWithRate !== 'function') continue;
            setWorkflowStatus(`${ch.name}: запуск уставки ${ch.setpoint} °C...`);
            const cur = await dev.obtainData();
            const curC = cur && cur.celsius != null ? cur.celsius : 0;
            const diff = Math.abs(ch.setpoint - curC);
            const customSpeed = ramp > 0 ? Math.round((diff / ramp) * 10) / 10 : 0;
            const ok = await dev.setCalibrationTemperatureWithRate(ch.setpoint, controlMinutes, customSpeed);
            if (!ok) throw new Error(`${ch.name}: не удалось запустить регулятор`);
            log(`${ch.name}: уставка ${ch.setpoint} °C отправлена (control=${controlMinutes} мин, ramp=${ramp} мин).`);
        }
    }

    async function waitAllM90Stable() {
        const connected = getConnectedM90Ids();
        if (!connected.length) return;
        const tol = readTempTolerance();
        const stability = readStabilityMinutes();
        const requiredMs = stability * 60 * 1000;
        const timeoutMs = 180 * 60 * 1000;
        const startTs = Date.now();
        let stableSince = null;

        setWorkflowStatus(`Ожидание стабилизации M90 (±${tol} °C, ≥ ${stability} мин)...`);

        while (Date.now() - startTs < timeoutMs) {
            ensureRunning();
            const readings = await Promise.all(
                connected.map(async (id) => {
                    const dev = getConnectedDevice(id);
                    const ch = getChannel(id);
                    const data = await dev.obtainData();
                    const c = data && data.celsius != null ? data.celsius : null;
                    const ok = c != null && !Number.isNaN(c) && Math.abs(c - ch.setpoint) <= tol;
                    return { id, ok, c, sp: ch.setpoint, name: ch.name };
                })
            );
            const allOk = readings.every((r) => r.ok);
            if (allOk) {
                if (stableSince === null) stableSince = Date.now();
                if (Date.now() - stableSince >= requiredMs) {
                    readings.forEach((r) => log(`${r.name}: стабильно ${r.c != null ? r.c.toFixed(2) : '—'} °C (уставка ${r.sp}).`));
                    return;
                }
            } else {
                stableSince = null;
            }
            await sleep(5000);
        }
        throw new Error('Таймаут стабилизации M90');
    }

    async function waitMitPlateau() {
        if (!isMitConnected()) {
            throw new Error('Для плато МИТ нужен подключённый МИТ 8');
        }
        const flatMin = readFlatMinutes();
        const flatTol = readFlatTol();
        const requiredMs = flatMin * 60 * 1000;
        const timeoutMs = 90 * 60 * 1000;
        const startTs = Date.now();

        setWorkflowStatus(`Плато МИТ: разброс ≤ ${flatTol} °C не менее ${flatMin} мин...`);

        while (Date.now() - startTs < timeoutMs) {
            ensureRunning();
            await pollMitOnce();
            const now = Date.now();
            const slice = mitHistory.filter((x) => now - x.ts <= requiredMs + 5000);
            if (slice.length >= 3) {
                const refs = slice.map((x) => x.ref);
                const mn = Math.min(...refs);
                const mx = Math.max(...refs);
                const spanOk = mx - mn <= flatTol;
                if (spanOk && now - slice[0].ts >= requiredMs) {
                    const last = refs[refs.length - 1];
                    log(`МИТ плато: разброс ${(mx - mn).toFixed(3)} °C, эталон ≈ ${last.toFixed(3)} °C`);
                    return last;
                }
            }
            await sleep(4000);
        }
        throw new Error('Таймаут ожидания плато МИТ');
    }

    async function phaseM90Mit() {
        setPhaseState('m90_mit', 'running');
        setScenarioPhaseTitle('Фаза 1: M90 + МИТ');
        await runM90AllRegulation();
        await waitAllM90Stable();
        if (isMitConnected()) {
            await pollMitOnce();
            const r = getMitRef();
            log(`Эталон МИТ (сейчас): ${r != null ? r.toFixed(3) : '—'} °C`);
        }
        setPhaseState('m90_mit', 'done');
        setWorkflowStatus('Фаза 1 завершена.');
    }

    async function phaseCalMin() {
        setPhaseState('cal_min', 'running');
        setScenarioPhaseTitle('Фаза 2: MIN +20');
        await waitForProceed(
            'Термодатчик корректора в среде +20 °C (M90 #1)',
            'После установки нажмите «Продолжить» — начнётся отсчёт плато МИТ.'
        );
        const ref = await waitMitPlateau();
        await writeCorrTemperatureCalibration(ref);
        setPhaseState('cal_min', 'done');
        setWorkflowStatus('Фаза 2: записан MIN.');
    }

    async function phaseCalMax() {
        setPhaseState('cal_max', 'running');
        setScenarioPhaseTitle('Фаза 3: MAX +20');
        await waitForProceed(
            'Термодатчик корректора в среде +20 °C (M90 #1)',
            'Нажмите «Продолжить» для старта контроля плато МИТ.'
        );
        const ref = await waitMitPlateau();
        await writeCorrTemperatureCalibration(ref);
        setPhaseState('cal_max', 'done');
        setWorkflowStatus('Фаза 3: записан MAX.');
    }

    async function phaseTempVerify() {
        setPhaseState('temp_verify', 'running');
        setScenarioPhaseTitle('Фаза 4: поверка T');
        const points = [20];
        const tol = readTempTolerance();
        let okAll = true;

        for (const p of points) {
            ensureRunning();
            await waitForProceed(`Поверка T: среда ${p} °C`, 'Установите датчик в соответствующую камеру, затем Продолжить.');
            await pollMitOnce();
            let ref = getMitRef();
            if (ref == null) {
                const manual = window.prompt(`МИТ недоступен. Введите эталон T для точки ${p} °C:`, String(p));
                if (manual === null) throw new Error('Отмена');
                ref = parseFloat(manual.replace(',', '.'));
                if (Number.isNaN(ref)) throw new Error('Неверное число');
            }
            parseHexReg('benchCorrRegTRead');
            const corrT = await readCorrTemperature();
            const d = Math.abs(corrT - ref);
            const ok = d <= tol;
            log(`T @ ${p} °C: эталон ${ref.toFixed(3)}, корректор ${corrT.toFixed(3)}, Δ=${d.toFixed(3)} → ${ok ? 'OK' : 'FAIL'}`);
            okAll = okAll && ok;
        }

        setPhaseState('temp_verify', okAll ? 'done' : 'failed');
        if (!okAll) throw new Error('Поверка температуры: есть FAIL — перекалибровка.');
        setWorkflowStatus('Фаза 4: поверка T пройдена.');
    }

    async function phaseImpulse() {
        setPhaseState('impulse', 'running');
        setScenarioPhaseTitle('Фаза 5: импульсы');
        await waitForProceed(
            'Импульсы — ручная работа',
            'Перейдите к импульсам на стенде и выполните их по инструкции. Обмен по COM для этой фазы не используется.',
            'Понятно, перехожу к импульсам',
        );
        await waitForProceed(
            'Подтверждение',
            'Когда импульсы на стенде завершены, нажмите кнопку ниже — фаза будет отмечена выполненной.',
            'Импульсы выполнены',
        );
        setPhaseState('impulse', 'done');
        setWorkflowStatus('Фаза 5: импульсы подтверждены оператором.');
    }

    function buildFivePoints(pmin, pmax) {
        if (pmax <= pmin) throw new Error('Для 5 точек: макс > мин');
        const step = (pmax - pmin) / 4;
        return [0, 1, 2, 3, 4].map((i) => pmin + step * i);
    }

    function buildDiffThreeParts(pmin, pmax) {
        if (pmax <= pmin) throw new Error('Диапазон перепада: макс > мин');
        return [pmin, (pmin + pmax) / 2, pmax];
    }

    async function waitPkdOptional(targetKpa) {
        const pkd = window.__benchPkd;
        if (!pkd || !pkd.isConnected) {
            log('ПКД не подключён — эталон = целевая точка (проверьте вручную).');
            return targetKpa;
        }
        const tt = readPkdTargetTol();
        const t0 = Date.now();
        const timeoutMs = 10 * 60 * 1000;
        if (typeof pkd.initArmMode === 'function') {
            try {
                await pkd.initArmMode();
            } catch (_e) {}
        }
        while (Date.now() - t0 < timeoutMs) {
            ensureRunning();
            const v = await pkd.readMeasurement(1);
            if (Math.abs(v - targetKpa) <= tt) {
                log(`ПКД эталон ≈ ${v.toFixed(5)} кПа (цель ${Number(targetKpa).toFixed(5)})`);
                return v;
            }
            await sleep(2000);
        }
        throw new Error('Таймаут: эталон ПКД не сошёлся с целью');
    }

    async function phasePressureAbs() {
        setPhaseState('pressure_abs', 'running');
        setScenarioPhaseTitle('Фаза 6: P абс.');
        const pmin = parseFloat(absPminInput?.value);
        const pmax = parseFloat(absPmaxInput?.value);
        if (Number.isNaN(pmin) || Number.isNaN(pmax)) throw new Error('Укажите мин/макс абс. давления');
        const pts = buildFivePoints(pmin, pmax);
        const pTol = readPressureTol();
        parseHexReg('benchCorrRegPabs');

        let allOk = true;
        for (let i = 0; i < pts.length; i += 1) {
            ensureRunning();
            const target = pts[i];
            await waitForProceed(
                `Абс. давление: точка ${i + 1}/5`,
                `Выставьте на стенде ≈ ${target.toFixed(3)} кПа. Нажмите «Продолжить» — опрос ПКД и корректора.`
            );
            let refP = target;
            try {
                refP = await waitPkdOptional(target);
            } catch (e) {
                log(`ПКД: ${e.message} — введите эталон вручную.`);
                const manual = window.prompt('Эталон P, кПа (как на ПКД или манометре):', String(target));
                if (manual === null) throw new Error('Отмена');
                refP = parseFloat(manual.replace(',', '.'));
                if (Number.isNaN(refP)) throw new Error('Неверное число');
            }
            const corrP = await readCorrPressureAbs();
            const d = Math.abs(corrP - refP);
            const ok = d <= pTol;
            log(`Абс. точка ${i + 1}: эталон ${refP.toFixed(3)}, корректор ${corrP.toFixed(3)}, Δ=${d.toFixed(3)} → ${ok ? 'OK' : 'FAIL'}`);
            allOk = allOk && ok;
        }

        setPhaseState('pressure_abs', allOk ? 'done' : 'failed');
        if (!allOk) throw new Error('Абс. давление: есть FAIL — датчик брак.');
        setWorkflowStatus('Фаза 6 завершена (абс.).');
    }

    async function phasePressureDiff() {
        setPhaseState('pressure_diff', 'running');
        setScenarioPhaseTitle('Фаза 7: P перепада');
        const pmin = parseFloat(diffPminInput?.value);
        const pmax = parseFloat(diffPmaxInput?.value);
        if (Number.isNaN(pmin) || Number.isNaN(pmax)) throw new Error('Укажите диапазон перепада');
        const pts = buildDiffThreeParts(pmin, pmax);
        const pTol = readPressureTol();
        parseHexReg('benchCorrRegPdiff');

        let allOk = true;
        for (let i = 0; i < pts.length; i += 1) {
            ensureRunning();
            const target = pts[i];
            await waitForProceed(
                `Перепад: точка ${i + 1}/3`,
                `Выставьте перепад ≈ ${target.toFixed(3)} кПа (треть диапазона). Продолжить — опрос.`
            );
            let refP = target;
            try {
                refP = await waitPkdOptional(target);
            } catch (e) {
                log(`ПКД: ${e.message} — вручную.`);
                const manual = window.prompt('Эталон перепада, кПа:', String(target));
                if (manual === null) throw new Error('Отмена');
                refP = parseFloat(manual.replace(',', '.'));
                if (Number.isNaN(refP)) throw new Error('Неверное число');
            }
            const corrP = await readCorrPressureDiff();
            const d = Math.abs(corrP - refP);
            const ok = d <= pTol;
            log(`Перепад ${i + 1}: эталон ${refP.toFixed(3)}, корректор ${corrP.toFixed(3)}, Δ=${d.toFixed(3)} → ${ok ? 'OK' : 'FAIL'}`);
            allOk = allOk && ok;
        }

        setPhaseState('pressure_diff', allOk ? 'done' : 'failed');
        if (!allOk) throw new Error('Перепад: есть FAIL — датчик брак.');
        setWorkflowStatus('Фаза 7 завершена.');
    }

    async function runPhase(name) {
        activePhaseId = name;
        phaseStopRequests.delete(name);
        if (PHASE_TO_MACRO[name] != null) setMacroWorkflowStep(PHASE_TO_MACRO[name]);
        try {
            switch (name) {
                case 'm90_mit':
                    await phaseM90Mit();
                    break;
                case 'cal_min':
                    await phaseCalMin();
                    break;
                case 'cal_max':
                    await phaseCalMax();
                    break;
                case 'temp_verify':
                    await phaseTempVerify();
                    break;
                case 'impulse':
                    await phaseImpulse();
                    break;
                case 'pressure_abs':
                    await phasePressureAbs();
                    break;
                case 'pressure_diff':
                    await phasePressureDiff();
                    break;
                default:
                    break;
            }
            await saveProgressToDb('phase_done', name);
        } catch (e) {
            await saveProgressToDb('phase_error', name);
            throw e;
        } finally {
            if (activePhaseId === name) activePhaseId = null;
        }
    }

    async function stopDevicesForPhase(phaseId) {
        if (['m90_mit', 'cal_min', 'cal_max', 'temp_verify'].includes(phaseId)) {
            const ids = getConnectedM90Ids();
            for (const id of ids) {
                const dev = devices.get(id);
                if (!dev || typeof dev.stopCalibration !== 'function') continue;
                try {
                    await dev.stopCalibration();
                    log(`${getChannel(id)?.name || id}: регулятор остановлен для фазы ${phaseId}.`);
                } catch (e) {
                    log(`${getChannel(id)?.name || id}: ошибка остановки регулятора: ${e.message}`);
                }
            }
        }
        if (['pressure_abs', 'pressure_diff'].includes(phaseId)) {
            const pkd = window.__benchPkd;
            if (pkd && pkd.isConnected && pkd.armInitialized && typeof pkd.exitArmMode === 'function') {
                try {
                    await pkd.exitArmMode();
                    log('ПКД: выход из ARM для остановки фазы давления.');
                } catch (e) {
                    log(`ПКД: ошибка выхода из ARM: ${e.message}`);
                }
            }
        }
    }

    async function stopPhase(phaseId) {
        phaseStopRequests.add(phaseId);
        if (activePhaseId !== phaseId) {
            log(`Фаза ${phaseId} не активна, запрос остановки сохранен.`);
            return;
        }
        await stopDevicesForPhase(phaseId);
        setPhaseState(phaseId, 'stopped');
        scenarioAborted = true;
        scenarioRunning = false;
        if (resolveProceed) {
            const r = resolveProceed;
            resolveProceed = null;
            r();
        }
        hideProceed();
        setWorkflowStatus(`Фаза ${phaseId} остановлена оператором.`);
        await saveProgressToDb('phase_stopped', phaseId);
    }

    async function runFullScenario(startIndex = 0, isResume = false) {
        scenarioRunning = true;
        scenarioAborted = false;
        fullScenarioActive = true;
        currentFullPhaseIndex = Math.max(0, startIndex);
        if (!isResume || !reportStartedAt) reportStartedAt = Date.now();
        if (!isResume) {
            PHASE_ORDER.forEach((id) => setPhaseState(id, 'pending'));
            clearScenarioState();
            updateResumeButton(null);
        } else {
            for (let i = 0; i < startIndex; i += 1) {
                setPhaseState(PHASE_ORDER[i], 'done');
            }
        }
        runFullBtn.disabled = true;
        if (resumeScenarioBtn) resumeScenarioBtn.disabled = true;
        stopScenarioBtn.disabled = false;
        try {
            for (let i = startIndex; i < PHASE_ORDER.length; i += 1) {
                currentFullPhaseIndex = i;
                saveScenarioState(i);
                ensureRunning();
                const ph = PHASE_ORDER[i];
                await runPhase(ph);
                saveScenarioState(i + 1);
            }
            setScenarioPhaseTitle('Готово');
            setWorkflowStatus('Полный сценарий завершён.');
            clearScenarioState();
            updateResumeButton(null);
            setMacroWorkflowStep(7);
            renderCycleReport('Цикл завершен успешно.', buildCycleReport('Успешно'));
            await saveProgressToDb('cycle_done', PHASE_ORDER[PHASE_ORDER.length - 1]);
        } catch (e) {
            if (e.message === 'Сценарий остановлен') {
                saveScenarioState(currentFullPhaseIndex);
                updateResumeButton(currentFullPhaseIndex);
                syncMacroStepWithSavedResume();
                setWorkflowStatus('Остановлено.');
                renderCycleReport('Цикл приостановлен.', buildCycleReport('Приостановлен оператором'));
                await saveProgressToDb('cycle_paused', PHASE_ORDER[currentFullPhaseIndex] || null);
            } else {
                log(`Ошибка: ${e.message}`);
                saveScenarioState(currentFullPhaseIndex);
                updateResumeButton(currentFullPhaseIndex);
                syncMacroStepWithSavedResume();
                setWorkflowStatus(`Ошибка: ${e.message}`);
                renderCycleReport('Цикл завершен с ошибкой.', buildCycleReport('Ошибка', e.message));
                await saveProgressToDb('cycle_error', PHASE_ORDER[currentFullPhaseIndex] || null);
            }
        } finally {
            scenarioRunning = false;
            fullScenarioActive = false;
            runFullBtn.disabled = false;
            stopScenarioBtn.disabled = true;
            hideProceed();
        }
    }

    function stopScenario() {
        scenarioAborted = true;
        scenarioRunning = false;
        if (fullScenarioActive) {
            saveScenarioState(currentFullPhaseIndex);
            updateResumeButton(currentFullPhaseIndex);
        }
        syncMacroStepWithSavedResume();
        if (resolveProceed) {
            const r = resolveProceed;
            resolveProceed = null;
            r();
        }
        hideProceed();
        setWorkflowStatus('Остановлено оператором.');
        stopScenarioBtn.disabled = true;
        runFullBtn.disabled = false;
        saveProgressToDb('cycle_stopped', PHASE_ORDER[currentFullPhaseIndex] || null);
    }

    if (proceedBtn) {
        proceedBtn.addEventListener('click', () => {
            if (resolveProceed) {
                const r = resolveProceed;
                resolveProceed = null;
                r();
            }
            hideProceed();
        });
    }

    if (clearLogBtn) {
        clearLogBtn.addEventListener('click', () => {
            logEl.innerHTML = '';
        });
    }

    if (exportLogBtn) {
        exportLogBtn.addEventListener('click', () => exportJournalToFile());
    }

    if (saveBenchSettingsBtn) {
        saveBenchSettingsBtn.addEventListener('click', () => saveBenchSettingsToStorage(true));
    }
    if (loadBenchSettingsBtn) {
        loadBenchSettingsBtn.addEventListener('click', () => loadBenchSettingsFromStorage(true));
    }
    if (resetBenchSettingsBtn) {
        resetBenchSettingsBtn.addEventListener('click', () => resetBenchSettingsToDefaults(true));
    }

    if (benchCorrSerialInput) {
        benchCorrSerialInput.addEventListener('change', () => {
            const normalized = normalizeCorrSerial(benchCorrSerialInput.value);
            if (!normalized) {
                setSerialLookupStatus('Серийный номер не распознан. Допустимы A-Z, 0-9, . _ - (3..40).', 'warn');
                return;
            }
            benchCorrSerialInput.value = normalized;
            saveSerialToStorage(normalized);
            setSerialLookupStatus(`SN ${normalized} сохранён локально. Нажмите «Проверить в БД».`, 'info');
        });
    }

    if (benchCheckSerialBtn) {
        benchCheckSerialBtn.addEventListener('click', async () => {
            try {
                const serial = normalizeCorrSerial(benchCorrSerialInput?.value || '');
                await lookupProgressBySerial(serial, true);
            } catch (e) {
                setSerialLookupStatus(e.message, 'error');
            }
        });
    }

    if (benchReadSerialBtn) {
        benchReadSerialBtn.addEventListener('click', async () => {
            try {
                const serial = await readSerialFromDevice();
                await lookupProgressBySerial(serial, true);
            } catch (e) {
                setSerialLookupStatus(`Считывание SN: ${e.message}`, 'error');
            }
        });
    }

    bindBenchSettingsPersistence();

    document.querySelectorAll('[data-run-phase]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            if (scenarioRunning) {
                log('Сценарий уже выполняется — дождитесь завершения или нажмите «Стоп».');
                return;
            }
            const ph = btn.getAttribute('data-run-phase');
            scenarioRunning = true;
            scenarioAborted = false;
            if (runFullBtn) runFullBtn.disabled = true;
            if (stopScenarioBtn) stopScenarioBtn.disabled = false;
            try {
                await runPhase(ph);
                notifyMacroPhaseComplete(ph);
            } catch (e) {
                log(`Фаза: ${e.message}`);
            } finally {
                scenarioRunning = false;
                if (runFullBtn) runFullBtn.disabled = false;
                if (stopScenarioBtn) stopScenarioBtn.disabled = true;
                hideProceed();
            }
        });
    });
    document.querySelectorAll('[data-stop-phase]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const ph = btn.getAttribute('data-stop-phase');
            await stopPhase(ph);
        });
    });

    if (runFullBtn) {
        runFullBtn.addEventListener('click', () => {
            reportStartedAt = Date.now();
            renderCycleReport('Цикл выполняется...', 'Сбор данных по фазам...');
            runFullScenario(0, false);
        });
    }
    if (resumeScenarioBtn) {
        resumeScenarioBtn.addEventListener('click', () => {
            if (scenarioRunning) return;
            const resumeIndex = loadScenarioState();
            if (!Number.isInteger(resumeIndex)) {
                updateResumeButton(null);
                log('Нет сохраненной точки продолжения.');
                return;
            }
            if (!reportStartedAt) reportStartedAt = Date.now();
            renderCycleReport('Цикл возобновлен...', 'Выполнение продолжается с сохраненной фазы.');
            runFullScenario(resumeIndex, true);
        });
    }
    if (stopScenarioBtn) {
        stopScenarioBtn.addEventListener('click', () => stopScenario());
    }
    if (autoReconnectToggleBtn) {
        autoReconnectToggleBtn.addEventListener('click', () => {
            const next = !isAutoConnectEnabled();
            setAutoConnectEnabled(next);
            renderAutoConnectToggle();
            log(`Автоподключение: ${next ? 'включено' : 'выключено'}.`);
        });
    }

    (async () => {
        try {
            const settings =
                window.TM07_SETTINGS && window.TM07_SETTINGS.getPublicSettings
                    ? await window.TM07_SETTINGS.getPublicSettings()
                    : await fetch('/api/admin-settings.php?action=public')
                          .then(function (r) {
                              return r.json();
                          })
                          .then(function (j) {
                              return j.success ? j.settings : null;
                          });
            if (settings) {
                const s = settings;
                const vid = parseHexUsbId(s.usb?.vendorIdHex);
                if (vid) usbVendorId = vid;
                const sch = s.m90?.channels;
                if (Array.isArray(sch) && sch.length > 0) {
                    const src = sch[0] || {};
                    const m90id = String(src.id || '').trim() || 'm90_6045';
                    const m90pid = parseHexUsbId(src.productIdHex) || 0x6045;
                    const m90nameBase = src.label || src.id || 'M90 #1';
                    const m90part = [{
                        id: m90id,
                        type: 'm90',
                        name: `${m90nameBase} (+20)`,
                        pid: m90pid,
                        setpoint: 20
                    }];
                    const mit = s.mit || {};
                    const mitPid = parseHexUsbId(mit.productIdHex || '0x6015') || 0x6015;
                    channels = [...m90part, { id: 'mit_6015', type: 'mit', name: mit.label || 'МИТ 8', pid: mitPid }];
                    m90ChannelOrder = m90part.map((c) => c.id);
                }
                const br = s.benchRegisters;
                if (br) {
                    const map = [
                        ['benchCorrRegTRead', 'corrRegTRead'],
                        ['benchCorrRegTWrite', 'corrRegTWrite'],
                        ['benchCorrRegPabs', 'corrRegPabs'],
                        ['benchCorrRegPdiff', 'corrRegPdiff'],
                        ['benchCorrLkgHex', 'corrLkgHex'],
                    ];
                    map.forEach(([id, key]) => {
                        const el = document.getElementById(id);
                        if (el && br[key] != null && br[key] !== '') el.value = String(br[key]);
                    });
                }
                const sc = s.benchScenarioDefaults;
                if (sc) {
                    const pairs = [
                        ['m90StabTime', 'm90RampMinutes'],
                        ['stabilityMinutes', 'stabilityMinutes'],
                        ['tempTolerance', 'tempToleranceC'],
                        ['flatMinutes', 'flatMinutes'],
                        ['flatTol', 'flatTolC'],
                        ['pressureTolKpa', 'pressureTolKpa'],
                        ['pkdTargetTol', 'pkdTargetTolKpa'],
                        ['absPmin', 'absPmin'],
                        ['absPmax', 'absPmax'],
                        ['diffPmin', 'diffPmin'],
                        ['diffPmax', 'diffPmax'],
                    ];
                    pairs.forEach(([id, key]) => {
                        const el = document.getElementById(id);
                        if (el && sc[key] != null && sc[key] !== '') el.value = String(sc[key]);
                    });
                }
                const tm = s.tm07;
                if (tm) {
                    const baud = document.getElementById('corrBaud');
                    if (baud && tm.defaultBaudRate != null) baud.value = String(tm.defaultBaudRate);
                    const addr = document.getElementById('corrAddress');
                    if (addr && tm.modbusAddress != null) addr.value = String(tm.modbusAddress);
                    const lkgReg = document.getElementById('benchCorrLkgRegHex');
                    if (lkgReg && tm.regLkgHex != null && String(tm.regLkgHex).trim() !== '') {
                        lkgReg.value = String(tm.regLkgHex).trim();
                    }
                }
                log('Профиль приборов с сервера применён (до локального профиля браузера).');
            }
        } catch (_e) {}

        if (loadBenchSettingsFromStorage(false)) {
            log('Параметры стенда восстановлены из сохранения браузера.');
        }

        renderChannels();
        renderAutoConnectToggle();
        PHASE_ORDER.forEach((id) => setPhaseState(id, 'pending'));
        renderCycleReport('Отчет появится после завершения полного цикла.', 'Отчет пока не сформирован.');
        const localSerial = normalizeCorrSerial(localStorage.getItem(CORR_SERIAL_KEY) || '');
        if (localSerial && benchCorrSerialInput) {
            benchCorrSerialInput.value = localSerial;
            setSerialLookupStatus(`SN ${localSerial} восстановлен из браузера. Проверяю БД...`, 'info');
            try {
                await lookupProgressBySerial(localSerial, true);
            } catch (e) {
                setSerialLookupStatus(`БД SN ${localSerial}: ${e.message}`, 'error');
            }
        }
        const resumeIndex = loadScenarioState();
        updateResumeButton(resumeIndex);
        if (Number.isInteger(resumeIndex)) {
            for (let i = 0; i < resumeIndex; i += 1) {
                setPhaseState(PHASE_ORDER[i], 'done');
            }
            log(`Доступно продолжение цикла с фазы ${resumeIndex + 1}.`);
            setMacroWorkflowStep(macroStepFromResumeNextIndex(resumeIndex));
        } else {
            setMacroWorkflowStep(1);
        }

        if (!navigator.serial) {
            log('Web Serial не поддерживается.');
        }

        if (isAutoConnectEnabled()) {
            channels.forEach((ch) => {
                if (localStorage.getItem(ARC_KEY + ch.id) === '1') {
                    connectChannel(ch, { autoReconnect: true });
                }
            });
        }

        if (isAutoConnectEnabled() && !isFirstInitDone()) {
            log('Первый запуск: для первичной привязки устройств кликните по странице и подтвердите выбор портов.');
            const firstInitClickHandler = async () => {
                document.removeEventListener('click', firstInitClickHandler, true);
                await initAllChannelsWithPrompt();
            };
            document.addEventListener('click', firstInitClickHandler, true);
        }
    })();
});
