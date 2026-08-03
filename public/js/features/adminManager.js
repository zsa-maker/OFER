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
    },
    flightTypeMapping: {}
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

    // נוסיף את זה כדי שברגע שנטענו נתונים - ה-UI יתעדכן
    window.addEventListener('personnelListsUpdated', () => {
        if (typeof window.renderFlightTypeMappingUI === 'function') {
            window.renderFlightTypeMappingUI();
        }
    });
    planningState.currentDate = new Date();
    loadPlanningData();
    window.activePeriod = window.getPeriodName(new Date());
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
        // אכלוס סלקטור התקופות לפי מה שמוגדר ב-planningSettings
        const periodSelect = document.getElementById('admin-population-period');
        if (periodSelect && window.planningSettings && window.planningSettings.periodConfigs) {
            const periods = Object.keys(window.planningSettings.periodConfigs).sort((a, b) => {
                const [pA, yA] = a.split('/').map(Number);
                const [pB, yB] = b.split('/').map(Number);
                return (yB + pB / 10) - (yA + pA / 10);
            });
            periodSelect.innerHTML = periods.map(p => `<option value="${p}">${p}</option>`).join('');

            // בחירת התקופה הנוכחית
            const currPeriod = window.getPeriodName(new Date());
            if (periods.includes(currPeriod)) periodSelect.value = currPeriod;
        }

        loadPopulationsForAdmin(); // במקום renderPopulations() ישי
        if (typeof window.renderFlightTypeMappingUI === 'function') {
            window.renderFlightTypeMappingUI();
        }
    }
}

// פונקציה לשליפת נתונים ספציפיים לתקופה בלי לעבור עמוד
export async function fetchPopulationsForPeriod(periodName) {
    if (!window.firestoreFunctions || !window.db) return null;
    const { doc, getDoc } = window.firestoreFunctions;
    const safePeriodName = periodName.replace(/\//g, '-');

    try {
        const snap = await getDoc(doc(window.db, "populations_by_period", safePeriodName));
        return snap.exists() ? snap.data() : null;
    } catch (e) {
        console.error("Error fetching period data:", e);
        return null;
    }
}

// פונקציית עזר להוצאת כל הטייסים מהקבוצות של תקופה
export function getAllPilotsFromPopulations(pops) {
    if (!pops) return [];
    let all = [];
    if (pops.instructorGroups) pops.instructorGroups.forEach(g => all.push(...g.members));
    if (pops.courses) pops.courses.forEach(c => all.push(...c.students));
    if (pops.conversionGroups) pops.conversionGroups.forEach(g => all.push(...g.members));
    return [...new Set(all)]; // מסיר כפילויות
}

// חשיפה ל-Window
window.fetchPopulationsForPeriod = fetchPopulationsForPeriod;
window.getAllPilotsFromPopulations = getAllPilotsFromPopulations;


export async function loadGoalsAndSystems() {
    if (!window.firestoreFunctions || !window.db) return;
    const { doc, getDoc } = window.firestoreFunctions;

    try {
        const docRef = doc(window.db, "settings", "advanced_config");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();

            // עדכון היעדים
            Global.goalConfigurations.splice(0, Global.goalConfigurations.length, ...(data.goalConfigurations || []));

            // 🔴 התיקון: סנכרון מלא של המשתנה הגלובלי כדי שהטבלה תראה אותו
            window.metricConfigurations = data.metricConfigurations || [];
            metricConfigurations.splice(0, metricConfigurations.length, ...window.metricConfigurations);
            // עדכון המערכות
            const systems = data.systemClassifications || {};
            for (const key in systems) { Global.systemClassifications[key] = systems[key]; }

            renderSystemList();
            renderMetricsConfigTable();
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

    // שימוש במערכים רגילים כדי שנוכל להפעיל את isDuplicate
    const lists = {
        instructorsFemale: personnelLists.instructorsFemale || [],
        pilots: personnelLists.pilots || [],
        observers: personnelLists.observers || [],
        simulators: personnelLists.simulators || [],
        flightTypes: personnelLists.flightTypes || [],
        flightNames: personnelLists.flightNames || []
    };

    savedFlights.forEach(flight => {
        const d = flight.data || {};
        const add = (key, listKey) => {
            const val = d[key];
            if (val && typeof val === 'string' && val.trim().length > 1) {
                const cleanVal = val.trim();
                // אם הערך לא קיים (מתעלם מגרשיים), נוסיף אותו
                if (!isDuplicate(lists[listKey], cleanVal)) {
                    lists[listKey].push(cleanVal);
                    addedCount++;
                }
            }
        };

        add('מדריכה', 'instructorsFemale'); add('instructor-name-1', 'instructorsFemale');
        add('טייס ימין', 'pilots'); add('טייס שמאל', 'pilots'); add('pilot-right', 'pilots'); add('pilot-left', 'pilots');
        add('מתצפת', 'observers'); add('observer', 'observers');
        add('סימולטור', 'simulators'); add('סוג גיחה', 'flightTypes'); add('שם גיחה', 'flightNames');
    });

    Object.keys(lists).forEach(key => { personnelLists[key] = lists[key].sort(); });

    if (addedCount > 0) {
        await savePersonnelLists();
        renderAllLists();
        showToast(`נוספו ${addedCount} ערכים חדשים!`, "green");
    } else {
        showToast("הכל מעודכן. לא נמצאו ערכים חדשים.", "blue");
    }
}

export async function updateListsFromImport(newNamesData) {
    if (personnelLists.pilots.length === 0) await loadPersonnelLists();
    let hasChanges = false;

    const mergeNames = (category, newNames) => {
        if (!newNames || newNames.length === 0) return;
        const currentList = personnelLists[category] || [];

        newNames.forEach(name => {
            const cleanName = name.trim();
            // שימוש בבדיקת כפילויות חכמה
            if (cleanName && !isDuplicate(currentList, cleanName)) {
                currentList.push(cleanName);
                hasChanges = true;
            }
        });
        personnelLists[category] = currentList.sort();
    };

    mergeNames('instructorsFemale', newNamesData.instructorsFemale);
    mergeNames('pilots', newNamesData.pilots);

    if (hasChanges) {
        const { doc, setDoc } = window.firestoreFunctions;
        if (window.db) await setDoc(doc(window.db, "settings", "personnel"), personnelLists);
        renderAllLists();
    }
}

function renderAllLists() {
    // renderList('instructorsMale'); 
    renderList('instructorsFemale'); renderList('pilots'); renderList('observers'); renderList('simulators'); renderList('flightTypes'); renderList('flightNames'); renderList('technicians');
}

function renderList(type) {
    const listContainer = document.getElementById(`list-${type}`);
    if (!listContainer) return;

    const items = personnelLists[type] || [];

    // עדכון מונה בראש הרשימה
    const header = document.getElementById(`header-${type}-count`);
    if (header) header.textContent = `(${items.length})`;

    listContainer.innerHTML = '';
    if (items.length === 0) {
        listContainer.innerHTML = `<li class="text-gray-400 text-sm italic text-center py-2">אין ערכים ברשימה.</li>`;
        return;
    }

    items.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = "flex justify-between items-center bg-gray-50 p-2 rounded hover:bg-gray-100 border border-gray-200";

        // הוספת המספור ${index + 1} לפני שם הפריט
        li.innerHTML = `
            <div class="flex items-center flex-grow">
                <span class="text-xs text-gray-400 w-6">${index + 1}.</span>
                <span class="font-medium text-gray-800 truncate" title="${item}">${item}</span>
            </div>
            <div class="flex gap-1 shrink-0">
                <button onclick="window.editPerson('${type}', ${index})" class="text-blue-500 hover:text-blue-700 p-1">✏️</button>
                <button onclick="window.removePerson('${type}', ${index})" class="text-red-500 hover:text-red-700 p-1">🗑️</button>
            </div>`;
        listContainer.appendChild(li);
    });
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

// פונקציית עזר שמשווה מחרוזות תוך התעלמות מגרשיים, מרכאות (אנגלית/עברית) ורווחים
export function isDuplicate(list, newValue) {
    if (!list || !newValue) return false;
    const normalize = (str) => typeof str === 'string' ? str.replace(/['"״׳]/g, '').trim() : '';
    const normalizedNew = normalize(newValue);
    return list.some(item => normalize(item) === normalizedNew);
}

export async function addPerson(type) {
    const input = document.getElementById(`input-${type}`);
    if (!input) return;

    const name = input.value.trim();
    if (!name) return showToast("נא להזין ערך.", "yellow");

    if (!personnelLists[type]) personnelLists[type] = [];

    if (isDuplicate(personnelLists[type], name)) return showToast("הערך כבר קיים ברשימה.", "red");

    personnelLists[type].push(name);
    // המיון (.sort()) הוסר בכוונה כדי לשמור על הסדר של ה-Drag&Drop!

    input.value = '';
    window.renderList(type);

    await savePersonnelLists(true);

    const undoAdd = async () => {
        personnelLists[type] = personnelLists[type].filter(n => n !== name);
        window.renderList(type);
        await savePersonnelLists(true);
        import('../components/modals.js').then(m => m.showToast(`ההוספה בוטלה, השם "${name}" הוסר.`, "blue"));
    };

    import('../components/modals.js').then(m => m.showToast(`נוסף ונשמר: ${name}`, "green", 3000, undoAdd));
}

window.addFromPersonnelModal = async () => {
    const input = document.getElementById('personnel-new-name');
    const name = input.value.trim();
    if (!name) return;

    if (!isDuplicate(personnelLists[currentModalType], name)) {
        personnelLists[currentModalType].push(name);
        // המיון האוטומטי הוסר מכאן
        input.value = '';
        await savePersonnelLists(true);
        window.filterPersonnelModal();
        window.renderList(currentModalType);

        const undoAddModal = async () => {
            personnelLists[currentModalType] = personnelLists[currentModalType].filter(n => n !== name);
            window.filterPersonnelModal();
            window.renderList(currentModalType);
            await savePersonnelLists(true);
            import('../components/modals.js').then(m => m.showToast(`ההוספה בוטלה, השם "${name}" הוסר.`, "blue"));
        };

        import('../components/modals.js').then(m => m.showToast(`השם "${name}" נוסף בהצלחה`, "green", 3000, undoAddModal));
    } else {
        showToast("השם כבר קיים ברשימה", "yellow");
    }
};

export async function removePerson(type, index) {
    const nameToRemove = personnelLists[type][index];
    if (confirm(`למחוק את "${nameToRemove}"?`)) {

        // גיבוי לטובת Undo
        const originalIndex = index;

        personnelLists[type].splice(index, 1);
        renderList(type);
        await savePersonnelLists(true);

        const undoRemove = async () => {
            // החזרה למערך באותו המיקום
            personnelLists[type].splice(originalIndex, 0, nameToRemove);
            renderList(type);
            await savePersonnelLists(true);
            import('../components/modals.js').then(m => m.showToast(`המחיקה בוטלה, "${nameToRemove}" הוחזר.`, "blue"));
        };

        import('../components/modals.js').then(m =>
            m.showToast(`נמחק ונשמר: ${nameToRemove}`, "green", 3000, undoRemove)
        );
    }
}

export async function editPerson(type, index) {
    const oldName = personnelLists[type][index];
    const newName = prompt("ערוך ערך:", oldName);

    if (newName && newName.trim() && newName !== oldName) {
        const finalNewName = newName.trim();
        const listWithoutCurrent = personnelLists[type].filter((_, i) => i !== index);

        if (isDuplicate(listWithoutCurrent, finalNewName)) {
            import('../components/modals.js').then(m => m.showToast("השם כבר קיים ברשימה.", "red"));
            return;
        }

        personnelLists[type][index] = finalNewName;
        // המיון (.sort()) הוסר כדי לא לפגוע בסדר הגרירה!
        window.renderList(type);
        await savePersonnelLists(true);

        // 2. סריקה ועדכון השם בכל הגיחות הקיימות במסד הנתונים
        if (window.firestoreFunctions && window.db && window.savedFlights) {
            import('../components/modals.js').then(m => m.showToast("מעדכן גיחות קיימות... נא להמתין", "blue"));

            try {
                const { doc, updateDoc } = window.firestoreFunctions;
                let count = 0;

                const fieldMap = {
                    'instructorsFemale': ['מדריכה', 'instructor-name-1', 'מדריכה נוספת'],
                    'pilots': ['טייס ימין', 'טייס שמאל', 'pilot-right', 'pilot-left'],
                    'observers': ['מתצפת', 'observer'],
                    'simulators': ['סימולטור'],
                    'flightTypes': ['סוג גיחה'],
                    'flightNames': ['שם גיחה'],
                    'technicians': ['טכנאי']
                };

                const fieldsToUpdate = fieldMap[type] || [];

                for (let flight of window.savedFlights) {
                    let changed = false;
                    fieldsToUpdate.forEach(field => {
                        if (flight.data[field] === oldName) {
                            flight.data[field] = finalNewName;
                            changed = true;
                        }
                    });

                    if (changed) {
                        await updateDoc(doc(window.db, "flights", flight.id), { data: flight.data });
                        count++;
                    }
                }

                if (count > 0) {
                    import('../components/modals.js').then(m => m.showToast(`השם עודכן בהצלחה ו-${count} גיחות עודכנו!`, "green"));
                } else {
                    import('../components/modals.js').then(m => m.showToast("השם עודכן ונשמר ברשימה.", "green"));
                }

                if (typeof window.filterPersonnelModal === 'function' && !document.getElementById('personnel-manage-modal').classList.contains('hidden')) {
                    window.filterPersonnelModal();
                }

            } catch (error) {
                console.error("Error updating flights on edit:", error);
                import('../components/modals.js').then(m => m.showToast("שגיאה בעדכון הגיחות. השם עודכן רק ברשימה.", "red"));
            }
        } else {
            import('../components/modals.js').then(m => m.showToast("השם עודכן ונשמר.", "green"));
        }
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

        // קריאה בסוף פונקציית loadPlanningData הקיימת
        updatePeriodInputsUI();
        window.renderPlanningSettings(); // החלפה של renderPlanningCalendar() הישן
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

    tbody.innerHTML = '';
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    let currentProcessDate = new Date(firstDay);
    // הולכים ליום ראשון הקרוב ביותר בתחילת החודש
    currentProcessDate.setDate(currentProcessDate.getDate() - currentProcessDate.getDay());

    // פונקציית עזר למציאת יום ראשון שבו מתחילה הגיחה או התקופה
    const getStartSunday = (d) => {
        if (!d) return null;
        const s = new Date(d);
        s.setHours(0, 0, 0, 0);
        s.setDate(s.getDate() - s.getDay());
        return s;
    };

    while (currentProcessDate <= lastDay || currentProcessDate.getDay() !== 0) {
        const tr = document.createElement('tr');

        let weekLabel = '-';
        let weekNumKey = null;

        const currSunday = getStartSunday(currentProcessDate);

        // שימוש בפונקציה החכמה כדי להבין לאיזו תקופה שייך השבוע הזה
        const periodName = window.getPeriodName(currSunday);
        let relevantStart = null;

        if (periodName) {
            const config = window.planningSettings?.periodConfigs?.[periodName];

            if (config && config.startDate) {
                // אם המנהל הגדיר תאריך מדויק לתקופה, נשתמש בו!
                relevantStart = getStartSunday(new Date(config.startDate));
            } else {
                // חישוב תאריך התחלה אוטומטי במקרה שלא הוגדר תאריך ידני
                const [pNum, pYear] = periodName.split('/');
                const fullYear = 2000 + parseInt(pYear);
                if (pNum === "1") {
                    relevantStart = getStartSunday(new Date(fullYear - 1, 11, 15)); // 15 בדצמבר שנה שעברה
                } else {
                    relevantStart = getStartSunday(new Date(fullYear, 5, 15)); // 15 ביוני
                }
            }
        }

        if (relevantStart) {
            // חישוב מספר השבוע יחסית ליום ראשון של תחילת התקופה
            const diffDays = Math.round((currSunday - relevantStart) / (1000 * 60 * 60 * 24));
            const weekNum = Math.floor(diffDays / 7) + 1;

            const finalWeekNum = Math.max(1, weekNum); // מונע מצב של "שבוע 0" בתפרי זמן
            weekLabel = `שבוע ${finalWeekNum}`;
            weekNumKey = `${periodName.replace('/', '-')}_w${finalWeekNum}`;
        }

        tr.innerHTML += `<td class="px-3 py-4 text-xs font-bold text-gray-700 bg-gray-50 border-l sticky right-0 z-10">${weekLabel}</td>`;

        let currentWeekDates = [];

        // רינדור 7 הימים של השבוע
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
        import('../components/modals.js').then(m => m.showToast("נא לבחור תאריכי התחלה וסיום", "yellow"));
        return;
    }

    const start = new Date(startDateVal);
    const end = new Date(endDateVal);

    if (end < start) {
        import('../components/modals.js').then(m => m.showToast("תאריך סיום חייב להיות אחרי תאריך התחלה", "red"));
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
        return fDate >= start && fDate <= end && f.executionStatus !== 'בוטלה';
    });

    if (relevantFlights.length === 0) {
        import('../components/modals.js').then(m => m.showToast("לא נמצאו גיחות (שלא בוטלו) בטווח התאריכים שנבחר.", "yellow"));
        return;
    }

    const groupedData = {};

    relevantFlights.forEach(f => {
        let dateStr = f.date;
        if (f.date instanceof Date) dateStr = f.date.toISOString().split('T')[0];

        const sim = (f.data['סימולטור'] || 'אחר').toUpperCase().trim();
        const startTime = f.data['שעת התחלה'];
        const endTime = f.data['שעת סיום'];

        if (!startTime || !endTime) return; // מתעלמים מגיחות ללא שעות

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

    // משיכת שעות סגירת המתקן הכלליות
    let facilityStatuses = {};
    if (window.firestoreFunctions && window.db) {
        try {
            const { collection, getDocs, query, where } = window.firestoreFunctions;
            const q = query(collection(window.db, "facility_status"),
                where("date", ">=", startDateVal),
                where("date", "<=", endDateVal));
            const snap = await getDocs(q);
            snap.forEach(doc => {
                const data = doc.data();
                facilityStatuses[data.date] = data.closeTime;
            });
        } catch (e) {
            console.error("Failed to load facility statuses", e);
        }
    }

    let csvContent = "\uFEFF";
    // כותרות מעודכנות לאקסל
    csvContent += "תאריך,יום,מאמן,שעת גיחה ראשונה,שעת גיחה אחרונה,חלון הפעלה (שעות),סהכ שעות הפעלה מצטבר,עם תמיכה,מנהל יומי\n";

    const sortedDates = Object.keys(groupedData).sort();

    sortedDates.forEach(dateStr => {
        const simulators = Object.keys(groupedData[dateStr]).sort();
        const plan = localPlanningData[dateStr];
        let manager = plan?.manager || '';
        let support = plan?.support ? 'V' : '';
        const hebrewDay = getHebrewDay(dateStr);

        // שעת הסגירה הכללית של המתקן באותו היום
        const closeTime = facilityStatuses[dateStr];

        simulators.forEach(sim => {
            const times = groupedData[dateStr][sim];
            times.startTimes.sort();
            times.endTimes.sort();

            const firstStart = times.startTimes[0];
            const lastEnd = times.endTimes[times.endTimes.length - 1];

            let operatingWindowDisplay = '';
            let operatingHoursCount = '';

            if (firstStart) {
                // שעת התחלת הפעלה (15 דקות לפני הגיחה הראשונה)
                const startObj = new Date(`2000-01-01T${firstStart}:00`);
                startObj.setMinutes(startObj.getMinutes() - 15);
                const opStartStr = startObj.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

                let endObj;
                let opEndStr;

                if (closeTime) {
                    endObj = new Date(`2000-01-01T${closeTime}:00`);
                    opEndStr = closeTime;
                    // אם שעת הסגירה גלשה מעבר לחצות
                    if (endObj < startObj) endObj.setDate(endObj.getDate() + 1);
                } else {
                    // אם המשתמש דילג על השלמת שעת סגירה, לוקחים את סיום הגיחה האחרונה
                    endObj = new Date(`2000-01-01T${lastEnd}:00`);
                    opEndStr = lastEnd;
                }

                operatingWindowDisplay = `${opStartStr} - ${opEndStr}`;

                let diffMs = endObj - startObj;
                if (diffMs > 0) {
                    operatingHoursCount = (diffMs / (1000 * 60 * 60)).toFixed(2);
                }
            }

            const cleanManager = manager.replace(/,/g, ' ');
            const [y, m, d] = dateStr.split('-');
            const formattedDate = `${d}/${m}/${y}`;

            csvContent += `${formattedDate},${hebrewDay},${sim},${firstStart},${lastEnd},${operatingWindowDisplay},${operatingHoursCount},${support},${cleanManager}\n`;
        });
    });

    const encodedUri = encodeURI("data:text/csv;charset=utf-8," + csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `דוח_הפעלה_עופר_${startDateVal}_${endDateVal}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    document.getElementById('export-report-modal').classList.add('hidden');
    import('../components/modals.js').then(m => m.showToast("הדוח נוצר בהצלחה!", "green"));
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
            personnelLists.flightTypes.map(t => `<option value="${t.replace(/"/g, '&quot;')}">${t}</option>`).join('');
    }

    if (nameSelect && personnelLists.flightNames) {
        nameSelect.innerHTML = '<option value="">בחר שם...</option>' +
            personnelLists.flightNames.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('');
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
            systemClassifications: Global.systemClassifications,
            // 🔴 התיקון: שמירת המשתנה הגלובלי שמכיל את המידע האמיתי
            metricConfigurations: window.metricConfigurations || metricConfigurations
        }, { merge: true });

        console.log("Configuration saved successfully");
    } catch (e) {
        console.error("Save advanced config failed", e);
        showToast("שגיאה בשמירת הגדרות מתקדמות", "red");
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
    const rawSearchTerm = document.getElementById('personnel-search-input').value.toLowerCase();

    // פונקציית עזר לניקוי תווים מיוחדים מהחיפוש - כך "יט 1" ימצא גם את "י"ט 1"
    const cleanString = (str) => typeof str === 'string' ? str.replace(/['"״׳]/g, '').trim() : '';
    const searchTerm = cleanString(rawSearchTerm);

    const container = document.getElementById('personnel-modal-list-container');
    const items = personnelLists[currentModalType] || [];

    container.innerHTML = '';

    // תיקון: מיפוי המערך תחילה כדי לשמור על האינדקס המקורי (הבטוח) גם אחרי פילטר
    const filteredItems = items
        .map((name, index) => ({ name, index }))
        .filter(item => cleanString(item.name.toLowerCase()).includes(searchTerm));

    if (filteredItems.length === 0) {
        container.innerHTML = '<div class="text-center py-4 text-gray-500">לא נמצאו תוצאות</div>';
        return;
    }

    filteredItems.forEach(item => {
        const { name, index: originalIndex } = item;
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-white p-3 mb-2 rounded shadow-sm border border-gray-100";

        div.innerHTML = `
            <span class="font-bold text-gray-800">${name}</span>
            <div class="flex gap-2">
                <button onclick="window.editPerson('${currentModalType}', ${originalIndex}); setTimeout(() => window.filterPersonnelModal(), 500);" 
                        class="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded hover:bg-yellow-200 font-bold">ערוך שם</button>
                <button onclick="window.initMergePersonnel(${originalIndex})" 
                        class="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200">מיזוג לשם אחר</button>
                <button onclick="window.removePerson('${currentModalType}', ${originalIndex}); setTimeout(() => window.filterPersonnelModal(), 500);" 
                        class="text-red-500 hover:text-red-700 text-lg">🗑️</button>
            </div>
        `;
        container.appendChild(div);
    });
};


window.initMergePersonnel = async (indexOrOldName) => {
    let oldName = indexOrOldName;
    let originalIndex = -1;

    // זיהוי אם קיבלנו אינדקס בטוח (מספר) ושליפת השם והאינדקס המדויקים
    if (typeof indexOrOldName === 'number') {
        originalIndex = indexOrOldName;
        oldName = personnelLists[currentModalType][originalIndex];
    } else {
        originalIndex = personnelLists[currentModalType].indexOf(oldName);
    }

    // תיקון: סינון לפי האינדקס בלבד כדי להבטיח ששמות כפולים יופיעו ברשימה להמיזוג
    const availableNames = personnelLists[currentModalType].filter((n, idx) => idx !== originalIndex);

    // ניקוי כפילויות ויזואליות ברשימת הבחירה עצמה בלבד
    const uniqueAvailableNames = [...new Set(availableNames)];

    if (uniqueAvailableNames.length === 0) {
        import('../components/modals.js').then(m => m.showToast("אין שמות נוספים ברשימה למזג אליהם.", "yellow"));
        return;
    }

    // יצירת חלון קופץ צף (מודאל מותאם אישית)
    const overlay = document.createElement('div');
    overlay.className = "fixed inset-0 bg-gray-900 bg-opacity-60 overflow-y-auto h-full w-full z-[60] flex justify-center items-center";
    overlay.id = "custom-merge-modal";

    const optionsHtml = uniqueAvailableNames.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('');

    overlay.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-xl w-96 text-right" dir="rtl">
            <h3 class="text-xl font-bold mb-2 text-ofer-dark-brown border-b pb-2">מיזוג נתונים</h3>
            <p class="text-sm text-gray-600 mb-4">לאיזה שם ברשימה תרצה למזג את <span class="font-bold text-red-600">"${oldName}"</span>?</p>
            <p class="text-xs text-gray-500 mb-4">* כל הגיחות של השם הנוכחי יעברו לשם שייבחר, והשם הנוכחי יימחק מהרשימה.</p>

            <div class="mb-4">
                <label class="block text-sm font-bold mb-2">בחר שם יעד (מתוך הרשימה הקיימת):</label>
                <select id="merge-target-select" class="w-full p-2 border rounded border-gray-300 focus:ring-ofer-orange bg-gray-50">
                    <option value="" disabled selected>-- בחר שם --</option>
                    ${optionsHtml}
                </select>
            </div>

            <div class="flex justify-end gap-3 mt-6">
                <button id="cancel-merge-btn" class="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 font-bold">ביטול</button>
                <button id="confirm-merge-btn" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-bold shadow">אשר מיזוג</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('cancel-merge-btn').onclick = () => {
        document.body.removeChild(overlay);
    };

    document.getElementById('confirm-merge-btn').onclick = async () => {
        const newNameSelect = document.getElementById('merge-target-select');
        const newName = newNameSelect.value;

        if (!newName) {
            import('../components/modals.js').then(m => m.showToast("יש לבחור שם מהרשימה.", "yellow"));
            return;
        }

        if (!confirm('האם אתה בטוח? פעולה זו תעדכן את כל הגיחות במסד הנתונים!')) return;

        document.body.removeChild(overlay);
        import('../components/modals.js').then(m => m.showToast("מבצע מיזוג... נא להמתין", "blue"));

        try {
            const { doc, updateDoc } = window.firestoreFunctions;
            let count = 0;
            const updatedFlightIds = [];

            const fieldMap = {
                'instructorsFemale': ['מדריכה', 'instructor-name-1', 'מדריכה נוספת'],
                'pilots': ['טייס ימין', 'טייס שמאל', 'pilot-right', 'pilot-left'],
                'observers': ['מתצפת', 'observer'],
                'simulators': ['סימולטור'],
                'flightTypes': ['סוג גיחה'],
                'flightNames': ['שם גיחה'],
                'technicians': ['טכנאי']
            };

            const fieldsToUpdate = fieldMap[currentModalType] || [];

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
                    updatedFlightIds.push(flight.id);
                    count++;
                }
            }

            // תיקון: מחיקת הפריט הספציפי שמוזג בלבד על פי מיקומו במערך
            if (originalIndex > -1) {
                personnelLists[currentModalType].splice(originalIndex, 1);
            } else {
                personnelLists[currentModalType] = personnelLists[currentModalType].filter(n => n !== oldName);
            }

            await savePersonnelLists(true);

            const undoMerge = async () => {
                import('../components/modals.js').then(m => m.showToast("מבטל מיזוג, משחזר גיחות ומאגר...", "blue"));
                try {
                    for (let flightId of updatedFlightIds) {
                        const flight = window.savedFlights.find(f => f.id === flightId);
                        if (flight) {
                            fieldsToUpdate.forEach(field => {
                                if (flight.data[field] === newName) {
                                    flight.data[field] = oldName;
                                }
                            });
                            await updateDoc(doc(window.db, "flights", flightId), { data: flight.data });
                        }
                    }

                    // תיקון ביטול: השבת השם לאינדקס המקורי שבו היה
                    if (originalIndex !== -1) {
                        personnelLists[currentModalType].splice(originalIndex, 0, oldName);
                    } else {
                        personnelLists[currentModalType].push(oldName);
                    }
                    await savePersonnelLists(true);

                    import('../components/modals.js').then(m => m.showToast(`המיזוג בוטל! ${count} גיחות הוחזרו ל-${oldName}.`, "green"));
                    window.filterPersonnelModal();
                    window.renderList(currentModalType);
                } catch (err) {
                    console.error("Error undoing merge:", err);
                    import('../components/modals.js').then(m => m.showToast("שגיאה בביטול המיזוג", "red"));
                }
            };

            import('../components/modals.js').then(m => m.showToast(`מיזוג הושלם! ${count} גיחות עודכנו ל-${newName}.`, "green", 3000, undoMerge));
            window.filterPersonnelModal();
            window.renderList(currentModalType);

        } catch (error) {
            console.error("Merge error:", error);
            import('../components/modals.js').then(m => m.showToast("שגיאה בתהליך המיזוג", "red"));
        }
    };
};

// רינדור המסך
function getAllAssignedPilots() {
    let assigned = [];
    pilotPopulations.instructorGroups.forEach(g => assigned.push(...g.members));
    pilotPopulations.courses.forEach(c => assigned.push(...c.students));
    pilotPopulations.conversionGroups.forEach(g => assigned.push(...g.members)); // הוספת שורה זו
    return assigned;
}

// ==========================================
// פונקציות גרירה וסידור ייעודיות לניהול אוכלוסיות
// ==========================================
window.draggedPopItem = null;

window.onDragStartPop = function (e) {
    const li = e.currentTarget;
    window.draggedPopItem = {
        type: li.dataset.type,
        gidx: parseInt(li.dataset.gidx),
        midx: parseInt(li.dataset.midx)
    };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", li.dataset.midx);

    setTimeout(() => li.classList.add('opacity-40', 'bg-gray-200', 'border-gray-400'), 0);
};

window.onDragOverPop = function (e) {
    e.preventDefault();
    const li = e.currentTarget;

    // מאפשרים גרירה רק בתוך אותה הקבוצה
    if (!window.draggedPopItem || window.draggedPopItem.type !== li.dataset.type || window.draggedPopItem.gidx !== parseInt(li.dataset.gidx)) return;

    e.dataTransfer.dropEffect = "move";
    li.classList.remove('border-t-2', 'border-b-2', 'border-blue-500');

    const dragIdx = window.draggedPopItem.midx;
    const dropIdx = parseInt(li.dataset.midx);

    if (dragIdx !== dropIdx) {
        const rect = li.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        if (relY < rect.height / 2) {
            li.classList.add('border-t-2', 'border-blue-500');
        } else {
            li.classList.add('border-b-2', 'border-blue-500');
        }
    }
};

window.onDragLeavePop = function (e) {
    const li = e.currentTarget;
    li.classList.remove('border-t-2', 'border-b-2', 'border-blue-500');
};

window.onDropPop = async function (e) {
    e.preventDefault();
    const li = e.currentTarget;
    li.classList.remove('border-t-2', 'border-b-2', 'border-blue-500');

    if (!window.draggedPopItem) return;

    const dragType = window.draggedPopItem.type;
    const dragGidx = window.draggedPopItem.gidx;
    const dragMidx = window.draggedPopItem.midx;

    const dropType = li.dataset.type;
    const dropGidx = parseInt(li.dataset.gidx);
    const dropMidx = parseInt(li.dataset.midx);

    // מניעת גרירה בין קבוצות שונות
    if (dragType !== dropType || dragGidx !== dropGidx || dragMidx === dropMidx) {
        window.draggedPopItem = null;
        return;
    }

    // חישוב המיקום החדש
    let finalDropIdx = dropMidx;
    const rect = li.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    if (relY >= rect.height / 2) finalDropIdx++;
    if (dragMidx < finalDropIdx) finalDropIdx--;

    // איתור המערך הרלוונטי ושליפת הפריט שנגרר
    let targetArray;
    if (dragType === 'instructor') targetArray = pilotPopulations.instructorGroups[dragGidx].members;
    else if (dragType === 'course') targetArray = pilotPopulations.courses[dragGidx].students;
    else if (dragType === 'conversion') targetArray = pilotPopulations.conversionGroups[dragGidx].members;

    const [movedItem] = targetArray.splice(dragMidx, 1);
    targetArray.splice(finalDropIdx, 0, movedItem);

    window.draggedPopItem = null;

    // רינדור ושמירה
    window.renderPopulations();
    await window.savePopulations(true);
};

window.onDragEndPop = function (e) {
    e.currentTarget.classList.remove('opacity-40', 'bg-gray-200', 'border-gray-400');
    document.querySelectorAll('li').forEach(el => el.classList.remove('border-t-2', 'border-b-2', 'border-blue-500'));
    window.draggedPopItem = null;
};

export function renderPopulations() {
    const instructorContainer = document.getElementById('instructor-groups-container');
    const coursesContainer = document.getElementById('courses-container');

    if (!instructorContainer || !coursesContainer) return;

    const activeElementId = document.activeElement ? document.activeElement.id : null;
    const allPilots = personnelLists.pilots || [];
    const assignedPilots = getAllAssignedPilots();

    // 1. רינדור קבוצות מדריכים
    instructorContainer.innerHTML = pilotPopulations.instructorGroups.map((group, gIdx) => {
        const searchId = `search-instr-group-${gIdx}`;
        const searchVal = document.getElementById(searchId)?.value.toLowerCase() || "";
        const availableForGroup = allPilots.filter(p => p.toLowerCase().includes(searchVal));

        return `
       <div class="bg-white p-3 rounded shadow border-r-4 border-blue-400 mb-3">
            <div class="flex justify-between items-center mb-2">
               <span class="font-bold text-sm text-blue-800">${group.name} (${group.members.length})</span>
               <button onclick="window.removeGroup('instructor', ${gIdx})" class="text-red-500 text-xs">מחק</button>
            </div>
            <div class="mb-2 relative">
               <input type="text" id="${searchId}" oninput="window.renderPopulations()" 
                value="${searchVal}" placeholder="חפש להוספה..." class="w-full border rounded p-1 text-xs pr-6">
                ${searchVal ? `<button onclick="document.getElementById('${searchId}').value=''; window.renderPopulations()" 
                class="absolute left-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">×</button>` : ''}
                <div class="border rounded p-1 h-24 overflow-y-auto mb-1 mt-1 bg-gray-50 custom-scrollbar">
                    ${availableForGroup.map(p => `
                        <label class="flex items-center space-x-2 space-x-reverse text-xs hover:bg-blue-50 p-1 cursor-pointer">
                            <input type="checkbox" class="instr-group-cb-${gIdx}" value="${p.replace(/"/g, '&quot;')}">
                            <span>${p}</span>
                        </label>
                    `).join('') || '<div class="text-gray-400 text-[10px]">אין טייסים זמינים</div>'}
                </div>
                <button onclick="window.addSelectedToGroup('instructor', ${gIdx})" class="w-full bg-blue-500 text-white py-1 rounded text-xs">הוסף נבחרים</button>
            </div>
            <ul class="space-y-1 mt-2">
                ${group.members.map((m, mIdx) => `
                    <li draggable="true" data-type="instructor" data-gidx="${gIdx}" data-midx="${mIdx}"
                        ondragstart="window.onDragStartPop(event)" ondragover="window.onDragOverPop(event)" ondragleave="window.onDragLeavePop(event)" ondrop="window.onDropPop(event)" ondragend="window.onDragEndPop(event)"
                        class="flex justify-between items-center text-xs bg-blue-50 p-1 rounded cursor-grab transition-all duration-150 border border-transparent hover:border-gray-300">
                        <div class="flex items-center flex-grow overflow-hidden pointer-events-none">
                        <span class="text-xs text-gray-400 mr-1 w-5">${mIdx + 1}.</span>
                            <span class="text-gray-400 mr-2 ml-1 text-sm">≡</span>
                            <span class="font-medium text-gray-800 truncate">${m}</span>
                        </div>
                        <button onclick="window.removeFromGroup('instructor', ${gIdx}, ${mIdx})" class="text-red-400 hover:text-red-600 font-bold px-1 z-10">×</button>
                    </li>
                `).join('')}
            </ul>
        </div>`;
    }).join('');

    // 2. רינדור קורסים
    coursesContainer.innerHTML = pilotPopulations.courses.map((course, cIdx) => {
        const searchId = `search-course-${cIdx}`;
        const searchVal = document.getElementById(searchId)?.value.toLowerCase() || "";
        const availableForCourse = allPilots.filter(p => p.toLowerCase().includes(searchVal));

        return `
        <div class="bg-white p-3 rounded shadow border-r-4 border-orange-400 mb-3">
            <div class="flex justify-between items-center mb-2">
                <input type="text" value="${course.name} (${course.students.length})" onchange="window.updateGroupName('course', ${cIdx}, this.value)" 
                       class="font-bold text-sm border-none p-0 focus:ring-0 w-2/3 text-orange-800">
                <button onclick="window.removeGroup('course', ${cIdx})" class="text-red-500 text-xs">מחק</button>
            </div>
           <div class="mb-2 relative">
                <input type="text" id="${searchId}" oninput="window.renderPopulations()" 
                       value="${searchVal}" placeholder="חפש להוספה..." class="w-full border rounded p-1 text-xs pr-6">
                ${searchVal ? `<button onclick="document.getElementById('${searchId}').value=''; window.renderPopulations()" 
                       class="absolute left-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">×</button>` : ''}
                <div class="border rounded p-1 h-24 overflow-y-auto mb-1 mt-1 bg-gray-50 custom-scrollbar">
                    ${availableForCourse.map(p => `
                        <label class="flex items-center space-x-2 space-x-reverse text-xs hover:bg-orange-50 p-1 cursor-pointer">
                            <input type="checkbox" class="course-cb-${cIdx}" value="${p.replace(/"/g, '&quot;')}">
                            <span>${p}</span>
                        </label>
                    `).join('') || '<div class="text-gray-400 text-[10px]">אין טייסים זמינים</div>'}
                </div>
                <button onclick="window.addSelectedToGroup('course', ${cIdx})" class="w-full bg-orange-500 text-white py-1 rounded text-xs">הוסף נבחרים</button>
            </div>
           <ul class="space-y-1 mt-2">
                ${course.students.map((s, sIdx) => {
            const isInactive = course.inactiveStudents && course.inactiveStudents.includes(s);
            const textClass = isInactive ? "text-gray-400 line-through" : "text-gray-800";
            const bgClass = isInactive ? "bg-gray-100" : "bg-orange-50";

            return `
                    <li draggable="true" data-type="course" data-gidx="${cIdx}" data-midx="${sIdx}"
                        ondragstart="window.onDragStartPop(event)" ondragover="window.onDragOverPop(event)" ondragleave="window.onDragLeavePop(event)" ondrop="window.onDropPop(event)" ondragend="window.onDragEndPop(event)"
                        class="flex justify-between items-center text-xs ${bgClass} p-1 rounded cursor-grab transition-all duration-150 border border-transparent hover:border-gray-300">
                        <div class="flex items-center flex-grow overflow-hidden pointer-events-none">
                        <span class="text-xs text-gray-400 mr-1 w-5">${sIdx + 1}.</span>
                            <span class="text-gray-400 mr-2 ml-1 text-sm">≡</span>
                            <span class="${textClass} font-medium truncate">${s}</span>
                        </div>
                        <div class="flex gap-2 items-center z-10">
                            <button onclick="window.toggleStudentStatus(${cIdx}, '${s.replace(/'/g, "\\'")}')" 
                                class="text-[10px] ${isInactive ? 'text-green-600 font-bold' : 'text-gray-500 hover:text-gray-700'}">
                                ${isInactive ? 'החזר' : 'הפסק פעילות'}
                            </button>
                            <button onclick="window.removeFromGroup('course', ${cIdx}, ${sIdx})" class="text-red-400 hover:text-red-600 font-bold text-sm px-1">×</button>
                        </div>
                    </li>
                    `;
        }).join('')}
            </ul>
        </div>`;
    }).join('');

    // 3. רינדור קבוצות הסבה
    const conversionContainer = document.getElementById('conversion-groups-container');
    if (conversionContainer) {
        conversionContainer.innerHTML = pilotPopulations.conversionGroups.map((group, gIdx) => {
            const searchId = `search-conv-group-${gIdx}`;
            const searchVal = document.getElementById(searchId)?.value.toLowerCase() || "";
            const availableForGroup = allPilots.filter(p => p.toLowerCase().includes(searchVal));

            return `
            <div class="bg-white p-3 rounded shadow border-r-4 border-purple-400 mb-3">
                <div class="flex justify-between items-center mb-2">
                    <input type="text" value="${group.name.replace(/"/g, '&quot;')} (${group.members.length})" onchange="window.updateConversionGroupName(${gIdx}, this.value)" 
                           class="font-bold text-sm border-none p-0 focus:ring-0 w-2/3 text-purple-800">
                    <button onclick="window.removeConversionGroup(${gIdx})" class="text-red-500 text-xs">מחק</button>
                </div>
                <div class="mb-2 relative">
                    <input type="text" id="${searchId}" oninput="window.renderPopulations()" 
                           value="${searchVal}" placeholder="חפש להוספה..." class="w-full border rounded p-1 text-xs pr-6">
                    ${searchVal ? `<button onclick="document.getElementById('${searchId}').value=''; window.renderPopulations()" 
                           class="absolute left-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">×</button>` : ''}
                    <div class="border rounded p-1 h-24 overflow-y-auto mb-1 mt-1 bg-gray-50 custom-scrollbar">
                        ${availableForGroup.map(p => `
                            <label class="flex items-center space-x-2 space-x-reverse text-xs hover:bg-purple-50 p-1 cursor-pointer">
                                <input type="checkbox" class="conv-group-cb-${gIdx}" value="${p.replace(/"/g, '&quot;')}">
                                <span>${p}</span>
                            </label>
                        `).join('') || '<div class="text-gray-400 text-[10px]">אין טייסים זמינים</div>'}
                    </div>
                    <button onclick="window.addSelectedToGroup('conversion', ${gIdx})" class="w-full bg-purple-500 text-white py-1 rounded text-xs">הוסף נבחרים</button>
                </div>
                <ul class="space-y-1 mt-2">
                    ${group.members.map((m, mIdx) => `
                        <li draggable="true" data-type="conversion" data-gidx="${gIdx}" data-midx="${mIdx}"
                            ondragstart="window.onDragStartPop(event)" ondragover="window.onDragOverPop(event)" ondragleave="window.onDragLeavePop(event)" ondrop="window.onDropPop(event)" ondragend="window.onDragEndPop(event)"
                            class="flex justify-between items-center text-xs bg-purple-50 p-1 rounded cursor-grab transition-all duration-150 border border-transparent hover:border-gray-300">
                            <div class="flex items-center flex-grow overflow-hidden pointer-events-none">
                            <span class="text-xs text-gray-400 mr-1 w-5">${mIdx + 1}.</span>
                                <span class="text-gray-400 mr-2 ml-1 text-sm">≡</span>
                                <span class="font-medium text-gray-800 truncate">${m}</span>
                            </div>
                            <button onclick="window.removeFromGroup('conversion', ${gIdx}, ${mIdx})" class="text-red-400 hover:text-red-600 px-1 font-bold z-10">×</button>
                        </li>
                    `).join('')}
                </ul>
            </div>`;
        }).join('');
    }

    if (activeElementId) {
        const el = document.getElementById(activeElementId);
        if (el) {
            el.focus();
            if (el.setSelectionRange) {
                const len = el.value.length;
                el.setSelectionRange(len, len);
            }
        }
    }

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

// פונקציית השמירה - שומרת *אך ורק* לנתיב של התקופה הספציפית, בלי Fallback גלובלי דורס!
window.savePopulations = async (silent = false) => {
    if (!window.firestoreFunctions || !window.db) return;
    const { doc, setDoc } = window.firestoreFunctions;

    let activePeriod = document.getElementById('admin-population-period')?.value;
    if (!activePeriod) activePeriod = window.getPeriodName(new Date());

    const safePeriodName = activePeriod.replace(/\//g, '-');
    currentPeriodCoursesCache = null;
    if (typeof renderList === 'function') window.renderList('pilots');

    try {
        // שמירת ה-Deep Copy למסד הנתונים, תחת השם הייחודי של התקופה
        const dataToSave = JSON.parse(JSON.stringify(pilotPopulations));
        await setDoc(doc(window.db, "populations_by_period", safePeriodName), dataToSave);

        if (!silent) {
            import('../components/modals.js').then(m => m.showToast(`הגדרות אוכלוסייה נשמרו בלעדית לתקופה: ${activePeriod}`, "green"));
        }
    } catch (e) {
        console.error("שגיאה בשמירה:", e);
        if (!silent) import('../components/modals.js').then(m => m.showToast("שגיאה בשמירה", "red"));
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

// ==========================================
// פונקציות גרירה וסידור לסיווג שמות גיחות (Flight Mapping)
// ==========================================
window.draggedMappingItem = null;

window.onDragStartMapping = function (e, cat, index) {
    window.draggedMappingItem = { cat, index };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index);

    setTimeout(() => e.target.classList.add('opacity-40', 'bg-purple-100', 'border-purple-300'), 0);
};

window.onDragOverMapping = function (e, cat) {
    e.preventDefault();
    const li = e.currentTarget;

    // מניעת גרירה בין קטגוריות שונות (למשל מגיחות חניכים לגיחות מדריכים)
    if (!window.draggedMappingItem || window.draggedMappingItem.cat !== cat) return;

    e.dataTransfer.dropEffect = "move";
    li.classList.remove('border-t-2', 'border-b-2', 'border-purple-500');

    const dragIndex = window.draggedMappingItem.index;
    const dropIndex = parseInt(li.dataset.idx);

    if (dragIndex !== dropIndex) {
        const rect = li.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        if (relY < rect.height / 2) {
            li.classList.add('border-t-2', 'border-purple-500');
        } else {
            li.classList.add('border-b-2', 'border-purple-500');
        }
    }
};

window.onDragLeaveMapping = function (e) {
    e.currentTarget.classList.remove('border-t-2', 'border-b-2', 'border-purple-500');
};

window.onDropMapping = async function (e, cat, dropIndex) {
    e.preventDefault();
    const li = e.currentTarget;
    li.classList.remove('border-t-2', 'border-b-2', 'border-purple-500');

    if (!window.draggedMappingItem || window.draggedMappingItem.cat !== cat) return;

    const dragIndex = window.draggedMappingItem.index;
    if (dragIndex === dropIndex) return;

    let finalDropIdx = dropIndex;
    const rect = li.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    if (relY >= rect.height / 2) finalDropIdx++;
    if (dragIndex < finalDropIdx) finalDropIdx--;

    const targetArray = pilotPopulations.flightMapping[cat];
    const [movedItem] = targetArray.splice(dragIndex, 1);
    targetArray.splice(finalDropIdx, 0, movedItem);

    window.draggedMappingItem = null;

    window.renderFlightMappingUI();
    await window.savePopulations(true);
};

window.onDragEndMapping = function (e) {
    e.currentTarget.classList.remove('opacity-40', 'bg-purple-100', 'border-purple-300');
    document.querySelectorAll('li').forEach(el => el.classList.remove('border-t-2', 'border-b-2', 'border-purple-500'));
    window.draggedMappingItem = null;
};

// פונקציית עזר לחיפוש וסינון גיחות - מבטיחה שגיחה שנבחרה תיעלם מהרשימה
window.renderFlightMappingUI = () => {
    const categories = ['students', 'instructors', 'conversion'];
    const allFlightNames = personnelLists.flightNames || [];
    const mapping = pilotPopulations.flightMapping || { students: [], instructors: [], conversion: [] };

    // תיקון: הבטחת הכללת קטגוריית ההסבה בחישוב הגיחות שכבר סווגו
    const allMapped = [
        ...(mapping.students || []),
        ...(mapping.instructors || []),
        ...(mapping.conversion || [])
    ];

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
                <input type="checkbox" class="mapping-cb-${cat}" value="${name.replace(/"/g, '&quot;')}">
                <span>${name}</span>
            </label>
        `).join('') || '<div class="text-gray-400 text-[10px] text-center p-2">אין גיחות זמינות</div>';

        const currentSelected = mapping[cat] || [];
        selectedList.innerHTML = currentSelected.map((name, idx) => `
            <li draggable="true" data-idx="${idx}"
                ondragstart="window.onDragStartMapping(event, '${cat}', ${idx})"
                ondragover="window.onDragOverMapping(event, '${cat}')"
                ondragleave="window.onDragLeaveMapping(event)"
                ondrop="window.onDropMapping(event, '${cat}', ${idx})"
                ondragend="window.onDragEndMapping(event)"
                class="flex justify-between items-center text-xs bg-purple-50 p-1 rounded border mb-1 cursor-grab transition-all duration-150 border-transparent hover:border-purple-300">
                
                <div class="flex items-center flex-grow overflow-hidden pointer-events-none">
                    <span class="text-gray-400 mr-2 ml-1 text-sm">≡</span>
                    <span class="font-medium text-gray-800 truncate">${name}</span>
                </div>
                
                <button onclick="window.removeFlightFromMapping('${cat}', ${idx})" class="text-red-400 hover:text-red-600 font-bold px-2 z-10">×</button>
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

export async function loadPopulationsForAdmin() {
    let selectedPeriod = '';
    const periodSelect = document.getElementById('admin-population-period');

    // אם אנחנו במסך מנהל ויש ערך - ניקח אותו. אחרת ניקח אוטומטית את התקופה של היום
    if (periodSelect && periodSelect.value) {
        selectedPeriod = periodSelect.value;
    } else {
        selectedPeriod = window.getPeriodName(new Date());
    }

    if (!selectedPeriod) return; // מונע קריסה אם אין שום תקופה

    const safePeriodName = selectedPeriod.replace(/\//g, '-');

    if (window.firestoreFunctions && window.db) {
        try {
            const { doc, getDoc } = window.firestoreFunctions;

            // 1. ננסה לטעון את האוכלוסייה של התקופה הספציפית הזו
            const popRef = doc(window.db, "populations_by_period", safePeriodName);
            const popSnap = await getDoc(popRef);

            if (popSnap.exists()) {
                // Deep Copy: יצירת עותק מנותק לחלוטין בזיכרון כדי למנוע דריסת כתובות
                window.pilotPopulations = JSON.parse(JSON.stringify(popSnap.data()));
            } else {
                // 2. אם אין מידע לתקופה הנוכחית, נבצע "הורשה" חכמה מהתקופה הקודמת לה כרונולוגית!
                const configs = window.planningSettings?.periodConfigs || {};
                const sortedPeriods = Object.keys(configs).sort((a, b) => {
                    const [pA, yA] = a.split('/').map(Number);
                    const [pB, yB] = b.split('/').map(Number);
                    return (yA + pA / 10) - (yB + pB / 10); // מיון עולה (הישן למעלה)
                });

                const currentIndex = sortedPeriods.indexOf(selectedPeriod);
                let inheritedData = null;

                // חיפוש בתקופה הקודמת (אם קיימת)
                if (currentIndex > 0) {
                    const prevPeriod = sortedPeriods[currentIndex - 1];
                    const prevSafeName = prevPeriod.replace(/\//g, '-');
                    const prevSnap = await getDoc(doc(window.db, "populations_by_period", prevSafeName));
                    if (prevSnap.exists()) {
                        inheritedData = prevSnap.data();
                    }
                }
                if (inheritedData) {
                    // הורשה (עותק מנותק) - מעתיק הכל כולל קורסים וחניכים!
                    window.pilotPopulations = JSON.parse(JSON.stringify(inheritedData));

                    import('../components/modals.js').then(m => m.showToast("נשאבו כל נתוני האוכלוסיות והקורסים מהתקופה הקודמת.", "blue"));
                } else {
                    // 3. Fallback אחרון: מבנה ריק לחלוטין
                    window.pilotPopulations = {
                        instructorGroups: [], courses: [], conversionGroups: [],
                        flightMapping: { students: [], instructors: [], conversion: [] },
                        flightTypeMapping: {} // <--- הוסיפי את השורה הזו כאן
                    };
                }
            }

            // וידוא שהאובייקט המקומי בקובץ מתעדכן בדיוק לאובייקט החדש שיצרנו (למניעת באגים בתצוגה)
            if (typeof pilotPopulations !== 'undefined') {
                Object.assign(pilotPopulations, JSON.parse(JSON.stringify(window.pilotPopulations)));
            }

            // הוספת שורת הרינדור כאן מוודאת שזה קורה מיד בסיום הטעינה:
            if (typeof window.renderFlightTypeMappingUI === 'function') {
                window.renderFlightTypeMappingUI();
            }

            renderPopulations();
        } catch (error) {
            console.error("Error loading populations for period:", error);
        }
    }
}
window.loadPopulationsForAdmin = loadPopulationsForAdmin;

// פונקציית השמירה - שומרת *אך ורק* לנתיב של התקופה הספציפית, בלי Fallback גלובלי דורס!
window.savePopulations = async (silent = false) => {
    if (!window.firestoreFunctions || !window.db) return;
    const { doc, setDoc } = window.firestoreFunctions;

    let activePeriod = document.getElementById('admin-population-period')?.value;
    if (!activePeriod) activePeriod = window.getPeriodName(new Date());

    const safePeriodName = activePeriod.replace(/\//g, '-');

    try {
        // שמירת ה-Deep Copy למסד הנתונים, תחת השם הייחודי של התקופה
        const dataToSave = JSON.parse(JSON.stringify(pilotPopulations));
        await setDoc(doc(window.db, "populations_by_period", safePeriodName), dataToSave);

        if (!silent) {
            import('../components/modals.js').then(m => m.showToast(`הגדרות אוכלוסייה נשמרו בלעדית לתקופה: ${activePeriod}`, "green"));
        }
    } catch (e) {
        console.error("שגיאה בשמירה:", e);
        if (!silent) import('../components/modals.js').then(m => m.showToast("שגיאה בשמירה", "red"));
    }
};

window.loadPopulationsForAdmin = loadPopulationsForAdmin;

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

window.renderFlightTypeMappingUI = () => {
    const typeSelect = document.getElementById('mapping-flight-type-select');
    const searchInput = document.getElementById('search-flight-type-mapping');
    const optionsContainer = document.getElementById('options-flight-type-mapping');
    const selectedList = document.getElementById('selected-flights-for-type');
    const title = document.getElementById('mapping-type-title');

    if (!typeSelect) return;

    // 1. שמירת הערך הנבחר כרגע (כדי לא לאבד אותו בריענון)
    const currentSelectedVal = typeSelect.value;

    // 2. אכלוס מחדש של ה-Dropdown מתוך personnelLists
    typeSelect.innerHTML = '<option value="" disabled selected>בחר סוג גיחה...</option>';

    // מוודאים שיש נתונים, אם לא - משאירים ריק ומחכים לאירוע עדכון
    const types = window.personnelLists?.flightTypes || [];
    types.forEach(type => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = type;
        typeSelect.appendChild(opt);
    });

    // 3. החזרת הבחירה
    if (currentSelectedVal) {
        typeSelect.value = currentSelectedVal;
    }

    // אם אין רכיבי UI נוספים כרגע (כי לא נבחר סוג), אין מה להמשיך
    if (!optionsContainer || !selectedList) return;
    const selectedType = typeSelect.value;
    if (!selectedType) {
        optionsContainer.innerHTML = '<div class="text-gray-400 text-[10px] text-center p-2">בחר סוג גיחה תחילה</div>';
        selectedList.innerHTML = '';
        return;
    }

    title.textContent = `שמות גיחות משויכים ל: ${selectedType}`;

    // וידוא קיום אובייקט במשתנה המקומי הנשמר ישירות ל-Firestore
    if (!pilotPopulations.flightTypeMapping) pilotPopulations.flightTypeMapping = {};
    if (!pilotPopulations.flightTypeMapping[selectedType]) pilotPopulations.flightTypeMapping[selectedType] = [];

    const mappedNames = pilotPopulations.flightTypeMapping[selectedType];
    const allFlightNames = window.personnelLists?.flightNames || [];
    const searchVal = searchInput ? searchInput.value.toLowerCase() : "";

    // רינדור אפשרויות זמינות (שלא נבחרו עדיין ומתאימות לחיפוש)
    const available = allFlightNames.filter(name =>
        !mappedNames.includes(name) && name.toLowerCase().includes(searchVal)
    );

    optionsContainer.innerHTML = available.map(name => `
        <label class="flex items-center space-x-2 space-x-reverse text-xs hover:bg-gray-100 p-1 cursor-pointer">
            <input type="checkbox" class="type-mapping-cb" value="${name.replace(/"/g, '&quot;')}">
            <span>${name}</span>
        </label>
    `).join('') || '<div class="text-gray-400 text-[10px] text-center p-2">אין שמות גיחות זמינים</div>';

    // רינדור שמות שנבחרו
    selectedList.innerHTML = mappedNames.map((name, idx) => `
        <li class="flex justify-between items-center text-xs bg-teal-50 p-1 rounded border mb-1 border-transparent hover:border-teal-300">
            <span class="font-medium text-gray-800 truncate mr-1">${name}</span>
            <button onclick="window.removeFlightNameFromType('${selectedType}', ${idx})" class="text-red-400 hover:text-red-600 font-bold px-2 z-10">×</button>
        </li>
    `).join('');

    // רינדור תצוגה מסכמת של כל הקבוצות שנוצרו
    const summaryContainer = document.getElementById('all-mapped-types-summary');
    if (summaryContainer) {
        let summaryHtml = '<h5 class="font-bold text-gray-700 mb-2 border-b pb-1">סוגי גיחות עם שיוכים:</h5>';
        const mappingObj = pilotPopulations.flightTypeMapping || {};
        let hasAnyMapping = false;

        for (const [fType, fNames] of Object.entries(mappingObj)) {
            if (fNames && fNames.length > 0) {
                hasAnyMapping = true;
                summaryHtml += `
                    <div class="bg-white p-2 border rounded shadow-sm mb-2">
                        <div class="font-bold text-teal-700 text-sm mb-1">${fType} <span class="text-xs text-gray-500">(${fNames.length} גיחות)</span></div>
                        <div class="flex flex-wrap gap-1">
                            ${fNames.map(n => `<span class="bg-teal-50 text-teal-800 text-[10px] px-2 py-1 rounded border border-teal-200">${n}</span>`).join('')}
                        </div>
                    </div>
                `;
            }
        }

        if (!hasAnyMapping) {
            summaryHtml += '<div class="text-xs text-gray-400 italic">טרם נוצרו שיוכים למערכת.</div>';
        }

        summaryContainer.innerHTML = summaryHtml;
    }
};

window.addFlightNamesToType = async () => {
    const selectedType = document.getElementById('mapping-flight-type-select').value;
    if (!selectedType) return;

    const checkboxes = document.querySelectorAll('.type-mapping-cb:checked');
    let changesMade = false;

    if (!pilotPopulations.flightTypeMapping) pilotPopulations.flightTypeMapping = {};
    if (!pilotPopulations.flightTypeMapping[selectedType]) pilotPopulations.flightTypeMapping[selectedType] = [];

    checkboxes.forEach(cb => {
        if (!pilotPopulations.flightTypeMapping[selectedType].includes(cb.value)) {
            pilotPopulations.flightTypeMapping[selectedType].push(cb.value);
            changesMade = true;
        }
    });

    if (changesMade) {
        document.getElementById('search-flight-type-mapping').value = "";
        window.renderFlightTypeMappingUI();
        await window.savePopulations(true); // מבצע שמירה מסודרת ל-Firestore
    }
};

window.removeFlightNameFromType = async (selectedType, idx) => {
    if (pilotPopulations?.flightTypeMapping?.[selectedType]) {
        pilotPopulations.flightTypeMapping[selectedType].splice(idx, 1);
        window.renderFlightTypeMappingUI();
        await window.savePopulations(true); // שמירה אוטומטית לאחר מחיקה
    }
};

let currentPeriodCoursesCache = null; // מטמון כדי למנוע טעינות מיותרות מול השרת

// פונקציית פתיחה וסגירה של תת-הרשימות (אקורדיון)
window.togglePilotAccordion = (id) => {
    const el = document.getElementById(id);
    const icon = document.getElementById('icon-' + id);
    if (el) {
        if (el.classList.contains('hidden')) {
            el.classList.remove('hidden');
            if (icon) icon.style.transform = 'rotate(180deg)';
        } else {
            el.classList.add('hidden');
            if (icon) icon.style.transform = 'rotate(0deg)';
        }
    }
};

// ==========================================
// פונקציות תמיכה בגרירה ושינוי סדר (Drag & Drop)
// ==========================================
window.draggedItemInfo = null;

window.onDragStartItem = function (e, type, originalIndex) {
    window.draggedItemInfo = { type, index: originalIndex };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", originalIndex);

    // עיצוב אלמנט נגרר כדי שיבלוט
    setTimeout(() => {
        e.target.classList.add('opacity-40', 'bg-blue-50', 'border-blue-300');
    }, 0);
};

window.onDragOverItem = function (e) {
    e.preventDefault(); // חובה לאפשר Drop
    e.dataTransfer.dropEffect = "move";

    const li = e.target.closest('li');
    if (li && window.draggedItemInfo) {
        const dragIndex = window.draggedItemInfo.index;
        const dropIndex = parseInt(li.getAttribute('data-index'));

        li.classList.remove('border-t-2', 'border-b-2', 'border-blue-500');

        if (dragIndex !== dropIndex) {
            const rect = li.getBoundingClientRect();
            const relY = e.clientY - rect.top;
            // חיווי חזותי - פס כחול למעלה או למטה בהתאם למיקום העכבר
            if (relY < rect.height / 2) {
                li.classList.add('border-t-2', 'border-blue-500');
            } else {
                li.classList.add('border-b-2', 'border-blue-500');
            }
        }
    }
};

window.onDragLeaveItem = function (e) {
    const li = e.target.closest('li');
    if (li) li.classList.remove('border-t-2', 'border-b-2', 'border-blue-500');
};

window.onDropItem = async function (e, type, dropIndex) {
    e.preventDefault();
    const li = e.target.closest('li');
    if (li) li.classList.remove('border-t-2', 'border-b-2', 'border-blue-500');

    if (!window.draggedItemInfo || window.draggedItemInfo.type !== type) return;

    const dragIndex = window.draggedItemInfo.index;
    if (dragIndex === dropIndex) return;

    // חישוב מיקום מדויק לזריקת האלמנט
    let finalDropIndex = dropIndex;
    if (li) {
        const rect = li.getBoundingClientRect();
        const relY = e.clientY - rect.top;
        if (relY >= rect.height / 2) {
            finalDropIndex++; // זריקה מתחת לאלמנט
        }
    }

    if (dragIndex < finalDropIndex) {
        finalDropIndex--; // תיקון אינדקס אם גוררים למטה
    }

    // שינוי המיקום במערך הרשמי
    const list = personnelLists[type];
    const [movedItem] = list.splice(dragIndex, 1);
    list.splice(finalDropIndex, 0, movedItem);

    window.draggedItemInfo = null;

    // רינדור מחדש ושמירה מיידית ב-Firestore
    window.renderList(type);
    await window.savePersonnelLists(true);
};

window.onDragEndItem = function (e) {
    e.target.classList.remove('opacity-40', 'bg-blue-50', 'border-blue-300');
    document.querySelectorAll('li').forEach(el => el.classList.remove('border-t-2', 'border-b-2', 'border-blue-500'));
    window.draggedItemInfo = null;
};

// ==========================================
// פונקציית הרינדור המעודכנת
// ==========================================
window.renderList = async function (type) {
    if (type === 'pilots') {
        await renderPilotsWithAccordion();
        return;
    }

    const listContainer = document.getElementById(`list-${type}`);
    const searchInput = document.getElementById(`search-input-${type}`);
    if (!listContainer) return;

    const rawSearchTerm = searchInput ? searchInput.value.toLowerCase() : "";
    const cleanString = (str) => typeof str === 'string' ? str.replace(/['"״׳]/g, '').trim() : '';
    const searchTerm = cleanString(rawSearchTerm);

    const items = personnelLists[type] || [];
    const filtered = items.filter(item => cleanString(item.toLowerCase()).includes(searchTerm));

    listContainer.innerHTML = '';

    // הזרקת כפתור מיון אלפבתי אם עדיין לא קיים (מאפשר למיין כפתור מתי שרוצים)
    if (!document.getElementById(`sort-btn-${type}`)) {
        const headerDiv = listContainer.parentElement;
        if (headerDiv) {
            const sortBtn = document.createElement('button');
            sortBtn.id = `sort-btn-${type}`;
            sortBtn.className = "w-full text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 p-1 mb-2 rounded border border-gray-200 transition font-medium flex justify-center items-center gap-1";
            sortBtn.innerHTML = '<span>מיין לפי א-ב</span> <span class="text-[10px]">⬇️</span>';
            sortBtn.onclick = async () => {
                if (confirm("האם למיין את הרשימה מחדש לפי סדר אלפבתי? סדר ידני קודם יידרס.")) {
                    personnelLists[type].sort();
                    window.renderList(type);
                    await window.savePersonnelLists(true);
                }
            };
            listContainer.parentNode.insertBefore(sortBtn, listContainer);
        }
    }

    if (filtered.length === 0) {
        listContainer.innerHTML = `<li class="text-gray-400 text-sm italic text-center py-2">אין ערכים.</li>`;
        return;
    }

    filtered.forEach((item) => {
        const li = document.createElement('li');
        const originalIndex = items.indexOf(item);

        // הוספת תמיכה בגרירה ל-CSS ולאלמנט
        li.className = "flex justify-between items-center bg-gray-50 p-2 rounded hover:bg-gray-100 border border-gray-200 cursor-grab transition-all duration-150";
        li.setAttribute('draggable', 'true');
        li.setAttribute('data-index', originalIndex);

        // צימוד אירועי גרירה
        li.ondragstart = (e) => window.onDragStartItem(e, type, originalIndex);
        li.ondragover = (e) => window.onDragOverItem(e);
        li.ondragleave = (e) => window.onDragLeaveItem(e);
        li.ondrop = (e) => window.onDropItem(e, type, originalIndex);
        li.ondragend = (e) => window.onDragEndItem(e);

        const safeTitle = item.replace(/"/g, '&quot;');

        // pointer-events-none בתוכן הפנימי מונע קפיצות ו"רעידות" בזמן גרירה מעל הטקסט
        li.innerHTML = `
            <div class="flex items-center flex-grow overflow-hidden pointer-events-none">
                <span class="text-gray-400 mr-2 ml-2 text-lg">≡</span>
                <span class="font-medium text-gray-800 truncate" title="${safeTitle}">${item}</span>
            </div>
            <div class="flex gap-1 shrink-0 z-10">
                <button onclick="window.editPerson('${type}', ${originalIndex})" class="text-blue-500 hover:bg-blue-100 rounded p-1">✏️</button>
                <button onclick="window.removePerson('${type}', ${originalIndex})" class="text-red-500 hover:bg-red-100 rounded p-1">🗑️</button>
            </div>`;
        listContainer.appendChild(li);
    });
};

// יצירת האקורדיונים של הקורסים
async function renderPilotsWithAccordion() {
    const listContainer = document.getElementById('list-pilots');
    const headersContainer = document.getElementById('pilots-tabs-headers');

    if (!listContainer) return;
    if (headersContainer) headersContainer.innerHTML = ''; // מוחקים את אזור הטאבים הישן

    // משיכת הקורסים של התקופה הנוכחית
    if (!currentPeriodCoursesCache && window.firestoreFunctions && window.db) {
        const currentPeriodName = window.getPeriodName(new Date());
        const safePeriodName = currentPeriodName.replace(/\//g, '-');
        try {
            const { doc, getDoc } = window.firestoreFunctions;
            const popSnap = await getDoc(doc(window.db, "populations_by_period", safePeriodName));
            if (popSnap.exists()) {
                currentPeriodCoursesCache = popSnap.data().courses || [];
            } else {
                currentPeriodCoursesCache = [];
            }
        } catch (e) { console.error(e); currentPeriodCoursesCache = []; }
    }

    const currentCourses = currentPeriodCoursesCache || [];
    const allPilots = personnelLists.pilots || [];

    // מיפוי החניכים לקורסים
    const courseMapping = {};
    const assignedPilots = new Set();
    currentCourses.forEach(c => {
        courseMapping[c.name] = c.students || [];
        (c.students || []).forEach(s => assignedPilots.add(s));
    });

    const unassignedPilots = allPilots.filter(p => !assignedPilots.has(p)).sort();

    // פונקציית עזר ליצירת קבוצה נשלפת (אקורדיון) ב-HTML
    const renderGroup = (title, pilotsArray, groupId, defaultOpen = false, themeClass = 'bg-gray-100 text-gray-700', inactiveArray = []) => {
        if (!pilotsArray || pilotsArray.length === 0) return '';

        let html = `
        <div class="mb-3 border border-gray-200 rounded-md bg-white shadow-sm overflow-hidden">
            <button onclick="window.togglePilotAccordion('${groupId}')" class="w-full flex justify-between items-center ${themeClass} hover:opacity-90 p-3 font-bold text-sm transition">
                <span class="flex items-center gap-2"><i class="fas fa-users text-opacity-70"></i> ${title} (${pilotsArray.length})</span>
                <i id="icon-${groupId}" class="fas fa-chevron-down transition-transform duration-200" style="transform: ${defaultOpen ? 'rotate(180deg)' : 'rotate(0deg)'}"></i>
            </button>
            <ul id="${groupId}" class="${defaultOpen ? '' : 'hidden'} divide-y divide-gray-100 bg-gray-50 p-1">
        `;

        // הפרדה ומיון: חניכים פעילים קודם (לפי א"ב), ואז מופסקים (לפי א"ב)
        const activePilots = pilotsArray.filter(p => !inactiveArray.includes(p)).sort();
        const inactivePilots = pilotsArray.filter(p => inactiveArray.includes(p)).sort();
        const sortedPilots = [...activePilots, ...inactivePilots];

        sortedPilots.forEach(item => {
            const mainIndex = allPilots.indexOf(item);

            // הגדרת עיצוב טקסט אם החניך מופסק
            const isInactive = inactiveArray.includes(item);
            const textStyle = isInactive ? 'text-gray-400 line-through' : 'text-gray-800';

            html += `
                <li class="flex justify-between items-center p-2 hover:bg-gray-200 transition-colors rounded my-1 border border-transparent hover:border-gray-300">
                    <span class="font-medium ${textStyle} truncate flex-grow ml-2" title="${isInactive ? 'הפסיק השתתפות' : ''}">${item}</span>
                    <div class="flex gap-1 shrink-0">
                        <button onclick="window.editPerson('pilots', ${mainIndex})" class="text-blue-500 hover:bg-blue-100 rounded p-1" title="ערוך שם">✏️</button>
                        <button onclick="window.removePerson('pilots', ${mainIndex})" class="text-red-500 hover:bg-red-100 rounded p-1" title="מחק טייס">🗑️</button>
                    </div>
                </li>
            `;
        });
        html += `</ul></div>`;
        return html;
    };

    let finalHtml = '';

    // 1. רינדור קורסים (צבע כתום בהיר) - סגורים כברירת מחדל כדי לא ליצור עומס
    currentCourses.forEach((c, idx) => {
        const inactiveList = c.inactiveStudents || []; // שליפת רשימת המופסקים של הקורס
        finalHtml += renderGroup(
            `קורס: ${c.name}`,
            courseMapping[c.name],
            `acc-course-${idx}`,
            false,
            'bg-orange-100 text-orange-900 border-b border-orange-200',
            inactiveList
        );
    });

    // 2. רינדור שאר הטייסים (צבע כחול בהיר) - פתוח כברירת מחדל
    finalHtml += renderGroup('טייסים / מדריכים ללא קורס', unassignedPilots, 'acc-unassigned', true, 'bg-blue-50 text-blue-900 border-b border-blue-100');

    listContainer.innerHTML = finalHtml;
}

window.setPilotsTab = (tabId) => {
    currentPilotsTab = tabId;
    window.renderList('pilots');
};


async function renderPilotsWithTabs() {
    const listContainer = document.getElementById('list-pilots');
    const headersContainer = document.getElementById('pilots-tabs-headers');
    if (!listContainer || !headersContainer) return;

    // שליפת הקורסים של התקופה *הנוכחית* בלבד, עם מנגנון מטמון למהירות
    if (!currentPeriodCoursesCache && window.firestoreFunctions && window.db) {
        const currentPeriodName = window.getPeriodName(new Date());
        const safePeriodName = currentPeriodName.replace(/\//g, '-');
        try {
            const { doc, getDoc } = window.firestoreFunctions;
            const popSnap = await getDoc(doc(window.db, "populations_by_period", safePeriodName));
            if (popSnap.exists()) {
                currentPeriodCoursesCache = popSnap.data().courses || [];
            } else {
                currentPeriodCoursesCache = [];
            }
        } catch (e) { console.error(e); currentPeriodCoursesCache = []; }
    }

    const currentCourses = currentPeriodCoursesCache || [];
    const allPilots = personnelLists.pilots || [];

    // בניית מיפוי מי שייך לאן
    const courseMapping = {};
    const assignedPilots = new Set();
    currentCourses.forEach(c => {
        courseMapping[c.name] = c.students || [];
        (c.students || []).forEach(s => assignedPilots.add(s));
    });

    const unassignedPilots = allPilots.filter(p => !assignedPilots.has(p));

    // רינדור הטאבים
    const getBtnClass = (isActive) => isActive
        ? 'bg-ofer-orange text-white font-bold px-2 py-1 rounded-t border-b-2 border-ofer-orange text-[11px]'
        : 'bg-gray-50 text-gray-600 hover:bg-gray-200 px-2 py-1 rounded-t border-b-2 border-transparent transition text-[11px]';

    let tabsHtml = `
        <button onclick="window.setPilotsTab('all')" class="whitespace-nowrap ${getBtnClass(currentPilotsTab === 'all')}">הכל</button>
        <button onclick="window.setPilotsTab('unassigned')" class="whitespace-nowrap ${getBtnClass(currentPilotsTab === 'unassigned')}">ללא קורס</button>
    `;

    currentCourses.forEach(c => {
        tabsHtml += `<button onclick="window.setPilotsTab('${c.name}')" class="whitespace-nowrap ${getBtnClass(currentPilotsTab === c.name)}">${c.name}</button>`;
    });
    headersContainer.innerHTML = tabsHtml;

    // סינון הרשימה לפי הטאב הנבחר
    let listToShow = [];
    if (currentPilotsTab === 'all') listToShow = allPilots;
    else if (currentPilotsTab === 'unassigned') listToShow = unassignedPilots;
    else listToShow = courseMapping[currentPilotsTab] || [];

    listToShow.sort();

    listContainer.innerHTML = '';
    if (listToShow.length === 0) {
        listContainer.innerHTML = `<li class="text-gray-400 text-sm italic text-center py-4">אין טייסים בקטגוריה זו</li>`;
        return;
    }

    listToShow.forEach(item => {
        const li = document.createElement('li');
        li.className = "flex justify-between items-center bg-gray-50 p-2 rounded hover:bg-gray-100 border border-gray-200";
        const safeItem = item.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        // מחפשים את האינדקס במערך המקורי תמיד כדי שהמחיקה והעריכה יעבדו כרגיל
        const mainIndex = allPilots.indexOf(item);

        li.innerHTML = `
            <span class="font-medium text-gray-800 truncate flex-grow ml-2">${item}</span>
            <div class="flex gap-1 shrink-0">
                <button onclick="window.editPerson('pilots', ${mainIndex})" class="text-blue-500 p-1">✏️</button>
                <button onclick="window.removePerson('pilots', ${mainIndex})" class="text-red-500 p-1">🗑️</button>
            </div>`;
        listContainer.appendChild(li);
    });
}

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

    typeSelect.innerHTML = '<option value="">בחר סוג...</option>' + types.map(t => `<option value="${t.replace(/"/g, '&quot;')}">${t}</option>`).join('');
    nameSelect.innerHTML = '<option value="">בחר שם...</option>' + names.map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n}</option>`).join('');
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
        // 🔴 התיקון: שימוש ב-merge כדי לא לדרוס בטעות יעדים או מערכות
        await setDoc(doc(window.db, "settings", "advanced_config"), {
            metricConfigurations: window.metricConfigurations
        }, { merge: true });

        showToast("הגדרות המדדים נשמרו בהצלחה!", "green");

        // ניקוי הטופס לאחר שמירה
        document.getElementById('metrics-editor-container').innerHTML = '';
        document.getElementById('metric-config-name').value = '';

        // 🔴 התיקון: רינדור הטבלה כדי שהמדד החדש יופיע מיד על המסך
        renderMetricsConfigTable();

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

        // 🔴 התיקון: שמירה בטוחה עם merge
        const { doc, setDoc } = window.firestoreFunctions;
        await setDoc(doc(window.db, "settings", "advanced_config"), {
            metricConfigurations: window.metricConfigurations
        }, { merge: true });

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

// פונקציה לשמירת/עדכון שורה של תקופה כולל תאריך ההתחלה שלה
// שמירת התקופה (כולל נתוני חניכים, מזער ויעד)
window.savePeriodConfigRow = async () => {
    const name = document.getElementById('admin-new-period-name').value.trim();
    const start = document.getElementById('admin-new-period-start').value;
    const end = document.getElementById('admin-new-period-end').value; 
    
    // קריאת נתוני החניכים (חדש)
    const nakaStudents = parseInt(document.getElementById('admin-new-period-naka-students')?.value) || 85;
    const targetStudents = parseInt(document.getElementById('admin-new-period-target-students')?.value) || 0;
    
    // קריאת נתוני מזער ויעד כלליים (נשארים עבור עמוד הפרופילים)
    const min = parseInt(document.getElementById('admin-new-period-min')?.value) || 0;
    const target = parseInt(document.getElementById('admin-new-period-target')?.value) || 0;

    if (!name || !start) {
        alert("חובה להזין לפחות שם תקופה ותאריך תחילת תקופה תקינים.");
        return;
    }

    if (!window.planningSettings) window.planningSettings = {};
    if (!window.planningSettings.periodConfigs) window.planningSettings.periodConfigs = {};

    window.planningSettings.periodConfigs[name] = {
        startDate: start,
        endDate: end || null, 
        nakaStudents: nakaStudents, // נק"ע חניכים
        targetStudents: targetStudents, // יעד חניכים
        minFlights: min, // מזער כללי לתאימות
        targetFlights: target, // יעד כללי לתאימות
        min: min, // לתאימות לאחור
        target: target // לתאימות לאחור
    };

    if (window.firestoreFunctions && window.db) {
        const { doc, setDoc } = window.firestoreFunctions;
        try {
            await setDoc(doc(window.db, "settings", "planning"), window.planningSettings);
            import('../components/modals.js').then(m => m.showToast(`הגדרות תקופה ${name} נשמרו בהצלחה!`, "green"));
            window.closePeriodForm();
            window.renderPlanningSettings();
        } catch (e) {
            console.error(e);
        }
    }
};

window.editPeriodConfigRow = (pKey) => {
    const configs = window.planningSettings?.periodConfigs || {};
    const config = configs[pKey];
    if (!config) return;

    window.openNewPeriodForm();
    document.getElementById('period-form-title').textContent = `עריכת תקופה: ${pKey}`;

    document.getElementById('admin-new-period-name').value = pKey;
    document.getElementById('admin-new-period-name').setAttribute('readonly', 'true');
    document.getElementById('admin-new-period-name').classList.add('bg-gray-100');

    document.getElementById('admin-new-period-start').value = config.startDate || '';
    document.getElementById('admin-new-period-end').value = config.endDate || '';
    
    if(document.getElementById('admin-new-period-naka-students')) {
        document.getElementById('admin-new-period-naka-students').value = config.nakaStudents !== undefined ? config.nakaStudents : 85;
    }
    if(document.getElementById('admin-new-period-target-students')) {
        document.getElementById('admin-new-period-target-students').value = config.targetStudents !== undefined ? config.targetStudents : 0;
    }
    if(document.getElementById('admin-new-period-min')) {
        document.getElementById('admin-new-period-min').value = config.minFlights !== undefined ? config.minFlights : (config.min || 0);
    }
    if(document.getElementById('admin-new-period-target')) {
        document.getElementById('admin-new-period-target').value = config.targetFlights !== undefined ? config.targetFlights : (config.target || 0);
    }

    document.getElementById('period-form-container').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

window.clearPeriodForm = () => {
    document.getElementById('period-form-title').textContent = 'הגדרת תקופה חדשה';
    document.getElementById('admin-new-period-name').value = '';
    document.getElementById('admin-new-period-name').removeAttribute('readonly');
    document.getElementById('admin-new-period-name').classList.remove('bg-gray-100');
    document.getElementById('admin-new-period-start').value = '';
    document.getElementById('admin-new-period-end').value = '';
    
    if(document.getElementById('admin-new-period-naka-students')) document.getElementById('admin-new-period-naka-students').value = '85';
    if(document.getElementById('admin-new-period-target-students')) document.getElementById('admin-new-period-target-students').value = '';
    if(document.getElementById('admin-new-period-min')) document.getElementById('admin-new-period-min').value = '';
    if(document.getElementById('admin-new-period-target')) document.getElementById('admin-new-period-target').value = '';
};


// מחיקת קונפיגורציית תקופה מהמערכת
window.deletePeriodConfigRow = async (pKey) => {
    if (!confirm(`האם אתה בטוח שברצונך למחוק את הגדרות תקופה ${pKey}?\n* הגיחות השייכות לתקופה זו יחזרו להיות מחושבות לפי ברירת המחדל האוטומטית.`)) return;

    if (window.planningSettings?.periodConfigs && window.planningSettings.periodConfigs[pKey]) {
        delete window.planningSettings.periodConfigs[pKey];

        if (window.firestoreFunctions && window.db) {
            const { doc, setDoc } = window.firestoreFunctions;
            try {
                await setDoc(doc(window.db, "settings", "planning"), window.planningSettings);
                import('../components/modals.js').then(m => m.showToast(`תקופה ${pKey} נמחקה מהמערכת`, "green"));
                window.clearPeriodForm();
                window.renderPlanningSettings();
            } catch (e) {
                console.error("Error deleting period:", e);
            }
        }
    }
};

// תמיכה בפתיחת וסגירת טופס התקופות
window.openNewPeriodForm = () => {
    if(window.clearPeriodForm) window.clearPeriodForm();
    document.getElementById('period-form-container').classList.remove('hidden');
    document.getElementById('admin-new-period-name').focus();
};

window.closePeriodForm = () => {
    document.getElementById('period-form-container').classList.add('hidden');
};

// רינדור הטבלה והבאנר של התקופה הנוכחית
export function renderAllPeriodsTable() {
    const tbody = document.getElementById('admin-periods-table-body');
    const banner = document.getElementById('current-period-banner');
    if (!tbody || !banner) return;

    tbody.innerHTML = '';
    banner.innerHTML = '';

    const configs = window.planningSettings?.periodConfigs || {};
    const sortedPeriods = Object.keys(configs).sort((a, b) => {
        const [pA, yA] = a.split('/').map(Number);
        const [pB, yB] = b.split('/').map(Number);
        return (yB + pB / 10) - (yA + pA / 10); // הכי חדש ראשון
    });

    if (sortedPeriods.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-400 italic">אין תקופות מוגדרות במערכת.</td></tr>`;
        banner.innerHTML = `<div class="text-gray-600 font-bold">לא מוגדרות תקופות. המערכת פועלת על פי תאריכים אוטומטיים.</div>`;
        return;
    }

    // זיהוי התקופה הנוכחית האמיתית (לפי תאריך של היום)
    const currentPeriodName = window.getPeriodName(new Date());

    // רינדור הבאנר לתקופה הנוכחית
    if (configs[currentPeriodName]) {
        const cp = configs[currentPeriodName];
        const sDate = cp.startDate ? new Date(cp.startDate).toLocaleDateString('he-IL') : 'לא מוגדר';
        const eDate = cp.endDate ? new Date(cp.endDate).toLocaleDateString('he-IL') : 'פתוח';
        banner.innerHTML = `
            <div>
                <span class="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded mb-2 inline-block">התקופה הנוכחית הפעילה</span>
                <h2 class="text-2xl font-black text-blue-900">${currentPeriodName}</h2>
                <p class="text-sm text-blue-700 font-medium mt-1">תאריכים: ${sDate} עד ${eDate}</p>
            </div>
            <div class="flex gap-6 text-center">
                <div class="bg-white p-3 rounded-md shadow-sm border border-blue-100 min-w-[80px]">
                    <div class="text-xl font-bold text-gray-800">${cp.targetFlights || cp.target || 0}</div>
                    <div class="text-xs text-gray-500 font-medium">יעד</div>
                </div>
                <div class="bg-white p-3 rounded-md shadow-sm border border-blue-100 min-w-[80px]">
                    <div class="text-xl font-bold text-gray-800">${cp.minFlights || cp.min || 0}</div>
                    <div class="text-xs text-gray-500 font-medium">מזער</div>
                </div>
            </div>
            <div>
                <button onclick="window.editPeriodConfigRow('${currentPeriodName}')" class="bg-blue-100 hover:bg-blue-200 text-blue-700 font-bold py-2 px-6 rounded border border-blue-300 transition">
                    <i class="fas fa-edit ml-1"></i> ערוך תקופה נוכחית
                </button>
            </div>
        `;
    }

    // רינדור טבלת היסטוריה (כל התקופות)
    sortedPeriods.forEach(pKey => {
        const config = configs[pKey];
        const formattedStart = config.startDate ? new Date(config.startDate).toLocaleDateString('he-IL') : 'לא הוגדר';
        const formattedEnd = config.endDate ? new Date(config.endDate).toLocaleDateString('he-IL') : '---';
        const naka = config.nakaValue !== undefined ? config.nakaValue : (config.naka || 85);
        const minFlights = config.minFlights !== undefined ? config.minFlights : (config.min || 0);
        const targetFlights = config.targetFlights !== undefined ? config.targetFlights : (config.target || 0);

        const isCurrent = (pKey === currentPeriodName);
        const rowClass = isCurrent ? "bg-blue-50/50" : "hover:bg-gray-50 transition-colors";

        const tr = document.createElement('tr');
        tr.className = rowClass;
        tr.innerHTML = `
            <td class="px-4 py-3 font-bold text-gray-900">${pKey} ${isCurrent ? '<span class="text-blue-500 text-xs mr-2">(נוכחית)</span>' : ''}</td>
            <td class="px-4 py-3 text-gray-600">${formattedStart} <i class="fas fa-arrow-left text-xs text-gray-400 mx-1"></i> ${formattedEnd}</td>
            <td class="px-4 py-3 text-gray-600">${naka}%</td>
            <td class="px-4 py-3 text-gray-600">${minFlights} / ${targetFlights}</td>
            <td class="px-4 py-3 whitespace-nowrap">
                <button onclick="window.editPeriodConfigRow('${pKey}')" class="text-blue-600 hover:text-blue-900 font-medium ml-3 transition">ערוך</button>
                <button onclick="window.deletePeriodConfigRow('${pKey}')" class="text-red-600 hover:text-red-900 font-medium transition">מחק</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// שיפור פונקציית הזיהוי כך שתתחשב בתאריך סיום (אם הוזן)
window.getPeriodName = (dateInput) => {
    if (!dateInput) return "";
    const d = new Date(dateInput);
    const checkTime = d.getTime();
    const plan = window.planningSettings;

    if (plan && plan.periodConfigs) {
        const definedPeriods = Object.keys(plan.periodConfigs)
            .map(pKey => ({
                name: pKey,
                startTime: plan.periodConfigs[pKey].startDate ? new Date(plan.periodConfigs[pKey].startDate).setHours(0, 0, 0, 0) : null,
                endTime: plan.periodConfigs[pKey].endDate ? new Date(plan.periodConfigs[pKey].endDate).setHours(23, 59, 59, 999) : null
            }))
            .filter(p => p.startTime !== null)
            .sort((a, b) => b.startTime - a.startTime); // מהחדש לישן

        for (let p of definedPeriods) {
            // אם לתקופה יש תאריך סיום - נוודא שהגיחה נופלת בדיוק בטווח
            if (p.endTime) {
                if (checkTime >= p.startTime && checkTime <= p.endTime) return p.name;
            } else {
                // אם אין תאריך סיום, מספיק שהגיחה אחרי תאריך ההתחלה
                if (checkTime >= p.startTime) return p.name;
            }
        }
    }

    // Fallback: אמצע חודש יוני / דצמבר
    let year = d.getFullYear();
    const month = d.getMonth();
    const day = d.getDate();
    let periodNum = "1";

    if (month === 5) periodNum = day < 15 ? "1" : "2";
    else if (month === 11) {
        if (day >= 15) { periodNum = "1"; year++; }
        else { periodNum = "2"; }
    }
    else if (month > 5 && month < 11) periodNum = "2";
    else periodNum = "1";

    return `${periodNum}/${year.toString().slice(-2)}`;
};

// פונקציית רענון מאוחדת לטאב התכנון
window.renderPlanningSettings = () => {
    if (typeof renderAllPeriodsTable === 'function') {
        renderAllPeriodsTable();
    }
    if (typeof renderPlanningCalendar === 'function') {
        renderPlanningCalendar();
    }
};

window.toggleStudentStatus = (cIdx, studentName) => {
    if (!pilotPopulations.courses[cIdx].inactiveStudents) {
        pilotPopulations.courses[cIdx].inactiveStudents = [];
    }
    const inactiveList = pilotPopulations.courses[cIdx].inactiveStudents;
    const idx = inactiveList.indexOf(studentName);

    if (idx === -1) {
        if (confirm(`האם להפסיק פעילות של ${studentName} בקורס?\n* הוא ייצבע באפור ולא יופיע יותר בטבלת המעקב המרכזית.`)) {
            inactiveList.push(studentName);
        }
    } else {
        inactiveList.splice(idx, 1);
    }

    window.renderPopulations();
    window.savePopulations(true);
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
window.renderPlanningSettings = window.renderPlanningSettings;
window.savePeriodConfigRow = window.savePeriodConfigRow;
window.clearPeriodForm = window.clearPeriodForm;
window.editPeriodConfigRow = window.editPeriodConfigRow;
window.deletePeriodConfigRow = window.deletePeriodConfigRow;
window.openNewPeriodForm = window.openNewPeriodForm;
window.closePeriodForm = window.closePeriodForm;
window.addFlightNamesToType = window.addFlightNamesToType;
window.removeFlightNameFromType = window.removeFlightNameFromType;
window.renderFlightTypeMappingUI = window.renderFlightTypeMappingUI;
window.renderPopulations = window.renderPopulations;
window.getPeriodName = getPeriodName;
