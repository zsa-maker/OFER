// public/js/features/faultManager.js

import { showToast, hideAllModals } from '../components/modals.js';
import { getPeriodDisplay } from '../core/util.js';

// משתנה עזר גלובלי לשמירת סטטוס היישום במודאל הפתוח
window.currentFaultImplementationStatus = null;

let faultChartInstances = {};

// משתנים למצב ניהול ומחיקה
let isFaultSelectionMode = false;
let faultSelectedSet = new Set();

/**
 * פונקציה לפתיחת טופס הזנה ידנית לתקלה
 */
window.openManualFaultModal = function () {
    const simSelect = document.getElementById('manual-fault-sim');
    const techSelect = document.getElementById('manual-fault-instructor'); // זהו השדה של הדיווח
    const sysSelect = document.getElementById('manual-sys-input');

    if (simSelect && window.personnelLists?.simulators) {
        simSelect.innerHTML = '<option value="" disabled selected>בחר מאמן...</option>' +
            window.personnelLists.simulators.map(s => `<option value="${s}">${s}</option>`).join('');
    }

    // תיקון: שימוש ברשימת הטכנאים (technicians) במקום מדריכות
    if (techSelect && window.personnelLists?.technicians) {
        techSelect.innerHTML = '<option value="" disabled selected>בחר טכנאי מדווח...</option>' +
            window.personnelLists.technicians.map(t => `<option value="${t}">${t}</option>`).join('');
    }

    if (sysSelect && window.systemClassifications) {
        let sysOptions = '<option value="">ללא סיווג</option>';
        Object.keys(window.systemClassifications).sort().forEach(category => {
            const subItems = window.systemClassifications[category] || [];
            if (subItems.length > 0) {
                subItems.forEach(sub => { sysOptions += `<option value="${category} - ${sub}">${category} - ${sub}</option>`; });
            } else {
                sysOptions += `<option value="${category}">${category}</option>`;
            }
        });
        sysSelect.innerHTML = sysOptions;
    }

    const timeInput = document.getElementById('manual-fault-time');
    if (timeInput) {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        timeInput.value = now.toISOString().slice(0, 16);
    }

    document.getElementById('manual-fault-modal')?.classList.remove('hidden');
};

window.saveManualFault = async function () {
    const sim = document.getElementById('manual-fault-sim').value;
    const instructor = document.getElementById('manual-fault-instructor').value; // יכול להיות ריק
    const desc = document.getElementById('manual-fault-desc').value.trim();
    const sysClass = document.getElementById('manual-sys-input').value;
    const severity = document.getElementById('manual-fault-severity').value;
    const isDowntime = document.getElementById('manual-fault-downtime').checked;
    const timeStr = document.getElementById('manual-fault-time').value;

    if (!sim || !desc || !timeStr) {
        import('../components/modals.js').then(m => m.showToast("נא למלא תאריך, מאמן ותיאור", "yellow"));
        return;
    }

    const faultData = {
        simulator: sim,
        reportingInstructor: instructor || "לא צוין",
        description: desc,
        systemClassification: sysClass,
        severity: severity,
        isDowntime: isDowntime,
        timestamp: new Date(timeStr).getTime(),
        isManualEntry: true
    };

    try {
        const { collection, addDoc } = window.firestoreFunctions;

        // שמירה במסד הנתונים וקבלת ה-ID החדש
        const docRef = await addDoc(collection(window.db, "standalone_faults"), faultData);

        // עדכון המערך המקומי כדי שהטבלה תתעדכן מיד
        const newFaultWithId = { id: docRef.id, ...faultData };
        if (!window.standaloneFaults) window.standaloneFaults = [];
        window.standaloneFaults.push(newFaultWithId);

        import('../components/modals.js').then(m => {
            m.showToast("התקלה נוספה בהצלחה!", "green");
            m.hideAllModals();
        });

        // עיבוד מחדש ורינדור של הטבלה
        if (typeof window.processFaultsData === 'function') window.processFaultsData();
        if (typeof window.renderFaultDatabaseTable === 'function') window.renderFaultDatabaseTable();

    } catch (e) {
        console.error("Manual fault save failed:", e);
        import('../components/modals.js').then(m => m.showToast("שגיאה בשמירה", "red"));
    }
};
/**
 * אתחול מאגר התקלות - הגדרת פילטרים וביצוע רינדור ראשוני
 */
window.switchFaultTab = function (tab) {
    const isTable = tab === 'table';
    document.getElementById('fault-tab-content-table').classList.toggle('hidden', !isTable);
    document.getElementById('fault-tab-content-stats').classList.toggle('hidden', isTable);

    // הסתרה/הצגה של פילטר סטטוס סגירה (רק ברשימה)
    const statusFilter = (window.appMode === 'daily') ? 'OPEN' : (document.getElementById('fault-status-filter')?.value || 'ALL');
    if (statusFilterContainer) {
        statusFilterContainer.classList.toggle('hidden', !isTable);
    }

    // הצגת כפתורי ניהול רק למנהלים ורק בטאב טבלה
    const adminControls = document.getElementById('fault-admin-controls-container');
    if (adminControls) {
        // מציג רק אם יש הרשאת ניהול (חלון.isAdmin מוגדר ב-auth.js)
        adminControls.classList.toggle('hidden', !window.isAdmin);
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

    // 1. טעינת כל התקופות שנוצרו והוגדרו בעמוד המנהל
    if (window.planningSettings?.periodConfigs) {
        Object.keys(window.planningSettings.periodConfigs).forEach(p => periods.add(p));
    }

    // 2. גיבוי: הוספת תקופות שעולות מתוך נתוני התקלות בפועל
    allFaults.forEach(f => {
        if (f.firstReportTimestamp) {
            const pName = typeof window.getPeriodName === 'function'
                ? window.getPeriodName(new Date(f.firstReportTimestamp))
                : getPeriodDisplay(new Date(f.firstReportTimestamp));
            if (pName) periods.add(pName);
        }
    });

    // מיון התקופות בסדר כרונולוגי יורד (החדש ביותר ראשון)
    const sortedPeriods = Array.from(periods).sort((a, b) => {
        const [pA, yA] = a.split('/').map(Number);
        const [pB, yB] = b.split('/').map(Number);
        return (yB + pB / 10) - (yA + pA / 10);
    });

    select.innerHTML = sortedPeriods.map(p => `<option value="${p}">${p}</option>`).join('');

    if (sortedPeriods.length > 0) {
        // בחירת התקופה הנוכחית של היום כברירת מחדל
        const currentP = typeof window.getPeriodName === 'function' ? window.getPeriodName(new Date()) : sortedPeriods[0];
        select.value = sortedPeriods.includes(currentP) ? currentP : sortedPeriods[0];
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
        const matchSim = simulatorFilter === 'ALL' || (f.simulator || '').toUpperCase().includes(simulatorFilter);
        if (!matchSim) return false;

        let matchTime = true;
        const reportDate = new Date(f.firstReportTimestamp);
        reportDate.setHours(0, 0, 0, 0);

        if (timeFilterType === 'period') {
            const selectedPeriod = document.getElementById('fault-period-select')?.value;
            const pName = typeof window.getPeriodName === 'function' ? window.getPeriodName(reportDate) : getPeriodDisplay(reportDate);
            matchTime = pName === selectedPeriod;
        }
        else if (timeFilterType === 'week') {
            const selectedWeek = parseInt(document.getElementById('fault-week-select')?.value);
            const selectedPeriod = document.getElementById('fault-period-select')?.value;

            if (selectedWeek && selectedPeriod) {
                const getStartSunday = (d) => {
                    if (!d) return null;
                    const s = new Date(d);
                    s.setHours(0, 0, 0, 0);
                    s.setDate(s.getDate() - s.getDay());
                    return s;
                };

                const reportSunday = getStartSunday(reportDate);
                let relevantStart = null;
                const config = planning.periodConfigs?.[selectedPeriod];

                if (config && config.startDate) {
                    relevantStart = getStartSunday(new Date(config.startDate));
                } else {
                    const [pNum, pYear] = selectedPeriod.split('/');
                    const fullYear = 2000 + parseInt(pYear);
                    relevantStart = (pNum === "1") ? getStartSunday(new Date(fullYear - 1, 11, 15)) : getStartSunday(new Date(fullYear, 5, 15));
                }

                if (relevantStart) {
                    const diffTime = reportSunday.getTime() - relevantStart.getTime();
                    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                    const faultWeekNum = Math.floor(diffDays / 7) + 1;
                    matchTime = (faultWeekNum === selectedWeek);
                } else {
                    matchTime = false;
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
    createFaultChart('chart-fault-severity', 'pie', Object.keys(stats.severity), Object.values(stats.severity), ['#60A5FA', '#FBBF24', '#F87171']);
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

    // הבטחת טעינת רשימות המנהל (סימולטורים) טרם האכלוס
    if ((!window.personnelLists || !window.personnelLists.simulators) && typeof window.loadPersonnelLists === 'function') {
        await window.loadPersonnelLists();
    }

    if (typeof window.getPlanningSettings === 'function') {
        await window.getPlanningSettings();
    }

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

    // תיקון: משיכת רשימת הסימולטורים מתוך ההגדרות של עמוד המנהל במקום ערכים קשיחים
    const sims = (window.personnelLists && window.personnelLists.simulators) ? window.personnelLists.simulators : [];
    simSelect.innerHTML = '<option value="ALL" selected>כל המאמנים</option>' +
        sims.map(s => `<option value="${s}">${s}</option>`).join('');

    populateFaultPeriodFilter();
    populateFaultWeekFilter();

    // חובה להוסיף את השורה הזו כדי לשלוף את התקלות הידניות מהשרת!
    await fetchStandaloneFaults();
    populateFaultPeriodFilter();
}
/**
 * עיבוד נתוני הגיחות ליצירת מאגר תקלות מאוחד
 */
export function processFaultsData() {
    const currentResolutionStatus = window.faultResolutionStatus || {};
    const unifiedFaultsDatabase = window.unifiedFaultsDatabase || {};
    const savedFlights = window.savedFlights || [];
    const standaloneFaults = window.standaloneFaults || []; // NEW

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
                    const cycleStatus = currentResolutionStatus[openCycleKey] || { isResolved: false };
                    unifiedFaultsDatabase[openCycleKey] = {
                        key: openCycleKey,
                        baseKey: baseKey,
                        simulator: simulator,
                        description: faultDescription,
                        reportCount: 1,
                        reportingInstructor: flight.data['מדריכה'] || "לא ידוע",
                        firstReportTimestamp: reportTimestamp,
                        lastReportTimestamp: reportTimestamp,
                        severity: fault.severity,
                        isDowntime: fault.isDowntime || false,
                        systemClassification: cycleStatus.systemClassification ? cycleStatus.systemClassification : fault.systemClassification,
                        status: cycleStatus,
                        sourceFlights: [flight.id]
                    };
                }
            });
        }
    });

    standaloneFaults.forEach(fault => {
        const baseKey = `${fault.simulator}|${fault.description}`;
        const key = fault.id || `MANUAL|${baseKey}|${fault.timestamp}`; // שימוש ב-ID אם קיים
        const manualCycleStatus = currentResolutionStatus[key] || { isResolved: false };

        unifiedFaultsDatabase[key] = {
            ...fault,
            key: key,
            baseKey: baseKey,
            reportCount: 1,
            firstReportTimestamp: fault.timestamp,
            lastReportTimestamp: fault.timestamp,
            systemClassification: manualCycleStatus.systemClassification || fault.systemClassification,
            status: manualCycleStatus // כאן נמצא ה-faultCategory
        };
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
    const severityEl = document.getElementById('fault-severity');
    const severity = severityEl ? severityEl.value : 'קל';
    const instructorEl = document.getElementById('instructor-name-1');
    const instructorName = instructorEl ? instructorEl.value : 'לא הוזן';

    const faultDescriptionEl = document.getElementById('other-fault-text');
    const faultDescription = faultDescriptionEl ? faultDescriptionEl.value.trim() : '';

    if (!faultDescription) {
        import('../components/modals.js').then(m => m.showToast('יש להזין פירוט עבור התקלה', 'red'));
        return;
    }

    const isDowntime = document.getElementById('fault-is-downtime')?.checked || false;
    const sysClassEl = document.getElementById('fault-system-class');
    const sysClass = sysClassEl ? sysClassEl.value : '';

    const newFault = {
        simulator: simulatorId,
        description: faultDescription,
        systemClassification: sysClass,
        severity: severity,
        reportingInstructor: instructorName,
        isDowntime: isDowntime,
        timestamp: Date.now()
    };

    if (!window.currentForm) window.currentForm = {};
    if (!window.currentForm.faults) window.currentForm.faults = [];

    window.currentForm.faults.push(newFault);

    if (typeof renderFaultsTable === 'function') {
        renderFaultsTable(window.currentForm.faults);
    }

    // איפוס שדות
    if (faultDescriptionEl) faultDescriptionEl.value = '';
    if (sysClassEl) sysClassEl.value = '';
    const sysClassDisplay = document.getElementById('fault-system-class-display');
    if (sysClassDisplay) sysClassDisplay.textContent = 'בחר מערכת...';

    const isDowntimeCb = document.getElementById('fault-is-downtime');
    if (isDowntimeCb) isDowntimeCb.checked = false;
    if (severityEl) severityEl.value = 'קל';
}

export function populateFaultOptions(simulatorId) {
    // הפונקציה כעת פשוט מציגה/מסתירה את אזור ההזנה בהתאם לבחירת מאמן
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
    } else {
        faultEntryAreas.forEach(el => el.classList.add('hidden'));
        addFaultContainers.forEach(el => el.classList.add('hidden'));
        simSelectContainers.forEach(el => el.classList.remove('hidden'));
        simDisplays.forEach(el => el.classList.add('hidden'));
    }
}

export async function fetchStandaloneFaults(forceRefresh = false) {
    if (!window.db) return;

    // עצירה אם הנתונים כבר נטענו ולא ביקשנו רענון כפוי
    if (!forceRefresh && window.standaloneFaults && window.standaloneFaults.length > 0) {
        processFaultsData();
        renderFaultDatabaseTable();
        return;
    }

    const { collection, getDocs } = window.firestoreFunctions;
    try {
        const querySnapshot = await getDocs(collection(window.db, "standalone_faults"));
        window.standaloneFaults = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        processFaultsData();
        renderFaultDatabaseTable();
    } catch (e) {
        console.error("Error fetching standalone faults:", e);
    }
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

    if (simulatorFilter !== 'ALL') {
        filteredFaults = filteredFaults.filter(f => (f.simulator || '').toUpperCase().includes(simulatorFilter));
    } if (statusFilter !== 'ALL') {
        filteredFaults = filteredFaults.filter(f => {
            if (statusFilter === 'OPEN') return !f.status.isResolved;
            if (statusFilter === 'RESOLVED') return f.status.isResolved && !f.status.isClosedWithPermission;
            if (statusFilter === 'PERMISSION') return f.status.isResolved && f.status.isClosedWithPermission;
            return true;
        });
    }

    filteredFaults = filteredFaults.filter(f => {
        const reportDate = new Date(f.firstReportTimestamp);
        reportDate.setHours(0, 0, 0, 0);

        if (timeFilterType === 'period') {
            const selectedPeriod = document.getElementById('fault-period-select')?.value;
            const pName = typeof window.getPeriodName === 'function' ? window.getPeriodName(reportDate) : getPeriodDisplay(reportDate);
            return pName === selectedPeriod;
        }
        else if (timeFilterType === 'week') {
            const selectedWeek = parseInt(document.getElementById('fault-week-select')?.value);
            const selectedPeriod = document.getElementById('fault-period-select')?.value;
            const planning = window.planningSettings || {};

            if (selectedWeek && selectedPeriod) {
                const getStartSunday = (d) => {
                    if (!d) return null;
                    const s = new Date(d);
                    s.setHours(0, 0, 0, 0);
                    s.setDate(s.getDate() - s.getDay());
                    return s;
                };

                const reportSunday = getStartSunday(reportDate);
                let relevantStart = null;
                const config = planning.periodConfigs?.[selectedPeriod];

                if (config && config.startDate) {
                    relevantStart = getStartSunday(new Date(config.startDate));
                } else {
                    const [pNum, pYear] = selectedPeriod.split('/');
                    const fullYear = 2000 + parseInt(pYear);
                    relevantStart = (pNum === "1") ? getStartSunday(new Date(fullYear - 1, 11, 15)) : getStartSunday(new Date(fullYear, 5, 15));
                }

                if (relevantStart) {
                    const diffTime = reportSunday.getTime() - relevantStart.getTime();
                    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                    const faultWeekNum = Math.floor(diffDays / 7) + 1;
                    return faultWeekNum === selectedWeek;
                }
            }
            return false;
        } else if (timeFilterType === 'range') {
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
        // מניעת שבירת Syntax ב-HTML באמצעות Escaping מחמיר
        const safeKey = fault.key ? fault.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n').replace(/\r/g, '') : '';

        // עיצוב שונה לתקלה פתוחה שמשביתה את המאמן
        const isDowntime = fault.isDowntime && !isResolved;
        const rowBg = isDowntime ? 'bg-red-50 border-r-4 border-red-500 hover:bg-red-100' : 'bg-white hover:bg-ofer-primary-50';

        return `<tr class="${rowBg} border-b transition cursor-pointer" onclick="window.showFaultDetailsModal('${safeKey}')">
            <td class="px-6 py-4 text-center ${isFaultSelectionMode ? '' : 'hidden'}" onclick="event.stopPropagation()">
                <input type="checkbox" class="fault-checkbox" data-key="${safeKey}" 
                    ${isChecked ? 'checked' : ''} 
                    onchange="window.toggleFaultCheckbox('${safeKey}')">
            </td>
            <td class="px-6 py-4 text-sm font-medium">${fault.simulator}</td>
            <td class="px-6 py-4 text-sm font-bold text-gray-900">
                ${fault.isDowntime ? '<span class="text-red-600 mr-1" title="תקלה משביתה">⚠️</span> ' : ''}${fault.description}
            </td>
            <td class="px-6 py-4 text-sm">${fault.systemClassification || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${new Date(fault.firstReportTimestamp).toLocaleDateString('he-IL')}</td>
            <td class="px-6 py-4 text-sm ${isResolved ? (fault.status.isClosedWithPermission ? 'text-yellow-600 font-bold' : 'text-green-600 font-bold') : 'text-red-600'}">
${isResolved ?
                `${fault.status.isClosedWithPermission ? 'נסגר בהיתר' : 'טופלה'} 
         <div class="text-[10px] text-gray-500 mt-1 font-normal">סיווג סגירה: ${fault.status.faultCategory || '-'}</div>`
                : 'פתוחה'}            </td>
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
            <p><strong>השבית את המאמן:</strong> <span class="${fault.isDowntime ? 'text-red-600 font-bold bg-red-100 px-1 rounded' : 'text-gray-600'}">${fault.isDowntime ? 'כן ⚠️' : 'לא'}</span></p>
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
            renderFaultDatabaseTable();
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
        irenderFaultDatabaseTable();
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

    // חילוץ תאריך ושעת פתיחת התקלה
    const firstReportDate = new Date(faultData.firstReportTimestamp);
    const openDateStr = firstReportDate.toLocaleDateString('he-IL');
    const openTimeStr = firstReportDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });

    const techOptions = (window.personnelLists?.technicians || [])
        .map(t => `<option value="${t}">${t}</option>`).join('');

    // בניית אפשרויות סיווג מערכת (לשינוי סיווג קיים)
    const systems = window.systemClassifications || {};
    let sysOptions = '<option value="">ללא סיווג / בחר מערכת...</option>';
    Object.keys(systems).sort().forEach(category => {
        const subItems = systems[category] || [];
        if (subItems.length > 0) {
            subItems.forEach(sub => {
                const val = `${category} - ${sub}`;
                const selected = (faultData.systemClassification === val) ? 'selected' : '';
                sysOptions += `<option value="${val}" ${selected}>${val}</option>`;
            });
        } else {
            const selected = (faultData.systemClassification === category) ? 'selected' : '';
            sysOptions += `<option value="${category}" ${selected}>${category}</option>`;
        }
    });

    let existingData = {};
    if (isEditMode && faultData.status) {
        existingData = faultData.status;
    }

    const safeKey = faultKey ? faultKey.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n').replace(/\r/g, '') : '';

    content.innerHTML = `
        <div class="space-y-4 text-right" dir="rtl">
            <div class="p-3 bg-gray-100 rounded-lg border border-gray-300 text-sm">
                <p class="mb-1"><strong>תיאור התקלה:</strong> ${faultData.description}</p>
                <p><strong>מדריכה מדווחת:</strong> <span class="text-ofer-orange font-bold">${reportingInstructor}</span></p>
                <p><strong>רמת הפרעה:</strong> <span class="font-bold">${severity}</span></p>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-bold mb-1 text-gray-500">תאריך פתיחה</label>
                    <input type="text" class="w-full border rounded p-2 bg-gray-100 text-gray-500 cursor-not-allowed" value="${openDateStr}" disabled>
                </div>
                <div>
                    <label class="block text-xs font-bold mb-1 text-gray-500">שעת פתיחה</label>
                    <input type="text" class="w-full border rounded p-2 bg-gray-100 text-gray-500 cursor-not-allowed" value="${openTimeStr}" disabled>
                </div>
            </div>

            <div>
                <label class="block text-xs font-bold mb-1">סיווג מערכת (ניתן לשינוי)</label>
                <select id="res-system-class" class="w-full border rounded p-2 focus:ring-ofer-primary-500 focus:border-ofer-primary-500">
                    ${sysOptions}
                </select>
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

<div id="verified-section">
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

            <div id="verified-text-area" class="mt-2">
                <label class="block text-xs font-bold mb-1">תיאור הטיפול / סיבת אי-אימות (חובה)</label>
                <textarea id="res-desc" class="w-full border rounded p-2" rows="3" 
                          placeholder="פרט כאן את אופן הטיפול...">${isEditMode ? (existingData.resolutionDescription || '') : ''}</textarea>
            </div>

            <div class="p-2 border rounded bg-yellow-50 border-yellow-200 mt-4">
                <div class="flex items-center gap-2">
                    <input type="checkbox" id="res-permission" onchange="window.updateResolutionFieldsVisibility()"
                           ${(isEditMode && existingData.isClosedWithPermission) ? 'checked' : ''}>
                    <label for="res-permission" class="font-bold">נסגר בהיתר</label>
                </div>
                <div id="permission-text-area" class="${(isEditMode && existingData.isClosedWithPermission) ? '' : 'hidden'} mt-2">
                    <textarea id="res-permission-note" class="w-full border rounded p-2" rows="2" 
                              placeholder="פרט את ההיתר...">${isEditMode ? (existingData.permissionNote || '') : ''}</textarea>
                </div>
            </div>

            ${isEditMode && existingData.isClosedWithPermission ? `
            <div class="p-2 border rounded bg-blue-50 border-blue-200 mt-4">
                <div class="flex items-center gap-2">
                    <input type="checkbox" id="res-final-closure" onchange="window.updateResolutionFieldsVisibility()">
                    <label for="res-final-closure" class="font-bold text-blue-800">האם התקלה טופלה סופית?</label>
                </div>
            </div>` : ''}

            ${faultData.isDowntime ? `
            <div class="p-3 border-2 rounded bg-red-50 border-red-400 mt-4 mb-2">
                <label class="block text-sm font-bold mb-2 text-red-800"><i class="fas fa-exclamation-triangle"></i> תקלה זו השביתה את המאמן!</label>
                <div class="flex items-center gap-2 bg-white p-2 rounded border">
                    <input type="checkbox" id="res-sim-returned" class="w-5 h-5 cursor-pointer accent-red-600">
                    <label for="res-sim-returned" class="font-bold cursor-pointer text-red-700">אני מאשר/ת שהמאמן שב לפעול כרגיל</label>
                </div>
            </div>` : ''}

            <button onclick="window.processFaultClosure('${safeKey}')" class="w-full bg-green-600 text-white font-bold py-3 rounded-lg shadow-md hover:bg-green-700 transition-colors mt-4">
                ${isEditMode ? 'עדכן וסגור' : 'אישור וסגירה'}
            </button>
        </div>`;

    if (isEditMode) {
        if (existingData.technicianName) document.getElementById('res-technician').value = existingData.technicianName;
        if (existingData.faultCategory) document.getElementById('res-category').value = existingData.faultCategory;
    }

    modal.classList.remove('hidden');
    window.updateResolutionFieldsVisibility();
}

async function processFaultClosure(faultKey) {
    const faultEntry = window.unifiedFaultsDatabase[faultKey];
    if (faultEntry && faultEntry.isDowntime) {
        const simReturned = document.getElementById('res-sim-returned');
        if (simReturned && !simReturned.checked) {
            showToast("חובה לאשר שהמאמן שב לפעול כרגיל לפני סגירת התקלה", "red");
            return;
        }
    }

    let technician = document.getElementById('res-technician').value;
    if (technician === 'OTHER') {
        const newTech = document.getElementById('res-new-technician').value.trim();
        if (!newTech) { showToast("יש להזין שם טכנאי חדש", "red"); return; }
        technician = newTech;

        if (window.personnelLists && window.personnelLists.technicians) {
            if (!window.personnelLists.technicians.includes(newTech)) {
                window.personnelLists.technicians.push(newTech);
                window.personnelLists.technicians.sort();
                if (window.savePersonnelLists) window.savePersonnelLists(true);
            }
        }
    }

    const isPermission = document.getElementById('res-permission').checked;
    const isFinalClosure = document.getElementById('res-final-closure')?.checked;

    // אם המשתמש סימן שזה טופל סופית - התקלה כבר אינה מוגדרת פתוחה תחת היתר
    const finalIsClosedWithPermission = isFinalClosure ? false : isPermission;

    const verifiedRadio = document.querySelector('input[name="verified-status"]:checked');
    const description = document.getElementById('res-desc').value.trim();
    const faultCategoryVal = document.getElementById('res-category').value;
    const systemClassVal = document.getElementById('res-system-class').value;
    const isEditMode = document.getElementById('res-final-closure') !== null;

    if (!technician) { showToast("יש לבחור טכנאי", "red"); return; }

    // בדיקת ולידציה של אופן הטיפול רק אם זו לא סגירה רגילה בהיתר
    if (!finalIsClosedWithPermission) {
        if (!verifiedRadio) { showToast("יש לסמן האם התקלה אומתה", "red"); return; }
        if (!description) { showToast("יש להזין פירוט על הטיפול", "red"); return; }
    }

    const dateVal = document.getElementById('res-date').value;
    const timeVal = document.getElementById('res-time').value;

    const closureData = {
        isResolved: true,
        technicianName: technician,
        faultCategory: faultCategoryVal,
        systemClassification: systemClassVal,
        isVerified: verifiedRadio ? verifiedRadio.value === 'true' : false,
        resolutionDescription: description || "נסגר בהיתר - ללא פירוט",
        isClosedWithPermission: finalIsClosedWithPermission,
        wasClosedWithPermission: isEditMode ? true : isPermission, // סימון לטובת המדדים אם עבר היתר
        permissionNote: finalIsClosedWithPermission ? document.getElementById('res-permission-note').value : "",
        date: dateVal,
        time: timeVal,
        timestamp: Date.now()
    };

    try {
        const { doc, setDoc } = window.firestoreFunctions;
        await setDoc(doc(window.db, "fault_resolutions", faultKey), closureData);

        if (!window.faultResolutionStatus) window.faultResolutionStatus = {};
        window.faultResolutionStatus[faultKey] = closureData;

        if (window.unifiedFaultsDatabase[faultKey]) {
            window.unifiedFaultsDatabase[faultKey].status = closureData;
            window.unifiedFaultsDatabase[faultKey].systemClassification = systemClassVal; // עדכון מקומי של סיווג המערכת
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

function calculateOperatingHoursBetween(startTs, endTs, flights) {
    let operatingMinutes = 0;
    flights.forEach(f => {
        if (f.executionStatus === 'בוטלה') return;
        const flightDate = f.date;
        const fStart = f.data['שעת התחלה'];
        const fEnd = f.data['שעת סיום'];
        if (!flightDate || !fStart || !fEnd) return;

        const fStartTs = new Date(`${flightDate}T${fStart}:00`).getTime();
        let fEndTs = new Date(`${flightDate}T${fEnd}:00`).getTime();
        if (fEndTs < fStartTs) fEndTs += 24 * 60 * 60 * 1000; // במקרה של גלישה מעבר לחצות

        const overlapStart = Math.max(startTs, fStartTs);
        const overlapEnd = Math.min(endTs, fEndTs);

        // אם הגיחה התקיימה בזמן שהתקלה הייתה פתוחה
        if (overlapEnd > overlapStart) {
            operatingMinutes += (overlapEnd - overlapStart) / 60000;
        }
    });
    return operatingMinutes / 60; // החזרה בשעות
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

    import('../components/modals.js').then(m => m.showToast("מוחק תקלות...", "blue"));

    try {
        for (const key of faultSelectedSet) {
            const faultEntry = window.unifiedFaultsDatabase[key];
            if (!faultEntry) continue;

            // 1. מחיקת רזולוציה (תיעוד הטיפול) אם קיימת
            try {
                await deleteDoc(doc(window.db, "fault_resolutions", key));
            } catch (e) {
                console.log('No resolution found to delete');
            }

            // 2. מחיקת תקלה ידנית מ- standalone_faults (התוספת החדשה!)
            if (faultEntry.id && faultEntry.isManualEntry) {
                try {
                    await deleteDoc(doc(window.db, "standalone_faults", faultEntry.id));
                } catch (e) {
                    console.error('Error deleting standalone fault', e);
                }
            }

            // 3. מחיקת התקלה מגיחות המקור (תקלות שדווחו דרך טופס גיחה)
            if (faultEntry.sourceFlights && faultEntry.sourceFlights.length > 0) {
                for (const flightId of faultEntry.sourceFlights) {
                    try {
                        const flightRef = doc(window.db, "flights", flightId);
                        const localFlight = window.savedFlights.find(f => f.id === flightId);
                        if (localFlight) {
                            const flightData = localFlight.data; // או localFlight עצמו, תלוי במבנה שלך
                            const originalFaults = flightData.faults || [];
                            const updatedFaults = originalFaults.filter(f =>
                                !(f.description === faultEntry.description && f.simulator === faultEntry.simulator)
                            );

                            if (originalFaults.length !== updatedFaults.length) {
                                await updateDoc(flightRef, { faults: updatedFaults });
                                // כדאי גם לעדכן את המערך המקומי כדי למנוע חוסר סנכרון
                                localFlight.data.faults = updatedFaults;
                            }
                        }
                    } catch (err) {
                        console.error(`Failed to update flight ${flightId}`, err);
                    }
                }
            }
            deletedCount++;
        }

        import('../components/modals.js').then(m => m.showToast(`${deletedCount} תקלות נמחקו בהצלחה`, 'green'));
        faultSelectedSet.clear();
        isFaultSelectionMode = false;
        window.toggleFaultAdminMode(); // איפוס מצב ה-UI

        // רענון טבלאות הנתונים כדי שהתקלה תיעלם מיד מהמסך
        if (typeof window.fetchStandaloneFaults === 'function') await window.fetchStandaloneFaults();
        if (typeof window.fetchFlights === 'function') await window.fetchFlights();

    } catch (e) {
        console.error(e);
        import('../components/modals.js').then(m => m.showToast('שגיאה בתהליך המחיקה', 'red'));
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

window.updateResolutionFieldsVisibility = () => {
    const isPermission = document.getElementById('res-permission')?.checked;
    const isFinal = document.getElementById('res-final-closure')?.checked;

    const verifiedSection = document.getElementById('verified-section');
    const descSection = document.getElementById('verified-text-area');
    const permTextArea = document.getElementById('permission-text-area');

    if (permTextArea) {
        permTextArea.classList.toggle('hidden', !isPermission);
    }

    // אם נסגר בהיתר וזה לא סגירה סופית -> נסתיר את אופן הטיפול והאימות (אין חובה למלא)
    if (isPermission && !isFinal) {
        if (verifiedSection) verifiedSection.classList.add('hidden');
        if (descSection) descSection.classList.add('hidden');
    } else {
        if (verifiedSection) verifiedSection.classList.remove('hidden');
        if (descSection) descSection.classList.remove('hidden');
    }
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
window.toggleFaultAdminMode = window.toggleFaultAdminMode;
window.toggleFaultTimeFilters = window.toggleFaultTimeFilters;
window.onFaultFilterChange = window.onFaultFilterChange;
window.updateResolutionFieldsVisibility = window.updateResolutionFieldsVisibility;
window.saveManualFault = window.saveManualFault;
window.populateSystemFilter = populateSystemFilter;
window.calculateOperatingHoursBetween = calculateOperatingHoursBetween;
window.openResolutionForm = openResolutionForm;
window.processFaultClosure = processFaultClosure;
window.fetchStandaloneFaults = fetchStandaloneFaults;