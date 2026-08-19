/**
 * Печать шильда: PDF + локальный Windows-агент (без BarTender).
 */
(function () {
    'use strict';

    let cachedConfig = null;
    let configPromise = null;

    function $(id) {
        return document.getElementById(id);
    }

    function kindFromSerial(serial) {
        const s = String(serial || '').trim();
        if (s.startsWith('400')) {
            return 'complex';
        }
        return 'corrector';
    }

    function notifyUser(message) {
        if (typeof window.plog === 'function') {
            window.plog(message);
        }
        if (typeof window.alert === 'function') {
            window.alert(message);
        }
    }

    async function loadConfig(force) {
        if (cachedConfig && !force) {
            return cachedConfig;
        }
        if (configPromise && !force) {
            return configPromise;
        }
        configPromise = fetch('/api/nameplate-print.php?action=config', { credentials: 'same-origin' })
            .then(function (resp) {
                return resp.json();
            })
            .then(function (data) {
                if (!data || !data.ok || !data.config) {
                    throw new Error('Не удалось загрузить настройки печати шильдика');
                }
                cachedConfig = data.config;
                window.TM07_NAMEPLATE_CONFIG = cachedConfig;
                return cachedConfig;
            })
            .finally(function () {
                configPromise = null;
            });
        return configPromise;
    }

    function getOrderRow() {
        try {
            const raw = sessionStorage.getItem('order1c_param_lastOrder') || localStorage.getItem('order1c_param_lastOrder');
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            return parsed && parsed.row ? parsed.row : null;
        } catch (_e) {
            return null;
        }
    }

    function buildOrderTitleFromRow(row) {
        if (!row) {
            return '';
        }
        const nom = String(row['НаименованиеПолное_Номенклатуры'] || '').trim();
        const ch = String(row['НаименованиеПолное_Характеристики'] || '').trim();
        if (nom && ch) {
            return nom + ' (' + ch + ')';
        }
        return nom || ch || '';
    }

    function buildOrderTextBlob(row) {
        if (!row) {
            return '';
        }
        const title = buildOrderTitleFromRow(row);
        const ToParam = window.TM07Order1cToParam;
        if (ToParam && typeof ToParam.collectOrderTextBlob === 'function') {
            return ToParam.collectOrderTextBlob(row, title);
        }
        return title;
    }

    function readParamVal(stepId) {
        const el = $('val_' + stepId);
        return el ? String(el.value || '').trim() : '';
    }

    function extractConfigBlock(text) {
        const s = String(text || '');
        const m = s.match(/\(\s*[ИI]\s*[1-4]\s*;/iu);
        if (!m || m.index == null) {
            return '';
        }
        let start = m.index;
        let depth = 0;
        for (let i = start; i < s.length; i += 1) {
            if (s[i] === '(') {
                depth += 1;
            } else if (s[i] === ')') {
                depth -= 1;
                if (depth === 0) {
                    return s.slice(start + 1, i).replace(/\s+/g, '').replace(/\./g, ',');
                }
            }
        }
        return '';
    }

    function collectConfigSourceTexts(row, passportPayload) {
        const texts = [];
        if (row) {
            texts.push(buildOrderTextBlob(row));
            texts.push(buildOrderTitleFromRow(row));
            const nom = String(row['НаименованиеПолное_Номенклатуры'] || '').trim();
            const ch = String(row['НаименованиеПолное_Характеристики'] || '').trim();
            if (nom) {
                texts.push(nom);
            }
            if (ch) {
                texts.push(ch);
            }
        }
        if (passportPayload) {
            ['correctorTitle', 'complexTitle', 'meterNote'].forEach(function (key) {
                if (passportPayload[key]) {
                    texts.push(String(passportPayload[key]));
                }
            });
        }
        [200, 100, 101].forEach(function (stepId) {
            const v = readParamVal(stepId);
            if (v) {
                texts.push(v);
            }
        });
        return texts;
    }

    function buildConfigTextFromSources(texts) {
        const list = Array.isArray(texts) ? texts : [texts];
        for (let i = 0; i < list.length; i += 1) {
            const cfg = extractConfigBlock(list[i]);
            if (cfg) {
                return cfg;
            }
        }
        return '';
    }

    function buildConfigTextFromOrder(row, passportPayload) {
        return buildConfigTextFromSources(collectConfigSourceTexts(row, passportPayload));
    }

    function buildPreviewUrl(payload) {
        const params = new URLSearchParams();
        params.set('action', 'preview');
        params.set('kind', payload.kind || kindFromSerial(payload.serial));
        params.set('serial', String(payload.serial || '').trim());
        ['orderNumber', 'productTitle', 'manufactureDate', 'organizationName', 'configText', 'orderConfig'].forEach(function (key) {
            if (payload[key]) {
                params.set(key, String(payload[key]));
            }
        });
        return '/api/nameplate-print.php?' + params.toString();
    }

    function normalizeOrderNumber(raw) {
        const s = String(raw || '').trim();
        if (!s) {
            return '';
        }
        const O = window.Order1cOdata;
        if (O && typeof O.normalizeOrderNumber === 'function') {
            try {
                return String(O.normalizeOrderNumber(s) || s).trim();
            } catch (_e) {
                /* keep raw */
            }
        }
        return s;
    }

    function pickOrderPrimaryTitle(row) {
        if (!row) {
            return '';
        }
        const nom = String(row['НаименованиеПолное_Номенклатуры'] || '').trim();
        const ch = String(row['НаименованиеПолное_Характеристики'] || '').trim();
        if (nom && ch) {
            if (ch.indexOf('(') >= 0 && nom.indexOf('(') < 0) {
                return ch;
            }
            if (ch.length > nom.length + 8) {
                return ch;
            }
            return nom + ' (' + ch + ')';
        }
        return nom || ch || buildOrderTitleFromRow(row);
    }

    function collectPayload(kind, serial, extra) {
        const extras = extra && typeof extra === 'object' ? extra : {};
        const payload = {
            kind: kind || kindFromSerial(serial),
            serial: String(serial || '').trim(),
        };
        const orderEl = $('paramOrder1cNumber');
        if (orderEl) {
            payload.orderNumber = normalizeOrderNumber(orderEl.value);
        }
        if (extras.orderNumber) {
            payload.orderNumber = normalizeOrderNumber(extras.orderNumber);
        }
        let passportPayload = null;
        const Passport = window.TM07_PASSPORT;
        if (Passport && typeof Passport.collectPassportPayload === 'function') {
            try {
                passportPayload = Passport.collectPassportPayload();
                const pp = passportPayload;
                if (pp.orderNumber && !payload.orderNumber) {
                    payload.orderNumber = normalizeOrderNumber(pp.orderNumber);
                }
                if (payload.kind === 'complex') {
                    payload.productTitle = pp.complexTitle || pp.correctorTitle || '';
                } else {
                    payload.productTitle = pp.correctorTitle || '';
                }
                if (pp.manufactureDate) {
                    payload.manufactureDate = pp.manufactureDate;
                }
                if (pp.organizationName) {
                    payload.organizationName = pp.organizationName;
                }
            } catch (_e) {
                /* optional enrichment */
            }
        }
        const row = getOrderRow();
        const orderPrimary = pickOrderPrimaryTitle(row);
        if (row) {
            payload.orderConfig = buildOrderTextBlob(row);
            // Order title with config wins over empty/weak passport title.
            const passportTitle = String(payload.productTitle || '').trim();
            const passportHasConfig = !!extractConfigBlock(passportTitle);
            if (orderPrimary && (!passportTitle || (!passportHasConfig && extractConfigBlock(orderPrimary)))) {
                payload.productTitle = orderPrimary;
            } else if (orderPrimary && !payload.productTitle) {
                payload.productTitle = orderPrimary;
            }
        }
        if (extras.productTitle) {
            payload.productTitle = String(extras.productTitle);
        }
        if (extras.orderConfig) {
            payload.orderConfig = String(extras.orderConfig);
        }
        if (!payload.orderConfig) {
            const parts = [];
            if (orderPrimary) {
                parts.push(orderPrimary);
            }
            [200, 100, 101].forEach(function (stepId) {
                const v = readParamVal(stepId);
                if (v) {
                    parts.push(v);
                }
            });
            payload.orderConfig = parts.join(' ').trim();
        }
        const cfg =
            (extras.configText && String(extras.configText).trim()) ||
            buildConfigTextFromOrder(row, passportPayload);
        if (cfg) {
            payload.configText = cfg;
        } else if (payload.productTitle) {
            const fromTitle = extractConfigBlock(payload.productTitle);
            if (fromTitle) {
                payload.configText = fromTitle;
            }
        } else if (payload.orderConfig) {
            const fromBlob = extractConfigBlock(payload.orderConfig);
            if (fromBlob) {
                payload.configText = fromBlob;
            }
        }
        return payload;
    }

    function assertOrderDataForPrint(payload) {
        const orderNumber = String(payload.orderNumber || '').trim();
        if (!orderNumber) {
            return;
        }
        const hasConfig =
            !!String(payload.configText || '').trim() ||
            !!extractConfigBlock(payload.orderConfig || '') ||
            !!extractConfigBlock(payload.productTitle || '');
        const hasTitle = !!String(payload.productTitle || '').trim();
        if (!hasTitle && !hasConfig) {
            throw new Error(
                'Нет данных заказа ' +
                    orderNumber +
                    ' для шильдика (название/конфигурация). Дождитесь загрузки 1С и повторите печать.'
            );
        }
        if (!hasConfig && typeof window.plog === 'function') {
            window.plog(
                'Шильдик: у заказа ' +
                    orderNumber +
                    ' не найден блок (И…;…) — на этикетке может не быть строк конфигурации'
            );
        }
    }

    function base64ToBlob(base64, mime) {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new Blob([bytes], { type: mime || 'application/octet-stream' });
    }

    function triggerDownload(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'nameplate.btw';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        triggerDownload(url, filename);
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 1000);
    }

    async function fetchPrintJob(payload) {
        const resp = await fetch('/api/nameplate-print.php', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(function () {
            return null;
        });
        if (!resp.ok || !data || !data.ok) {
            throw new Error((data && data.error) || 'Не удалось сформировать задание печати');
        }
        return data;
    }

    async function blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function () {
                const dataUrl = String(reader.result || '');
                const base64 = dataUrl.split(',')[1] || '';
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    function agentSupportsTspl(health) {
        if (!health) {
            return false;
        }
        if (Array.isArray(health.supports) && health.supports.indexOf('tspl') >= 0) {
            return Number(health.version || 0) >= 3;
        }
        return Number(health.version || 0) >= 3;
    }

    async function fetchJobFileBase64(job, urlKey, fallbackUrl) {
        const url = job[urlKey] || fallbackUrl || (job.generated && job.generated.downloadUrl);
        if (!url) {
            throw new Error('Файл печати не сгенерирован на сервере');
        }
        const resp = await fetch(url, { credentials: 'same-origin' });
        if (!resp.ok) {
            throw new Error('Не удалось загрузить файл для печати');
        }
        return blobToBase64(await resp.blob());
    }

    async function fetchJobPrintBase64(job, config, format) {
        const fmt = String(format || 'pdf').toLowerCase();
        if (fmt === 'tspl') {
            if (!job.tsplDownloadUrl) {
                throw new Error('TSPL не сгенерирован на сервере');
            }
            return {
                format: 'tspl',
                base64: await fetchJobFileBase64(job, 'tsplDownloadUrl', null),
            };
        }
        if (fmt === 'png') {
            const pngUrlKey = job.pngDownloadUrl ? 'pngDownloadUrl' : 'downloadUrl';
            return {
                format: 'png',
                base64: await fetchJobFileBase64(job, pngUrlKey, null),
            };
        }
        return {
            format: 'pdf',
            base64: await fetchJobFileBase64(job, 'downloadUrl', null),
        };
    }

    async function checkPrintAgentHealth(agentUrl) {
        const url = String(agentUrl || 'http://127.0.0.1:18778').replace(/\/$/, '');
        try {
            const resp = await fetch(url + '/health', { mode: 'cors' });
            const data = await resp.json().catch(function () {
                return null;
            });
            if (!resp.ok || !data || !data.ok) {
                throw new Error('Print agent unavailable at ' + url);
            }
            return data;
        } catch (e) {
            // Агент не запущен — тихий fail для статус-бейджа (не спамить console как uncaught).
            const err = e instanceof Error ? e : new Error(String(e));
            err.silent = true;
            throw err;
        }
    }

    function printAgentUrlFromConfig(config, job) {
        const pa = (config && config.printAgent) || {};
        return String((job && job.printAgentUrl) || pa.agentUrl || 'http://127.0.0.1:18778').replace(/\/$/, '');
    }

    function buildPrintAgentBody(job, config, printPayload) {
        const pa = (config && config.printAgent) || {};
        const printer = job.printer || pa.printer || 'TSC TE200';
        const format = printPayload.format;
        const pdfName = job.filename
            || (job.generated && job.generated.filename)
            || (job.serial + '-' + (job.kind || 'corrector') + '.pdf');
        const body = {
            printer: printer,
            format: format,
            serial: job.serial,
            kind: job.kind,
            filename: format === 'pdf'
                ? pdfName
                : (job.serial + '-' + (job.kind || 'corrector') + '.' + format),
        };
        if (format === 'tspl') {
            body.tsplBase64 = printPayload.base64;
        } else if (format === 'png') {
            body.pngBase64 = printPayload.base64;
        } else {
            body.pdfBase64 = printPayload.base64;
        }
        return body;
    }

    async function postPrintAgentRequest(agentUrl, body, token) {
        const headers = { 'Content-Type': 'application/json' };
        const tok = String(token || '').trim();
        if (tok) {
            headers['X-TM07-Print-Token'] = tok;
            body.token = tok;
        }
        const resp = await fetch(agentUrl + '/print', {
            method: 'POST',
            mode: 'cors',
            headers: headers,
            body: JSON.stringify(body),
        });
        const data = await resp.json().catch(function () {
            return null;
        });
        if (!resp.ok || !data || !data.ok) {
            throw new Error((data && data.error) || ('Print agent error HTTP ' + resp.status));
        }
        return data;
    }

    const AGENT_HINT =
        'Агент печати не запущен. На этом ПК: C:\\tm07-agent\\restart-print-agent.cmd (или scripts\\windows\\install-print-agent.cmd один раз)';

    async function ensurePrintAgentReady(config, job) {
        const pa = (config && config.printAgent) || {};
        if (pa.enabled === false) {
            throw new Error('Печать через агент отключена в nameplate-config (printAgent.enabled)');
        }
        const agentUrl = printAgentUrlFromConfig(config, job);
        try {
            return await checkPrintAgentHealth(agentUrl);
        } catch (_e) {
            throw new Error(AGENT_HINT);
        }
    }

    async function printViaPrintAgent(job, config) {
        const pa = (config && config.printAgent) || {};
        const agentUrl = printAgentUrlFromConfig(config, job);
        const health = await ensurePrintAgentReady(config, job);

        let format = String(job.printFormat || pa.format || 'tspl').toLowerCase();
        if (format === 'tspl' && (!agentSupportsTspl(health) || !job.tsplDownloadUrl)) {
            const usePng = !!(job.pngDownloadUrl || (job.mime && String(job.mime).indexOf('png') >= 0));
            format = usePng ? 'png' : 'pdf';
            if (typeof window.plog === 'function') {
                window.plog('Агент без TSPL — печать ' + format.toUpperCase());
            }
        }

        try {
            const printPayload = await fetchJobPrintBase64(job, config, format);
            return await postPrintAgentRequest(
                agentUrl,
                buildPrintAgentBody(job, config, printPayload),
                pa.agentToken || job.printAgentToken
            );
        } catch (firstErr) {
            if (format === 'tspl') {
                const fallbackFmt = (job.pngDownloadUrl || (job.mime && String(job.mime).indexOf('png') >= 0)) ? 'png' : 'pdf';
                if (typeof window.plog === 'function') {
                    window.plog('TSPL: ' + (firstErr.message || String(firstErr)) + ' — пробуем ' + fallbackFmt.toUpperCase());
                }
                const fbPayload = await fetchJobPrintBase64(job, config, fallbackFmt);
                return await postPrintAgentRequest(
                    agentUrl,
                    buildPrintAgentBody(job, config, fbPayload),
                    pa.agentToken || job.printAgentToken
                );
            }
            const msg = firstErr && firstErr.message ? firstErr.message : String(firstErr);
            if (/fetch|network|Failed to fetch|agent/i.test(msg)) {
                throw new Error(AGENT_HINT);
            }
            throw firstErr;
        }
    }

    async function printDirect(payload) {
        const resp = await fetch('/api/nameplate-print.php?action=print-direct', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(function () {
            return null;
        });
        if (!resp.ok || !data || data.ok !== true) {
            throw new Error((data && data.error) || ('Прямая печать: HTTP ' + resp.status));
        }
        return data;
    }

    async function printViaSystemDialog(job, config) {
        const paCfg = (config && config.printAgent) || {};
        const dlg = paCfg.dialog || {};
        const wmm = Number(dlg.pageWidthMm) > 0 ? Number(dlg.pageWidthMm) : 58;
        const hmm = Number(dlg.pageHeightMm) > 0 ? Number(dlg.pageHeightMm) : 20;
        const src =
            job.pngDownloadUrl ||
            job.previewUrl ||
            (job.generated && (job.generated.pngDownloadUrl || job.generated.previewUrl)) ||
            '';
        if (!src) {
            throw new Error('Нет PNG-изображения шильдика для печати');
        }
        const html =
            '<!DOCTYPE html>\n' +
            '<html lang="ru">\n' +
            '<head>\n' +
            '<meta charset="utf-8">\n' +
            '<title>' + String(job.serial || '') + '</title>\n' +
            '<style>\n' +
            '  @page { size: ' + wmm + 'mm ' + hmm + 'mm; margin: 0; }\n' +
            '  * { margin: 0; padding: 0; box-sizing: border-box; }\n' +
            '  html, body { margin: 0; padding: 0; background: #fff; }\n' +
            '  img { display: block; width: ' + wmm + 'mm; height: ' + hmm + 'mm; }\n' +
            '</style>\n' +
            '</head>\n' +
            '<body><img src="' + src + '" alt=""></body>\n' +
            '</html>';
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const w = window.open(url, '_blank', 'width=640,height=480');
        if (!w) {
            URL.revokeObjectURL(url);
            throw new Error('Браузер заблокировал окно печати — разрешите всплывающие окна для сайта');
        }
        const done = function () {
            try {
                w.close();
            } catch (_e) {
                /* ignore */
            }
            URL.revokeObjectURL(url);
        };
        w.addEventListener('load', function () {
            try {
                w.focus();
                w.print();
            } catch (_e) {
                done();
            }
        });
        if (w.onafterprint !== undefined) {
            w.onafterprint = done;
        } else {
            setTimeout(done, 20000);
        }
        return { opened: true, widthMm: wmm, heightMm: hmm, src: src };
    }

    async function openPdfPreview(job, payload, serial) {
        const previewUrl = resolvePdfPreviewUrl(job, payload);
        const w = window.open(previewUrl, '_blank');
        if (!w) {
            const name = job.filename || serial + '-corrector.png';
            triggerDownload(previewUrl, name);
        }
        if (typeof window.plog === 'function') {
            window.plog('Превью шильдика: ' + serial);
        }
        return Object.assign({}, job, {
            generatedBy: 'raster-preview',
            filled: true,
            previewUrl: previewUrl,
        });
    }

    function resolvePdfPreviewUrl(job, payload) {
        if (job.previewUrl && /[?&]file=/.test(job.previewUrl)) {
            return job.previewUrl;
        }
        if (job.downloadUrl) {
            return job.downloadUrl.replace('action=download', 'action=preview');
        }
        if (job.generated && job.generated.downloadUrl) {
            return String(job.generated.downloadUrl).replace('action=download', 'action=preview');
        }
        return buildPreviewUrl(payload);
    }

    async function printNameplate(opts) {
        const o = opts || {};
        const serial = String(o.serial || '').trim();
        if (!/^\d{10}$/.test(serial)) {
            throw new Error('Enter a valid serial (10 digits).');
        }
        const kind = o.kind || kindFromSerial(serial);
        const config = await loadConfig(false);
        const payload = collectPayload(kind, serial, {
            orderNumber: o.orderNumber,
            productTitle: o.productTitle,
            orderConfig: o.orderConfig,
            configText: o.configText,
        });
        assertOrderDataForPrint(payload);
        if (typeof window.plog === 'function') {
            window.plog(
                'Шильдик S/N ' +
                    serial +
                    (payload.orderNumber ? ' заказ ' + payload.orderNumber : '') +
                    (payload.configText ? ' конфиг OK' : ' без блока конфига')
            );
        }
        const job = await fetchPrintJob(payload);
        const pa = config.printAgent || {};

        const agentEngines = { raster: true, pdf: true, html: true };
        if (agentEngines[job.engine] && pa.enabled !== false && pa.direct && pa.direct.enabled === true) {
            try {
                const directResult = await printDirect(payload);
                const printer = job.printer || pa.printer || 'TSC TE200';
                const msg = 'Шильд отправлен на принтер ' + printer + ' напрямую (S/N ' + serial + ')';
                if (typeof window.plog === 'function') {
                    window.plog(msg);
                }
                return Object.assign({}, job, {
                    generatedBy: 'print-direct',
                    filled: true,
                    printed: true,
                    userMessage: msg,
                    direct: directResult,
                });
            } catch (directErr) {
                const errMsg = directErr && directErr.message ? directErr.message : String(directErr);
                if (pa.fallbackPreview !== false) {
                    if (typeof window.plog === 'function') {
                        window.plog('Прямая печать: ' + errMsg + ' — открываем превью');
                    }
                    const preview = await openPdfPreview(job, payload, serial);
                    return Object.assign({}, preview, {
                        printed: false,
                        previewFallback: true,
                        printDirectError: errMsg,
                        userMessage: 'Прямая печать недоступна (' + errMsg + ') — открыто превью шильдика (S/N ' + serial + ').',
                    });
                }
                throw new Error(errMsg);
            }
        }

        if (agentEngines[job.engine] && pa.enabled !== false && pa.dialog && pa.dialog.enabled === true) {
        try {
            const dlgResult = await printViaSystemDialog(job, config);
            const printer = job.printer || pa.printer || 'TSC TE200';
            const msg = 'Открыт системный диалог печати — выберите ' + printer + ' (S/N ' + serial + ')';
            if (typeof window.plog === 'function') {
                window.plog(msg);
            }
            return Object.assign({}, job, {
                generatedBy: 'system-dialog',
                filled: true,
                printed: false,
                dialog: dlgResult,
                userMessage: msg,
            });
        } catch (dialogErr) {
            const errMsg = dialogErr && dialogErr.message ? dialogErr.message : String(dialogErr);
            if (pa.fallbackPreview !== false) {
                if (typeof window.plog === 'function') {
                    window.plog('Диалог печати: ' + errMsg + ' — открываем превью');
                }
                const preview = await openPdfPreview(job, payload, serial);
                return Object.assign({}, preview, {
                    printed: false,
                    previewFallback: true,
                    userMessage: 'Диалог печати недоступен (' + errMsg + ') — открыто превью шильдика (S/N ' + serial + ').',
                });
            }
            throw new Error(errMsg);
        }
    }

        if (agentEngines[job.engine] && pa.enabled !== false) {
            try {
                const agentResult = await printViaPrintAgent(job, config);
                const printer = job.printer || pa.printer || 'TSC TE200';
                const msg = 'Шильд отправлен на принтер ' + printer + ' (S/N ' + serial + ')';
                if (typeof window.plog === 'function') {
                    window.plog(msg);
                }
                return Object.assign({}, job, {
                    generatedBy: 'print-agent',
                    filled: true,
                    printed: true,
                    userMessage: msg,
                    agent: agentResult,
                });
            } catch (agentErr) {
                const errMsg = agentErr && agentErr.message ? agentErr.message : String(agentErr);
                // По умолчанию — превью, если агент не запущен (как раньше).
                // Явно выключить: printAgent.fallbackPreview = false в nameplate-config.
                if (pa.fallbackPreview !== false) {
                    if (typeof window.plog === 'function') {
                        window.plog('Агент печати: ' + errMsg + ' — открываем превью');
                    }
                    const preview = await openPdfPreview(job, payload, serial);
                    return Object.assign({}, preview, {
                        printed: false,
                        previewFallback: true,
                        userMessage:
                            'Агент печати недоступен — открыто превью шильдика (S/N ' +
                            serial +
                            '). Запустите агент или нажмите «Печать шильдика».',
                    });
                }
                throw new Error(errMsg.indexOf('Агент печати') >= 0 ? errMsg : (AGENT_HINT + ' (' + errMsg + ')'));
            }
        }

        // Agent disabled: only then open preview
        if (job.engine === 'raster' || job.engine === 'pdf' || (job.engine === 'html' && (job.previewUrl || job.downloadUrl))) {
            return openPdfPreview(job, payload, serial);
        }

        if (job.engine === 'html' && job.html) {
            const blob = new Blob([job.html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const w = window.open(url, '_blank');
            if (!w) {
                downloadBlob(blob, serial + '-preview.html');
            } else {
                w.addEventListener('load', function () {
                    URL.revokeObjectURL(url);
                }, { once: true });
            }
            return Object.assign({}, job, { generatedBy: 'html-legacy', filled: true });
        }

        throw new Error('Неизвестный движок печати: ' + (job.engine || '?'));
    }

    async function printCorrector(serial, opts) {
        const o = opts && typeof opts === 'object' ? opts : {};
        return printNameplate(Object.assign({ kind: 'corrector', serial: serial }, o));
    }

    async function printComplex(serial, opts) {
        const o = opts && typeof opts === 'object' ? opts : {};
        return printNameplate(Object.assign({ kind: 'complex', serial: serial }, o));
    }

    async function issueSerialAndPrintForOrder(orderNumber) {
        const config = await loadConfig(false);
        if (config.autoSerialOnOrderOpen === false) {
            return null;
        }
        const ui = window.TM07_SERIAL_REGISTRY_UI;
        if (!ui || typeof ui.allocateCorrectorSerial !== 'function') {
            throw new Error('Модуль выдачи S/N недоступен');
        }
        const orderNorm = normalizeOrderNumber(orderNumber);
        const result = await ui.allocateCorrectorSerial({
            force: true,
            orderNumber: orderNorm || null,
            printNameplate: false,
        });
        if (!result || !result.serial) {
            throw new Error('Не удалось выдать S/N корректора');
        }

        const display = $('wbCorrectorSerialDisplay');
        if (display) {
            display.value = result.serial;
        }
        const val3 = $('val_3');
        if (val3) {
            val3.value = result.serial;
        }
        window.__wbAssemblyCorrectorSerial = result.serial;

        let printed = false;
        let printResult = null;
        if (config.autoPrintOnOrderOpen !== false) {
            const row = getOrderRow();
            const primary = pickOrderPrimaryTitle(row);
            try {
                printResult = await printCorrector(result.serial, {
                    orderNumber: orderNorm,
                    productTitle: primary || undefined,
                    orderConfig: row ? buildOrderTextBlob(row) : undefined,
                });
                printed = !!(printResult && printResult.printed);
            } catch (printErr) {
                // S/N уже выдан — печать не должна ронять открытие заказа.
                if (typeof window.plog === 'function') {
                    window.plog('Печать шильдика: ' + (printErr.message || String(printErr)));
                }
                printResult = {
                    printed: false,
                    printError: printErr.message || String(printErr),
                    userMessage: printErr.message || String(printErr),
                };
            }
        }

        return Object.assign({}, result, {
            printed: printed,
            printResult: printResult,
        });
    }

    window.TM07_NAMEPLATE = {
        loadConfig: loadConfig,
        printNameplate: printNameplate,
        printCorrector: printCorrector,
        printComplex: printComplex,
        collectPayload: collectPayload,
        checkPrintAgentHealth: checkPrintAgentHealth,
        ensurePrintAgentReady: ensurePrintAgentReady,
        printViaPrintAgent: printViaPrintAgent,
        printDirect: printDirect,
        printViaSystemDialog: printViaSystemDialog,
        issueSerialAndPrintForOrder: issueSerialAndPrintForOrder,
        AGENT_HINT: AGENT_HINT,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            void loadConfig(false);
        });
    } else {
        void loadConfig(false);
    }
})();
