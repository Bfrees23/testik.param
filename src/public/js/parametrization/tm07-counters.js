/**
 * Counter handling for parametrization page.
 * Fetches list of counters from /api/counters.php and populates a select.
 * When a counter is selected (or button pressed), loads its parameters and
 * fills the corresponding input fields (val_<stepId>) on the page.
 */
(function () {
    const el = (id) => document.getElementById(id);
    const log = (m) => {
        const le = el('paramLog');
        if (!le) return;
        const t = new Date().toLocaleTimeString();
        le.innerHTML += `[${t}] ${m}<br>`;
        le.scrollTop = le.scrollHeight;
    };
    const counterSelect = el('counterSelect');
    const loadBtn = el('loadCounterBtn');
    if (!counterSelect) return; // No counter UI on this page.

    // Populate counter list.
    async function loadCounters() {
        try {
            const r = await fetch('/api/counters.php?action=list');
            const data = await r.json();
            if (!data.success) {
                log('Failed to load counters list');
                return;
            }
            // Clear existing options (except placeholder).
            const placeholder = counterSelect.querySelector('option[value=""]');
            counterSelect.innerHTML = '';
            if (placeholder) counterSelect.appendChild(placeholder);
            data.counters.forEach((c) => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name + (c.serial ? ` (${c.serial})` : '');
                counterSelect.appendChild(opt);
            });
            log(`Loaded ${data.counters.length} counters`);
        } catch (e) {
            log('Error loading counters: ' + e.message);
        }
    }

    async function applyCounter(id) {
        if (!id) {
            log('No counter selected');
            return;
        }
        try {
            const r = await fetch(`/api/counters.php?action=get&id=${id}`);
            const data = await r.json();
            if (!data.success) {
                log('Failed to load counter details');
                return;
            }
            const params = data.counter?.parameters ?? {};
            // Expected params: { "<stepId>": "value", ... }
            Object.entries(params).forEach(([stepId, value]) => {
                const inp = el('val_' + stepId);
                if (inp) inp.value = value;
            });
            log(`Applied parameters from counter #${id}`);
        } catch (e) {
            log('Error applying counter: ' + e.message);
        }
    }

    // Load list on page load.
    document.addEventListener('DOMContentLoaded', loadCounters);

    // Button click triggers apply.
    loadBtn?.addEventListener('click', () => {
        const id = counterSelect.value;
        applyCounter(id);
    });
})();
