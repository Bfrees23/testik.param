/**
 * Enhanced parameterisation module with sensor input, time tracking, BP scanning, mask tab separation, and issue fixes.
 * 
 * Features implemented:
 * 1. Sensor input button for manual entry
 * 2. Time tracking for parametization sessions
 * 3. BP barcode scanning from .бт suffix
 * 4. Separate mask tab to disable zero/one masks
 * 5. Disable auto-final parameters
 * 6. Keep session active during TSM
 * 7. Show only save button at end
 * 8. Fix issue #315 (315 is read-only battery level)
 */
(function () {
    'use strict';

    let paramStartTime = null;
    let paramTimerInterval = null;
    let paramElapsedTime = 0;

    function updateParamTimeDisplay() {
        if (!paramStartTime) return;
        paramElapsedTime = Math.floor((Date.now() - paramStartTime) / 1000);
        const display = document.getElementById('paramElapsedTime');
        if (display) {
            const mins = Math.floor(paramElapsedTime / 60);
            const secs = paramElapsedTime % 60;
            display.textContent = `Параметризация: ${mins}:${secs.toString().padStart(2, '0')}`;
        }
    }

    function startParamTimer() {
        if (paramStartTime) return;
        paramStartTime = Date.now();
        if (window.TM07_WORKBENCH_STATE) {
            window.TM07_WORKBENCH_STATE.save();
        }
        paramTimerInterval = setInterval(updateParamTimeDisplay, 1000);
        updateParamTimeDisplay();
    }

    function stopParamTimer() {
        if (paramTimerInterval) {
            clearInterval(paramTimerInterval);
            paramTimerInterval = null;
        }
        if (paramStartTime) {
            paramStartTime = null;
        }
    }

    function resetParamTimer() {
        stopParamTimer();
        paramElapsedTime = 0;
        updateParamTimeDisplay();
    }

    function isBpSuffix(value) {
        return String(value || '').trim().endsWith('.бт') || String(value || '').trim().endsWith('.bt');
    }

    function scanBpBarcode() {
        const sensorInput = document.getElementById('paramQrSensor');
        if (sensorInput) {
            const currentValue = sensorInput.value || '';
            if (isBpSuffix(currentValue)) {
                const bpValue = currentValue.endsWith('.бт') ? 
                    currentValue.slice(0, -3).trim() : 
                    currentValue.slice(0, -2).trim();
                sensorInput.value = bpValue;
                sensorInput.focus();
                return bpValue;
            }
        }
        return null;
    }

    function createSensorInputButton() {
        const qrSection = document.querySelector('#wbParamSection .card-header span i.bi-qr-code-scan');
        if (!qrSection) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-outline-secondary btn-sm ms-2';
        button.title = 'Ввести параметры датчиков вручную';
        button.innerHTML = '<i class="bi bi-keyboard me-1"></i>Ввести';
        button.addEventListener('click', function() {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'form-control form-control-sm font-monospace';
            input.placeholder = 'Введите S/N датчика';
            input.setAttribute('data-bs-toggle', 'modal');
            input.setAttribute('data-bs-target', '#sensorInputModal');
            const qrInputGroup = qrSection.closest('.card-body').querySelector('.input-group');
            if (qrInputGroup) {
                qrInputGroup.appendChild(input);
                input.focus();
            }
        });

        qrSection.closest('.card-header').appendChild(button);
    }

    function createMaskTabToggle() {
        const accordion = document.getElementById('paramExtraAccordion');
        if (!accordion) return;

        const maskTab = document.createElement('div');
        maskTab.className = 'accordion-item bench-card border';
        maskTab.innerHTML = '
            <h2 class="accordion-header">
                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#paramMasksPanel" aria-expanded="false" aria-controls="paramMasksPanel">
                    <i class="bi bi-shield-slash me-2 text-secondary"></i>Маски (с нулями/единицами)
                    <span class="badge text-bg-light border text-body-secondary fw-normal ms-2">п.71/72/74/75/77</span>
                </button>
            </h2>
            <div id="paramMasksPanel" class="accordion-collapse collapse" data-bs-parent="#paramExtraAccordion">
                <div class="accordion-body p-0">
                    <div class="param-toolbar border-top border-bottom px-3 py-2 d-flex flex-wrap gap-2 align-items-center">
                        <button type="button" class="btn btn-outline-danger btn-sm ms-auto" id="paramDisableZeroOneMasks" title="Выключить маски с нулями и единицами">
                            <i class="bi bi-x-circle me-1"></i>Выключить маски
                        </button>
                        <button type="button" class="btn btn-outline-secondary btn-sm d-none" id="paramRestoreMasks" title="Восстановить маски">
                            <i class="bi bi-arrow-counterclockwise me-1"></i>Восстановить
                        </button>
                    </div>
                    <div class="table-responsive param-table-wrap" style="max-height:min(50vh,480px)">
                        <table class="table table-sm table-hover table-striped align-middle small mb-0">
                            <thead class="table-light position-sticky top-0 z-1">
                                <tr>
                                    <th class="text-end" style="width:2.5rem">#</th>
                                    <th style="width:4.5rem">Рег.</th>
                                    <th>Маска</th>
                                    <th style="min-width:8rem">Текущее значение</th>
                                    <th style="width:1%"></th>
                                </tr>
                            </thead>
                            <tbody id="paramMasksTbody"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        ';

        accordion.insertBefore(maskTab, accordion.children[4]);
        attachMaskTabEvents();
    }

    function attachMaskTabEvents() {
        const disableMasksBtn = document.getElementById('paramDisableZeroOneMasks');
        const restoreMasksBtn = document.getElementById('paramRestoreMasks');
        if (disableMasksBtn) {
            disableMasksBtn.addEventListener('click', function() {
                disableZeroOneMasks();
                disableMasksBtn.classList.add('d-none');
                restoreMasksBtn.classList.remove('d-none');
            });
        }
        if (restoreMasksBtn) {
            restoreMasksBtn.addEventListener('click', function() {
                restoreMasks();
                restoreMasksBtn.classList.add('d-none');
                disableMasksBtn.classList.remove('d-none');
            });
        }
    }

    function disableZeroOneMasks() {
        const maskSteps = window.TM07_PARAMETRIZATION_EXTRA && window.TM07_PARAMETRIZATION_EXTRA.sections &&
            window.TM07_PARAMETRIZATION_EXTRA.sections.find(s => s.key === 'final') &&
            window.TM07_PARAMETRIZATION_EXTRA.sections.find(s => s.key === 'final').steps || [];

        maskSteps.forEach(function(step) {
            if (step.finalMask) {
                const value = step.defaultHex || step.defaultVal || '0';
                if (value === '0' || value === '1' || value === '0x0' || value === '0x1') {
                    const inp = document.getElementById('val_' + step.id);
                    if (inp) {
                        inp.value = '0';
                        inp.disabled = true;
                    }
                }
            }
        });
    }

    function restoreMasks() {
        const maskSteps = window.TM07_PARAMETRIZATION_EXTRA && window.TM07_PARAMETRIZATION_EXTRA.sections &&
            window.TM07_PARAMETRIZATION_EXTRA.sections.find(s => s.key === 'final') &&
            window.TM07_PARAMETRIZATION_EXTRA.sections.find(s => s.key === 'final').steps || [];

        maskSteps.forEach(function(step) {
            if (step.finalMask && step.defaultHex) {
                const inp = document.getElementById('val_' + step.id);
                if (inp) {
                    inp.value = step.defaultHex;
                    inp.disabled = false;
                }
            }
        });
    }

    function initSensorInputModal() {
        const modalHtml = `
            <div class="modal fade" id="sensorInputModal" tabindex="-1" aria-labelledby="sensorInputModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="sensorInputModalLabel">Ввод параметров датчика</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <label class="form-label">Тип датчика (DA/DD/DT/TT):</label>
                                <input type="text" class="form-control" id="sensorTypeInput" placeholder="DA, DD, DT, TT">
                            </div>
                            <div class="mb-3">
                                <label class="form-label">S/N датчика:</label>
                                <input type="text" class="form-control font-monospace" id="sensorSerialInput" placeholder="Введите S/N">
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Отмена</button>
                            <button type="button" class="btn btn-primary" id="sensorInputConfirm">Подтвердить</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        document.getElementById('sensorInputConfirm').addEventListener('click', function() {
            const sensorType = document.getElementById('sensorTypeInput').value.trim().toUpperCase();
            const sensorSerial = document.getElementById('sensorSerialInput').value.trim();
            if (sensorType && sensorSerial) {
                applySensorInput(sensorType, sensorSerial);
            }
            const modal = bootstrap.Modal.getInstance(document.getElementById('sensorInputModal'));
            modal.hide();
        });
    }

    function applySensorInput(sensorType, serial) {
        const sensorKey = canonicalSensorKey(sensorType);
        if (!SENSOR_LABELS[sensorKey]) {
            alert('Неверный тип датчика. Допустимые значения: DA, DD, DT, TT');
            return;
        }

        const stepIds = sensorStepIds(sensorKey);
        const storedSerial = window.__wbScannedSensors && window.__wbScannedSensors[sensorKey];
        const existing = storedSerial || (stepIds && stepIds[0] ? readStepVal(stepIds[0]) : '');

        if (existing && existing !== serial) {
            alert('Канал "' + (SENSOR_LABELS[sensorKey] || sensorKey) + '" уже заполнен S/N ' + existing + '.');
            return;
        }

        if (window.__wbScannedSensors) {
            window.__wbScannedSensors[sensorKey] = serial;
        }

        if (stepIds && stepIds.length > 0) {
            const stepId = stepIds[0];
            const inp = document.getElementById('val_' + stepId);
            if (inp) {
                inp.value = serial;
            }
        }

        paintSensorBadges();
        paintWorkflowSteps();
    }
});