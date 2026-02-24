// public/js/features/faultManager.js

import { showToast, hideAllModals } from '../components/modals.js';
import { fetchFlights } from '../core/global.js';
import { getPeriodDisplay } from '../core/util.js';

// משתנה עזר גלובלי לשמירת סטטוס היישום במודאל הפתוח
window.currentFaultImplementationStatus = null;

let faultChartInstances = {};

// משתנים למצב ניהול ומחיקה
let isFaultSelectionMode = false;
let faultSelectedSet = new Set();

/**
 * אתחול מאגר התקלות - הגדרת פילטרים וביצוע רינדור ראשוני
 */
window.switchFaultTab = function (tab) {
    const isTable = tab === 'table';
    document.getElementById('fault-tab-content-table').classList.toggle('hidden', !isTable);
    document.getElementById('fault-tab-content-stats').classList.toggle('hidden', isTable);

    // הסתרה/הצגה של פילטר סטטוס סגירה (רק ברשימה)
    const statusFilterContainer = document.getElementById('fault-status-filter-container');
    if (statusFilterContainer) {
        statusFilterContainer.classList.toggle('hidden', !isTable);
    }

    // הצגת כפתורי ניהול רק למנהלים ורק בטאב טבלה
    const adminControls = document.getElementById('fault-admin-controls-container');
    if (adminControls) {
        // מציג רק אם יש הרשאת ניהול (חלון.isAdmin מוגדר ב-auth.js)
        adminControls.classList.toggle('hidden', !isTable || !window.isAdmin);
    }

    const tableBtn = document.getElementById('fault-tab-btn-table');
    const statsBtn = document.getElementById('fault-tab-btn-stats');
    tableBtn.className = isTable ? 'border-ofer-orange text-ofer-orange whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm' : 'border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm';
    statsBtn.className = !isTable ? 'border-ofer-orange text-ofer-orange whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm' : 'border-transparent text-gray-500 hover:text-gray-700 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm';

    if (!isTable) renderFaultStatistics();
    else renderFaultDatabaseTable(); // רינדור הטבלה כדי לעדכן מצב כפתורי בחירה
};

export function populateFaultPeriodFilter() {
    const select = document.getElementById('fault-period-select');
    if (!select) return;

    const allFaults = Object.values(window.unifiedFaultsDatabase || {});
    const periods = new Set();

    allFaults.forEach(f => {
        if (f.firstReportTimestamp) {
            const display = getPeriodDisplay(new Date(f.firstReportTimestamp));
            if (display) periods.add(display);
        }
    });

    const sortedPeriods = Array.from(periods).sort((a, b) => {
        const [pA, yA] = a.split('/');
        const [pB, yB] = b.split('/');
        return yA !== yB ? Number(yA) - Number(yB) : Number(pA) - Number(pB);
    });

    select.innerHTML = sortedPeriods.map(p => `<option value="${p}">${p}</option>`).join('');

    if (sortedPeriods.length > 0) {
        select.value = sortedPeriods[sortedPeriods.length - 1];
    }
}
export function populateFaultWeekFilter() {
    const select = document.getElementById('fault-week-select');
    if (!select) return;
    let html = '<option value="">בחר שבוע...</option>';
    for (let i = 1; i <= 26; i++) {
        html += `<option value="${i}">שבוע ${i}</option>`;
    }
    select.innerHTML = html;
}

export function renderFaultStatistics() {
    const allFaults = Object.values(window.unifiedFaultsDatabase || {});
    const simulatorFilter = document.getElementById('fault-simulator-filter')?.value || 'ALL';
    const timeFilterType = document.getElementById('fault-time-filter-type')?.value || 'all';
    const planning = window.planningSettings || {};

    let filtered = allFaults.filter(f => {
        const matchSim = simulatorFilter === 'ALL' || f.simulator === simulatorFilter;
        if (!matchSim) return false;

        let matchTime = true;
        const reportDate = new Date(f.firstReportTimestamp);
        reportDate.setHours(0, 0, 0, 0);

        if (timeFilterType === 'period') {
            const selectedPeriod = document.getElementById('fault-period-select')?.value;
            matchTime = getPeriodDisplay(reportDate) === selectedPeriod;
        }
        else if (timeFilterType === 'week') {
            const selectedWeek = parseInt(document.getElementById('fault-week-select')?.value);
            const selectedPeriod = document.getElementById('fault-period-select')?.value;

            if (selectedWeek && selectedPeriod) {
                let baseDateStr = null;
                if (selectedPeriod === getPeriodDisplay(new Date(planning.periodCurrStart))) baseDateStr = planning.periodCurrStart;
                else if (selectedPeriod === getPeriodDisplay(new Date(planning.periodPrevStart))) baseDateStr = planning.periodPrevStart;
                else if (selectedPeriod === getPeriodDisplay(new Date(planning.periodNextStart))) baseDateStr = planning.periodNextStart;

                if (baseDateStr) {
                    const baseDate = new Date(baseDateStr);
                    baseDate.setHours(0, 0, 0, 0);
                    baseDate.setDate(baseDate.getDate() - baseDate.getDay());

                    const diffDays = Math.round((reportDate - baseDate) / (1000 * 60 * 60 * 24));
                    const faultWeekNum = Math.floor(diffDays / 7) + 1;
                    matchTime = (faultWeekNum === selectedWeek);
                }
            }
        }
        else if (timeFilterType === 'range') {
            const startStr = document.getElementById('fault-date-start')?.value;
            const endStr = document.getElementById('fault-date-end')?.value;
            if (startStr && endStr) {
                const startDate = new Date(startStr);
                const endDate = new Date(endStr);
                endDate.setHours(23, 59, 59, 999);
                matchTime = reportDate >= startDate && reportDate <= endDate;
            }
        }
        return matchTime;
    });

    const stats = {
        categories: {},
        verification: { 'אומת': 0, 'לא אומת': 0 },
        severity: { 'קל': 0, 'בינוני': 0, 'חמור': 0 },
        statusRatio: { 'פתוחה': 0, 'טופלה': 0 }
    };

    filtered.forEach(f => {
        if (f.status.isResolved) {
            stats.statusRatio['טופלה']++;
            const cat = f.status.faultCategory || 'לא סווג';
            stats.categories[cat] = (stats.categories[cat] || 0) + 1;
            const vKey = f.status.isVerified ? 'אומת' : 'לא אומת';
            stats.verification[vKey]++;
        } else {
            stats.statusRatio['פתוחה']++;
        }
        const sev = f.severity || 'לא צוין';
        if (stats.severity[sev] !== undefined) stats.severity[sev]++;
    });

    createFaultChart('chart-fault-categories', 'pie', Object.keys(stats.categories), Object.values(stats.categories), ['#3B82F6', '#10B981', '#F59E0B', '#EF4444']);
    createFaultChart('chart-fault-verification', 'pie', Object.keys(stats.verification), Object.values(stats.verification), ['#10B981', '#EF4444']);
    createFaultChart('chart-fault-severity', 'bar', Object.keys(stats.severity), Object.values(stats.severity), ['#60A5FA', '#FBBF24', '#F87171']);
    createFaultChart('chart-fault-status-ratio', 'pie', Object.keys(stats.statusRatio), Object.values(stats.statusRatio), ['#EF4444', '#10B981']);
}

function createFaultChart(canvasId, type, labels, data, colors) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (faultChartInstances[canvasId]) faultChartInstances[canvasId].destroy();

    faultChartInstances[canvasId] = new Chart(ctx, {
        type: type,
        data: {
            labels: labels,
            datasets: [{ data: data, backgroundColor: colors }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    rtl: true,
                    labels: {
                        boxWidth: 10,
                        padding: 8,
                        font: { size: 10 }
                    }
                }
            },
            layout: {
                padding: { top: 5, bottom: 5, left: 5, right: 5 }
            }
        }
    });
}

export async function initFaultDatabase() {
    const simSelect = document.getElementById('fault-simulator-filter');
    if (!simSelect) return;

    if (!window.planningSettings && window.db) {
        const { doc, getDoc } = window.firestoreFunctions;
        try {
            const snap = await getDoc(doc(window.db, "settings", "planning"));
            if (snap.exists()) {
                window.planningSettings = snap.data();
            }
        } catch (e) {
            console.error("Failed to load planning settings for weeks filter", e);
        }
    }
    // הוספה בתוך פונקציית האתחול של ה-Fault Manager
    document.getElementById('simulator-select')?.addEventListener('change', (e) => {
        window.populateFaultOptions(e.target.value);
    });
    const sim = document.getElementById('simulator-select');
    if (sim && !sim.dataset.listenerAttached) {
        sim.addEventListener('change', (e) => {
            window.populateFaultOptions(e.target.value);
        });
        sim.dataset.listenerAttached = "true";
    }
    const sims = (window.personnelLists && window.personnelLists.simulators) ? window.personnelLists.simulators : [];
    simSelect.innerHTML = '<option value="ALL">כל המאמנים</option>' +
        sims.map(sim => `<option value="${sim}">${sim}</option>`).join('');

    populateFaultPeriodFilter();
    populateFaultWeekFilter();
    renderFaultDatabaseTable();
}

/**
 * עיבוד נתוני הגיחות ליצירת מאגר תקלות מאוחד
 */
export function processFaultsData() {
    const currentResolutionStatus = window.faultResolutionStatus || {};
    const unifiedFaultsDatabase = window.unifiedFaultsDatabase || {};
    const savedFlights = window.savedFlights || [];

    Object.keys(unifiedFaultsDatabase).forEach(key => delete unifiedFaultsDatabase[key]);

    const sortedFlights = [...savedFlights].sort((a, b) => a.flightStartTimestamp - b.flightStartTimestamp);

    sortedFlights.forEach(flight => {
        if (flight.faults && flight.faults.length > 0 && flight.flightStartTimestamp) {
            flight.faults.forEach(fault => {
                const faultDescription = fault.description;
                const simulator = fault.simulator;
                const baseKey = `${simulator}|${faultDescription}`;
                const reportTimestamp = fault.timestamp || flight.flightStartTimestamp;

                let joinedKey = null;
                Object.keys(unifiedFaultsDatabase).forEach(key => {
                    const currentFault = unifiedFaultsDatabase[key];
                    if (currentFault.baseKey === baseKey) {
                        const cycleStatus = currentResolutionStatus[key] || { isResolved: false };
                        if (!cycleStatus.isResolved) joinedKey = key;
                    }
                });

                if (joinedKey) {
                    unifiedFaultsDatabase[joinedKey].reportCount++;
                    unifiedFaultsDatabase[joinedKey].lastReportTimestamp = Math.max(unifiedFaultsDatabase[joinedKey].lastReportTimestamp, reportTimestamp);
                    // שמירת הגיחה כמקור (עבור מחיקה עתידית)
                    if (!unifiedFaultsDatabase[joinedKey].sourceFlights) unifiedFaultsDatabase[joinedKey].sourceFlights = [];
                    unifiedFaultsDatabase[joinedKey].sourceFlights.push(flight.id);
                } else {
                    const openCycleKey = `${baseKey}|${reportTimestamp}`;
                    unifiedFaultsDatabase[openCycleKey] = {
                        key: openCycleKey,
                        baseKey: baseKey,
                        simulator: simulator,
                        description: faultDescription,
                        reportCount: 1,
                        reportingInstructor: flight.data['מדריכה'] || "לא ידוע",
                        firstReportTimestamp: reportTimestamp,
                        lastReportTimestamp: reportTimestamp,
                        systemClassification: fault.systemClassification,
                        severity: fault.severity,
                        isDowntime: fault.isDowntime || false,
                        status: currentResolutionStatus[openCycleKey] || { isResolved: false },
                        sourceFlights: [flight.id] // אתחול מערך גיחות מקור
                    };
                }
            });
        }
    });

    const sims = (window.personnelLists && window.personnelLists.simulators) ? window.personnelLists.simulators : [];
    window.simulatorFaults = {};
    sims.forEach(sim => {
        window.simulatorFaults[sim] = Object.values(unifiedFaultsDatabase)
            .filter(f => f.simulator === sim && !f.status.isResolved)
            .map(f => f.description);
    });
}

function buildDropdownMenu(systems, onSelect) {
    const menuContainer = document.createElement('div');
    menuContainer.className = "flex flex-col text-right text-sm bg-white border border-gray-200 shadow-lg rounded-md";

    Object.keys(systems).sort().forEach(category => {
        const subItems = systems[category] || [];
        const hasSubs = subItems.length > 0;
        const itemContainer = document.createElement('div');
        itemContainer.className = "relative group border-b border-gray-100 last:border-0";

        const row = document.createElement('div');
        row.className = `flex justify-between items-center px-4 py-2 cursor-pointer hover:bg-gray-100 transition-colors`;
        row.innerHTML = `<span>${category}</span>`;

        if (hasSubs) {
            row.innerHTML += `<i class="fas fa-chevron-left text-gray-400 text-[10px]"></i>`;
            const subMenu = document.createElement('div');
            subMenu.className = "hidden group-hover:block absolute top-0 right-full w-48 bg-white border border-gray-200 shadow-xl rounded-md z-[1000]";
            subItems.forEach(sub => {
                const subRow = document.createElement('div');
                subRow.className = "px-4 py-2 hover:bg-ofer-primary-50 cursor-pointer text-gray-700 hover:text-ofer-orange transition-colors border-b border-gray-50 last:border-0";
                subRow.textContent = sub;
                subRow.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onSelect(`${category} - ${sub}`); };
                subMenu.appendChild(subRow);
            });
            itemContainer.appendChild(subMenu);
        } else {
            row.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onSelect(category); };
        }
        itemContainer.appendChild(row);
        menuContainer.appendChild(itemContainer);
    });
    return menuContainer;
}

export function setupCustomDropdown(triggerId, menuId, inputId, displayId, initialValue = "") {
    const trigger = document.getElementById(triggerId);
    const menu = document.getElementById(menuId);
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    if (!trigger || !menu || !input || !display) return;

    if (initialValue) { input.value = initialValue; display.textContent = initialValue; }
    else { input.value = ""; display.textContent = "בחר מערכת..."; }

    const systems = window.systemClassifications || {};
    menu.innerHTML = '';
    const handleSelect = (value) => { input.value = value; display.textContent = value; menu.classList.add('hidden'); };
    menu.appendChild(buildDropdownMenu(systems, handleSelect));

    trigger.onclick = (e) => {
        e.stopPropagation();
        const isHidden = menu.classList.contains('hidden');
        document.querySelectorAll('[id$="-menu"]').forEach(m => m.classList.add('hidden'));
        if (isHidden) menu.classList.remove('hidden');
    };

    document.addEventListener('click', (e) => {
        if (!trigger.contains(e.target) && !menu.contains(e.target)) menu.classList.add('hidden');
    });
}

export function populateFaultOptions(simulatorId) {
    const simulatorFaults = window.simulatorFaults || {};
    const faultSelects = document.querySelectorAll('[id="fault-select"]');
    const otherFaultGroups = document.querySelectorAll('[id="other-fault-group"]');
    const faultEntryAreas = document.querySelectorAll('[id="fault-entry-area"]');
    const addFaultBtns = document.querySelectorAll('[id="add-fault-btn"]');
    const addFaultContainers = document.querySelectorAll('[id="add-fault-container"]');
    const simSelectContainers = document.querySelectorAll('[id="simulator-select-container"]');
    const simDisplays = document.querySelectorAll('[id="simulator-display"]');
    const simNameSpans = document.querySelectorAll('[id="selected-simulator-name"]');

    if (simulatorId) {
        simSelectContainers.forEach(el => el.classList.add('hidden'));
        simDisplays.forEach(el => el.classList.remove('hidden'));
        simNameSpans.forEach(el => el.textContent = simulatorId);
        faultEntryAreas.forEach(el => el.classList.remove('hidden'));
        addFaultContainers.forEach(el => el.classList.remove('hidden'));
        addFaultBtns.forEach(el => el.disabled = false);

        const openFaults = simulatorFaults[simulatorId] || [];

        faultSelects.forEach(select => {
            select.innerHTML = '<option value="" disabled selected>בחר תקלה קיימת...</option>';
            openFaults.forEach(fault => {
                const opt = document.createElement('option');
                opt.value = fault;
                opt.textContent = fault;
                select.appendChild(opt);
            });
            const otherOpt = document.createElement('option');
            otherOpt.value = "OTHER";
            otherOpt.textContent = "אחר / תקלה חדשה";
            select.appendChild(otherOpt);
            if (openFaults.length === 0) select.value = "OTHER";
        });

        otherFaultGroups.forEach(group => {
            if (openFaults.length === 0) group.classList.remove('hidden');
            else group.classList.add('hidden');
        });

    } else {
        faultEntryAreas.forEach(el => el.classList.add('hidden'));
        addFaultContainers.forEach(el => el.classList.add('hidden'));
        simSelectContainers.forEach(el => el.classList.remove('hidden'));
        simDisplays.forEach(el => el.classList.add('hidden'));
    }
}

export function toggleOtherFaultInput(selectElement) {
    const otherFaultGroup = document.getElementById('other-fault-group');
    const otherFaultInput = document.getElementById('other-fault-text');
    if (!otherFaultGroup || !otherFaultInput) return;
    if (selectElement.value === 'OTHER') {
        otherFaultGroup.classList.remove('hidden');
        otherFaultInput.focus();
    } else {
        otherFaultGroup.classList.add('hidden');
        otherFaultInput.value = '';
    }
}

export function addFaultFromForm() {
    const simulatorId = document.getElementById('simulator-select')?.value;
    const faultSelect = document.getElementById('fault-select');
    const severity = document.getElementById('fault-severity').value;
    const instructorName = document.getElementById('instructor-name-1').value;
    let faultDescription = (faultSelect.value === 'OTHER') ? document.getElementById('other-fault-text').value.trim() : faultSelect.value;
    const isDowntime = document.getElementById('fault-is-downtime')?.checked || false;

    const newFault = {
        simulator: simulatorId,
        description: faultDescription,
        systemClassification: document.getElementById('fault-system-class').value,
        severity: severity,
        reportingInstructor: instructorName,
        isDowntime: isDowntime,
        timestamp: Date.now()
    };
    window.currentForm.faults.push(newFault);
    renderFaultsTable(window.currentForm.faults);
}

export function renderFaultsTable(faults) {
    const container = document.getElementById('faults-list-container');
    if (!container) return;
    if (!faults || faults.length === 0) { container.innerHTML = `<p class="text-gray-500 mt-2 text-right">לא דווחו תקלות בגיחה זו.</p>`; return; }

    let html = `<h4 class="text-md font-semibold mb-2 mt-4 text-right">תקלות שדווחו:</h4><table class="min-w-full divide-y divide-gray-200" dir="rtl">
        <thead class="bg-gray-50"><tr><th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">מאמן</th><th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">תיאור</th><th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">סיווג</th><th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">מחיקה</th></tr></thead>
        <tbody class="bg-white divide-y divide-gray-200">`;

    faults.forEach((fault, index) => {
        html += `<tr><td class="px-4 py-2 text-sm">${fault.simulator}</td><td class="px-4 py-2 text-sm">${fault.description}</td><td class="px-4 py-2 text-sm">${fault.systemClassification || '-'}</td><td class="px-4 py-2 text-sm"><button class="delete-fault-btn text-red-600" data-fault-index="${index}">🗑️</button></td></tr>`;
    });
    html += `</tbody></table>`;
    container.innerHTML = html;
}

export function renderFaultDatabaseTable() {
    const tableBody = document.getElementById('fault-database-body');
    if (!tableBody) return;

    processFaultsData();

    // ניהול עמודת בחירה
    document.querySelector('.fault-select-col')?.classList.toggle('hidden', !isFaultSelectionMode);
    document.getElementById('fault-admin-controls-container')?.classList.remove('hidden');

    const simulatorFilter = document.getElementById('fault-simulator-filter')?.value || 'ALL';
    const statusFilter = document.getElementById('fault-status-filter')?.value || 'ALL';
    const timeFilterType = document.getElementById('fault-time-filter-type')?.value || 'all';

    let filteredFaults = Object.values(window.unifiedFaultsDatabase);

    if (simulatorFilter !== 'ALL') filteredFaults = filteredFaults.filter(f => f.simulator === simulatorFilter);
    if (statusFilter !== 'ALL') filteredFaults = filteredFaults.filter(f => f.status.isResolved === (statusFilter === 'RESOLVED'));

    filteredFaults = filteredFaults.filter(f => {
        const reportDate = new Date(f.firstReportTimestamp);
        reportDate.setHours(0, 0, 0, 0);

        if (timeFilterType === 'period') {
            const selectedPeriod = document.getElementById('fault-period-select')?.value;
            return getPeriodDisplay(reportDate) === selectedPeriod;
        }
        else if (timeFilterType === 'week') {
            const selectedWeek = parseInt(document.getElementById('fault-week-select')?.value);
            const selectedPeriod = document.getElementById('fault-period-select')?.value;
            const planning = window.planningSettings || {};

            if (selectedWeek && selectedPeriod) {
                let baseDateStr = null;
                if (selectedPeriod === getPeriodDisplay(new Date(planning.periodCurrStart))) baseDateStr = planning.periodCurrStart;
                else if (selectedPeriod === getPeriodDisplay(new Date(planning.periodPrevStart))) baseDateStr = planning.periodPrevStart;
                else if (selectedPeriod === getPeriodDisplay(new Date(planning.periodNextStart))) baseDateStr = planning.periodNextStart;

                if (baseDateStr) {
                    const baseDate = new Date(baseDateStr);
                    baseDate.setHours(0, 0, 0, 0);
                    baseDate.setDate(baseDate.getDate() - baseDate.getDay());
                    const diffDays = Math.round((reportDate - baseDate) / (1000 * 60 * 60 * 24));
                    const faultWeekNum = Math.floor(diffDays / 7) + 1;
                    return faultWeekNum === selectedWeek;
                }
            }
            return true;
        }
        else if (timeFilterType === 'range') {
            const startStr = document.getElementById('fault-date-start')?.value;
            const endStr = document.getElementById('fault-date-end')?.value;
            if (startStr && endStr) {
                const startDate = new Date(startStr);
                startDate.setHours(0, 0, 0, 0);
                const endDate = new Date(endStr);
                endDate.setHours(23, 59, 59, 999);
                return reportDate >= startDate && reportDate <= endDate;
            }
        }
        return true;
    });

    filteredFaults.sort((a, b) => b.lastReportTimestamp - a.lastReportTimestamp);

    if (filteredFaults.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">לא נמצאו תקלות תואמות לסינון.</td></tr>`;
        return;
    }

tableBody.innerHTML = filteredFaults.map(fault => {
        const isResolved = fault.status.isResolved;
        const isChecked = faultSelectedSet.has(fault.key);
        
        // יצירת מזהה בטוח כדי למנוע קריסת HTML בגלל גרשיים
        const safeKey = fault.key ? fault.key.replace(/'/g, "\\'").replace(/"/g, '&quot;') : '';

        return `<tr class="bg-white border-b hover:bg-ofer-primary-50 transition" onclick="window.showFaultDetailsModal('${safeKey}')">
            <td class="px-6 py-4 text-center ${isFaultSelectionMode ? '' : 'hidden'}" onclick="event.stopPropagation()">
                <input type="checkbox" class="fault-checkbox" data-key="${safeKey}" 
                    ${isChecked ? 'checked' : ''} 
                    onchange="window.toggleFaultCheckbox('${safeKey}')">
            </td>
            <td class="px-6 py-4 text-sm">${fault.simulator}</td>
            <td class="px-6 py-4 text-sm font-medium text-gray-900">${fault.description}</td>
            <td class="px-6 py-4 text-sm">${fault.systemClassification || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${new Date(fault.firstReportTimestamp).toLocaleDateString('he-IL')}</td>
            <td class="px-6 py-4 text-sm ${isResolved ? 'text-green-600 font-bold' : 'text-red-600'}">${isResolved ? 'טופלה' : 'פתוחה'}</td>
        </tr>`;
    }).join('');
}

export async function showFaultDetailsModal(faultKey) {
    const fault = window.unifiedFaultsDatabase[faultKey];
    if (!fault) return;

    hideAllModals();
    const modal = document.getElementById('fault-resolution-modal');
    const content = document.getElementById('fault-resolution-content');
    const title = document.getElementById('fault-resolution-modal-title');

    title.textContent = `פרטי תקלה: ${fault.description}`;

    let html = `
    <div class="space-y-4 text-right" dir="rtl">
        <div class="p-4 border rounded-lg bg-blue-50">
            <h3 class="font-bold border-b mb-2">פרטי דיווח</h3>
            <p><strong>סימולטור:</strong> ${fault.simulator}</p>
            <p><strong>מערכת:</strong> ${fault.systemClassification || '-'}</p>
            <p><strong>מדריכה מדווחת:</strong> ${fault.reportingInstructor}</p>
            <p><strong>תיאור:</strong> ${fault.description}</p>
        </div>`;

    if (fault.status && fault.status.isResolved) {
        const res = fault.status;
        const isPermission = res.isClosedWithPermission;

        html += `
        <div class="p-4 border rounded-lg ${isPermission ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}">
            <h3 class="font-bold border-b mb-2 ${isPermission ? 'text-yellow-800' : 'text-green-800'}">
                ${isPermission ? '⚠️ נסגר בהיתר' : '✅ פרטי טיפול וסגירה'}
            </h3>
            <p><strong>טכנאי מטפל:</strong> ${res.technicianName || 'לא הוזן'}</p>
            <p><strong>סטטוס אימות:</strong> ${res.isVerified ? '✅ אומת' : '❌ לא אומת'}</p>
            <p><strong>סיווג סגירה:</strong> ${res.faultCategory || '-'}</p>
            <p><strong>תאריך סגירה:</strong> ${res.date} בשעה ${res.time}</p>
            <div class="mt-2 p-2 bg-white rounded border">
                <strong>תיאור הטיפול:</strong><br>
                ${res.resolutionDescription || 'אין פירוט'}
            </div>
            ${isPermission ? `<p class="mt-2 text-red-600 font-bold">הערת היתר: ${res.permissionNote || ''}</p>` : ''}
        </div>`;
    }

    content.innerHTML = html + `</div>`;

    if (!fault.status.isResolved) {
        const resolveBtn = document.createElement('button');
        resolveBtn.className = "w-full bg-blue-600 text-white font-bold py-3 rounded-lg mt-4 shadow hover:bg-blue-700";
        resolveBtn.innerText = "עבור לטופס פתרון תקלה";
        resolveBtn.onclick = () => window.openResolutionForm(faultKey, fault);
        content.appendChild(resolveBtn);
    } else if (fault.status.isClosedWithPermission) {
        const editBtn = document.createElement('button');
        editBtn.className = "w-full bg-yellow-600 text-white font-bold py-3 rounded-lg mt-4 shadow hover:bg-yellow-700";
        editBtn.innerText = "ערוך סגירה / סגור סופית";
        editBtn.onclick = () => window.openResolutionForm(faultKey, fault, true);
        content.appendChild(editBtn);
    }

    modal.classList.remove('hidden');
}

export function setFaultImplementation(status) {
    window.currentFaultImplementationStatus = status;
    const yesBtn = document.getElementById('btn-impl-yes');
    const noBtn = document.getElementById('btn-impl-no');

    if (yesBtn) yesBtn.className = `px-4 py-1 rounded text-xs font-bold transition-colors ${status === true ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'}`;
    if (noBtn) noBtn.className = `px-4 py-1 rounded text-xs font-bold transition-colors ${status === false ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-600'}`;
}

export async function saveFaultResolutionStatus(faultKey, onlyUpdateClassification = false, reopen = false) {
    if (!window.currentUsername) return;
    const sysClassInput = document.getElementById('system-classification-input');
    const systemClassification = sysClassInput ? sysClassInput.value.trim() : '';

    const { doc, setDoc, deleteDoc } = window.firestoreFunctions;
    const resolutionCollection = window.db ? doc(window.db, "fault_resolutions", faultKey) : null;

    if (!resolutionCollection) return;

    if (reopen) {
        if (!confirm('האם לפתוח את התקלה מחדש?')) return;
        try {
            await deleteDoc(resolutionCollection);
            delete window.faultResolutionStatus[faultKey];
            if (window.unifiedFaultsDatabase[faultKey]) {
                window.unifiedFaultsDatabase[faultKey].status = { isResolved: false };
            }
            showToast('התקלה נפתחה מחדש', 'blue');
            hideAllModals();
            fetchFlights().then(() => renderFaultDatabaseTable());
            return;
        } catch (e) {
            showToast('שגיאה בפתיחה מחדש', 'red');
            return;
        }
    }

    try {
        let statusData;
        const current = window.faultResolutionStatus[faultKey] || {};

        if (onlyUpdateClassification) {
            statusData = { ...current, systemClassification, faultKey };
        } else {
            const technicianName = document.getElementById('technician-name').value.trim();
            const faultCategory = document.getElementById('fault-category').value;
            const isVerified = document.getElementById('is-verified-checkbox').checked;
            const desc = document.getElementById('fault-resolution-desc').value;
            const isClosedWithPermission = document.getElementById('closed-with-permission').checked;

            if (!technicianName) return showToast('חובה להזין שם טכנאי', 'yellow');
            if (isVerified && !desc.trim()) return showToast('יש לתאר את אופן הטיפול בתקלה שאומתה', 'yellow');

            statusData = {
                faultKey,
                isResolved: true,
                technicianName,
                faultCategory,
                isVerified,
                resolutionDescription: isVerified ? desc : "לא אומת",
                isClosedWithPermission,
                timestamp: Date.now(),
                date: new Date().toISOString().split('T')[0],
                time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
                systemClassification: document.getElementById('system-classification-input')?.value || ''
            };
        }

        await setDoc(resolutionCollection, statusData);

        window.faultResolutionStatus[faultKey] = statusData;
        if (window.unifiedFaultsDatabase[faultKey]) {
            window.unifiedFaultsDatabase[faultKey].status = statusData;
            window.unifiedFaultsDatabase[faultKey].systemClassification = systemClassification;
        }

        showToast(onlyUpdateClassification ? 'סיווג עודכן' : 'התקלה טופלה', 'green');
        hideAllModals();
        fetchFlights().then(() => renderFaultDatabaseTable());
    } catch (e) {
        console.error('Save failed:', e);
        showToast('שגיאה בשמירת הנתונים', 'red');
    }
}

export function populateSystemFilter() {
    const filter = document.getElementById('fault-system-filter');
    if (!filter) return;
    const systems = window.systemClassifications || {};
    let optionsHtml = '<option value="ALL">כל המערכות</option>';

    Object.keys(systems).sort().forEach(category => {
        const subItems = systems[category] || [];
        if (subItems.length > 0) {
            subItems.forEach(sub => {
                const val = `${category} - ${sub}`;
                optionsHtml += `<option value="${val}">${val}</option>`;
            });
        } else {
            optionsHtml += `<option value="${category}">${category}</option>`;
        }
    });
    filter.innerHTML = optionsHtml;
}

function openResolutionForm(faultKey, faultData, isEditMode = false) {
    const modal = document.getElementById('generic-modal');
    const content = document.getElementById('modal-content');
    const title = document.getElementById('modal-title');

    if (!modal || !content) return;

    title.innerText = isEditMode ? "עריכת סגירת תקלה (היתר)" : "פרטי סגירת תקלה";

    const reportingInstructor = faultData.reportingInstructor || "לא ידוע";
    const severity = faultData.severity || 'לא צוין';

    const now = new Date();
    const currentTime = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });
    const currentDate = now.toISOString().split('T')[0];

    const techOptions = (window.personnelLists?.technicians || [])
        .map(t => `<option value="${t}">${t}</option>`).join('');

    let existingData = {};
    if (isEditMode && faultData.status) {
        existingData = faultData.status;
    }

    content.innerHTML = `
        <div class="space-y-4 text-right" dir="rtl">
            <div class="p-3 bg-gray-100 rounded-lg border border-gray-300 text-sm">
                <p class="mb-1"><strong>תיאור התקלה:</strong> ${faultData.description}</p>
                <p><strong>מדריכה מדווחת:</strong> <span class="text-ofer-orange font-bold">${reportingInstructor}</span></p>
                <p><strong>רמת הפרעה:</strong> <span class="font-bold">${severity}</span></p>
            </div>

           <div>
                <label class="block text-xs font-bold mb-1">שם טכנאי מטפל (חובה)</label>
                <div class="flex gap-2">
                    <select id="res-technician" class="w-full border rounded p-2" onchange="if(this.value === 'OTHER') { document.getElementById('new-tech-container').classList.remove('hidden'); } else { document.getElementById('new-tech-container').classList.add('hidden'); }">
                        <option value="" disabled ${!isEditMode ? 'selected' : ''}>בחר טכנאי...</option>
                        ${techOptions}
                        <option value="OTHER" class="font-bold text-ofer-orange">-- טכנאי אחר (הוסף חדש) --</option>
                    </select>
                </div>
                <div id="new-tech-container" class="hidden mt-2">
                    <input type="text" id="res-new-technician" class="w-full border rounded p-2 text-sm" placeholder="הזן שם טכנאי חדש...">
                </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-bold mb-1 text-gray-500">תאריך סגירה (אוטומטי)</label>
                    <input type="date" id="res-date" class="w-full border rounded p-2 bg-gray-100 text-gray-500 cursor-not-allowed" 
                           value="${currentDate}" disabled>
                </div>
                <div>
                    <label class="block text-xs font-bold mb-1 text-gray-500">שעת סגירה (אוטומטי)</label>
                    <input type="time" id="res-time" class="w-full border rounded p-2 bg-gray-100 text-gray-500 cursor-not-allowed" 
                           value="${currentTime}" disabled>
                </div>
            </div>

            <div>
                <label class="block text-xs font-bold mb-1">סיווג סגירה</label>
                <select id="res-category" class="w-full border rounded p-2">
                    <option value="תקלה">1. תקלה</option>
                    <option value="תפעול">2. תפעול</option>
                    <option value="הועבר לצוות פיתוח">3. הועבר לצוות פיתוח</option>
                    <option value="לא תקלה">4. לא תקלה</option>
                </select>
            </div>

            <div>
                <label class="block text-xs font-bold mb-1">האם התקלה אומתה? (חובה)</label>
                <div class="flex gap-4 p-2 border rounded bg-gray-50">
                    <label class="flex items-center gap-1 cursor-pointer">
                        <input type="radio" name="verified-status" value="true" 
                               ${(isEditMode && existingData.isVerified) ? 'checked' : ''}> אומת
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer">
                        <input type="radio" name="verified-status" value="false"
                               ${(isEditMode && existingData.isVerified === false) ? 'checked' : ''}> לא אומת
                    </label>
                </div>
            </div>

            <div id="verified-text-area">
                <label class="block text-xs font-bold mb-1">תיאור הטיפול / סיבת אי-אימות</label>
                <textarea id="res-desc" class="w-full border rounded p-2" rows="3" 
                          placeholder="פרט כאן את אופן הטיפול...">${isEditMode ? (existingData.resolutionDescription || '') : ''}</textarea>
            </div>

            <div class="p-2 border rounded bg-yellow-50 border-yellow-200">
                <div class="flex items-center gap-2">
                    <input type="checkbox" id="res-permission" onchange="window.togglePermissionText(this.checked)"
                           ${(isEditMode && existingData.isClosedWithPermission) ? 'checked' : ''}>
                    <label for="res-permission" class="font-bold">נסגר בהיתר</label>
                </div>
                <div id="permission-text-area" class="${(isEditMode && existingData.isClosedWithPermission) ? '' : 'hidden'} mt-2">
                    <textarea id="res-permission-note" class="w-full border rounded p-2" rows="2" 
                              placeholder="פרט את ההיתר...">${isEditMode ? (existingData.permissionNote || '') : ''}</textarea>
                </div>
            </div>

<button onclick="window.processFaultClosure('${faultKey.replace(/'/g, "\\'").replace(/"/g, '&quot;')}')" class="w-full bg-green-600 text-white font-bold py-3 rounded-lg shadow-md hover:bg-green-700 transition-colors">
                ${isEditMode ? 'עדכן וסגור' : 'אישור וסגירה'}
            </button>
        </div>`;

    if (isEditMode) {
        if (existingData.technicianName) document.getElementById('res-technician').value = existingData.technicianName;
        if (existingData.faultCategory) document.getElementById('res-category').value = existingData.faultCategory;
    }

    modal.classList.remove('hidden');
}

async function processFaultClosure(faultKey) {
    let technician = document.getElementById('res-technician').value;

    if (technician === 'OTHER') {
        const newTech = document.getElementById('res-new-technician').value.trim();
        if (!newTech) { showToast("יש להזין שם טכנאי חדש", "red"); return; }
        technician = newTech;

        // הוספה לרשימה ב-adminManager (צריך לוודא שזה נשמר ב-Firestore)
        if (window.personnelLists && window.personnelLists.technicians) {
            if (!window.personnelLists.technicians.includes(newTech)) {
                window.personnelLists.technicians.push(newTech);
                window.personnelLists.technicians.sort();
                if (window.savePersonnelLists) window.savePersonnelLists(true);
            }
        }
    }
    const verifiedRadio = document.querySelector('input[name="verified-status"]:checked');
    const description = document.getElementById('res-desc').value.trim();

    if (!technician) { showToast("יש לבחור טכנאי", "red"); return; }
    if (!verifiedRadio) { showToast("יש לסמן האם התקלה אומתה", "red"); return; }
    if (!description) { showToast("יש להזין פירוט על הטיפול", "red"); return; }

    const isPermission = document.getElementById('res-permission').checked;

    const dateVal = document.getElementById('res-date').value;
    const timeVal = document.getElementById('res-time').value;

    const closureData = {
        isResolved: true,
        technicianName: technician,
        isVerified: verifiedRadio.value === 'true',
        resolutionDescription: description,
        isClosedWithPermission: isPermission,
        permissionNote: isPermission ? document.getElementById('res-permission-note').value : "",
        date: dateVal,
        time: timeVal,
        timestamp: Date.now()
    };

try {
        const { doc, setDoc } = window.firestoreFunctions;
        await setDoc(doc(window.db, "fault_resolutions", faultKey), closureData);

        if (!window.faultResolutionStatus) window.faultResolutionStatus = {}; // שורת ההגנה
        window.faultResolutionStatus[faultKey] = closureData;
        if (window.unifiedFaultsDatabase[faultKey]) {
            window.unifiedFaultsDatabase[faultKey].status = closureData;
        }

        showToast("התקלה נסגרה/עודכנה בהצלחה", "green");
        hideAllModals();

        if (window.currentScreen === 'simulator-management-screen' && window.renderSimulatorDashboard) {
            window.renderSimulatorDashboard();
        } else {
            renderFaultDatabaseTable();
        }

    } catch (e) {
        console.error(e);
        showToast("שגיאה בשמירה", "red");
    }
}

// --- לוגיקת בחירה ומחיקת תקלות ---

window.toggleFaultAdminMode = function () {
    isFaultSelectionMode = !isFaultSelectionMode;
    const btn = document.getElementById('toggle-fault-admin-mode-btn');
    if (btn) {
        btn.innerHTML = isFaultSelectionMode ?
            '<i class="fas fa-times ml-2"></i> צא ממצב ניהול' :
            '<i class="fas fa-edit ml-2"></i> מצב ניהול';
        btn.classList.toggle('bg-gray-500', isFaultSelectionMode);
        btn.classList.toggle('bg-gray-700', !isFaultSelectionMode);
    }

    // הצגת/הסתרת כפתור המחיקה
    document.getElementById('delete-fault-selected-btn')?.classList.toggle('hidden', !isFaultSelectionMode);

    if (!isFaultSelectionMode) {
        faultSelectedSet.clear();
        updateFaultDeleteBtn();
    }
    renderFaultDatabaseTable();
};

window.toggleFaultCheckbox = function (key) {
    if (faultSelectedSet.has(key)) faultSelectedSet.delete(key);
    else faultSelectedSet.add(key);
    updateFaultDeleteBtn();
};

window.toggleAllFaults = function (isChecked) {
    const checkboxes = document.querySelectorAll('.fault-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = isChecked;
        if (isChecked) faultSelectedSet.add(cb.dataset.key);
        else faultSelectedSet.delete(cb.dataset.key);
    });
    updateFaultDeleteBtn();
};

function updateFaultDeleteBtn() {
    const btn = document.getElementById('delete-fault-selected-btn');
    const countSpan = document.getElementById('fault-selected-count');
    if (btn && countSpan) {
        countSpan.textContent = faultSelectedSet.size;
        btn.classList.toggle('hidden', faultSelectedSet.size === 0);
    }
}

window.deleteSelectedFaults = async function () {
    if (faultSelectedSet.size === 0) return;
    if (!confirm(`פעולה זו תמחק את התקלות מהמאגר, וגם תסיר אותן מהגיחות המקוריות שדיווחו עליהן. האם להמשיך?`)) return;

    const { doc, deleteDoc, updateDoc, getDoc } = window.firestoreFunctions;
    let deletedCount = 0;

    showToast("מוחק תקלות...", "blue");

    try {
        for (const key of faultSelectedSet) {
            const faultEntry = window.unifiedFaultsDatabase[key];
            if (!faultEntry) continue;

            // 1. מחיקת רזולוציה (אם קיימת)
            await deleteDoc(doc(window.db, "fault_resolutions", key));

            // 2. מחיקת התקלה מגיחות המקור
            if (faultEntry.sourceFlights && faultEntry.sourceFlights.length > 0) {
                for (const flightId of faultEntry.sourceFlights) {
                    try {
                        const flightRef = doc(window.db, "flights", flightId);
                        const flightSnap = await getDoc(flightRef);
                        if (flightSnap.exists()) {
                            const flightData = flightSnap.data();
                            // סינון התקלות התואמות (לפי תיאור וסימולטור)
                            const originalFaults = flightData.faults || [];
                            const updatedFaults = originalFaults.filter(f =>
                                !(f.description === faultEntry.description && f.simulator === faultEntry.simulator)
                            );

                            if (originalFaults.length !== updatedFaults.length) {
                                await updateDoc(flightRef, { faults: updatedFaults });
                            }
                        }
                    } catch (err) {
                        console.error(`Failed to update flight ${flightId}`, err);
                    }
                }
            }
            deletedCount++;
        }

        showToast(`${deletedCount} תקלות נמחקו בהצלחה`, 'green');
        faultSelectedSet.clear();
        isFaultSelectionMode = false;
        window.toggleFaultAdminMode(); // איפוס UI
        await fetchFlights(); // רענון מלא
    } catch (e) {
        console.error(e);
        showToast('שגיאה בתהליך המחיקה', 'red');
    }
};

window.toggleFaultTimeFilters = function (type) {
    const groups = {
        'period': 'fault-filter-period-group',
        'week': 'fault-filter-week-group',
        'range': 'fault-filter-range-group'
    };

    Object.values(groups).forEach(id => document.getElementById(id)?.classList.add('hidden'));

    if (type === 'period') {
        document.getElementById('fault-filter-period-group').classList.remove('hidden');
    } else if (type === 'week') {
        document.getElementById('fault-filter-period-group').classList.remove('hidden');
        document.getElementById('fault-filter-week-group').classList.remove('hidden');
    } else if (type === 'range') {
        document.getElementById('fault-filter-range-group').classList.remove('hidden');
    }
};

window.togglePermissionText = (show) => {
    const el = document.getElementById('permission-text-area');
    if (el) el.classList.toggle('hidden', !show);
};
window.onFaultFilterChange = function () {
    renderFaultStatistics();
    renderFaultDatabaseTable();
};

// חשיפת פונקציות גלובליות
window.processFaultsData = processFaultsData;
window.renderFaultDatabaseTable = renderFaultDatabaseTable;
window.showFaultDetailsModal = showFaultDetailsModal;
window.setFaultImplementation = setFaultImplementation;
window.saveFaultResolutionStatus = saveFaultResolutionStatus;
window.addFaultFromForm = addFaultFromForm;
window.populateFaultOptions = populateFaultOptions;
window.toggleOtherFaultInput = toggleOtherFaultInput;
window.openResolutionForm = openResolutionForm;
window.processFaultClosure = processFaultClosure;
window.toggleVerifiedText = (show) => {
    const el = document.getElementById('verified-text-area');
    if (el) el.classList.toggle('hidden', !show);
};
window.togglePermissionText = (show) => {
    const el = document.getElementById('permission-text-area');
    if (el) el.classList.toggle('hidden', !show);
};
window.toggleAllFaults = window.toggleAllFaults;
window.toggleFaultCheckbox = window.toggleFaultCheckbox;
window.deleteSelectedFaults = window.deleteSelectedFaults;