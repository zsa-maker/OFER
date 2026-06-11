// public/js/features/profileManager.js

import { personnelLists, loadGoalsAndSystems, loadPersonnelLists } from './adminManager.js';
import { fetchFlights } from '../core/global.js';
import { showToast } from '../components/modals.js';

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

    const allFlights = window.savedFlights || [];
    const filteredFlights = allFlights.filter(f => {
        const periodOfFlight = getFlightPeriodName(f.date, plan).trim();
        const isSamePeriod = periodOfFlight === selectedPeriodName.trim();
        const isNotCancelled = f.executionStatus !== 'בוטלה';
        return isSamePeriod && isNotCancelled;
    });

    const type = typeSelect.value;
    const insFlightType = document.querySelector('input[name="ins-flight-type"]:checked')?.value;

    if (insFlightTypeContainer) {
        type === 'instructors' ? insFlightTypeContainer.classList.remove('hidden') : insFlightTypeContainer.classList.add('hidden');
    }

    const subPopName = subPopSelect.value.trim().replace(/["']/g, '"');
    const populations = window.pilotPopulations;

    let relevantFlights = [];
    if (type === 'instructors') {
        relevantFlights = insFlightType === 'instructor' ? (populations.flightMapping?.instructors || []) : (populations.flightMapping?.students || []);
    } else if (type === 'conversion') {
        relevantFlights = populations.flightMapping?.conversion || [];
    } else {
        relevantFlights = populations.flightMapping?.students || [];
    }

    let groups = [];
    if (type === 'instructors') groups = populations.instructorGroups || [];
    else if (type === 'conversion') groups = populations.conversionGroups || [];
    else groups = populations.courses || [];

    // תוקן: שליפה חכמה של טייסים שתומכת גם ב-members וגם ב-students לכל סוגי האוכלוסיות
    let relevantPilots = [];
    if (subPopName === "ALL") {
        groups.forEach(g => relevantPilots.push(...(g.members || g.students || [])));
        relevantPilots = [...new Set(relevantPilots)];
    } else {
        const group = groups.find(g => g.name.trim().replace(/["']/g, '"') === subPopName);
        if (group) relevantPilots = group.members || group.students || [];
    }

    const showQuotas = type === 'instructors' && insFlightType === 'instructor';
    const quotas = {
        min: parseInt(periodConfig.min) || 0,
        target: parseInt(periodConfig.target) || 0
    };

    // בניית כותרת הטבלה (Thead) - כל הכותרות הוסבו לאנכיות
    // בניית כותרת הטבלה (Thead) - כל הכותרות באותו גודל בדיוק
    // בניית כותרת הטבלה (Thead) - רוחב מינימלי אחיד, מתרחב רק אם הטקסט דורש זאת
    thead.innerHTML = `
    <tr class="bg-gray-100">
        <th class="border p-0 text-sm h-32 w-12 min-w-[48px] text-center align-bottom sticky right-0 z-10 bg-gray-100 whitespace-nowrap">
            <div class="vertical-header inline-block font-bold">שם הטייס</div>
        </th>
        <th class="border p-0 text-sm h-32 w-12 min-w-[48px] text-center align-bottom whitespace-nowrap">
            <div class="vertical-header inline-block font-bold">אוכלוסייה</div>
        </th>
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
            return `<td class="border p-0 w-12 min-w-[48px] text-center align-middle ${didFly ? 'bg-green-500' : 'bg-red-500'}">
                        ${count > 1 ? `<span class="text-white font-bold text-sm">${count}</span>` : ''}
                    </td>`;
        }).join('');

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

        // שימוש ב- whitespace-nowrap ללא חיתוך הטקסט, מה שיגרום לעמודה להתרחב רק בהתאם לטקסט ארוך
        return `<tr>
            <td class="border p-2 font-bold sticky right-0 z-10 bg-white w-12 min-w-[48px] text-center whitespace-nowrap">${pilot}</td>
            <td class="border p-2 text-gray-600 text-sm w-12 min-w-[48px] text-center whitespace-nowrap">${subPop}</td>
            <td class="border p-2 text-center font-bold text-blue-600 text-sm bg-gray-50 w-12 min-w-[48px]">${bonusCount}</td>
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

// --- לוגיקת דוח מדריכים ---

window.profileManager.openInstructorReportModal = function() {
    const modal = document.getElementById('instructor-report-modal');
    const periodSelect = document.getElementById('instructor-report-period');
    const mainPeriodSelect = document.getElementById('matrix-period');
    
    if (!modal || !periodSelect) return;

    periodSelect.innerHTML = mainPeriodSelect.innerHTML;
    periodSelect.value = mainPeriodSelect.value;
    modal.classList.remove('hidden');
};

window.profileManager.generateInstructorsReport = async function() {
    const periodSelect = document.getElementById('instructor-report-period');
    const selectedPeriodName = periodSelect.value;
    const btn = document.getElementById('btn-generate-instructors-report');
    
    if (!selectedPeriodName) {
        showToast('אנא בחר תקופה', 'red');
        return;
    }

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> מכין קבצים...';

        const populations = window.pilotPopulations || {};
        const instructorGroups = populations.instructorGroups || [];
        
        let allInstructors = new Set();
        instructorGroups.forEach(group => {
            (group.members || group.students || []).forEach(member => allInstructors.add(member.trim()));
        });
        const instructorsList = Array.from(allInstructors);

        if (instructorsList.length === 0) {
            showToast('לא נמצאו מדריכים מוגדרים במערכת.', 'red');
            return;
        }

        const plan = window.planningSettings || {};
        const allFlights = window.savedFlights || [];
        
        // סינון: כל הגיחות למעט אלו שבוטלו (כולל גיחות חלקיות וטרם דווחו)
        const periodFlights = allFlights.filter(f => {
            const periodOfFlight = getFlightPeriodName(f.date, plan).trim(); 
            const isSamePeriod = periodOfFlight === selectedPeriodName.trim();
            const isCancelled = f.executionStatus === 'בוטלה' || !!(f.data && f.data['סיבת ביטול']);
            
            return isSamePeriod && !isCancelled;
        });

        const reportsData = instructorsList.map(instructorName => {
            return collectDataForInstructor(instructorName, periodFlights, selectedPeriodName);
        });

        const hasCreatedFiles = await createAndDownloadWordDocuments(reportsData, selectedPeriodName);

        if (hasCreatedFiles) {
            showToast('הקבצים נוצרו והורדו בהצלחה.', 'green');
            document.getElementById('instructor-report-modal').classList.add('hidden');
        }

    } catch (error) {
        console.error("שגיאה ביצירת דוחות:", error);
        showToast('שגיאה ביצירת הדוחות.', 'red');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-download"></i> הורד קבצים';
    }
};

function collectDataForInstructor(instructorName, flights, periodName) {
    let report = {
        name: instructorName,
        period: periodName,
        instructorFlights: { hours: 0, details: [] }, 
        studentFlights: { hours: 0, details: [] },    
        totalHours: 0,
        personalFlights: { hours: 0 },                
        personalFitness: [],
        instructorGoals: { met: 0, notMet: 0 }
    };

    const mapping = window.pilotPopulations?.flightMapping || { students: [], instructors: [], conversion: [] };
    
    // ניקוי רווחים מכל הרשימות המוגדרות בעמוד הניהול
    const mappedInstructors = (mapping.instructors || []).map(n => n.trim());
    const mappedStudents = (mapping.students || []).map(n => n.trim());

    flights.forEach(f => {
        const d = f.data || {};
        const isRightPilot = d['טייס ימין']?.trim() === instructorName || d['pilot-right']?.trim() === instructorName;
        const isLeftPilot = d['טייס שמאל']?.trim() === instructorName || d['pilot-left']?.trim() === instructorName;
        const isInstructor = d['מדריך']?.trim() === instructorName || d['מדריכה']?.trim() === instructorName || d['instructor-main']?.trim() === instructorName;
        
        if (!isRightPilot && !isLeftPilot && !isInstructor) return;

        const durationMinutes = parseInt(d['שעות טיסה (דקות)']) || 0;
        const durationHoursDec = durationMinutes / 60;
        const flightName = d['שם גיחה']?.trim() || 'ללא שם';
        const dateStr = f.date ? new Date(f.date).toLocaleDateString('he-IL') : 'תאריך חסר';
        
        const isPersonalFlight = mappedInstructors.includes(flightName);
        const isStudentFlight = mappedStudents.includes(flightName);

        // איסוף לקח של הטייס
        let lessonText = '';
        if (isRightPilot) lessonText = d['לקחי מתאמן - ימין'] || d['lesson-right'];
        else if (isLeftPilot) lessonText = d['לקחי מתאמן - שמאל'] || d['lesson-left'];

        if (isPersonalFlight) { 
            report.instructorFlights.hours += durationHoursDec;
            report.personalFlights.hours += durationHoursDec;
            
            // הכנסת הלקח פנימה
            let finalLessonDisplay = lessonText && lessonText.trim() && !['אין', '-', '---'].includes(lessonText.trim())
                ? lessonText.trim()
                : '-';

            report.personalFitness.push({
                date: dateStr,
                flightName: flightName,
                lesson: finalLessonDisplay
            });

            // איסוף יעדים
            if (f.goalsStatus) {
                Object.values(f.goalsStatus).forEach(status => {
                    const s = (status || '').trim();
                    if (s === 'עמד.ה' || s === 'עמד' || s === 'בוצע') {
                        report.instructorGoals.met++;
                    } else if (s === 'לא עמד.ה' || s === 'לא עמד' || s === 'לא בוצע') {
                        report.instructorGoals.notMet++;
                    }
                });
            }

        } else if (isStudentFlight) { 
            report.studentFlights.hours += durationHoursDec;
            report.studentFlights.details.push({
                date: dateStr,
                flightName: flightName
            });
        }

        report.totalHours += durationHoursDec;
    });

    return report;
}

async function getBase64ImageFromUrl(imageUrl) {
    try {
        const res = await fetch(imageUrl);
        const blob = await res.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn("Could not load image", imageUrl);
        return "";
    }
}

function generatePieChartBase64(met, notMet) {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    
    // מילוי רקע לבן כדי שלא יהיה שקוף ב-Word
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const total = met + notMet;
    const centerX = 150, centerY = 130, radius = 100;

    if (total === 0) {
        ctx.fillStyle = "#e2e8f0";
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = "#64748b";
        ctx.font = "bold 16px Arial";
        ctx.textAlign = "center";
        ctx.fillText("אין יעדים מדווחים", centerX, centerY);
        return canvas.toDataURL('image/png');
    }

    const metAngle = (met / total) * 2 * Math.PI;
    
    // עמד - ירוק
    ctx.fillStyle = "#10B981"; 
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + metAngle);
    ctx.lineTo(centerX, centerY);
    ctx.fill();
    
    // לא עמד - אדום
    ctx.fillStyle = "#EF4444"; 
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, -Math.PI / 2 + metAngle, 1.5 * Math.PI);
    ctx.lineTo(centerX, centerY);
    ctx.fill();
    
    // מקרא
    ctx.font = "bold 16px Arial";
    
    ctx.fillStyle = "#10B981";
    ctx.fillRect(200, 260, 18, 18);
    ctx.fillStyle = "#333";
    ctx.textAlign = "right";
    ctx.fillText(`עמד (${met})`, 190, 275);
    
    ctx.fillStyle = "#EF4444";
    ctx.fillRect(70, 260, 18, 18);
    ctx.fillStyle = "#333";
    ctx.fillText(`לא עמד (${notMet})`, 60, 275);

    return canvas.toDataURL('image/png');
}

/**
 * יצירת קבצי הדוחות - כולל החזרת סעיף הלקחים!
 */
async function createAndDownloadWordDocuments(reportsData, periodName) {
    if (typeof JSZip === 'undefined') {
        showToast('ספריית יצירת ZIP חסרה במערכת.', 'red');
        return false;
    }

    const logo1Base64 = await getBase64ImageFromUrl(window.location.origin + '/ofer-logo.png');
    const logo2Base64 = await getBase64ImageFromUrl(window.location.origin + '/iaf-logo.png');

    const zip = new JSZip();
    const cleanPeriodName = periodName.replace(/\//g, '-');
    const folderName = `סיכום מדריכים תקופה ${cleanPeriodName}`;
    const folder = zip.folder(folderName);

    // שמירת הלוגואים כקבצים בתיקייה
    if (logo1Base64) folder.file("logo1.png", logo1Base64.split(',')[1], {base64: true});
    if (logo2Base64) folder.file("logo2.png", logo2Base64.split(',')[1], {base64: true});

    let hasFiles = false;

    reportsData.forEach(report => {
        if (report.totalHours === 0) return; 
        hasFiles = true;

        const safeName = report.name.replace(/[\\/:*?"<>|]/g, '_');
        
        // יצירת הגרף ושמירתו כקובץ PNG בתיקייה
        const pieChartImgBase64 = generatePieChartBase64(report.instructorGoals.met, report.instructorGoals.notMet);
        const pieFileName = `pie_chart_${safeName}.png`;
        folder.file(pieFileName, pieChartImgBase64.split(',')[1], {base64: true});

        const htmlContent = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
        <head>
            <meta charset="utf-8">
            <title>סיכום מדריך - ${report.name}</title>
            <style>
                body { font-family: 'Arial', sans-serif; direction: rtl; text-align: right; }
                h1 { text-align: center; font-size: 22pt; margin-bottom: 5px; color: #000; font-weight: bold; }
                h2 { text-align: center; font-size: 14pt; margin-top: 0; margin-bottom: 30px; color: #444; font-weight: normal; }
                
                .hours-wrapper { width: 100%; border: none; text-align: center; margin-bottom: 40px; border-collapse: collapse;}
                .hours-box { border: 2px solid #000; padding: 25px 10px; width: 30%; }
                .hours-val { font-size: 20pt; font-weight: bold; color: #000; display: block; margin-bottom: 10px; }
                .hours-lbl { font-size: 14pt; color: #444; display: block; font-weight: bold; }
                .spacer-col { width: 5%; border: none; }

                .section-title { font-weight: bold; font-size: 16pt; margin-bottom: 15px; color: #000; border-bottom: 1px solid #000; padding-bottom: 5px; }
                
                .fitness-wrapper { width: 100%; border: none; border-collapse: collapse; margin-bottom: 30px; }
                .fitness-box { border: 2px solid #000; padding: 15px; vertical-align: top; }
                .box-title { font-weight: bold; font-size: 14pt; text-align: center; margin-bottom: 15px; background-color: #f3f4f6; padding: 5px; border: 1px solid #ccc; }
                
                .inner-table { width: 100%; border-collapse: collapse; }
                .inner-table th, .inner-table td { border: 1px solid #ccc; padding: 8px; text-align: right; font-size: 11pt; }
                .inner-table th { background-color: #e2e8f0; font-weight: bold; }

                .students-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                .students-table th, .students-table td { border: 1px solid #000; padding: 8px; text-align: right; }
                .students-table th { background-color: #f3f4f6; }
            </style>
        </head>
        <body>
            <table style="width: 100%; border: none; margin-bottom: 20px;">
                <tr>
                    <td style="text-align: right; border: none;">${logo1Base64 ? `<img src="logo1.png" width="80" height="80">` : ''}</td>
                    <td style="text-align: left; border: none;">${logo2Base64 ? `<img src="logo2.png" width="80" height="80">` : ''}</td>
                </tr>
            </table>

            <h1>${report.name}</h1>
            <h2>סוף תקופה ${report.period}</h2>
            
            <table class="hours-wrapper">
                <tr>
                    <td class="hours-box">
                        <span class="hours-val">${report.studentFlights.hours.toFixed(1)} ש'</span>
                        <span class="hours-lbl">טיסות הדרכה</span>
                    </td>
                    <td class="spacer-col"></td>
                    <td class="hours-box">
                        <span class="hours-val">${report.totalHours.toFixed(1)} ש'</span>
                        <span class="hours-lbl">טיסות סה"כ</span>
                    </td>
                    <td class="spacer-col"></td>
                    <td class="hours-box">
                        <span class="hours-val">${report.personalFlights.hours.toFixed(1)} ש'</span>
                        <span class="hours-lbl">טיסות אישיות</span>
                    </td>
                </tr>
            </table>

            <div class="section-title">כשירות אישית (גיחות מדריך)</div>
            
            <table class="fitness-wrapper">
                <tr>
                    <td class="fitness-box" style="width: 55%;">
                        <div class="box-title">פירוט גיחות ולקחים</div>
                        <table class="inner-table">
                            <tr>
                                <th style="width: 35%;">תאריך וגיחה</th>
                                <th style="width: 65%;">לקחים</th>
                            </tr>
                            ${report.personalFitness.length > 0 ? 
                                report.personalFitness.map(f => `
                                <tr>
                                    <td><strong>${f.date}</strong><br>${f.flightName}</td>
                                    <td>${f.lesson.replace(/\n/g, '<br>')}</td>
                                </tr>`).join('') 
                                : '<tr><td colspan="2" style="text-align: center;">לא בוצעו גיחות אישיות</td></tr>'}
                        </table>
                    </td>
                    <td class="spacer-col" style="width: 5%;"></td>
                    
                    <td class="fitness-box" style="text-align: center; width: 40%;">
                        <div class="box-title">עמידה ביעדים</div>
                        <img src="${pieFileName}" width="220" height="220" alt="גרף עמידה ביעדים">
                    </td>
                </tr>
            </table>

            <div class="section-title">פירוט גיחות מדריכים (חניכים)</div>
            <table class="students-table">
                <tr>
                    <th style="width: 30%;">תאריך</th>
                    <th style="width: 70%;">שם גיחה</th>
                </tr>
                ${report.studentFlights.details.length > 0 ? 
                    report.studentFlights.details.map(f => `<tr><td>${f.date}</td><td>${f.flightName}</td></tr>`).join('') 
                    : '<tr><td colspan="2" style="text-align: center;">לא בוצעו גיחות הדרכה</td></tr>'}
            </table>
        </body>
        </html>
        `;

        const contentWithBOM = '\ufeff' + htmlContent;
        folder.file(`סיכום_${safeName}.doc`, contentWithBOM);
    });

    if (!hasFiles) {
        showToast('לא נמצאו טיסות למדריכים בתקופה הנבחרת.', 'yellow');
        return false;
    }

    try {
        const zipBlob = await zip.generateAsync({ type: "blob" });
        downloadBlob(zipBlob, `${folderName}.zip`);
        return true;
    } catch (error) {
        console.error("Error generating ZIP file:", error);
        throw new Error("שגיאה באריזת הנתונים לקובץ ZIP.");
    }
}

function downloadBlob(blob, fileName) {
    console.log(`מנסה להוריד קובץ: ${fileName}, גודל: ${blob.size} bytes`);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);  
    }, 3000); 
}

window.showFlightDetails = (id) => { if (window.showFlightDetailsModal) window.showFlightDetailsModal(id); };