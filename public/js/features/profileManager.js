// public/js/features/profileManager.js

import { personnelLists, loadGoalsAndSystems, loadPersonnelLists } from './adminManager.js';
import { fetchFlights } from '../core/global.js';

let profileChart = null;
let currentPilotFlights = [];

window.profileManager = window.profileManager || {};

/**
 * מעבר בין תצוגת פרופיל אישי למטריצה קבוצתית
 */
window.profileManager.switchMainTab = function (tab) {
    const individualView = document.getElementById('individual-view');
    const groupView = document.getElementById('group-view');
    const tabIndividual = document.getElementById('tab-profile-individual');
    const tabGroup = document.getElementById('tab-profile-group');

    if (tab === 'individual') {
        if (individualView) individualView.classList.remove('hidden');
        if (groupView) groupView.classList.add('hidden');
        if (tabIndividual) tabIndividual.className = 'border-ofer-orange text-ofer-orange py-4 px-1 border-b-2 font-medium text-lg';
        if (tabGroup) tabGroup.className = 'border-transparent text-gray-500 hover:text-gray-700 py-4 px-1 border-b-2 font-medium text-lg';
    } else {
        if (individualView) individualView.classList.add('hidden');
        if (groupView) groupView.classList.remove('hidden');
        if (tabGroup) tabGroup.className = 'border-ofer-orange text-ofer-orange py-4 px-1 border-b-2 font-medium text-lg';
        if (tabIndividual) tabIndividual.className = 'border-transparent text-gray-500 hover:text-gray-700 py-4 px-1 border-b-2 font-medium text-lg';

        // אתחול המטריצה
        this.initMatrixFilters();
    }
};

/**
 * אתחול הפילטרים למטריצה הקבוצתית - כולל עדכון דינמי
 */
window.profileManager.initMatrixFilters = async function () {
    try {
        const typeSelect = document.getElementById('matrix-pop-type');
        const subPopSelect = document.getElementById('matrix-sub-pop');
        if (!typeSelect || !subPopSelect) return;

        // הוספת מאזינים לעדכון אוטומטי (רק אם לא קיימים)
        if (!typeSelect.dataset.listenerAttached) {
            typeSelect.addEventListener('change', () => this.initMatrixFilters());
            subPopSelect.addEventListener('change', () => this.updateMatrix());
            typeSelect.dataset.listenerAttached = "true";
        }

        // טעינת נתונים אם חסר
        const hasPopData = window.pilotPopulations &&
            ((window.pilotPopulations.instructorGroups?.length > 0) ||
                (window.pilotPopulations.courses?.length > 0));

        if (!hasPopData && window.firestoreFunctions) {
            const { doc, getDoc } = window.firestoreFunctions;
            const popRef = doc(window.db, "settings", "populations");
            const popSnap = await getDoc(popRef);
            if (popSnap.exists()) {
                window.pilotPopulations = popSnap.data();
            }
        }

        const type = typeSelect.value;
        const populations = window.pilotPopulations || { instructorGroups: [], courses: [] };

        // בחירת הרשימה הנכונה לפי הסוג הנבחר
        let list = [];
        if (type === 'instructors') {
            list = populations.instructorGroups || [];
        } else if (type === 'conversion') {
            list = populations.conversionGroups || []; // הנחה: הנתונים יושבים תחת conversionGroups
        } else {
            list = populations.courses || [];
        }

        let optionsHtml = '<option value="ALL">כל תתי האוכלוסיות</option>';
        optionsHtml += list.map(item => `<option value="${item.name.trim()}">${item.name}</option>`).join('');

        subPopSelect.innerHTML = optionsHtml;

        // עדכון הטבלה עצמה
        this.updateMatrix();
    } catch (error) {
        console.error("Error initializing matrix filters:", error);
    }
};

window.profileManager.refreshLessons = () => {
    const pilotName = document.getElementById('profile-pilot-search').value;
    const filterType = document.getElementById('profile-lessons-type-select').value;

    // עדכון הלקחים
    updateLessonsListUI(pilotName);

    // עדכון הטבלה לפי הסינון
    const filtered = currentPilotFlights.filter(f => filterType === 'all' || f.data['סוג גיחה'] === filterType);
    renderPilotFlightsTable(filtered);
};

window.profileManager.refreshChart = () => {
    const pilotName = document.getElementById('profile-pilot-search').value;
    updateProfileChart(pilotName);
};

/**
 * עדכון המטריצה הקבוצתית
 */
window.profileManager.updateMatrix = function () {
    const typeSelect = document.getElementById('matrix-pop-type');
    const subPopSelect = document.getElementById('matrix-sub-pop');
    const periodSelect = document.getElementById('matrix-period');
    const thead = document.getElementById('matrix-head');
    const tbody = document.getElementById('matrix-body');
    const insFlightTypeContainer = document.getElementById('instructor-flight-type-container');

    // בדיקת קיום אלמנטים ונתוני בסיס
    if (!typeSelect || !periodSelect?.value || !window.pilotPopulations) return;

    const plan = window.planningSettings || {};
    const selectedPeriodName = periodSelect.value;
    const periodConfig = plan.periodConfigs ? plan.periodConfigs[selectedPeriodName] : { min: 0, target: 0 };

    // סינון הגיחות: עכשיו משתמש בפונקציה החכמה שבודקת מול הגדרות המנהל
    const allFlights = window.savedFlights || [];
    const filteredFlights = allFlights.filter(f => {
        const periodOfFlight = getFlightPeriodName(f.date, plan).trim();
        const isSamePeriod = periodOfFlight === selectedPeriodName.trim();
        const isNotCancelled = f.executionStatus !== 'בוטלה';
        return isSamePeriod && isNotCancelled;
    });
    const type = typeSelect.value;
    const insFlightType = document.querySelector('input[name="ins-flight-type"]:checked')?.value;

    // הצגת/הסתרת בורר סוג הגיחה למדריכים
    if (insFlightTypeContainer) {
        type === 'instructors' ? insFlightTypeContainer.classList.remove('hidden') : insFlightTypeContainer.classList.add('hidden');
    }

    const subPopName = subPopSelect.value.trim().replace(/["']/g, '"');
    const populations = window.pilotPopulations;

    // קביעת רשימת הגיחות הרלוונטיות לתצוגה לפי סוג האוכלוסייה
    let relevantFlights = [];
    if (type === 'instructors') {
        relevantFlights = insFlightType === 'instructor' ? (populations.flightMapping?.instructors || []) : (populations.flightMapping?.students || []);
    } else if (type === 'conversion') {
        relevantFlights = populations.flightMapping?.conversion || [];
    } else {
        relevantFlights = populations.flightMapping?.students || [];
    }

    // קביעת רשימת הטייסים הרלוונטיים לפי תת-אוכלוסייה
    let groups = [];
    if (type === 'instructors') groups = populations.instructorGroups || [];
    else if (type === 'conversion') groups = populations.conversionGroups || [];
    else groups = populations.courses || [];

    let relevantPilots = [];
    if (subPopName === "ALL") {
        groups.forEach(g => relevantPilots.push(...(type === 'instructors' ? (g.members || []) : (g.students || []))));
        relevantPilots = [...new Set(relevantPilots)];
    } else {
        const group = groups.find(g => g.name.trim().replace(/["']/g, '"') === subPopName);
        if (group) relevantPilots = type === 'instructors' ? (group.members || []) : (group.students || []);
    }

    // הגדרת תצוגת מכסות (רק למדריכים בגיחות הדרכה)
    const showQuotas = type === 'instructors' && insFlightType === 'instructor';
    const quotas = {
        min: parseInt(periodConfig.min) || 0,
        target: parseInt(periodConfig.target) || 0
    };

    // בניית כותרת הטבלה (Thead)
    thead.innerHTML = `
    <tr class="bg-gray-100">
        <th class="p-2 border font-bold text-right sticky right-0 z-10 bg-gray-100 min-w-[120px]">שם הטייס</th>
        <th class="p-2 border font-bold text-right min-w-[100px]">אוכלוסייה</th>
        <th class="border p-0 text-xs h-32 w-12 min-w-[48px] text-center align-bottom">
            <div class="vertical-header inline-block">בונוס</div>
        </th>
        ${showQuotas ? `
        <th class="border p-0 text-xs h-32 w-12 min-w-[48px] text-center align-bottom bg-blue-50">
            <div class="vertical-header inline-block font-bold text-blue-800">מזער</div>
        </th>
        <th class="border p-0 text-xs h-32 w-12 min-w-[48px] text-center align-bottom bg-blue-50">
            <div class="vertical-header inline-block font-bold text-blue-800">יעד</div>
        </th>` : ''}
        ${relevantFlights.map(f => `
            <th class="border p-0 text-xs h-32 w-12 min-w-[48px] text-center align-bottom">
                <div class="vertical-header inline-block">${f}</div>
            </th>
        `).join('')}
    </tr>
    `;

    // בניית גוף הטבלה (Tbody)
    tbody.innerHTML = relevantPilots.map(pilot => {
        const cleanPilot = pilot.trim();
        const subPop = groups.find(g => (g.students || g.members || []).some(m => m.trim() === cleanPilot))?.name || "-";

        // חישוב כמות גיחות "בונוס" לתקופה הנבחרת
        const bonusCount = filteredFlights.filter(f => {
            const d = f.data || {};
            const names = [d['טייס ימין'], d['טייס שמאל'], d['מדריך'], d['מדריכה']].map(n => n?.toString().trim());
            return names.includes(cleanPilot) && (d['שם גיחה'] || '').includes('בונוס');
        }).length;

        let totalForQuotas = 0;
        const cells = relevantFlights.map(flightName => {
            const count = filteredFlights.filter(f => {
                const d = f.data || {};
                const pilots = [d['טייס ימין'], d['טייס שמאל'], d['מדריך'], d['מדריכה']].map(n => n?.toString().trim());
                return pilots.includes(cleanPilot) && (d['שם גיחה'] || '').trim() === flightName.trim();
            }).length;

            totalForQuotas += count;
            const didFly = count > 0;
            // הצגת המספר על הרקע הירוק רק אם בוצע יותר מסיבוב אחד
            return `<td class="border p-0 w-12 min-w-[48px] text-center align-middle ${didFly ? 'bg-green-500' : 'bg-red-500'}">
                        ${count > 1 ? `<span class="text-white font-bold text-sm">${count}</span>` : ''}
                    </td>`;
        }).join('');

        // בניית תאי המכסות (במידה ורלוונטי)
        let quotasHtml = '';
        if (showQuotas) {
            quotasHtml = `
                <td class="border p-0 w-12 min-w-[48px] text-center align-middle ${totalForQuotas >= quotas.min ? 'bg-green-500' : 'bg-red-500'}">
                    <span class="text-white font-bold text-xs">${totalForQuotas}/${quotas.min}</span>
                </td>
                <td class="border p-0 w-12 min-w-[48px] text-center align-middle ${totalForQuotas >= quotas.target ? 'bg-green-500' : 'bg-red-500'}">
                    <span class="text-white font-bold text-xs">${totalForQuotas}/${quotas.target}</span>
                </td>
            `;
        }

        return `<tr>
            <td class="border p-2 font-bold sticky right-0 z-10 bg-white">${pilot}</td>
            <td class="border p-2 text-gray-600 text-sm">${subPop}</td>
            <td class="border p-2 text-center font-bold text-blue-600 text-sm bg-gray-50">${bonusCount}</td>
            ${quotasHtml}${cells}
        </tr>`;
    }).join('');
};
/**
 * עדכון פרופיל טייס ספציפי
 */
function updatePilotProfile(pilotName) {
    if (!pilotName) return;

    const flights = (window.savedFlights || []).filter(f => {
        const d = f.data || {};
        const pilots = [d['טייס ימין'], d['טייס שמאל'], d['pilot-right'], d['pilot-left']].map(n => n?.toString().trim());
        return pilots.includes(pilotName.trim());
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    currentPilotFlights = flights;
    populateFlightTypeSelects(flights);

    // עדכון שעות
    const totalMinutes = flights.reduce((sum, f) =>
        (f.executionStatus === 'בוטלה' || f.executionStatus === 'טרם דווחה') ? sum : sum + (parseInt(f.data['שעות טיסה (דקות)']) || 0), 0);
    document.getElementById('profile-total-hours').textContent = formatMinutesToHM(totalMinutes);

    // עדכון רכיבים
    renderPilotFlightsTable(flights); // הצגת כל הגיחות בהתחלה
    updateLessonsListUI(pilotName);
    updateProfileChart(pilotName);

    const lastValid = flights.find(f => f.executionStatus !== 'טרם דווחה' && f.executionStatus !== 'בוטלה') || flights[0];
    updateGoalsListUI(lastValid);
}

function updateGoalsListUI(lastFlight) {
    const goalsList = document.getElementById('profile-last-goals-list');
    if (!goalsList) return;
    if (lastFlight && lastFlight.goalsStatus) {
        goalsList.innerHTML = Object.entries(lastFlight.goalsStatus).map(([id, status]) => {
            const goalName = getGoalName(id, lastFlight);
            const explanation = (status === 'לא עמד.ה') ? `<div class="text-xs text-red-500 italic mt-1">הסבר: ${lastFlight.goalsDetails?.[id] || 'אין פירוט'}</div>` : '';
            return `<li class="mb-3"><strong>• ${goalName}</strong> <span class="text-xs ${status === 'עמד.ה' ? 'text-green-600' : 'text-red-600'}">(${status})</span>${explanation}</li>`;
        }).join('');
    } else { goalsList.innerHTML = '<li class="text-gray-400">אין נתונים</li>'; }
}

function updateLessonsListUI(pilotName) {
    const lessonsList = document.getElementById('profile-last-lessons');
    const filterSelect = document.getElementById('profile-lessons-type-select');
    if (!lessonsList || !pilotName) return;

    const filterType = filterSelect ? filterSelect.value : 'all';
    const cleanSearchName = pilotName.trim();

    // סינון גיחות לפי סוג
    const filteredFlights = currentPilotFlights.filter(f =>
        filterType === 'all' || f.data['סוג גיחה'] === filterType
    );

    const lastLessons = [];

    for (const f of filteredFlights) {
        const d = f.data || {};
        let lesson = '';

        // זיהוי הצד בו טס הטייס כדי לשלוף את הלקח שלו
        const isRight = (d['טייס ימין']?.toString().trim() === cleanSearchName || d['pilot-right']?.toString().trim() === cleanSearchName);
        const isLeft = (d['טייס שמאל']?.toString().trim() === cleanSearchName || d['pilot-left']?.toString().trim() === cleanSearchName);

        if (isRight) {
            lesson = d['לקחי מתאמן - ימין'] || d['lesson-right'];
        } else if (isLeft) {
            lesson = d['לקחי מתאמן - שמאל'] || d['lesson-left'];
        }

        // ניקוי תווים ריקים
        if (lesson && lesson.trim() && !['אין', '-', '---'].includes(lesson.trim())) {
            lastLessons.push({
                text: lesson,
                date: new Date(f.date).toLocaleDateString('he-IL'),
                flightName: d['שם גיחה'] || 'ללא שם'
            });
        }
        if (lastLessons.length === 3) break; // הצגת 3 אחרונים
    }

    if (lastLessons.length === 0) {
        lessonsList.innerHTML = '<li class="text-gray-400 text-center py-4">אין תיעוד לקחים לסוג גיחה זה</li>';
        return;
    }

    lessonsList.innerHTML = lastLessons.map(l => `
        <li class="mb-2 border-b border-gray-50 pb-1 list-none text-right">
            <div class="text-[10px] text-gray-400 font-bold">${l.date} - ${l.flightName}</div>
            <div class="text-gray-700 leading-tight text-sm">${l.text.replace(/\n/g, '<br>')}</div>
        </li>
    `).join('');
}

async function populatePeriodSelector() {
    const periodSelect = document.getElementById('matrix-period');
    if (!periodSelect) return;

    // ניסיון טעינה חוזר אם הנתונים חסרים
    if (!window.planningSettings && window.firestoreFunctions) {
        const { doc, getDoc } = window.firestoreFunctions;
        try {
            const planSnap = await getDoc(doc(window.db, "settings", "planning"));
            if (planSnap.exists()) {
                window.planningSettings = planSnap.data();
            }
        } catch (e) { console.error("Error fetching periods:", e); }
    }

    const configs = window.planningSettings?.periodConfigs || {};
    const periods = Object.keys(configs).sort((a, b) => {
        // מיון חכם לפי שנה ואז תקופה (למשל 2/25 לפני 1/25)
        const [pA, yA] = a.split('/').map(Number);
        const [pB, yB] = b.split('/').map(Number);
        return (yB + pB / 10) - (yA + pA / 10);
    });

    if (periods.length === 0) {
        periodSelect.innerHTML = '<option value="">אין תקופות מוגדרות (שמור נתונים במנהל)</option>';
        return;
    }

    periodSelect.innerHTML = periods.map(p => `<option value="${p}">${p}</option>`).join('');

    // בחירת התקופה שמתאימה להיום
    const currentPeriodName = getFlightPeriodName(new Date(), window.planningSettings);
    if (periods.includes(currentPeriodName)) {
        periodSelect.value = currentPeriodName;
    }
}

const originalInitMatrixFilters = window.profileManager.initMatrixFilters;
window.profileManager.initMatrixFilters = async function () {
    await populatePeriodSelector();
    await originalInitMatrixFilters.call(this);
};

function updateProfileChart(pilotName) {
    const chartTypeSelect = document.getElementById('profile-chart-type-select');
    const type = chartTypeSelect?.value || 'all';
    const canvas = document.getElementById('profile-goals-chart');
    if (!canvas) return;

    const filtered = currentPilotFlights.filter(f => type === 'all' || f.data['סוג גיחה'] === type);
    let met = 0, notMet = 0;
    filtered.forEach(f => { if (f.goalsStatus) Object.values(f.goalsStatus).forEach(s => s === 'עמד.ה' ? met++ : notMet++); });

    if (profileChart) profileChart.destroy();
    profileChart = new Chart(canvas.getContext('2d'), {
        type: 'pie',
        data: { labels: ['עמד', 'לא עמד'], datasets: [{ data: [met, notMet], backgroundColor: ['#10B981', '#EF4444'] }] },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function getFlightPeriodName(flightDate, planningSettings) {
    if (!planningSettings) return window.getPeriodName(flightDate);

    const date = new Date(flightDate);
    const result = window.getPeriodName(date);
    // ברירת מחדל אם אין התאמה לתאריכים המוגדרים
    return result || window.getPeriodName(date);
}

function getGoalName(goalKey, flight) {
    if ((goalKey === "יעד 1" || goalKey === "יעד 2") && flight.goalsDetails?.[goalKey]) return flight.goalsDetails[goalKey];
    return goalKey;
}

function formatMinutesToHM(totalMinutes) {
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

function renderPilotFlightsTable(flights) {
    const tableBody = document.getElementById('profile-flights-table');
    if (!tableBody) return;

    if (!flights || flights.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" class="text-center py-4 text-gray-500">אין גיחות לסוג זה</td></tr>';
        return;
    }

    tableBody.innerHTML = flights.map(f => {
        const d = f.data || {};
        const status = f.executionStatus || 'לא ידוע';
        let badgeClass = 'bg-gray-100 text-gray-800';
        if (status === 'בוצעה') badgeClass = 'bg-green-100 text-green-800';
        if (status === 'בוטלה') badgeClass = 'bg-red-100 text-red-800';

        return `
            <tr class="hover:bg-gray-50 cursor-pointer" onclick="window.showFlightDetails('${f.id}')">
                <td class="px-4 py-2">${new Date(f.date).toLocaleDateString('he-IL')}</td>
                <td class="px-4 py-2 font-medium">${d['שם גיחה'] || '---'}</td>
                <td class="px-4 py-2"><span class="px-2 py-1 rounded-full text-[10px] ${badgeClass}">${status}</span></td>
            </tr>
        `;
    }).join('');
}

/**
 * היסטוריית יעדים/לקחים
 */
window.showAllHistory = function (type) {
    const title = type === 'goals' ? 'היסטוריית יעדים' : 'היסטוריית לקחים';
    let metList = [], notMetList = [];

    currentPilotFlights.forEach(f => {
        if (type === 'goals' && f.goalsStatus) {
            Object.entries(f.goalsStatus).forEach(([id, status]) => {
                const goalName = getGoalName(id, f);
                const date = new Date(f.date).toLocaleDateString('he-IL');
                const html = `<div class="p-2 border-b text-sm"><strong>${date}</strong>: ${goalName} <span class="text-xs text-gray-400">(${f.data['שם גיחה']})</span>`;
                if (status === 'לא עמד.ה') {
                    notMetList.push(html + `<div class="text-xs text-red-500 mt-1">סיבה: ${f.goalsDetails?.[id] || 'אין'}</div></div>`);
                } else { metList.push(html + `</div>`); }
            });
        } else if (type === 'lessons') {
            const pilotName = document.getElementById('profile-pilot-search').value;
            const lesson = f.data['טייס ימין'] === pilotName ? f.data['לקחי מתאמן - ימין'] : f.data['לקחי מתאמן - שמאל'];
            if (lesson) metList.push(`<div class="p-2 border-b text-sm"><strong>${new Date(f.date).toLocaleDateString('he-IL')}</strong>: ${lesson}</div>`);
        }
    });

    const modal = document.getElementById('flight-details-modal');
    if (modal) {
        const editBtn = document.getElementById('details-edit-button');
        if (editBtn) editBtn.style.display = 'none';

        document.getElementById('details-modal-title').textContent = title;
        document.getElementById('flight-details-content').innerHTML = `
            <div class="mb-4 border-b flex space-x-8 space-x-reverse">
                <button onclick="window.switchHistoryTab('met')" id="tab-btn-met" class="py-2 px-1 border-b-2 font-medium text-sm">בוצעו (${metList.length})</button>
                ${type === 'goals' ? `<button onclick="window.switchHistoryTab('not-met')" id="tab-btn-not-met" class="py-2 px-1 border-b-2 font-medium text-sm">לא בוצעו (${notMetList.length})</button>` : ''}
            </div>
            <div id="history-content-met" class="max-h-60 overflow-y-auto">${metList.join('') || 'אין נתונים'}</div>
            <div id="history-content-not-met" class="max-h-60 overflow-y-auto hidden">${notMetList.join('')}</div>
        `;
        modal.classList.remove('hidden');
        if (type === 'goals' && notMetList.length > 0) {
            window.switchHistoryTab('not-met');
        } else {
            window.switchHistoryTab('met');
        }
    }
};

window.switchHistoryTab = function (tabType) {
    const met = document.getElementById('history-content-met'), notMet = document.getElementById('history-content-not-met');
    const bMet = document.getElementById('tab-btn-met'), bNotMet = document.getElementById('tab-btn-not-met');
    if (tabType === 'met') {
        met?.classList.remove('hidden'); notMet?.classList.add('hidden');
        if (bMet) bMet.className = 'border-green-500 text-green-600 py-2 px-1 border-b-2 font-medium text-sm';
        if (bNotMet) bNotMet.className = 'border-transparent text-gray-500 py-2 px-1 border-b-2 font-medium text-sm';
    } else {
        met?.classList.add('hidden'); notMet?.classList.remove('hidden');
        if (bMet) bMet.className = 'border-transparent text-gray-500 py-2 px-1 border-b-2 font-medium text-sm';
        if (bNotMet) bNotMet.className = 'border-red-500 text-red-600 py-2 px-1 border-b-2 font-medium text-sm';
    }
};

export async function initProfilePage() {
    const pilotInput = document.getElementById('profile-pilot-search');
    const resultsMenu = document.getElementById('pilot-search-results');
    if (!pilotInput || !resultsMenu) return;

    if (window.savedFlights?.length === 0) await fetchFlights();
    await loadPersonnelLists();

    const allPilots = (personnelLists.pilots || []).sort();
    pilotInput.oninput = (e) => {
        const val = e.target.value;
        const filtered = allPilots.filter(p => p.includes(val));
        resultsMenu.innerHTML = filtered.map(p => `<div class="px-4 py-2 hover:bg-gray-100 cursor-pointer pilot-option" data-value="${p}">${p}</div>`).join('');
        resultsMenu.classList.toggle('hidden', filtered.length === 0);
        if (allPilots.includes(val)) { updatePilotProfile(val); resultsMenu.classList.add('hidden'); }
    };

    resultsMenu.onclick = (e) => {
        const opt = e.target.closest('.pilot-option');
        if (opt) { pilotInput.value = opt.dataset.value; updatePilotProfile(opt.dataset.value); resultsMenu.classList.add('hidden'); }
    };
}

function populateFlightTypeSelects(flights) {
    const types = [...new Set(flights.map(f => f.data['סוג גיחה']).filter(Boolean))];
    const selects = ['profile-chart-type-select', 'profile-lessons-type-select'];

    selects.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        const currentValue = select.value;
        let html = '<option value="all">כל סוגי הגיחות</option>';
        html += types.map(t => `<option value="${t}">${t}</option>`).join('');
        select.innerHTML = html;
        if (currentValue) select.value = currentValue;
    });
}



window.showFlightDetails = (id) => { if (window.showFlightDetailsModal) window.showFlightDetailsModal(id); };