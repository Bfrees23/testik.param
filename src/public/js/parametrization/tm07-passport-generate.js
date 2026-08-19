/**
 * Автогенерация паспортов DOCX после параметризации (шаблоны ТМР.408843.300 / ТМР.407279.400).
 */
(function () {
    'use strict';

    const STORAGE_LAST = 'order1c_param_lastOrder';
    let lastPassportFiles = [];

    function $(id) {
        return document.getElementById(id);
    }

    function readVal(stepId) {
        const el = $('val_' + stepId);
        return el ? String(el.value || '').trim() : '';
    }

    function formatRuDate(d) {
        const dt = d instanceof Date ? d : new Date();
        const dd = String(dt.getDate()).padStart(2, '0');
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const yyyy = dt.getFullYear();
        return dd + '.' + mm + '.' + yyyy;
    }

    function getOrderRow() {
        try {
            const raw =
                sessionStorage.getItem(STORAGE_LAST) || localStorage.getItem(STORAGE_LAST);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            return parsed && parsed.row ? parsed.row : null;
        } catch (_e) {
            return null;
        }
    }

    function pickPrimaryOrderName(row) {
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
        }
        return nom || ch;
    }

    function extractCorrectorTitle(row) {
        const ToParam = window.TM07Order1cToParam;
        const parts = [];
        const primary = pickPrimaryOrderName(row);
        if (primary) {
            parts.push(primary);
        }
        if (row && ToParam && typeof ToParam.collectOrderTextBlob === 'function') {
            parts.push(ToParam.collectOrderTextBlob(row, readVal(200)));
        }
        for (let i = 0; i < parts.length; i += 1) {
            const text = String(parts[i] || '');
            const m = text.match(/Корректор\s+объ[её]ма\s+газа\s+ТМ-07[^.\n\r]*/i);
            if (m) {
                return m[0].trim();
            }
        }
        if (/корректор/i.test(primary) && !/комплекс\s+промышленного/i.test(primary)) {
            return primary;
        }
        return '';
    }

    function extractComplexTitle(row) {
        const primary = pickPrimaryOrderName(row);
        if (/комплекс\s+промышленного/i.test(primary)) {
            return primary;
        }
        return '';
    }

    /** Полное наименование из 1С: номенклатура + характеристика (DN50;…). */
    function buildOrderProductTitle(row) {
        if (!row) {
            return '';
        }
        const nom = String(row['НаименованиеПолное_Номенклатуры'] || '').trim();
        const ch = String(row['НаименованиеПолное_Характеристики'] || '').trim();
        if (nom && ch) {
            // Характеристика уже полное обозначение с «(И…» / «(DN…».
            if (/^\s*\(/.test(ch) === false && /\(\s*[ИI]\s*[1-4]/i.test(ch)) {
                return ch;
            }
            if (ch.indexOf('(') >= 0 && nom.indexOf('(') < 0 && ch.length > nom.length + 8) {
                return ch;
            }
            if (/\(\s*[ИI]\s*[1-4]/i.test(nom) || /ПК-ТМ-/i.test(nom)) {
                // Номенклатура уже с конфигурацией — не дублируем скобки.
                if (ch.length < 8 || nom.indexOf(ch) >= 0) {
                    return nom;
                }
            }
            return nom + ' (' + ch + ')';
        }
        return nom || ch || '';
    }

    /**
     * Название корректора для п.8 паспорта ТМ-07 (свидетельство о приёмке / поверка).
     * Для заказа на комплекс берём конфигурацию (Иn; ПАД… ) из характеристики.
     */
    function buildCorrectorTitleForPassport(row) {
        const fromOrder = buildOrderProductTitle(row);
        if (/корректор\s+объ/i.test(fromOrder)) {
            return fromOrder;
        }
        const extracted = extractCorrectorTitle(row);
        if (extracted) {
            return extracted;
        }
        // Комплекс: собрать «Корректор … ТМ-07 (Иn; …)» из датчиков заказа.
        const blob = [fromOrder];
        if (row) {
            blob.push(String(row['НаименованиеПолное_Номенклатуры'] || ''));
            blob.push(String(row['НаименованиеПолное_Характеристики'] || ''));
        }
        const text = blob.join(' ');
        const cfg = extractCorrectorConfigFromText(text);
        if (cfg) {
            return 'Корректор объема газа ТМ-07 (' + cfg + ')';
        }
        return '';
    }

    /** Фрагмент «И1; …; Ксж-2» из текста заказа / комплекса. */
    function extractCorrectorConfigFromText(text) {
        const s = String(text || '');
        let m = s.match(/\(\s*([ИI]\s*[1-4]\s*;[^)]*)\)/iu);
        if (m) {
            return m[1].replace(/\s+/g, ' ').trim();
        }
        // В характеристике комплекса датчики без «Иn» — собрать по составу.
        const C = window.TM07_CORRECTOR_EXECUTION;
        if (!C || typeof C.detectEquipment !== 'function') {
            return '';
        }
        const equip = C.detectEquipment(s);
        const variant =
            typeof C.resolveExecutionVariant === 'function'
                ? C.resolveExecutionVariant(!!equip.hasPpd, !!equip.hasPttp)
                : equip.hasPpd && equip.hasPttp
                  ? 'И4'
                  : equip.hasPpd
                    ? 'И2'
                    : equip.hasPttp
                      ? 'И3'
                      : 'И1';
        const parts = [variant];
        const pad = s.match(/ПАД\s*\(([^)]+)\)/i);
        const ptg = s.match(/ПТГ\s*\(([^)]+)\)/i);
        const ppd = s.match(/ППД\s*\(([^)]+)\)/i);
        const pttp = s.match(/ПТТП\s*\(([^)]+)\)/i);
        const kszh = s.match(/Ксж\s*[-–—]?\s*([123])/i);
        if (pad) {
            parts.push('ПАД(' + pad[1].trim() + ')');
        }
        if (ptg) {
            parts.push('ПТГ(' + ptg[1].trim() + ')');
        }
        if (kszh) {
            parts.push('Ксж-' + kszh[1]);
        }
        if (ppd) {
            parts.push('ППД(' + ppd[1].trim() + ')');
        }
        if (pttp) {
            parts.push('ПТТП(' + pttp[1].trim() + ')');
        }
        if (parts.length <= 1) {
            return '';
        }
        return parts.join('; ');
    }

    function buildComplexTitleForPassport(row) {
        const fromOrder = buildOrderProductTitle(row);
        if (/комплекс\s+промышленного/i.test(fromOrder) || /ПК-ТМ-/i.test(fromOrder)) {
            return fromOrder;
        }
        const p200 = readVal(200);
        if (p200) {
            const ch = row
                ? String(row['НаименованиеПолное_Характеристики'] || '').trim()
                : '';
            if (ch && p200.indexOf('(') < 0) {
                return p200 + ' (' + ch + ')';
            }
            return p200;
        }
        return extractComplexTitle(row);
    }

    function buildMeterNote() {
        const meterName = readVal(100);
        const typeCode = readVal(101);
        const parts = [];
        if (meterName) {
            parts.push(meterName);
        }
        if (typeCode) {
            parts.push(typeCode);
        }
        return parts.join('   ').trim();
    }

    function readVerifyDate(stepId) {
        const v = readVal(stepId);
        if (v && /^\d{2}\.\d{2}\.\d{4}$/.test(v)) {
            return v;
        }
        return '';
    }

    async function fetchBenchContextForPassport() {
        try {
            const resp = await fetch('/api/bench-db-status.php?action=status', { credentials: 'same-origin' });
            const data = await resp.json();
            if (!resp.ok || !data || !data.ok) {
                return {};
            }
            return {
                verifierName:
                    (data.operator &&
                        (data.operator.lastName || data.operator.displayName || data.operator.login)) ||
                    '',
                organizationName: (data.workstation && data.workstation.name) || '',
            };
        } catch (_e) {
            return {};
        }
    }

    async function collectPassportPayloadAsync() {
        const base = collectPassportPayload();
        const ctx = await fetchBenchContextForPassport();
        const today = formatRuDate(new Date());
        const verifyDateMeter = readVerifyDate(103) || today;
        const verifyDateComplex = readVerifyDate(202) || today;
        return Object.assign(base, {
            verifyDate: verifyDateComplex || verifyDateMeter || today,
            verifyDateMeter: verifyDateMeter,
            verifyDateComplex: verifyDateComplex,
            verifyInfo: 'Первичная поверка',
            verifierName: ctx.verifierName || '',
            organizationName: ctx.organizationName || 'ООО «Техномер»',
            commissionDate: today,
            commissionPerson: ctx.verifierName || '',
        });
    }

    function collectPassportPayload() {
        const row = getOrderRow();
        const correctorSerial = readVal(3);
        const complexSerial = readVal(201);
        const complexTitle = extractComplexTitle(row);
        const isComplex = !!complexSerial || !!complexTitle;

        const complexTitleFull = buildComplexTitleForPassport(row);
        const passport = window.__paramDevicePassport;
        const correctorFromDevice =
            passport && passport.serial ? String(passport.serial).trim() : '';

        return {
            kind: 'auto',
            orderNumber: ($('paramOrder1cNumber') || {}).value || '',
            manufactureDate: formatRuDate(new Date()),
            correctorSerial: correctorSerial || correctorFromDevice,
            complexSerial: complexSerial,
            correctorTitle: buildCorrectorTitleForPassport(row),
            complexTitle: complexTitleFull || complexTitle,
            titleFromOrder: !!buildOrderProductTitle(row),
            meterSerial: readVal(102) || ($('paramMeterSerial') || {}).value || '',
            meterNote: buildMeterNote(),
            telemetryName: readVal(227) || '-',
            telemetrySerial: readVal(228) || '-',
            sensors: {
                pad: readVal(57) || '-',
                ptg: readVal(61) || '-',
                ppd: readVal(64) || '-',
                pttp: readVal(68) || '-',
            },
            isComplex: isComplex,
        };
    }

    function triggerDownload(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || '';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    function renderPassportLinks(files) {
        const box = $('wbPassportLinks');
        if (!box) {
            return;
        }
        if (!files || !files.length) {
            box.innerHTML = '';
            box.classList.add('d-none');
            return;
        }
        const links = files
            .map(function (f) {
                const label = f.kind === 'pk-tm' ? 'Паспорт ПК-ТМ' : 'Паспорт ТМ-07';
                return (
                    '<a class="btn btn-sm btn-outline-primary me-2 mb-2" href="' +
                    f.url +
                    '" download="' +
                    (f.filename || '') +
                    '"><i class="bi bi-file-earmark-word me-1"></i>' +
                    label +
                    '</a>'
                );
            })
            .join('');
        box.innerHTML =
            '<p class="mb-2 small mb-1"><strong>Паспорта сформированы:</strong></p><div class="d-flex flex-wrap">' +
            links +
            '</div>';
        box.classList.remove('d-none');
    }

    async function generatePassports(options) {
        const opts = options || {};
        const payload = await collectPassportPayloadAsync();
        if (!payload.correctorSerial && !payload.complexSerial) {
            throw new Error('Нет серийных номеров для паспорта (п.3 / п.201).');
        }

        const resp = await fetch('/api/passport-generate.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(function () {
            return null;
        });
        if (!resp.ok || !data || !data.ok) {
            throw new Error((data && data.error) || 'Ошибка генерации паспорта');
        }

        lastPassportFiles = data.files || [];
        renderPassportLinks(lastPassportFiles);

        if (opts.download !== false) {
            lastPassportFiles.forEach(function (f, idx) {
                setTimeout(function () {
                    triggerDownload(f.url, f.filename);
                }, idx * 400);
            });
        }

        return lastPassportFiles;
    }

    window.TM07_PASSPORT = {
        collectPassportPayload: collectPassportPayload,
        collectPassportPayloadAsync: collectPassportPayloadAsync,
        generatePassports: generatePassports,
        getLastFiles: function () {
            return lastPassportFiles.slice();
        },
        renderPassportLinks: renderPassportLinks,
    };
})();
