// public/js/features/adminManager.js
import { showToast } from '../components/modals.js';
import { savedFlights, goalConfigurations, systemClassifications } from '../core/global.js';
import * as Global from '../core/global.js';

export let metricConfigurations = [];
// משתנה גלובלי לשמירת הרשימות בזיכרון
export let personnelLists = {
    // instructorsMale: [],
    instructorsFemale: [],
    pilots: [],
    observers: [],
    simulators: [],
    flightTypes: ["יום אימון", "חניכים", "הסבת מדריכים", "צ'ק", "השכלה", "פנימי", "אבלואציה"],
    flightNames: [
        "בונוס", "בונוס 1", "בונוס 2", "בונוס 3", "בונוס 4",
        "בכירים",
        "הסבת חניכים 1", "הסבת חניכים 2", "הסבת חניכים 3",
        "הסבת מדריך לילה",
        "הסבת מדריכים 1", "הסבת מדריכים 2", "הסבת מדריכים 3", "הסבת מדריכים 4", "הסבת מדריכים 5", "הסבת מדריכים 6",
        "זנב",
        'י"ט 1', 'י"ט 2', 'י"ט 3',
        'יג"נ 1', 'יג"נ 2',
        'יו"א מדריך 1.1', 'יו"א מדריך 1.2', 'יו"א מדריך 1.3',
        'יו"א מדריך 2.1', 'יו"א מדריך 2.2', 'יו"א מדריך 2.3',
        "יסודות 1", "יסודות 2", "יסודות 3",
        "יסודות חירומים 1", "יסודות חירומים 2", "יסודות חירומים 3", "יסודות חירומים 4", "יסודות חירומים 5", "יסודות חירומים 6", "יסודות חירומים 7",
        "לילה 1", "לילה 2", "לילה 3", "לילה 4",
        "מבנה 1", "מבנה 2", "מבנה 3",
        "מכשירים 1", "מכשירים 2",
        "מסכם משימה",
        "מסכמת זנב",
        "מסכמת משימה",
        'מסכמת משימה מסע"ר',
        'מסכמת משימה מסק"ר',
        'משימה מסע"ר',
        'משימה מסק"ר',
        "ריענון מדריך 1", "ריענון מדריך 2",
        "תכונות טיסה"
    ],
    technicians: [],
    cancellationReasons: ["טייסת", "איוש", "אישי", "תיאום", "טכני", "אחר"] // <--- הוסף את השורה הזו

};

// --- משתנים לתכנון תקופה ---
let planningState = {
    currentDate: new Date(),
    periodPrevStart: null,
    periodCurrStart: null,
    periodNextStart: null,
    dailyPlans: {},
    originalPlans: {},
    weeklyPlans: {}
};

export let pilotPopulations = {
    instructorGroups: [],
    courses: [],
    conversionGroups: [], // <--- הוספת שדה לקבוצות הסבה
    flightMapping: {
        students: [],
        instructors: [],
        conversion: [] // <--- הוספת שדה למיפוי גיחות הסבה
    }
};

let currentEditingDate = null;

// --- פונקציית אתחול ראשית למסך המנהל ---
export async function initAdminPage() {
    const { doc, getDoc } = window.firestoreFunctions;

    loadPersonnelLists();
    loadGoalsAndSystems();

    if (window.db) {
        try {
            const popRef = doc(window.db, "settings", "populations");
            const popSnap = await getDoc(popRef);
            if (popSnap.exists()) {
                const data = popSnap.data();

                // טעינת קבוצות מדריכים וקורסים (קיים)
                pilotPopulations.instructorGroups = data.instructorGroups || [];
                pilotPopulations.courses = data.courses || [];

                // --- הוספה חשובה 1: טעינת קבוצות הסבה ---
                pilotPopulations.conversionGroups = data.conversionGroups || [];

                // --- הוספה חשובה 2: טעינת מיפוי גיחות עם ברירת מחדל לקטגוריה החדשה ---
                pilotPopulations.flightMapping = data.flightMapping || {};

                // וידוא שהמערכים קיימים בתוך המיפוי (מונע את שגיאת ה-undefined)
                if (!pilotPopulations.flightMapping.students) pilotPopulations.flightMapping.students = [];
                if (!pilotPopulations.flightMapping.instructors) pilotPopulations.flightMapping.instructors = [];
                if (!pilotPopulations.flightMapping.conversion) pilotPopulations.flightMapping.conversion = [];
            }
        } catch (error) {
            console.error("Error loading populations:", error);
        }
    }

    planningState.currentDate = new Date();
    loadPlanningData();
    switchAdminTab('planning');
}

// --- ניהול טאבים ---
export function switchAdminTab(tabId) {
    // עדכון כפתורים
    document.querySelectorAll('[id^="tab-btn-"]').forEach(btn => {
        btn.classList.remove('border-ofer-orange', 'text-ofer-orange');
        btn.classList.add('border-transparent', 'text-gray-500');
    });

    const activeBtn = document.getElementById(`tab-btn-${tabId}`);
    if (activeBtn) {
        activeBtn.classList.add('border-ofer-orange', 'text-ofer-orange');
        activeBtn.classList.remove('border-transparent', 'text-gray-500');
    }

    // עדכון תוכן
    document.querySelectorAll('.admin-tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    const targetContent = document.getElementById(`tab-content-${tabId}`);
    if (targetContent) targetContent.classList.remove('hidden');

    // פעולות ספציפיות לטאב
    if (tabId === 'planning') {
        loadPlanningData();
    } else if (tabId === 'goals') {
        populateGoalConfigDropdowns();
        renderGoalsConfigTable();
        // אתחול שדה יעד ראשון אם הרשימה ריקה
        const container = document.getElementById('goals-container');
        if (container && container.children.length === 0) {
            window.addGoalInput();
        }
    } else if (tabId === 'populations') {
        renderPopulations();
    }
}

export async function loadGoalsAndSystems() {
    if (!window.firestoreFunctions || !window.db) return;
    const { doc, getDoc } = window.firestoreFunctions;

    try {
        const docRef = doc(window.db, "settings", "advanced_config");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            // טעינת יעדים
            Global.goalConfigurations.splice(0, Global.goalConfigurations.length, ...(data.goalConfigurations || []));
            // טעינת מדדים (החלק החסר)
            window.metricConfigurations = data.metricConfigurations || [];

            // עדכון המערכות
            const systems = data.systemClassifications || {};
            for (const key in systems) { Global.systemClassifications[key] = systems[key]; }

            renderSystemList();
            renderMetricsConfigTable(); // קריאה לרינדור הטבלה
        }
    } catch (error) {
        console.error("Error loading advanced config:", error);
    }
}

function renderMetricsConfigTable() {
    const tbody = document.getElementById('metrics-config-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    (window.metricConfigurations || []).forEach((config, index) => {
        const metricsText = config.metrics.map(m => `<b>${m.mainName}:</b> ${m.subs.join(', ')}`).join('<br>');
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50 transition-colors";
        tr.innerHTML = `
            <td class="px-6 py-4 text-sm text-gray-900">${config.type}</td>
            <td class="px-6 py-4 text-sm text-gray-900">${config.name}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${metricsText}</td>
            <td class="px-6 py-4 text-sm whitespace-nowrap">
                <button onclick="window.editMetricConfig(${index})" class="text-blue-600 hover:text-blue-900 ml-3">ערוך</button>
                <button onclick="window.deleteMetricConfig(${index})" class="text-red-600 hover:text-red-900">מחק</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- פונקציות טעינה וסנכרון רשימות ---
export async function loadPersonnelLists() {
    if (!window.firestoreFunctions || !window.db) { renderAllLists(); return; }
    const { doc, getDoc } = window.firestoreFunctions;
    try {
        const docRef = doc(window.db, "settings", "personnel");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            Object.assign(personnelLists, data);

            // הצמדה קריטית ל-Window כדי ש-Global.js ו-FaultManager.js יראו את הנתונים
            window.personnelLists = personnelLists;

            renderAllLists();
            window.dispatchEvent(new CustomEvent('personnelListsUpdated'));
        }
    } catch (error) { console.error("Error loading lists:", error); }
}

export async function syncFromExistingFlights() {
    if (!savedFlights || savedFlights.length === 0) { showToast("לא נמצאו גיחות במערכת לסנכרון.", "yellow"); return; }
    if (!confirm("פעולה זו תסרוק את כל הגיחות הקיימות ותוסיף שמות חסרים לרשימות. להמשיך?")) return;
    let addedCount = 0;
    const sets = {
        // instructorsMale: new Set(personnelLists.instructorsMale || []),
        instructorsFemale: new Set(personnelLists.instructorsFemale || []),
        pilots: new Set(personnelLists.pilots || []),
        observers: new Set(personnelLists.observers || []),
        simulators: new Set(personnelLists.simulators || []),
        flightTypes: new Set(personnelLists.flightTypes || []),
        flightNames: new Set(personnelLists.flightNames || [])
    };
    savedFlights.forEach(flight => {
        const d = flight.data || {};
        const add = (key, setKey) => { const val = d[key]; if (val && typeof val === 'string' && val.trim().length > 1) { if (!sets[setKey].has(val.trim())) { sets[setKey].add(val.trim()); addedCount++; } } };
        // add('מדריך', 'instructorsMale'); add('instructor-main', 'instructorsMale');
        add('מדריכה', 'instructorsFemale'); add('instructor-name-1', 'instructorsFemale');
        add('טייס ימין', 'pilots'); add('טייס שמאל', 'pilots'); add('pilot-right', 'pilots'); add('pilot-left', 'pilots');
        add('מתצפת', 'observers'); add('observer', 'observers');
        add('סימולטור', 'simulators'); add('סוג גיחה', 'flightTypes'); add('שם גיחה', 'flightNames');
    });
    Object.keys(sets).forEach(key => { personnelLists[key] = Array.from(sets[key]).sort(); });
    if (addedCount > 0) { await savePersonnelLists(); renderAllLists(); showToast(`נוספו ${addedCount} ערכים חדשים!`, "green"); } else { showToast("הכל מעודכן. לא נמצאו ערכים חדשים.", "blue"); }
}

export async function updateListsFromImport(newNamesData) {
    if (personnelLists.pilots.length === 0) await loadPersonnelLists();
    let hasChanges = false;
    const mergeNames = (category, newNames) => { if (!newNames || newNames.length === 0) return; const currentSet = new Set(personnelLists[category] || []); newNames.forEach(name => { const cleanName = name.trim(); if (cleanName && !currentSet.has(cleanName)) { currentSet.add(cleanName); hasChanges = true; } }); personnelLists[category] = Array.from(currentSet).sort(); };
    // mergeNames('instructorsMale', newNamesData.instructorsMale);
    mergeNames('instructorsFemale', newNamesData.instructorsFemale); mergeNames('pilots', newNamesData.pilots);
    if (hasChanges) { const { doc, setDoc } = window.firestoreFunctions; if (window.db) await setDoc(doc(window.db, "settings", "personnel"), personnelLists); renderAllLists(); }
}

function renderAllLists() {
    // renderList('instructorsMale'); 
    renderList('instructorsFemale'); renderList('pilots'); renderList('observers'); renderList('simulators'); renderList('flightTypes'); renderList('flightNames'); renderList('technicians');
}
function renderList(type) {
    const listContainer = document.getElementById(`list-${type}`); if (!listContainer) return; listContainer.innerHTML = ''; const items = personnelLists[type] || [];
    if (items.length === 0) { listContainer.innerHTML = `<li class="text-gray-400 text-sm italic text-center py-2">אין ערכים ברשימה.</li>`; return; }
    items.forEach((item, index) => { const li = document.createElement('li'); li.className = "flex justify-between items-center bg-gray-50 p-2 rounded hover:bg-gray-100 border border-gray-200"; li.innerHTML = `<span class="font-medium text-gray-800 truncate flex-grow ml-2" title="${item}">${item}</span><div class="flex gap-1 shrink-0"><button onclick="window.editPerson('${type}', ${index})" class="text-blue-500 hover:text-blue-700 p-1">✏️</button><button onclick="window.removePerson('${type}', ${index})" class="text-red-500 hover:text-red-700 p-1">🗑️</button></div>`; listContainer.appendChild(li); });
}

export async function savePersonnelLists(silent = false) {
    if (!window.firestoreFunctions || !window.db) return;

    try {
        const { doc, setDoc } = window.firestoreFunctions;
        await setDoc(doc(window.db, "settings", "personnel"), personnelLists);

        if (!silent) {
            showToast('השינויים נשמרו בהצלחה!', 'green');
        }
    } catch (error) {
        console.error(error);
        showToast('שגיאה בשמירה אוטומטית.', 'red');
    }
}

export async function addPerson(type) {
    const input = document.getElementById(`input-${type}`);
    if (!input) return;

    const name = input.value.trim();
    if (!name) return showToast("נא להזין ערך.", "yellow");

    if (!personnelLists[type]) personnelLists[type] = [];
    if (personnelLists[type].includes(name)) return showToast("הערך כבר קיים.", "red");

    personnelLists[type].push(name);
    personnelLists[type].sort();

    input.value = '';
    renderList(type);

    await savePersonnelLists(true);
    showToast(`נוסף ונשמר: ${name}`, "green");
}

export async function removePerson(type, index) {
    const nameToRemove = personnelLists[type][index];
    if (confirm(`למחוק את "${nameToRemove}"?`)) {
        personnelLists[type].splice(index, 1);
        renderList(type);

        await savePersonnelLists(true);
        showToast(`נמחק ונשמר: ${nameToRemove}`, "green");
    }
}

export async function editPerson(type, index) {
    const oldName = personnelLists[type][index];
    const newName = prompt("ערוך ערך:", oldName);

    if (newName && newName.trim() && newName !== oldName) {
        personnelLists[type][index] = newName.trim();
        personnelLists[type].sort();
        renderList(type);

        await savePersonnelLists(true);
        showToast("השם עודכן ונשמר.", "green");
    }
}

// --- פונקציות תכנון (Planning) ---
function add26Weeks(date) {
    const result = new Date(date);
    result.setDate(result.getDate() + (26 * 7));
    return result;
}
function addWeeks(date, weeks) {
    const result = new Date(date);
    result.setDate(result.getDate() + (weeks * 7));
    return result;
}

function generatePeriodName(date) {
    if (!date) return "";
    let year = date.getFullYear();
    const month = date.getMonth();

    if (month === 11) {
        year++;
        return `1/${year.toString().slice(-2)}`;
    }

    const yearShort = year.toString().slice(-2);
    // תיקון: ינואר-מאי (0-4) הם תקופה 1, יוני-נובמבר (5-10) הם תקופה 2
    const periodNum = month < 5 ? "1" : "2";
    return `${periodNum}/${yearShort}`;
}



export async function loadPlanningData() {
    const inputCurr = document.getElementById('input-period-curr');
    const nakaInput = document.getElementById('input-period-naka');
    const minInput = document.getElementById('input-period-min');
    const targetInput = document.getElementById('input-period-target');

    if (!window.firestoreFunctions || !window.db) return;
    const { doc, getDoc } = window.firestoreFunctions;

    try {
        const docRef = doc(window.db, "settings", "planning");
        const snap = await getDoc(docRef);

        if (snap.exists()) {
            const data = snap.data();
            window.planningSettings = data; // שמירה גלובלית לשימוש בשאר המערכת

            planningState.periodPrevStart = data.periodPrevStart ? new Date(data.periodPrevStart) : null;
            planningState.periodCurrStart = data.periodCurrStart ? new Date(data.periodCurrStart) : null;
            planningState.periodNextStart = data.periodNextStart ? new Date(data.periodNextStart) : null;
            planningState.dailyPlans = data.dailyPlans || {};
            planningState.originalPlans = data.originalPlans || {};

            // טעינת המכסות של התקופה הנוכחית המוצגת
            if (planningState.periodCurrStart) {
                const periodName = window.getPeriodName(planningState.periodCurrStart);
                const config = data.periodConfigs?.[periodName] || {};
                if (nakaInput) nakaInput.value = config.naka || 85;
                if (minInput) minInput.value = config.min || 0;
                if (targetInput) targetInput.value = config.target || 0;
            }
        }

        updatePeriodInputsUI();
        renderPlanningCalendar();
    } catch (error) {
        console.error("Error loading planning data:", error);
    }
}

// עדכון התצוגה של השדות והלייבלים
function updatePeriodInputsUI() {
    const mapping = [
        { key: 'Prev', label: 'התקופה הקודמת', state: planningState.periodPrevStart },
        { key: 'Curr', label: 'התקופה הנוכחית', state: planningState.periodCurrStart },
        { key: 'Next', label: 'התקופה הבאה', state: planningState.periodNextStart }
    ];

    mapping.forEach(item => {
        const input = document.getElementById(`input-period-${item.key.toLowerCase()}`);
        const label = document.getElementById(`label-period-${item.key.toLowerCase()}`);

        if (item.state) {
            if (input) input.value = item.state.toISOString().split('T')[0];
            if (label) {
                const pName = generatePeriodName(item.state);
                label.textContent = `${item.label} (${pName})`;
            }
        }
    });
}

function initDefaultPeriods() {
    const inputP1 = document.getElementById('input-period1-start');
    const inputP2 = document.getElementById('input-period2-start');

    planningState.period1Start = new Date();
    planningState.period2Start = add26Weeks(planningState.period1Start);

    if (inputP1) inputP1.value = planningState.period1Start.toISOString().split('T')[0];
    if (inputP2) inputP2.value = planningState.period2Start.toISOString().split('T')[0];
}

export function changePlanningMonth(offset) {
    planningState.currentDate.setMonth(planningState.currentDate.getMonth() + offset);
    renderPlanningCalendar();
}

window.openDayPlanModal = (dateStr) => {
    currentEditingDate = dateStr;
    const modal = document.getElementById('day-plan-modal');
    const inputCount = document.getElementById('day-plan-input');
    const inputManager = document.getElementById('day-plan-manager');
    const inputSupport = document.getElementById('day-plan-support');
    const title = document.getElementById('day-plan-date-display');

    const dateObj = new Date(dateStr);
    title.textContent = dateObj.toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const currentData = planningState.dailyPlans[dateStr];

    if (typeof currentData === 'object' && currentData !== null) {
        inputCount.value = currentData.count !== undefined ? currentData.count : '';
        inputManager.value = currentData.manager || '';
        inputSupport.checked = !!currentData.support;
    } else if (typeof currentData === 'number' || typeof currentData === 'string') {
        inputCount.value = currentData;
        inputManager.value = '';
        inputSupport.checked = false;
    } else {
        inputCount.value = '';
        inputManager.value = '';
        inputSupport.checked = false;
    }

    modal.classList.remove('hidden');
    inputCount.focus();
};

window.confirmDayPlan = () => {
    if (!currentEditingDate) return;

    const inputCount = document.getElementById('day-plan-input');
    const inputManager = document.getElementById('day-plan-manager');
    const inputSupport = document.getElementById('day-plan-support');

    const countVal = inputCount.value === '' ? null : parseInt(inputCount.value);
    const managerVal = inputManager.value.trim();
    const supportVal = inputSupport.checked;

    const newData = {
        count: countVal !== null ? countVal : 0,
        manager: managerVal,
        support: supportVal
    };

    if (planningState.originalPlans[currentEditingDate] === undefined && countVal !== null) {
        planningState.originalPlans[currentEditingDate] = countVal;
    }

    if (countVal === null && !managerVal && !supportVal) {
        delete planningState.dailyPlans[currentEditingDate];
    } else {
        planningState.dailyPlans[currentEditingDate] = newData;
    }

    document.getElementById('day-plan-modal').classList.add('hidden');
    renderPlanningCalendar();
    window.savePlanningData();
};

export function renderPlanningCalendar() {
    const tbody = document.getElementById('planning-calendar-body');
    const monthTitle = document.getElementById('planning-current-month');
    if (!tbody) return;

    const year = planningState.currentDate.getFullYear();
    const month = planningState.currentDate.getMonth();
    const monthNames = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
    if (monthTitle) monthTitle.textContent = `${monthNames[month]} ${year}`;

    // שליחת תאריכי התקופות כפי שהוגדרו על ידי המשתמש
    const pPrev = planningState.periodPrevStart;
    const pCurr = planningState.periodCurrStart;
    const pNext = planningState.periodNextStart;

    tbody.innerHTML = '';
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let currentProcessDate = new Date(firstDay);
    // הולכים ליום ראשון הקרוב ביותר בתחילת החודש
    currentProcessDate.setDate(currentProcessDate.getDate() - currentProcessDate.getDay());

    while (currentProcessDate <= lastDay || currentProcessDate.getDay() !== 0) {
        const tr = document.createElement('tr');

        let weekLabel = '-';
        let relevantStart = null;
        let periodName = '';
        let weekNumKey = null;

        // פונקציית עזר למציאת יום ראשון שבו מתחילה הגיחה או התקופה
        const getStartSunday = (d) => {
            if (!d) return null;
            const s = new Date(d);
            s.setHours(0, 0, 0, 0);
            s.setDate(s.getDate() - s.getDay());
            return s;
        };

        const currSunday = getStartSunday(currentProcessDate);
        const pPrevSun = getStartSunday(pPrev);
        const pCurrSun = getStartSunday(pCurr);
        const pNextSun = getStartSunday(pNext);

        /**
         * קביעת התקופה הרלוונטית לפי סדר עדיפויות יורד (הבאה, אז הנוכחית, אז הקודמת).
         * שיטה זו מונעת כפילויות בשבועות המעבר מכיוון שכל יום ראשון משויך לתקופה אחת בלבד.
         */
        if (pNextSun && currSunday >= pNextSun) {
            relevantStart = pNextSun;
            periodName = "באה";
        } else if (pCurrSun && currSunday >= pCurrSun) {
            relevantStart = pCurrSun;
            periodName = "נוכחית";
        } else if (pPrevSun && currSunday >= pPrevSun) {
            relevantStart = pPrevSun;
            periodName = "קודמת";
        }

        if (relevantStart) {
            // חישוב מספר השבוע יחסית ליום ראשון של תחילת התקופה
            const diffDays = Math.round((currSunday - relevantStart) / (1000 * 60 * 60 * 24));
            const weekNum = Math.floor(diffDays / 7) + 1;
            weekLabel = `שבוע ${weekNum}`;

            const pKeyMap = { "נוכחית": "curr", "באה": "next", "קודמת": "prev" };
            if (pKeyMap[periodName]) {
                weekNumKey = `${pKeyMap[periodName]}_w${weekNum}`;
            }
        }

        tr.innerHTML += `<td class="px-3 py-4 text-xs font-bold text-gray-700 bg-gray-50 border-l sticky right-0 z-10">${weekLabel}</td>`;

        let currentWeekDates = [];

        for (let i = 0; i < 7; i++) {
            const y = currentProcessDate.getFullYear();
            const m = String(currentProcessDate.getMonth() + 1).padStart(2, '0');
            const d = String(currentProcessDate.getDate()).padStart(2, '0');
            const dateStr = `${y}-${m}-${d}`;
            currentWeekDates.push(dateStr);

            const isCurrentMonth = currentProcessDate.getMonth() === month;
            const dayNum = currentProcessDate.getDate();
            const storedData = planningState.dailyPlans[dateStr];

            let displayCount = '-';
            let managerName = '';
            let hasSupport = false;

            if (storedData) {
                if (typeof storedData === 'object') {
                    displayCount = storedData.count !== undefined ? storedData.count : '-';
                    managerName = storedData.manager || '';
                    hasSupport = !!storedData.support;
                } else {
                    displayCount = storedData;
                }
            }

            const originalValue = planningState.originalPlans[dateStr];
            const currentCountVal = (displayCount === '-') ? 0 : parseInt(displayCount);
            const hasChanged = originalValue !== undefined && currentCountVal !== originalValue;

            let updateIndicator = hasChanged ? '<span class="absolute top-1 left-1 text-[8px] text-ofer-orange">●</span>' : '';
            const supportIcon = hasSupport ? '<span class="text-green-500 text-[10px] mr-1">🛠️</span>' : '';
            const managerDisplay = managerName ? `<div class="text-[9px] text-blue-600 truncate w-full text-center mt-1">${managerName}</div>` : '';
            const cursorClass = isCurrentMonth ? 'cursor-pointer hover:bg-blue-50' : 'opacity-50 bg-gray-50';

            const td = document.createElement('td');
            td.className = `border p-1 relative h-24 align-top ${cursorClass}`;
            if (isCurrentMonth) td.setAttribute('onclick', `window.openDayPlanModal('${dateStr}')`);

            const finalCountDisplay = (currentCountVal === 0 && displayCount !== 0) ? '-' : currentCountVal;

            td.innerHTML = `
                <div class="flex justify-between items-start mb-1">
                    <span class="text-xs font-semibold ml-1 text-gray-500">${dayNum}</span>
                    <div class="flex gap-1">${supportIcon}${updateIndicator}</div>
                </div>
                <div class="flex flex-col items-center justify-center h-full pb-2">
                    <div class="text-xl font-bold text-gray-800">${finalCountDisplay === 0 ? '-' : finalCountDisplay}</div>
                    <span class="text-[10px] text-gray-400">גיחות</span>
                    ${managerDisplay}
                </div>
            `;
            tr.appendChild(td);
            currentProcessDate.setDate(currentProcessDate.getDate() + 1);
        }

        let weeklySum = 0;
        currentWeekDates.forEach(d => {
            const val = planningState.dailyPlans[d];
            let count = 0;
            if (typeof val === 'number') count = val;
            else if (val && typeof val.count === 'number') count = val.count;
            weeklySum += count;
        });

        if (weekNumKey) planningState.weeklyPlans[weekNumKey] = weeklySum;
        const displaySum = (weekLabel !== '-') ? weeklySum : '-';

        tr.innerHTML += `
            <td class="border p-2 bg-orange-50 align-middle text-center">
                <span class="font-bold text-lg text-ofer-orange">${displaySum}</span>
                <div class="text-[10px] text-gray-500">סה"כ</div>
            </td>
        `;
        tbody.appendChild(tr);
    }
}


// חפש את פונקציית savePlanningData ועדכן אותה:
window.savePlanningData = async () => {
    if (!window.firestoreFunctions || !window.db) return;
    const { doc, setDoc, getDoc } = window.firestoreFunctions;

    // 1. קריאת התאריכים המעודכנים מהשדות לפני השמירה
    const prevInput = document.getElementById('input-period-prev')?.value;
    const currInput = document.getElementById('input-period-curr')?.value;
    const nextInput = document.getElementById('input-period-next')?.value;

    if (prevInput) planningState.periodPrevStart = new Date(prevInput);
    if (currInput) planningState.periodCurrStart = new Date(currInput);
    if (nextInput) planningState.periodNextStart = new Date(nextInput);

    // חילוץ שם התקופה בצורה מדויקת
    const periodName = window.getPeriodName(planningState.periodCurrStart);
    if (!periodName) return showToast("לא ניתן לזהות שם תקופה, נא לוודא שיש תאריך התחלה", "red");

    // קריאה מאובטחת של השדות (אם ריק ישמר ערך ברירת מחדל)
    const nakaInputVal = document.getElementById('input-period-naka')?.value;
    const minInputVal = document.getElementById('input-period-min')?.value;
    const targetInputVal = document.getElementById('input-period-target')?.value;

    const nakaVal = nakaInputVal !== "" ? parseInt(nakaInputVal) : 85;
    const minVal = minInputVal !== "" ? parseInt(minInputVal) : 0;
    const targetVal = targetInputVal !== "" ? parseInt(targetInputVal) : 0;

    try {
        const docRef = doc(window.db, "settings", "planning");
        const snap = await getDoc(docRef);
        const existingData = snap.exists() ? snap.data() : {};
        
        const periodConfigs = existingData.periodConfigs || {};
        periodConfigs[periodName] = {
            naka: nakaVal,
            min: minVal,
            target: targetVal
        };

        const dataToSave = {
            ...existingData,
            periodPrevStart: planningState.periodPrevStart?.toISOString() || null,
            periodCurrStart: planningState.periodCurrStart?.toISOString() || null,
            periodNextStart: planningState.periodNextStart?.toISOString() || null,
            periodConfigs: periodConfigs,
            dailyPlans: planningState.dailyPlans,
            originalPlans: planningState.originalPlans,
            lastUpdated: new Date()
        };

        await setDoc(docRef, dataToSave);
        window.planningSettings = dataToSave; // עדכון גלובלי מיידי
        
        // רענון התצוגה של הכותרות (Labels) כך שישקפו את שם התקופה המעודכן
        if (typeof updatePeriodInputsUI === 'function') updatePeriodInputsUI();
        
        showToast(`נתוני תקופה ${periodName} נשמרו בהצלחה!`, "green");
    } catch (error) {
        console.error("Error saving plan:", error);
        showToast("שגיאה בשמירת הנתונים", "red");
    }
};

// הוסף ייצוא של פונקציית שם התקופה כדי שתהיה זמינה לכולם
window.getPeriodName = (date) => {
    if (!date) return "";
    const d = new Date(date);
    let year = d.getFullYear();
    const month = d.getMonth();

    if (month === 11) { // דצמבר נחשב כתקופה 1 של השנה הבאה
        year++;
        return `1/${year.toString().slice(-2)}`;
    }

    const yearShort = year.toString().slice(-2);
    const periodNum = month < 5 ? "1" : "2"; 
    return `${periodNum}/${yearShort}`;
};

// --- ייצוא לאקסל (CSV) ---
function getHebrewDay(dateStr) {
    const days = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];
    const d = new Date(dateStr);
    return days[d.getDay()];
}

export async function performExport() {
    const startDateVal = document.getElementById('export-start-date').value;
    const endDateVal = document.getElementById('export-end-date').value;

    if (!startDateVal || !endDateVal) {
        showToast("נא לבחור תאריכי התחלה וסיום", "yellow");
        return;
    }

    const start = new Date(startDateVal);
    const end = new Date(endDateVal);

    if (end < start) {
        showToast("תאריך סיום חייב להיות אחרי תאריך התחלה", "red");
        return;
    }

    let localPlanningData = planningState.dailyPlans;
    if (Object.keys(localPlanningData).length === 0) {
        if (window.firestoreFunctions && window.db) {
            try {
                const { doc, getDoc } = window.firestoreFunctions;
                const docRef = doc(window.db, "settings", "planning");
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    localPlanningData = snap.data().dailyPlans || {};
                }
            } catch (e) {
                console.error("Failed to fetch planning data for export", e);
            }
        }
    }

    const relevantFlights = savedFlights.filter(f => {
        let fDate = f.date;
        if (typeof fDate === 'string') fDate = new Date(fDate);
        return fDate >= start && fDate <= end;
    });

    if (relevantFlights.length === 0) {
        showToast("לא נמצאו גיחות בטווח התאריכים שנבחר.", "yellow");
        return;
    }

    const groupedData = {};

    relevantFlights.forEach(f => {
        let dateStr = f.date;
        if (f.date instanceof Date) dateStr = f.date.toISOString().split('T')[0];

        const sim = (f.data['סימולטור'] || 'אחר').toUpperCase().trim();
        const startTime = f.data['שעת התחלה'] || '00:00';
        const endTime = f.data['שעת סיום'] || '00:00';

        if (!groupedData[dateStr]) groupedData[dateStr] = {};
        if (!groupedData[dateStr][sim]) {
            groupedData[dateStr][sim] = {
                startTimes: [],
                endTimes: []
            };
        }

        groupedData[dateStr][sim].startTimes.push(startTime);
        groupedData[dateStr][sim].endTimes.push(endTime);
    });

    let simulatorStatuses = {};
    if (window.firestoreFunctions && window.db) {
        try {
            const { collection, getDocs, query, where } = window.firestoreFunctions;
            const q = query(collection(window.db, "simulator_status"),
                where("date", ">=", startDateVal),
                where("date", "<=", endDateVal));
            const snap = await getDocs(q);
            snap.forEach(doc => {
                const data = doc.data();
                simulatorStatuses[`${data.simName}_${data.date}`] = data.closeTime;
            });
        } catch (e) {
            console.error("Failed to load simulator statuses", e);
        }
    }

    let csvContent = "\uFEFF";
    csvContent += "תאריך,יום,מאמן,שעת מסירה,שעת סגירה,זמן הפעלה (שעות),עם תמיכה,מנהל יומי\n";

    const sortedDates = Object.keys(groupedData).sort();

    sortedDates.forEach(dateStr => {
        const simulators = Object.keys(groupedData[dateStr]).sort();
        const plan = localPlanningData[dateStr];
        let manager = plan?.manager || '';
        let support = plan?.support ? 'V' : '';
        const hebrewDay = getHebrewDay(dateStr);

        simulators.forEach(sim => {
            const times = groupedData[dateStr][sim];
            times.startTimes.sort();
            times.endTimes.sort();

            const firstStart = times.startTimes[0];
            const lastEnd = times.endTimes[times.endTimes.length - 1];

            // חישוב זמן הפעלה
            let operatingHours = '';
            const closeTime = simulatorStatuses[`${sim}_${dateStr}`];
            if (closeTime && firstStart) {
                // חישוב זמן הפעלה: שעה וחצי לפני שעת מסירה עד שעת סגירה
                const startObj = new Date(`2000-01-01T${firstStart}`);
                startObj.setMinutes(startObj.getMinutes() - 90); // שעה וחצי לפני
                const closeObj = new Date(`2000-01-01T${closeTime}`);

                let diffMs = closeObj - startObj;
                if (diffMs > 0) {
                    operatingHours = (diffMs / (1000 * 60 * 60)).toFixed(2);
                }
            }

            const cleanManager = manager.replace(/,/g, ' ');
            const [y, m, d] = dateStr.split('-');
            const formattedDate = `${d}/${m}/${y}`;

            csvContent += `${formattedDate},${hebrewDay},${sim},${firstStart},${lastEnd},${operatingHours},${support},${cleanManager}\n`;
        });
    });

    const encodedUri = encodeURI("data:text/csv;charset=utf-8," + csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `דוח_גיחות_${startDateVal}_${endDateVal}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    document.getElementById('export-report-modal').classList.add('hidden');
    showToast("הדוח נוצר בהצלחה!", "green");
}

window.openExportModal = () => {
    document.getElementById('export-report-modal').classList.remove('hidden');
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);

    document.getElementById('export-end-date').valueAsDate = now;
    document.getElementById('export-start-date').valueAsDate = firstDay;
};

export function renderSystemList() {
    const container = document.getElementById('systems-container');
    if (!container) return;
    container.innerHTML = '';

    const systems = Global.systemClassifications;

    if (Object.keys(systems).length === 0) {
        container.innerHTML = '<p class="text-gray-400 text-sm p-2">אין מערכות מוגדרות.</p>';
        return;
    }

    Object.keys(systems).sort().forEach(sysName => {
        const subItems = systems[sysName] || [];

        const div = document.createElement('div');
        div.className = "bg-white border rounded p-2";

        let subItemsHtml = subItems.map((sub, idx) => `
            <span class="inline-flex items-center bg-gray-100 text-xs px-2 py-1 rounded mr-2 mb-1">
                ${sub}
                <button onclick="window.removeSystemSubItem('${sysName}', ${idx})" class="mr-1 text-red-500 hover:text-red-700 font-bold">×</button>
            </span>
        `).join('');

        div.innerHTML = `
            <div class="flex justify-between items-center mb-2 border-b pb-1">
                <span class="font-bold text-purple-700">${sysName}</span>
                <button onclick="window.removeSystemCategory('${sysName}')" class="text-red-500 hover:text-red-700 text-xs">מחק קטגוריה</button>
            </div>
            <div class="flex flex-wrap mb-2">
                ${subItemsHtml}
            </div>
            <div class="flex gap-1">
                <input type="text" id="input-sub-${sysName}" placeholder="תת-מערכת..." class="border rounded px-1 text-xs py-1 flex-grow">
                <button onclick="window.addSystemSubItem('${sysName}')" class="bg-gray-200 text-gray-700 px-2 rounded text-xs hover:bg-gray-300">+</button>
            </div>
        `;
        container.appendChild(div);
    });
}

window.addSystemCategory = async () => {
    const input = document.getElementById('input-new-system');
    const name = input.value.trim();
    if (!name) return showToast("נא להזין שם מערכת", "yellow");

    if (Global.systemClassifications[name]) return showToast("המערכת כבר קיימת", "red");

    Global.systemClassifications[name] = [];
    input.value = '';

    await saveAdvancedConfig();
    renderSystemList();
};

window.removeSystemCategory = async (name) => {
    if (confirm(`למחוק את קטגוריית "${name}" וכל תתי המערכות שלה?`)) {
        delete Global.systemClassifications[name];
        await saveAdvancedConfig();
        renderSystemList();
    }
};

window.addSystemSubItem = async (sysName) => {
    const input = document.getElementById(`input-sub-${sysName}`);
    const val = input.value.trim();
    if (!val) return;

    if (!Global.systemClassifications[sysName].includes(val)) {
        Global.systemClassifications[sysName].push(val);
        Global.systemClassifications[sysName].sort();
        await saveAdvancedConfig();
        renderSystemList();
    } else {
        showToast("קיים כבר", "yellow");
    }
};

window.removeSystemSubItem = async (sysName, index) => {
    Global.systemClassifications[sysName].splice(index, 1);
    await saveAdvancedConfig();
    renderSystemList();
};

// --- ניהול יעדים אוטומטיים (מעודכן: שדות דינמיים) ---

function populateGoalConfigDropdowns() {
    const typeSelect = document.getElementById('goal-config-type');
    const nameSelect = document.getElementById('goal-config-name');

    if (typeSelect && personnelLists.flightTypes) {
        typeSelect.innerHTML = '<option value="">בחר סוג...</option>' +
            personnelLists.flightTypes.map(t => `<option value="${t}">${t}</option>`).join('');
    }

    if (nameSelect && personnelLists.flightNames) {
        nameSelect.innerHTML = '<option value="">בחר שם...</option>' +
            personnelLists.flightNames.map(n => `<option value="${n}">${n}</option>`).join('');
    }
}

// פונקציות ליעדים דינמיים: הוספה
window.addGoalInput = (value = '') => {
    const container = document.getElementById('goals-container');
    if (!container) return;

    const div = document.createElement('div');
    div.className = "flex gap-2 items-center mb-2";

    div.innerHTML = `
        <span class="text-gray-500 font-bold text-sm w-4 text-center select-none counter"></span>
        <input type="text" class="goal-input flex-grow border-gray-300 rounded-md shadow-sm text-sm p-2 border" 
               placeholder="תיאור היעד..." value="${value}">
        <button onclick="this.parentElement.remove(); window.updateGoalCounters();" 
                class="text-red-500 hover:text-red-700 px-1" title="הסר יעד">
            ×
        </button>
    `;

    container.appendChild(div);
    window.updateGoalCounters();
};

// עדכון המספור
window.updateGoalCounters = () => {
    const counters = document.querySelectorAll('#goals-container .counter');
    counters.forEach((span, index) => {
        span.textContent = index + 1 + ".";
    });
};

// שמירת ההגדרה (קוראת מהשדות הדינמיים)
window.saveGoalConfig = async () => {
    const type = document.getElementById('goal-config-type').value;
    const name = document.getElementById('goal-config-name').value;

    if (!type || !name) return showToast("יש לבחור סוג גיחה ושם גיחה", "yellow");

    // איסוף היעדים מה-DOM
    const inputs = document.querySelectorAll('#goals-container .goal-input');
    const fullGoals = Array.from(inputs)
        .map(input => input.value.trim())
        .filter(val => val !== "");

    if (fullGoals.length === 0) return showToast("יש להזין לפחות יעד אחד", "yellow");

    const existingIndex = Global.goalConfigurations.findIndex(c => c.type === type && c.name === name);

    const newConfig = { type, name, goals: fullGoals };

    if (existingIndex >= 0) {
        if (!confirm("קיימת כבר הגדרה לגיחה זו. האם לעדכן?")) return;
        Global.goalConfigurations[existingIndex] = newConfig;
    } else {
        Global.goalConfigurations.push(newConfig);
    }

    // איפוס הטופס
    document.getElementById('goal-config-name').value = ""; // משאיר את הסוג לשימוש חוזר? או שמאפס הכל
    document.getElementById('goals-container').innerHTML = "";
    window.addGoalInput(); // מוסיף שורה ריקה

    await saveAdvancedConfig();
    renderGoalsConfigTable();
    showToast("הגדרה נשמרה!", "green");
};

function renderGoalsConfigTable() {
    const tbody = document.getElementById('goals-config-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    Global.goalConfigurations.forEach((config, index) => {
        const goalsText = config.goals.filter(g => g).map((g, i) => `${i + 1}. ${g}`).join('<br>');

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="px-6 py-4 text-sm text-gray-900">${config.type}</td>
            <td class="px-6 py-4 text-sm text-gray-900">${config.name}</td>
            <td class="px-6 py-4 text-sm text-gray-500">${goalsText}</td>
            <td class="px-6 py-4 text-sm whitespace-nowrap">
                <button onclick="window.editGoalConfig(${index})" class="text-blue-600 hover:text-blue-900 ml-2">ערוך</button>
                <button onclick="window.deleteGoalConfig(${index})" class="text-red-600 hover:text-red-900">מחק</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// עריכת יעד (מילוי השדות הדינמיים)
window.editGoalConfig = (index) => {
    const config = Global.goalConfigurations[index];
    if (!config) return;

    const typeSelect = document.getElementById('goal-config-type');
    const nameSelect = document.getElementById('goal-config-name');
    const container = document.getElementById('goals-container');

    if (typeSelect) typeSelect.value = config.type;
    if (nameSelect) nameSelect.value = config.name;

    if (container) {
        container.innerHTML = '';
        if (config.goals && config.goals.length > 0) {
            config.goals.forEach(goal => window.addGoalInput(goal));
        } else {
            window.addGoalInput();
        }
    }

    if (typeSelect) typeSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('הנתונים נטענו לטופס. בצע שינויים ולחץ על "שמור הגדרה".', 'blue');
};

window.deleteGoalConfig = async (index) => {
    if (confirm("למחוק הגדרה זו?")) {
        Global.goalConfigurations.splice(index, 1);
        await saveAdvancedConfig();
        renderGoalsConfigTable();
    }
};

async function saveAdvancedConfig() {
    if (!window.firestoreFunctions || !window.db) return;
    const { doc, setDoc } = window.firestoreFunctions;

    try {
        await setDoc(doc(window.db, "settings", "advanced_config"), {
            goalConfigurations: Global.goalConfigurations,
            systemClassifications: Global.systemClassifications
        });
    } catch (e) {
        console.error("Save advanced config failed", e);
        showToast("שגיאה בשמירה", "red");
    }
}

// משתנים למודאל
let currentModalType = '';
let currentModalLabel = '';

window.openAdvancedPersonnel = (type, label) => {
    currentModalType = type;
    currentModalLabel = label;
    document.getElementById('personnel-modal-title').textContent = `ניהול רשימת ${label}`;
    document.getElementById('personnel-search-input').value = '';
    document.getElementById('personnel-new-name').value = '';
    document.getElementById('personnel-manage-modal').classList.remove('hidden');
    window.filterPersonnelModal();
};

window.filterPersonnelModal = () => {
    const searchTerm = document.getElementById('personnel-search-input').value.toLowerCase();
    const container = document.getElementById('personnel-modal-list-container');
    const items = personnelLists[currentModalType] || [];

    container.innerHTML = '';

    const filteredItems = items.filter(name => name.toLowerCase().includes(searchTerm));

    if (filteredItems.length === 0) {
        container.innerHTML = '<div class="text-center py-4 text-gray-500">לא נמצאו תוצאות</div>';
        return;
    }

    filteredItems.forEach(name => {
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-white p-3 mb-2 rounded shadow-sm border border-gray-100";
        div.innerHTML = `
            <span class="font-bold text-gray-800">${name}</span>
            <div class="flex gap-2">
                <button onclick="window.initMergePersonnel('${name}')" class="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200">מיזוג עם שם אחר</button>
                <button onclick="window.removePerson('${currentModalType}', personnelLists['${currentModalType}'].indexOf('${name}')); window.filterPersonnelModal();" 
                        class="text-red-500 hover:text-red-700">🗑️</button>
            </div>
        `;
        container.appendChild(div);
    });
};

window.addFromPersonnelModal = async () => {
    const input = document.getElementById('personnel-new-name');
    const name = input.value.trim();
    if (!name) return;

    if (!personnelLists[currentModalType].includes(name)) {
        personnelLists[currentModalType].push(name);
        personnelLists[currentModalType].sort();
        input.value = '';
        await savePersonnelLists(true);
        window.filterPersonnelModal();
        renderList(currentModalType); // עדכון הרשימה המקורית מאחורה
    } else {
        showToast("השם כבר קיים ברשימה", "yellow");
    }
};

window.initMergePersonnel = async (oldName) => {
    const newName = prompt(`לאיזה שם ברשימה תרצה למזג את "${oldName}"?\nכל הגיחות של ${oldName} יעברו לשם החדש, ו-${oldName} יימחק מהרשימה.`);

    if (!newName || newName === oldName) return;

    if (!personnelLists[currentModalType].includes(newName)) {
        showToast("שם היעד אינו קיים ברשימה. הוסף אותו קודם.", "red");
        return;
    }

    if (!confirm(`האם אתה בטוח? פעולה זו תעדכן את כל הגיחות במסד הנתונים. אי אפשר לבטל!`)) return;

    showToast("מבצע מיזוג... נא להמתין", "blue");

    try {
        const { doc, updateDoc } = window.firestoreFunctions;
        let count = 0;

        // מיפוי שדות לפי סוג הרשימה
        const fieldMap = {
            'instructorsFemale': ['מדריכה', 'instructor-name-1'],
            // 'instructorsMale': ['מדריך', 'instructor-main'],
            'pilots': ['טייס ימין', 'טייס שמאל', 'pilot-right', 'pilot-left'],
            'observers': ['מתצפת', 'observer']
        };

        const fieldsToUpdate = fieldMap[currentModalType] || [];

        // עדכון כל הגיחות בזיכרון וב-DB
        for (let flight of window.savedFlights) {
            let changed = false;
            fieldsToUpdate.forEach(field => {
                if (flight.data[field] === oldName) {
                    flight.data[field] = newName;
                    changed = true;
                }
            });

            if (changed) {
                await updateDoc(doc(window.db, "flights", flight.id), { data: flight.data });
                count++;
            }
        }

        // מחיקת השם הישן מהרשימה
        personnelLists[currentModalType] = personnelLists[currentModalType].filter(n => n !== oldName);
        await savePersonnelLists(true);

        showToast(`מיזוג הושלם! ${count} גיחות עודכנו.`, "green");
        window.filterPersonnelModal();
        renderList(currentModalType);
    } catch (error) {
        console.error("Merge error:", error);
        showToast("שגיאה בתהליך המיזוג", "red");
    }
};

// רינדור המסך
function getAllAssignedPilots() {
    let assigned = [];
    pilotPopulations.instructorGroups.forEach(g => assigned.push(...g.members));
    pilotPopulations.courses.forEach(c => assigned.push(...c.students));
    pilotPopulations.conversionGroups.forEach(g => assigned.push(...g.members)); // הוספת שורה זו
    return assigned;
}

export function renderPopulations() {
    const instructorContainer = document.getElementById('instructor-groups-container');
    const coursesContainer = document.getElementById('courses-container');

    if (!instructorContainer || !coursesContainer) return;

    // שמירת ה-ID של האלמנט שבפוקוס כרגע כדי למנוע איבוד פוקוס בזמן הקלדה
    const activeElementId = document.activeElement ? document.activeElement.id : null;

    const allPilots = personnelLists.pilots || [];
    const assignedPilots = getAllAssignedPilots();

    // 1. רינדור קבוצות מדריכים
    instructorContainer.innerHTML = pilotPopulations.instructorGroups.map((group, gIdx) => {
        const searchId = `search-instr-group-${gIdx}`;
        const searchVal = document.getElementById(searchId)?.value.toLowerCase() || "";
        const availableForGroup = allPilots.filter(p => !assignedPilots.includes(p) && p.toLowerCase().includes(searchVal));

        return `
        <div class="bg-white p-3 rounded shadow border-r-4 border-blue-400 mb-3">
            <div class="flex justify-between items-center mb-2">
                <input type="text" value="${group.name}" onchange="window.updateGroupName('instructor', ${gIdx}, this.value)" 
                       class="font-bold text-sm border-none p-0 focus:ring-0 w-2/3 text-blue-800">
                <button onclick="window.removeGroup('instructor', ${gIdx})" class="text-red-500 text-xs">מחק</button>
            </div>
            <div class="mb-2">
               <input type="text" id="${searchId}" oninput="window.renderPopulations()" 
                value="${searchVal}" placeholder="חפש להוספה..." class="w-full border rounded p-1 text-xs pr-6">
                ${searchVal ? `<button onclick="document.getElementById('${searchId}').value=''; window.renderPopulations()" 
                class="absolute left-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">×</button>` : ''}
                <div class="border rounded p-1 h-24 overflow-y-auto mb-1 bg-gray-50 custom-scrollbar">
                    ${availableForGroup.map(p => `
                        <label class="flex items-center space-x-2 space-x-reverse text-xs hover:bg-blue-50 p-1 cursor-pointer">
                            <input type="checkbox" class="instr-group-cb-${gIdx}" value="${p}">
                            <span>${p}</span>
                        </label>
                    `).join('') || '<div class="text-gray-400 text-[10px]">אין טייסים זמינים</div>'}
                </div>
                <button onclick="window.addSelectedToGroup('instructor', ${gIdx})" class="w-full bg-blue-500 text-white py-1 rounded text-xs">הוסף נבחרים</button>
            </div>
            <ul class="space-y-1 mt-2">
                ${group.members.map((m, mIdx) => `
                    <li class="flex justify-between items-center text-xs bg-blue-50 p-1 rounded">
                        <span>${m}</span>
                        <button onclick="window.removeFromGroup('instructor', ${gIdx}, ${mIdx})" class="text-red-400">×</button>
                    </li>
                `).join('')}
            </ul>
        </div>`;
    }).join('');

    // 2. רינדור קורסים
    coursesContainer.innerHTML = pilotPopulations.courses.map((course, cIdx) => {
        const searchId = `search-course-${cIdx}`;
        const searchVal = document.getElementById(searchId)?.value.toLowerCase() || "";
        const availableForCourse = allPilots.filter(p => !assignedPilots.includes(p) && p.toLowerCase().includes(searchVal));

        return `
        <div class="bg-white p-3 rounded shadow border-r-4 border-orange-400 mb-3">
            <div class="flex justify-between items-center mb-2">
                <input type="text" value="${course.name}" onchange="window.updateGroupName('course', ${cIdx}, this.value)" 
                       class="font-bold text-sm border-none p-0 focus:ring-0 w-2/3 text-orange-800">
                <button onclick="window.removeGroup('course', ${cIdx})" class="text-red-500 text-xs">מחק</button>
            </div>
            <div class="mb-2">
                <input type="text" id="${searchId}" oninput="window.renderPopulations()" 
                       ${searchVal ? `<button onclick="document.getElementById('${searchId}').value=''; window.renderPopulations()" 
           class="absolute left-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">×</button>` : ''}
                <div class="border rounded p-1 h-24 overflow-y-auto mb-1 bg-gray-50 custom-scrollbar">
                    ${availableForCourse.map(p => `
                        <label class="flex items-center space-x-2 space-x-reverse text-xs hover:bg-orange-50 p-1 cursor-pointer">
                            <input type="checkbox" class="course-cb-${cIdx}" value="${p}">
                            <span>${p}</span>
                        </label>
                    `).join('') || '<div class="text-gray-400 text-[10px]">אין טייסים זמינים</div>'}
                </div>
                <button onclick="window.addSelectedToGroup('course', ${cIdx})" class="w-full bg-orange-500 text-white py-1 rounded text-xs">הוסף נבחרים</button>
            </div>
            <ul class="space-y-1 mt-2">
                ${course.students.map((s, sIdx) => `
                    <li class="flex justify-between items-center text-xs bg-orange-50 p-1 rounded">
                        <span>${s}</span>
                        <button onclick="window.removeFromGroup('course', ${cIdx}, ${sIdx})" class="text-red-400">×</button>
                    </li>
                `).join('')}
            </ul>
        </div>`;
    }).join('');

    const conversionContainer = document.getElementById('conversion-groups-container');
    if (conversionContainer) {
        const allPilots = personnelLists.pilots || [];
        const assignedPilots = getAllAssignedPilots();

        conversionContainer.innerHTML = pilotPopulations.conversionGroups.map((group, gIdx) => {
            const searchId = `search-conv-group-${gIdx}`;
            const searchVal = document.getElementById(searchId)?.value.toLowerCase() || "";
            const availableForGroup = allPilots.filter(p => !assignedPilots.includes(p) && p.toLowerCase().includes(searchVal));

            return `
            <div class="bg-white p-3 rounded shadow border-r-4 border-purple-400 mb-3">
                <div class="flex justify-between items-center mb-2">
                    <input type="text" value="${group.name}" onchange="window.updateConversionGroupName(${gIdx}, this.value)" 
                           class="font-bold text-sm border-none p-0 focus:ring-0 w-2/3 text-purple-800">
                    <button onclick="window.removeConversionGroup(${gIdx})" class="text-red-500 text-xs">מחק</button>
                </div>
                <div class="mb-2">
                    <input type="text" id="${searchId}" oninput="window.renderPopulations()" 
                           value="${searchVal}" placeholder="חפש להוספה..." class="w-full border rounded p-1 text-xs">
                    <div class="border rounded p-1 h-24 overflow-y-auto mb-1 bg-gray-50 custom-scrollbar">
                        ${availableForGroup.map(p => `
                            <label class="flex items-center space-x-2 space-x-reverse text-xs hover:bg-purple-50 p-1 cursor-pointer">
                                <input type="checkbox" class="conv-group-cb-${gIdx}" value="${p}">
                                <span>${p}</span>
                            </label>
                        `).join('') || '<div class="text-gray-400 text-[10px]">אין טייסים זמינים</div>'}
                    </div>
                    <button onclick="window.addSelectedToGroup('conversion', ${gIdx})" class="w-full bg-purple-500 text-white py-1 rounded text-xs">הוסף נבחרים</button>
                </div>
                <ul class="space-y-1 mt-2">
                    ${group.members.map((m, mIdx) => `
                        <li class="flex justify-between items-center text-xs bg-purple-50 p-1 rounded">
                            <span>${m}</span>
                            <button onclick="window.removeFromGroup('conversion', ${gIdx}, ${mIdx})" class="text-red-400">×</button>
                        </li>
                    `).join('')}
                </ul>
            </div>`;
        }).join('');
    }

    // החזרת הפוקוס לאלמנט הנכון לאחר הרינדור מחדש
    if (activeElementId) {
        const el = document.getElementById(activeElementId);
        if (el) {
            el.focus();
            // הזזת הסמן לסוף הטקסט במידה וזה input
            if (el.setSelectionRange) {
                const len = el.value.length;
                el.setSelectionRange(len, len);
            }
        }
    }

    // קריאה למיפוי הגיחות (חלק מהטאב)
    window.renderFlightMappingUI();
}

// פונקציות ניהול (הוספה/הסרה/עדכון)
window.addNewInstructorGroup = () => {
    const name = prompt("אוכלוסיית מדריכים חדשה");
    if (name) {
        pilotPopulations.instructorGroups.push({ name, members: [] });
        renderPopulations();
        window.savePopulations(true);
    }
};

window.addSelectedToGroup = (type, idx) => {
    let selector, targetArray;

    if (type === 'instructor') {
        selector = `.instr-group-cb-${idx}`;
        targetArray = pilotPopulations.instructorGroups[idx].members;
    } else if (type === 'course') {
        selector = `.course-cb-${idx}`;
        targetArray = pilotPopulations.courses[idx].students;
    }
    // --- הוספה נדרשת ---
    else if (type === 'conversion') {
        selector = `.conv-group-cb-${idx}`;
        // וודאי שהמערך conversionGroups קיים
        if (!pilotPopulations.conversionGroups[idx]) return;
        targetArray = pilotPopulations.conversionGroups[idx].members;
    }
    // --------------------

    if (!targetArray) return;

    const checkboxes = document.querySelectorAll(`${selector}:checked`);
    let changes = false;
    checkboxes.forEach(cb => {
        if (!targetArray.includes(cb.value)) {
            targetArray.push(cb.value);
            changes = true;
        }
    });

    if (changes) {
        renderPopulations();
        window.savePopulations(true);
    }
};

window.removeFromGroup = (type, groupIdx, memberIdx) => {
    if (type === 'instructor') pilotPopulations.instructorGroups[groupIdx].members.splice(memberIdx, 1);
    else if (type === 'course') pilotPopulations.courses[groupIdx].students.splice(memberIdx, 1);
    else if (type === 'conversion') pilotPopulations.conversionGroups[groupIdx].members.splice(memberIdx, 1);

    renderPopulations();
    window.savePopulations(true);
};

window.updateGroupName = (type, idx, newName) => {
    if (!newName) return;
    if (type === 'instructor') pilotPopulations.instructorGroups[idx].name = newName;
    else pilotPopulations.courses[idx].name = newName;
    window.savePopulations(true);
};

window.removeGroup = (type, idx) => {
    if (confirm("מחיקת הקבוצה תחזיר את כל חבריה למאגר הלא-מסווגים. להמשיך?")) {
        if (type === 'instructor') pilotPopulations.instructorGroups.splice(idx, 1);
        else pilotPopulations.courses.splice(idx, 1);
        renderPopulations();
        window.savePopulations(true);
    }
};

// פונקציית הוספה מרובה
window.addSelectedToPopulation = (type, cIdx) => {
    if (type === 'instructors') {
        const checkboxes = document.querySelectorAll('.instr-checkbox:checked');
        checkboxes.forEach(cb => {
            if (!pilotPopulations.instructors.includes(cb.value)) {
                pilotPopulations.instructors.push(cb.value);
            }
        });
        document.getElementById('search-pilots-for-instructors').value = "";
    } else if (type === 'course') {
        const checkboxes = document.querySelectorAll(`.course-checkbox-${cIdx}:checked`);
        checkboxes.forEach(cb => {
            if (!pilotPopulations.courses[cIdx].students.includes(cb.value)) {
                pilotPopulations.courses[cIdx].students.push(cb.value);
            }
        });
    }
    renderPopulations();
    window.savePopulations(true); // שמירה אוטומטית שקטה
};

// פונקציות הוספה
window.addInstructorToPopulation = () => {
    const sel = document.getElementById('select-add-instructor');
    if (sel.value) {
        pilotPopulations.instructors.push(sel.value);
        renderPopulations();
    }
};

window.addStudentToCourse = (cIdx) => {
    const sel = document.getElementById(`select-add-student-${cIdx}`);
    if (sel.value) {
        pilotPopulations.courses[cIdx].students.push(sel.value);
        renderPopulations();
    }
};

// פונקציית הסרה גנרית
window.removeFromPopulation = (type, idx1, idx2) => {
    if (type === 'instructors') {
        pilotPopulations.instructors.splice(idx1, 1);
    } else if (type === 'student') {
        pilotPopulations.courses[idx1].students.splice(idx2, 1);
    }
    renderPopulations();
    window.savePopulations(true); // שמירה אוטומטית שקטה
};

window.addNewCourse = () => {
    const name = prompt("שם הקורס (למשל: קאמ מנ\"ט):");
    if (name) {
        pilotPopulations.courses.push({ name, students: [] });
        renderPopulations();
        window.savePopulations(true);
    }
};

window.updateCourseName = (idx, newName) => {
    if (newName && newName.trim()) {
        pilotPopulations.courses[idx].name = newName.trim();
        window.savePopulations(true);
    }
};

window.removeCourse = (idx) => {
    if (confirm("האם למחוק את הקורס?")) {
        pilotPopulations.courses.splice(idx, 1);
        renderPopulations();
        window.savePopulations(true);
    }
};

window.savePopulations = async (silent = false) => {
    if (!window.firestoreFunctions || !window.db) return;
    const { doc, setDoc } = window.firestoreFunctions;
    try {
        await setDoc(doc(window.db, "settings", "populations"), pilotPopulations);
        if (!silent) {
            showToast("הגדרות אוכלוסייה נשמרו!", "green");
        }
    } catch (e) {
        console.error("שגיאה בשמירה אוטומטית:", e);
        if (!silent) showToast("שגיאה בשמירה", "red");
    }
};

window.saveFlightMapping = async () => {
    const studentFlights = Array.from(document.getElementById('flight-mapping-students').selectedOptions).map(o => o.value);
    const instructorFlights = Array.from(document.getElementById('flight-mapping-instructors').selectedOptions).map(o => o.value);

    pilotPopulations.flightMapping = { students: studentFlights, instructors: instructorFlights };
    await window.savePopulations();
    showToast("מיפוי גיחות נשמר", "green");
};

// עדכון renderPopulations כדי למלא את הסלקטים של שמות הגיחות
// (הוסף זאת בתוך פונקציית renderPopulations הקיימת)
const studentSelect = document.getElementById('flight-mapping-students');
const instrSelect = document.getElementById('flight-mapping-instructors');
if (studentSelect && instrSelect) {
    const names = personnelLists.flightNames || [];
    const optionsHtml = names.map(n => `<option value="${n}" ${pilotPopulations.flightMapping?.students?.includes(n) ? 'selected' : ''}>${n}</option>`).join('');
    studentSelect.innerHTML = optionsHtml;
    instrSelect.innerHTML = optionsHtml;
}

// פונקציה לרינדור הרשימה עם חיפוש (דומה למנגנון האוכלוסיות)
window.renderFlightMappingList = () => {
    const container = document.getElementById('flight-mapping-options');
    const searchVal = document.getElementById('flight-mapping-search').value.toLowerCase();
    const allNames = personnelLists.flightNames || []; // רשימת הגיחות הכללית

    // הצגת המיכל רק אם המשתמש התחיל להקליד
    if (searchVal.length > 0) {
        container.classList.remove('hidden');
    } else {
        container.classList.add('hidden');
    }

    container.innerHTML = allNames
        .filter(name => name.toLowerCase().includes(searchVal))
        .map(name => `
            <label class="flex items-center space-x-2 space-x-reverse text-sm hover:bg-purple-50 p-1 cursor-pointer">
                <input type="checkbox" value="${name}" onchange="window.toggleFlightToCategory('${name}')">
                <span>${name}</span>
            </label>
        `).join('') || '<div class="text-gray-400 text-xs text-center">לא נמצאו תוצאות</div>';
};

window.filterFlightMappingList = () => {
    window.renderFlightMappingList();
};

// פונקציית עזר לחיפוש וסינון גיחות - מבטיחה שגיחה שנבחרה תיעלם מהרשימה
window.renderFlightMappingUI = () => {
    const categories = ['students', 'instructors', 'conversion'];
    const allFlightNames = personnelLists.flightNames || [];
    const mapping = pilotPopulations.flightMapping || { students: [], instructors: [] };
    const allMapped = [...(mapping.students || []), ...(mapping.instructors || [])];

    categories.forEach(cat => {
        const searchInput = document.getElementById(`search-flight-mapping-${cat}`);
        const searchVal = searchInput ? searchInput.value.toLowerCase() : "";
        const optionsContainer = document.getElementById(`options-flight-mapping-${cat}`);
        const selectedList = document.getElementById(`selected-flights-${cat}`);

        if (!optionsContainer || !selectedList) return;

        // סינון: רק גיחות שלא סווגו ומתאימות לחיפוש
        const available = allFlightNames.filter(name =>
            !allMapped.includes(name) && name.toLowerCase().includes(searchVal)
        );

        optionsContainer.innerHTML = available.map(name => `
            <label class="flex items-center space-x-2 space-x-reverse text-xs hover:bg-gray-100 p-1 cursor-pointer">
                <input type="checkbox" class="mapping-cb-${cat}" value="${name}">
                <span>${name}</span>
            </label>
        `).join('') || '<div class="text-gray-400 text-[10px] text-center p-2">אין גיחות זמינות</div>';

        const currentSelected = mapping[cat] || [];
        selectedList.innerHTML = currentSelected.map((name, idx) => `
            <li class="flex justify-between items-center text-xs bg-purple-50 p-2 rounded border mb-1">
                <span>${name}</span>
                <button onclick="window.removeFlightFromMapping('${cat}', ${idx})" class="text-red-500 font-bold px-2">×</button>
            </li>
        `).join('');
    });
};

window.addFlightsToMapping = async (cat) => {
    const checkboxes = document.querySelectorAll(`.mapping-cb-${cat}:checked`);

    // הגנה מקסימלית: יצירת האובייקטים אם הם אינם קיימים
    if (!pilotPopulations.flightMapping) {
        pilotPopulations.flightMapping = { students: [], instructors: [], conversion: [] };
    }

    // אם הקטגוריה הספציפית (למשל conversion) לא קיימת - צור אותה כעת
    if (!Array.isArray(pilotPopulations.flightMapping[cat])) {
        pilotPopulations.flightMapping[cat] = [];
    }

    let changesMade = false;
    checkboxes.forEach(cb => {
        if (!pilotPopulations.flightMapping[cat].includes(cb.value)) {
            pilotPopulations.flightMapping[cat].push(cb.value);
            changesMade = true;
        }
    });

    if (changesMade) {
        // ניקוי שדה החיפוש
        const searchInput = document.getElementById(`search-flight-mapping-${cat}`);
        if (searchInput) searchInput.value = "";

        window.renderFlightMappingUI();
        await window.savePopulations(true); // שמירה
    }
};

window.removeFlightFromMapping = async (cat, idx) => {
    pilotPopulations.flightMapping[cat].splice(idx, 1);
    window.renderFlightMappingUI();
    await window.savePopulations(true);
};

// וודא שפונקציה זו קיימת ב-adminManager.js לטיפול בחיפוש אנשים
window.filterPopulationList = (type) => {
    // קריאה לפונקציית הרינדור הקיימת של האוכלוסיות (למשל renderStudentOptions)
    if (type === 'student') window.renderStudentOptions();
    if (type === 'instructor') window.renderInstructorOptions();
};

// פונקציית עזר לקבלת כל הגיחות שכבר סווגו (חניכים + מדריכים)
function getAllMappedFlightNames() {
    const mapping = pilotPopulations.flightMapping || { students: [], instructors: [], conversion: [] };
    const students = mapping.students || [];
    const instructors = mapping.instructors || [];
    const conversion = mapping.conversion || [];
    return [...students, ...instructors, ...conversion];
}

window.addFlightsToMapping = async (cat) => {
    const checkboxes = document.querySelectorAll(`.mapping-cb-${cat}:checked`);
    if (!pilotPopulations.flightMapping) {
        pilotPopulations.flightMapping = { students: [], instructors: [], conversion: [] };
    }

    checkboxes.forEach(cb => {
        if (!pilotPopulations.flightMapping[cat].includes(cb.value)) {
            pilotPopulations.flightMapping[cat].push(cb.value);
        }
    });

    // ניקוי שדה החיפוש
    const searchInput = document.getElementById(`search-flight-mapping-${cat}`);
    if (searchInput) searchInput.value = "";

    window.renderFlightMappingUI();

    // שמירה לבסיס הנתונים - קריטי לריפרש
    if (typeof window.savePopulations === 'function') {
        await window.savePopulations();
    }
};

window.removeFlightFromMapping = async (cat, idx) => {
    if (pilotPopulations.flightMapping && pilotPopulations.flightMapping[cat]) {
        pilotPopulations.flightMapping[cat].splice(idx, 1);
        window.renderFlightMappingUI();

        // שמירה לאחר מחיקה
        if (typeof window.savePopulations === 'function') {
            await window.savePopulations();
        }
    }
};

window.renderAllLists = function () {
    Object.keys(personnelLists).forEach(type => window.renderList(type));
};

window.renderList = function (type) {
    const listContainer = document.getElementById(`list-${type}`);
    const searchInput = document.getElementById(`search-input-${type}`); // שים לב ל-ID הזה ב-HTML
    if (!listContainer) return;

    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
    const items = personnelLists[type] || [];
    const filtered = items.filter(item => item.toLowerCase().includes(searchTerm));

    listContainer.innerHTML = '';
    filtered.forEach((item) => {
        const li = document.createElement('li');
        li.className = "flex justify-between items-center bg-gray-50 p-2 rounded hover:bg-gray-100 border border-gray-200";
        li.innerHTML = `
            <span class="font-medium text-gray-800 truncate flex-grow ml-2">${item}</span>
            <div class="flex gap-1 shrink-0">
                <button onclick="window.editPerson('${type}', personnelLists['${type}'].indexOf('${item}'))" class="text-blue-500 p-1">✏️</button>
                <button onclick="window.removePerson('${type}', personnelLists['${type}'].indexOf('${item}'))" class="text-red-500 p-1">🗑️</button>
            </div>`;
        listContainer.appendChild(li);
    });
};

window.openMergeModal = (type) => {
    const labelMap = {
        instructorsMale: 'מדריכים',
        instructorsFemale: 'מדריכות',
        pilots: 'טייסים',
        observers: 'מתצפתים',
        simulators: 'סימולטורים',
        flightTypes: 'סוגי גיחה',
        flightNames: 'שמות גיחות'
    };
    window.openAdvancedPersonnel(type, labelMap[type] || type);
};

window.switchAdvancedTab = (tab) => {
    document.querySelectorAll('.advanced-tab-section').forEach(s => s.classList.add('hidden'));
    document.getElementById(`sub-tab-${tab.split('-')[0]}`).classList.remove('hidden');

    // עדכון עיצוב כפתורים
    document.getElementById('btn-sub-goals').className = tab === 'goals-sub' ? 'py-2 px-4 border-b-2 border-ofer-orange text-ofer-orange font-bold' : 'py-2 px-4 border-b-2 border-transparent text-gray-500';
    document.getElementById('btn-sub-metrics').className = tab === 'metrics-sub' ? 'py-2 px-4 border-b-2 border-ofer-orange text-ofer-orange font-bold' : 'py-2 px-4 border-b-2 border-transparent text-gray-500';

    if (tab === 'metrics-sub') {
        populateMetricDropdowns();
    }
};

function populateMetricDropdowns() {
    const typeSelect = document.getElementById('metric-config-type');
    const nameSelect = document.getElementById('metric-config-name');
    const types = personnelLists.flightTypes || [];
    const names = personnelLists.flightNames || [];

    typeSelect.innerHTML = '<option value="">בחר סוג...</option>' + types.map(t => `<option value="${t}">${t}</option>`).join('');
    nameSelect.innerHTML = '<option value="">בחר שם...</option>' + names.map(n => `<option value="${n}">${n}</option>`).join('');
}

window.addNewMetricGroup = (metricName = '', subItems = []) => {
    const container = document.getElementById('metrics-editor-container');
    const div = document.createElement('div');
    div.className = "metric-group border p-4 rounded bg-gray-50 relative";

    div.innerHTML = `
        <button onclick="this.parentElement.remove()" class="absolute left-2 top-2 text-red-500">×</button>
        <input type="text" class="metric-main-name font-bold w-full mb-2 p-1 border" placeholder="שם המדד (למשל: תפעול חירום)" value="${metricName}">
        <div class="sub-items-container space-y-2 mr-4 border-r-2 pr-2">
            ${subItems.map(item => `
                <div class="flex gap-2">
                    <input type="text" class="metric-sub-item w-full text-sm p-1 border" value="${item}">
                    <button onclick="this.parentElement.remove()" class="text-gray-400">×</button>
                </div>
            `).join('')}
        </div>
        <button onclick="window.addMetricSubItem(this)" class="text-xs text-blue-600 mt-2">+ הוסף תת-קטגוריה</button>
    `;
    container.appendChild(div);
};

window.addMetricSubItem = (btn) => {
    const container = btn.previousElementSibling;
    const div = document.createElement('div');
    div.className = "flex gap-2";
    div.innerHTML = `<input type="text" class="metric-sub-item w-full text-sm p-1 border" placeholder="תת קטגוריה..."><button onclick="this.parentElement.remove()" class="text-gray-400">×</button>`;
    container.appendChild(div);
};

window.saveMetricConfig = async () => {
    const type = document.getElementById('metric-config-type').value;
    const name = document.getElementById('metric-config-name').value;

    if (!type || !name) {
        return showToast("יש לבחור סוג גיחה ושם גיחה", "yellow");
    }

    // איסוף המדדים מה-DOM
    const metricGroups = [];
    const groupElements = document.querySelectorAll('.metric-group');

    groupElements.forEach(groupEl => {
        const mainNameInput = groupEl.querySelector('.metric-main-name');
        const mainName = mainNameInput ? mainNameInput.value.trim() : '';

        if (mainName) {
            const subItemInputs = groupEl.querySelectorAll('.metric-sub-item');
            const subs = Array.from(subItemInputs)
                .map(input => input.value.trim())
                .filter(val => val !== ""); // סינון שדות ריקים

            metricGroups.push({
                mainName: mainName,
                subs: subs
            });
        }
    });

    if (metricGroups.length === 0) {
        return showToast("יש להזין לפחות מדד אחד עם תתי-קטגוריות", "yellow");
    }

    // עדכון המערך הגלובלי (או יצירת אובייקט הגדרות חדש)
    if (!window.metricConfigurations) window.metricConfigurations = [];

    const existingIndex = window.metricConfigurations.findIndex(c => c.type === type && c.name === name);
    const newConfig = { type, name, metrics: metricGroups };

    if (existingIndex >= 0) {
        if (!confirm("קיימת כבר הגדרת מדדים לגיחה זו. האם לעדכן?")) return;
        window.metricConfigurations[existingIndex] = newConfig;
    } else {
        window.metricConfigurations.push(newConfig);
    }

    // שמירה לבסיס הנתונים (Firestore)
    if (!window.firestoreFunctions || !window.db) return;
    const { doc, setDoc } = window.firestoreFunctions;

    try {
        // אנחנו שומרים את זה בתוך אובייקט ה-advanced_config הקיים כדי לא לדרוס הגדרות אחרות (כמו יעדים)
        await setDoc(doc(window.db, "settings", "advanced_config"), {
            goalConfigurations: window.goalConfigurations || [],
            systemClassifications: window.systemClassifications || {},
            metricConfigurations: window.metricConfigurations // השדה החדש
        });

        showToast("הגדרות המדדים נשמרו בהצלחה!", "green");

        // ניקוי הטופס לאחר שמירה
        document.getElementById('metrics-editor-container').innerHTML = '';
        document.getElementById('metric-config-name').value = '';

    } catch (e) {
        console.error("Save metric config failed", e);
        showToast("שגיאה בשמירת המדדים", "red");
    }
};

window.editMetricConfig = (index) => {
    const config = window.metricConfigurations[index];
    if (!config) return;

    // מילוי שדות הבחירה (סוג ושם גיחה)
    document.getElementById('metric-config-type').value = config.type;
    document.getElementById('metric-config-name').value = config.name;

    // ניקוי וטעינת המדדים לטופס העריכה
    const container = document.getElementById('metrics-editor-container');
    container.innerHTML = '';

    if (config.metrics && config.metrics.length > 0) {
        config.metrics.forEach(m => {
            window.addNewMetricGroup(m.mainName, m.subs);
        });
    }

    // גלילה חלקה למעלה לטופס העריכה
    document.getElementById('metric-config-type').scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast("המדדים נטענו לעריכה. בצע שינויים ולחץ על 'שמור מדדים'.", "blue");
};
window.deleteMetricConfig = async (index) => {
    if (confirm("האם אתה בטוח שברצונך למחוק הגדרת מדדים זו?")) {
        window.metricConfigurations.splice(index, 1);

        // שמירה ל-Firestore
        const { doc, setDoc } = window.firestoreFunctions;
        await setDoc(doc(window.db, "settings", "advanced_config"), {
            goalConfigurations: window.goalConfigurations || [],
            systemClassifications: window.systemClassifications || {},
            metricConfigurations: window.metricConfigurations
        });

        renderMetricsConfigTable();
        showToast("ההגדרה נמחקה", "green");
    }
};

// הוספת קבוצת הסבה חדשה
window.addNewConversionGroup = () => {
    const name = prompt("שם קבוצת הסבה חדשה (למשל: הסבת לילה):");
    if (name) {
        pilotPopulations.conversionGroups.push({ name: name, members: [] });
        window.renderPopulations();
        window.savePopulations(true);
    }
};

// עדכון שם קבוצת הסבה
window.updateConversionGroupName = (idx, newName) => {
    if (newName && newName.trim()) {
        pilotPopulations.conversionGroups[idx].name = newName.trim();
        window.savePopulations(true);
    }
};

// מחיקת קבוצת הסבה
window.removeConversionGroup = (idx) => {
    if (confirm("האם למחוק את קבוצת ההסבה?")) {
        pilotPopulations.conversionGroups.splice(idx, 1);
        window.renderPopulations();
        window.savePopulations(true);
    }
};

// חשיפה ל-window
window.editMetricConfig = window.editMetricConfig;
window.deleteMetricConfig = window.deleteMetricConfig;

// חשיפת פונקציות לחלון
window.switchAdminTab = switchAdminTab;
window.saveGoalConfig = window.saveGoalConfig;
window.deleteGoalConfig = window.deleteGoalConfig;
window.editGoalConfig = window.editGoalConfig;
window.addGoalInput = window.addGoalInput;
window.updateGoalCounters = window.updateGoalCounters;
window.saveFlightMapping = window.saveFlightMapping;
window.initAdminPage = initAdminPage;
window.switchAdminTab = switchAdminTab;
window.changePlanningMonth = changePlanningMonth;
window.renderPlanningCalendar = renderPlanningCalendar;
window.openDayPlanModal = window.openDayPlanModal;
window.confirmDayPlan = window.confirmDayPlan;
window.addPerson = addPerson;
window.removePerson = removePerson;
window.editPerson = editPerson;
window.savePersonnelLists = savePersonnelLists;
window.loadPersonnelLists = loadPersonnelLists;
window.syncFromExistingFlights = syncFromExistingFlights;
window.updateListsFromImport = updateListsFromImport;
window.performExport = performExport;
window.openExportModal = window.openExportModal;
window.loadGoalsAndSystems = loadGoalsAndSystems;
window.renderPopulations = renderPopulations;
window.addSelectedToPopulation = addSelectedToPopulation;
window.removeFromPopulation = removeFromPopulation;
window.addNewCourse = addNewCourse;
window.updateCourseName = updateCourseName;
window.removeCourse = removeCourse;
window.savePopulations = savePopulations;
window.addNewInstructorGroup = window.addNewInstructorGroup;
window.addSelectedToGroup = window.addSelectedToGroup;
window.removeFromGroup = window.removeFromGroup;
window.updateGroupName = window.updateGroupName;
window.removeGroup = window.removeGroup;
window.openAdvancedPersonnel = window.openAdvancedPersonnel;
window.filterPersonnelModal = window.filterPersonnelModal;
window.addFromPersonnelModal = window.addFromPersonnelModal;
window.initMergePersonnel = window.initMergePersonnel;
window.renderAllLists = window.renderAllLists;
window.openMergeModal = window.openMergeModal;
window.switchAdvancedTab = window.switchAdvancedTab;
window.addNewMetricGroup = window.addNewMetricGroup;
window.addMetricSubItem = window.addMetricSubItem;
window.saveMetricConfig = window.saveMetricConfig;
window.renderMetricConfigTable = renderMetricsConfigTable;
window.editMetricConfig = window.editMetricConfig;
window.deleteMetricConfig = window.deleteMetricConfig;
window.removeConversionGroup = window.removeConversionGroup;
window.updateConversionGroupName = window.updateConversionGroupName;
window.addNewConversionGroup = window.addNewConversionGroup;
window.renderFlightMappingUI = window.renderFlightMappingUI;
window.filterFlightMappingList = window.filterFlightMappingList;
window.addFlightsToMapping = window.addFlightsToMapping;
window.removeFlightFromMapping = window.removeFlightFromMapping;
