(function () {
    'use strict';

    const API = '/api/btw-inspect.php';

    const els = {
        templateList: document.getElementById('btwTemplateList'),
        listStatus: document.getElementById('btwListStatus'),
        dropzone: document.getElementById('btwDropzone'),
        fileInput: document.getElementById('btwFileInput'),
        uploadStatus: document.getElementById('btwUploadStatus'),
        emptyState: document.getElementById('btwEmptyState'),
        result: document.getElementById('btwResult'),
        resultTitle: document.getElementById('btwResultTitle'),
        validBadge: document.getElementById('btwValidBadge'),
        fileSize: document.getElementById('btwFileSize'),
        pngCount: document.getElementById('btwPngCount'),
        format: document.getElementById('btwFormat'),
        qrMarker: document.getElementById('btwQrMarker'),
        metadataBody: document.getElementById('btwMetadataBody'),
        headerBody: document.getElementById('btwHeaderBody'),
        knownFields: document.getElementById('btwKnownFields'),
        imagesCard: document.getElementById('btwImagesCard'),
        images: document.getElementById('btwImages'),
        hexPreview: document.getElementById('btwHexPreview'),
        readableText: document.getElementById('btwReadableText'),
        labelTextNote: document.getElementById('btwLabelTextNote'),
        note: document.getElementById('btwNote'),
    };

    function formatBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function formatDate(ts) {
        if (!ts) return '—';
        return new Date(ts * 1000).toLocaleString('ru-RU');
    }

    function setStatus(el, text, kind) {
        el.textContent = text || '';
        el.className = 'small mt-3 mb-0' + (kind === 'error' ? ' text-danger' : kind === 'ok' ? ' text-success' : ' text-body-secondary');
    }

    async function fetchJson(url, options) {
        const res = await fetch(url, options);
        const data = await res.json().catch(function () {
            return { ok: false, error: 'Некорректный JSON' };
        });
        if (!res.ok && data.ok !== false) {
            data.ok = false;
            data.error = data.error || ('HTTP ' + res.status);
        }
        return data;
    }

    function renderTableRows(tbody, obj) {
        tbody.innerHTML = '';
        const entries = Object.entries(obj || {});
        if (!entries.length) {
            tbody.innerHTML = '<tr><td class="text-body-secondary ps-3">Нет данных</td></tr>';
            return;
        }
        entries.forEach(function (pair) {
            const tr = document.createElement('tr');
            tr.innerHTML = '<th scope="row" class="ps-3 text-nowrap">' + escapeHtml(pair[0]) + '</th><td>' + escapeHtml(pair[1] ?? '') + '</td>';
            tbody.appendChild(tr);
        });
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderKnownFields(fields) {
        els.knownFields.innerHTML = '';
        (fields || []).forEach(function (name) {
            const span = document.createElement('span');
            span.className = 'badge text-bg-primary';
            span.textContent = name;
            els.knownFields.appendChild(span);
        });
        if (!fields || !fields.length) {
            els.knownFields.innerHTML = '<span class="text-body-secondary small">Не заданы</span>';
        }
    }

    function renderResult(payload) {
        const r = payload.result || payload;
        els.emptyState.classList.add('d-none');
        els.result.classList.remove('d-none');

        const fileName = (r.file && r.file.name) || r.source || 'Файл';
        els.resultTitle.textContent = fileName;

        if (r.valid) {
            els.validBadge.className = 'badge text-bg-success';
            els.validBadge.textContent = 'BarTender .btw';
        } else {
            els.validBadge.className = 'badge text-bg-warning';
            els.validBadge.textContent = 'Не похож на .btw';
        }

        els.fileSize.textContent = formatBytes(r.size || 0) +
            (r.file && r.file.modified ? ' · изменён ' + formatDate(r.file.modified) : '');
        els.pngCount.textContent = String((r.analysis && r.analysis.pngCount) || 0);
        els.format.textContent = (r.header && r.header.format) || '—';
        els.qrMarker.textContent = (r.analysis && r.analysis.hasQrMarker) ? 'найден' : 'нет';

        renderTableRows(els.metadataBody, r.metadata);
        renderTableRows(els.headerBody, r.header);
        renderKnownFields(r.knownFields);
        els.hexPreview.textContent = r.hexPreview || '';
        const rt = r.readableText || {};
        els.readableText.textContent = (rt.lines && rt.lines.length)
            ? rt.lines.join('\n')
            : (rt.headerBlock || '—');
        if (rt.labelFieldsFound) {
            els.labelTextNote.className = 'small text-success mb-0';
            els.labelTextNote.textContent = 'В файле найдены строки имён полей этикетки (Serial, OrderNumber и т.д.).';
        } else {
            els.labelTextNote.className = 'small text-warning mb-0';
            els.labelTextNote.textContent = 'Текст этикетки (S/N, конфигурация, QR) в .btw не хранится открытым текстом — только служебные метаданные и превью PNG ниже.';
        }
        els.note.textContent = r.note || '';

        const images = r.embeddedImages || [];
        els.images.innerHTML = '';
        if (images.length) {
            els.imagesCard.classList.remove('d-none');
            images.forEach(function (img) {
                const col = document.createElement('div');
                col.className = 'col-md-6';
                col.innerHTML =
                    '<div class="small text-body-secondary mb-2">PNG #' + img.index +
                    ' · offset ' + img.offset + ' · ' + formatBytes(img.size) + '</div>' +
                    '<img class="btw-thumb" alt="PNG #' + img.index + '" src="' + img.dataUrl + '">';
                els.images.appendChild(col);
            });
        } else {
            els.imagesCard.classList.add('d-none');
        }
    }

    async function loadTemplates() {
        setStatus(els.listStatus, 'Загрузка списка…');
        try {
            const data = await fetchJson(API + '?action=list');
            if (!data.ok) throw new Error(data.error || 'Ошибка');
            els.templateList.innerHTML = '';
            if (!data.files || !data.files.length) {
                els.templateList.innerHTML = '<div class="list-group-item text-body-secondary small">Нет .btw в каталоге</div>';
            } else {
                data.files.forEach(function (file) {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
                    btn.innerHTML =
                        '<span><i class="bi bi-file-earmark-binary me-2"></i>' + escapeHtml(file.name) + '</span>' +
                        '<span class="badge text-bg-light text-dark">' + formatBytes(file.size) + '</span>';
                    btn.addEventListener('click', function () {
                        parseTemplate(file.name);
                    });
                    els.templateList.appendChild(btn);
                });
            }
            setStatus(els.listStatus, data.directory ? 'Каталог: ' + data.directory : '', 'ok');
        } catch (err) {
            setStatus(els.listStatus, err.message || 'Не удалось загрузить список', 'error');
        }
    }

    async function parseTemplate(name) {
        setStatus(els.uploadStatus, 'Чтение ' + name + '…');
        try {
            const data = await fetchJson(API + '?action=parse&file=' + encodeURIComponent(name));
            if (!data.ok) throw new Error(data.error || 'Ошибка');
            renderResult(data);
            setStatus(els.uploadStatus, 'Загружен шаблон проекта: ' + name, 'ok');
        } catch (err) {
            setStatus(els.uploadStatus, err.message || 'Ошибка чтения', 'error');
        }
    }

    async function uploadFile(file) {
        if (!file) return;
        if (!/\.btw$/i.test(file.name)) {
            setStatus(els.uploadStatus, 'Нужен файл с расширением .btw', 'error');
            return;
        }
        setStatus(els.uploadStatus, 'Загрузка ' + file.name + '…');
        const form = new FormData();
        form.append('file', file);
        try {
            const data = await fetchJson(API + '?action=upload', { method: 'POST', body: form });
            if (!data.ok) throw new Error(data.error || 'Ошибка');
            renderResult(data);
            setStatus(els.uploadStatus, 'Файл разобран: ' + file.name, 'ok');
        } catch (err) {
            setStatus(els.uploadStatus, err.message || 'Ошибка загрузки', 'error');
        }
    }

    els.dropzone.addEventListener('click', function () {
        els.fileInput.click();
    });

    els.dropzone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            els.fileInput.click();
        }
    });

    els.fileInput.addEventListener('change', function () {
        uploadFile(els.fileInput.files && els.fileInput.files[0]);
        els.fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
        els.dropzone.addEventListener(ev, function (e) {
            e.preventDefault();
            e.stopPropagation();
            els.dropzone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(function (ev) {
        els.dropzone.addEventListener(ev, function (e) {
            e.preventDefault();
            e.stopPropagation();
            els.dropzone.classList.remove('dragover');
        });
    });

    els.dropzone.addEventListener('drop', function (e) {
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        uploadFile(file);
    });

    loadTemplates();
})();
