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
        const periodSelect = document.getElementById('matrix-period'); // הוספה
        if (!typeSelect || !subPopSelect || !periodSelect) return;

        if (!typeSelect.dataset.listenerAttached) {
            typeSelect.addEventListener('change', () => this.initMatrixFilters());
            periodSelect.addEventListener('change', () => this.initMatrixFilters()); // מאזין גם לתקופה!
            subPopSelect.addEventListener('change', () => this.updateMatrix());
            typeSelect.dataset.listenerAttached = "true";
        }

        const selectedPeriod = periodSelect.value;

        // טעינת אוכלוסיות דינמית לפי התקופה שנבחרה
        if (selectedPeriod && window.firestoreFunctions) {
            const { doc, getDoc } = window.firestoreFunctions;
            const safePeriodName = selectedPeriod.replace(/\//g, '-');
            const popRef = doc(window.db, "populations_by_period", safePeriodName);
            const popSnap = await getDoc(popRef);

            if (popSnap.exists()) {
                window.pilotPopulations = popSnap.data();
            } else {
                // Fallback להגדרות הישנות (אם מדובר בתקופה שנוצרה לפני העדכון)
                const oldRef = doc(window.db, "settings", "populations");
                const oldSnap = await getDoc(oldRef);
                window.pilotPopulations = oldSnap.exists() ? oldSnap.data() : { instructorGroups: [], courses: [] };
            }
        }

        const type = typeSelect.value;
        const populations = window.pilotPopulations || { instructorGroups: [], courses: [] };

        let list = [];
        if (type === 'instructors') list = populations.instructorGroups || [];
        else if (type === 'conversion') list = populations.conversionGroups || [];
        else list = populations.courses || [];

        let optionsHtml = '<option value="ALL">כל תתי האוכלוסיות</option>';
        optionsHtml += list.map(item => `<option value="${item.name.trim()}">${item.name}</option>`).join('');

        subPopSelect.innerHTML = optionsHtml;

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
        // תיקון: גיחות מנהל משתמשות בתקופה השמורה, גיחות רגילות מחושבות דינמית לפי תאריך
        const rawPeriod = f.isAdminAdded ? f.period : getFlightPeriodName(f.date, plan);
        const periodOfFlight = String(rawPeriod || '').trim();

        const isSamePeriod = periodOfFlight === selectedPeriodName.trim();
        const isNotCancelled = f.executionStatus !== 'בוטלה';
        const isNotPending = f.executionStatus !== 'טרם דווחה'; // סינון גיחות פתוחות
        return isSamePeriod && isNotCancelled && isNotPending;
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

    // --- סינון חכם של טייסים כולל מניעת הצגת חניכים שהופסקה פעילותם ---
    let relevantPilots = [];
    if (subPopName === "ALL") {
        groups.forEach(g => {
            let members = g.members || g.students || [];
            // סינון לא-פעילים
            if (g.inactiveStudents) {
                members = members.filter(m => !g.inactiveStudents.includes(m));
            }
            relevantPilots.push(...members);
        });
        relevantPilots = [...new Set(relevantPilots)];
    } else {
        const group = groups.find(g => g.name.trim().replace(/["']/g, '"') === subPopName);
        if (group) {
            let members = group.members || group.students || [];
            // סינון לא-פעילים לקורס הספציפי
            if (group.inactiveStudents) {
                members = members.filter(m => !group.inactiveStudents.includes(m));
            }
            relevantPilots = members;
        }
    }

    const showQuotas = type === 'instructors' && insFlightType === 'instructor';
    const quotas = {
        min: parseInt(periodConfig.min) || 0,
        target: parseInt(periodConfig.target) || 0
    };

    // בניית כותרת הטבלה (Thead)
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
            const names = [d['טייס ימין'], d['טייס שמאל'], d['מדריך'], d['מדריכה'], d['מדריכה נוספת']].map(n => n?.toString().trim());
            return names.includes(cleanPilot) && (d['שם גיחה'] || '').includes('בונוס');
        }).length;

        let totalForQuotas = 0;
        const cells = relevantFlights.map(flightName => {
            const flightsForCell = filteredFlights.filter(f => {
                const d = f.data || {};
                const pilots = [d['טייס ימין'], d['טייס שמאל'], d['מדריך'], d['מדריכה'], d['מדריכה נוספת']].map(n => n?.toString().trim());
                return pilots.includes(cleanPilot) && (d['שם גיחה'] || '').trim() === flightName.trim();
            });

            const count = flightsForCell.length;
            totalForQuotas += count;
            const didFly = count > 0;

            const adminAddedFlight = flightsForCell.find(f => f.isAdminAdded);
            const isAdminAdded = !!adminAddedFlight;

            let bgColor = 'bg-red-500';
            let cellContent = '';
            let clickHandler = window.isAdmin ? `onclick="window.profileManager.promptAddAdminFlight('${cleanPilot}', '${flightName}', '${selectedPeriodName}')" class="cursor-pointer hover:bg-red-400 transition" title="לחץ לאישור ידני (מנהל)"` : '';

            if (didFly) {
                if (isAdminAdded) {
                    bgColor = 'bg-teal-400 border-teal-500';
                    cellContent = `<div class="flex items-center justify-center gap-1"><i class="fas fa-check-double text-white text-[10px]" title="נוסף ע״י מנהל"></i><span class="text-white font-bold text-sm">${count > 1 ? count : ''}</span></div>`;
                    clickHandler = window.isAdmin ? `onclick="window.profileManager.promptRemoveAdminFlight('${adminAddedFlight.id}')" class="cursor-pointer hover:bg-teal-500 transition" title="לחץ לביטול אישור ידני"` : '';
                } else {
                    bgColor = 'bg-green-500';
                    cellContent = count > 1 ? `<span class="text-white font-bold text-sm">${count}</span>` : '';
                    clickHandler = '';
                }
            }

            return `<td class="border p-0 w-12 min-w-[48px] text-center align-middle ${bgColor}" ${clickHandler}>
            ${cellContent}
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

    const selectedPeriod = document.getElementById('profile-period-select')?.value || 'all';
    const plan = window.planningSettings || {};

    const flights = (window.savedFlights || []).filter(f => {
        const d = f.data || {};
        const pilots = [d['טייס ימין'], d['טייס שמאל'], d['pilot-right'], d['pilot-left']].map(n => n?.toString().trim());
        if (!pilots.includes(pilotName.trim())) return false;

        // סינון לפי תקופה אם לא נבחר "הכל"
        if (selectedPeriod !== 'all') {
            const rawPeriod = f.isAdminAdded ? f.period : getFlightPeriodName(f.date, plan);
            const periodOfFlight = String(rawPeriod || '').trim();
            if (periodOfFlight !== selectedPeriod) return false;
        }

        return true;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    currentPilotFlights = flights;
    populateFlightTypeSelects(flights);

    // עדכון שעות
    const totalMinutes = flights.reduce((sum, f) =>
        (f.executionStatus === 'בוטלה' || f.executionStatus === 'טרם דווחה') ? sum : sum + (parseInt(f.data['שעות טיסה (דקות)']) || 0), 0);
    document.getElementById('profile-total-hours').textContent = formatMinutesToHM(totalMinutes);

    // עדכון רכיבים
    renderPilotFlightsTable(flights);
    updateLessonsListUI(pilotName);
    updateProfileChart(pilotName);

    const lastValid = flights.find(f => f.executionStatus !== 'טרם דווחה' && f.executionStatus !== 'בוטלה') || flights[0];
    updateGoalsListUI(lastValid);
}

// פונקציית עזר שתקרא כאשר משנים את התקופה בדרופדאון
window.profileManager.triggerPilotProfileUpdate = function () {
    const pilotInput = document.getElementById('profile-pilot-search');
    if (pilotInput && pilotInput.value) {
        updatePilotProfile(pilotInput.value);
    }
};

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
    const matrixPeriodSelect = document.getElementById('matrix-period');
    const profilePeriodSelect = document.getElementById('profile-period-select');

    if (!window.planningSettings && window.firestoreFunctions) {
        const { doc, getDoc } = window.firestoreFunctions;
        try {
            const planSnap = await getDoc(doc(window.db, "settings", "planning"));
            if (planSnap.exists()) {
                window.planningSettings = planSnap.data();
            }
        } catch (e) { console.error("Error fetching periods:", e); }
    }

    const periodsSet = new Set();

    const configs = window.planningSettings?.periodConfigs || {};
    Object.keys(configs).forEach(p => periodsSet.add(p.trim()));

    const allFlights = window.savedFlights || [];
    allFlights.forEach(f => {
        const p = f.isAdminAdded ? f.period : window.getPeriodName(f.date);
        if (p) periodsSet.add(p.trim());
    });

    const periods = Array.from(periodsSet).sort((a, b) => {
        const [pA, yA] = a.split('/').map(Number);
        const [pB, yB] = b.split('/').map(Number);
        return (yB + pB / 10) - (yA + pA / 10);
    });

    if (periods.length === 0) {
        if (matrixPeriodSelect) matrixPeriodSelect.innerHTML = '<option value="">אין תקופות זמינות</option>';
        return;
    }

    const optionsHtml = periods.map(p => `<option value="${p}">${p}</option>`).join('');

    // --- התיקון קורה כאן למטה: ---

    // מעקב קבוצתי (מטריצה)
    if (matrixPeriodSelect) {
        // שומרים את הערך שהמשתמש בחר עכשיו
        const currentMatrixVal = matrixPeriodSelect.value;

        matrixPeriodSelect.innerHTML = optionsHtml;

        // מנסים להחזיר את הערך שנשמר. אם אין (טעינה ראשונה), נשים את התקופה הנוכחית
        if (currentMatrixVal && periods.includes(currentMatrixVal)) {
            matrixPeriodSelect.value = currentMatrixVal;
        } else {
            const currentPeriodName = window.getPeriodName(new Date());
            matrixPeriodSelect.value = periods.includes(currentPeriodName) ? currentPeriodName : periods[0];
        }
    }

    // מעקב אישי (פרופיל)
    if (profilePeriodSelect) {
        const currentProfileVal = profilePeriodSelect.value;
        profilePeriodSelect.innerHTML = '<option value="all">כל התקופות (היסטוריה מלאה)</option>' + optionsHtml;

        if (currentProfileVal) {
            profilePeriodSelect.value = currentProfileVal;
        }
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
        let statusText = status;
        let rowBgClass = 'hover:bg-gray-50'; // ברירת מחדל לשורה

        if (status === 'בוצעה') badgeClass = 'bg-green-100 text-green-800';
        if (status === 'בוטלה') badgeClass = 'bg-red-100 text-red-800';

        // הוספת חיווי מיוחד לגיחה שאושרה ידנית על ידי מנהל
        if (f.isAdminAdded) {
            statusText = 'נוספה ע"י מנהל';
            badgeClass = 'bg-orange-100 text-orange-800 border border-orange-300 shadow-sm';
            rowBgClass = 'bg-orange-50 hover:bg-orange-100'; // צביעת השורה עצמה בכתום בהיר
        }

        return `
            <tr class="${rowBgClass} cursor-pointer transition-colors" onclick="window.showFlightDetails('${f.id}')">
                <td class="px-4 py-2 border-b border-gray-100">${new Date(f.date).toLocaleDateString('he-IL')}</td>
                <td class="px-4 py-2 font-medium border-b border-gray-100">${d['שם גיחה'] || '---'}</td>
                <td class="px-4 py-2 border-b border-gray-100"><span class="px-2 py-1 rounded text-[11px] font-bold ${badgeClass}">${statusText}</span></td>
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

window.profileManager.openInstructorReportModal = function () {
    const modal = document.getElementById('instructor-report-modal');
    const periodSelect = document.getElementById('instructor-report-period');
    const mainPeriodSelect = document.getElementById('matrix-period');

    if (!modal || !periodSelect) return;

    periodSelect.innerHTML = mainPeriodSelect.innerHTML;
    periodSelect.value = mainPeriodSelect.value;
    modal.classList.remove('hidden');
};

// ==========================================
// הגדרות תמונות ולוגואים לדו"ח סיכום מדריכים
// ==========================================
const REPORT_CONFIG = {
    logoRight: './ofer-logo.png',       // נתיב ללוגו ימין (טייסת)
    logoLeft: './bist.png',         // נתיב ללוגו שמאל (חיל האוויר)
    barcodeRegister: './register.jpeg', // תמונת ברקוד הרשמה
    barcodeFeedback: './feedback.png'  // תמונת ברקוד משוב
};

// ברקוד ברירת מחדל לגיבוי במקרה שחסרה תמונה בתיקייה
const DEFAULT_BARCODE_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAH0AAAAeCAYAAAClXhX2AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACLSURBVGhD7dFRCgAhCARR1/tf2m+VzGBSO1iB58Nw15b1XvLgE9xK72K8e2z2cR8yMDOzJ2ZgZmZPzMDMzJ6YgZmZPTEDMzN7YgZmZvbEDMzM7IkZmJnZEzMwM7MnZmBmZk/MwMzMntwBvM8X+T+wN+M9zMDMzJ6YgZmZPTEDMzN7YgZmZvbEDMzM7IkZ5Iydm0/7AzWp9uA8AAAAAElFTkSuQmCC";

window.profileManager.openInstructorReportModal = function () {
    const modal = document.getElementById('instructor-report-modal');
    const periodSelect = document.getElementById('instructor-report-period');
    const mainPeriodSelect = document.getElementById('matrix-period');

    if (!modal || !periodSelect) return;

    periodSelect.innerHTML = mainPeriodSelect.innerHTML;
    periodSelect.value = mainPeriodSelect.value;

    const populations = window.pilotPopulations || {};
    const instructorGroups = populations.instructorGroups || [];
    let allInstructors = new Set();
    instructorGroups.forEach(group => {
        (group.members || group.students || []).forEach(member => allInstructors.add(member.trim()));
    });
    const instructorsList = Array.from(allInstructors).sort();

    let listContainer = document.getElementById('instructor-checkbox-wrapper');
    if (!listContainer) {
        const btn = document.getElementById('btn-generate-instructors-report');
        listContainer = document.createElement('div');
        listContainer.id = 'instructor-checkbox-wrapper';
        listContainer.className = 'w-full mb-4';

        // מוצא את ה-footer של החלון (איפה שנמצאים כפתורי הייצוא/ביטול) ומכניס את הרשימה מעליו!
        const footer = btn.closest('.flex.justify-end') || btn.parentNode;
        if (footer && footer.parentNode) {
            footer.parentNode.insertBefore(listContainer, footer);
        } else {
            btn.parentNode.insertBefore(listContainer, btn);
        }
    }

    // סידור החלון: כפתורי בחר/נקה למעלה, שמות באמצע
    let html = `
        <div class="mb-4 bg-white p-3 rounded border border-gray-200 shadow-sm">
            <h4 class="font-bold text-sm text-gray-700 mb-3 border-b pb-1">הגדרות ברקודים (אופציונלי)</h4>
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-xs font-bold mb-1 text-gray-600">כותרת ברקוד ימין</label>
                    <input type="text" id="custom-barcode-title-1" value="הרשמה ליום אימון" class="w-full text-sm p-1.5 border rounded border-gray-300">
                    <label class="block text-xs font-bold mt-2 mb-1 text-gray-600">קובץ תמונה (במקום הקיים)</label>
                    <input type="file" id="custom-barcode-file-1" accept="image/*" class="w-full text-xs text-gray-500">
                </div>
                <div>
                    <label class="block text-xs font-bold mb-1 text-gray-600">כותרת ברקוד שמאל</label>
                    <input type="text" id="custom-barcode-title-2" value="משוב יום אימון" class="w-full text-sm p-1.5 border rounded border-gray-300">
                    <label class="block text-xs font-bold mt-2 mb-1 text-gray-600">קובץ תמונה (במקום הקיים)</label>
                    <input type="file" id="custom-barcode-file-2" accept="image/*" class="w-full text-xs text-gray-500">
                </div>
            </div>
        </div>
        
        <div class="flex justify-between items-center mb-3 pb-2 border-b border-gray-200">
            <span class="font-bold text-gray-700 text-lg">בחר מדריכים להפקה:</span>
            <div class="flex gap-3">
                <button type="button" class="text-sm text-blue-600 font-medium hover:text-blue-800 transition" onclick="document.querySelectorAll('.inst-chk').forEach(c=>c.checked=true)">סמן הכל</button>
                <button type="button" class="text-sm text-gray-500 font-medium hover:text-gray-700 transition" onclick="document.querySelectorAll('.inst-chk').forEach(c=>c.checked=false)">נקה הכל</button>
            </div>
        </div>
        
        <div class="bg-gray-50 border border-gray-200 rounded p-3 max-h-60 overflow-y-auto shadow-inner">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
    `;

    instructorsList.forEach(inst => {
        const id = 'chk-' + inst.replace(/[\s"']/g, '-');
        html += `
                <div class="flex items-center bg-white p-2 rounded border border-gray-200 hover:bg-blue-50 transition cursor-pointer" onclick="const cb=document.getElementById('${id}'); cb.checked=!cb.checked;">
                    <input type="checkbox" id="${id}" value="${inst}" class="inst-chk w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 ml-3" checked onclick="event.stopPropagation()">
                    <label for="${id}" class="text-gray-800 font-medium text-sm truncate select-none cursor-pointer" onclick="event.stopPropagation()">${inst}</label>
                </div>
        `;
    });

    html += `
            </div>
        </div>
    `;

    listContainer.innerHTML = html;
    modal.classList.remove('hidden');
};

window.profileManager.generateInstructorsReport = async function () {
    const periodSelect = document.getElementById('instructor-report-period');
    const selectedPeriodName = periodSelect.value;
    const btn = document.getElementById('btn-generate-instructors-report');

    if (!selectedPeriodName) {
        showToast('אנא בחר תקופה', 'red');
        return;
    }

    const selectedBoxes = document.querySelectorAll('.inst-chk:checked');
    const selectedInstructors = Array.from(selectedBoxes).map(cb => cb.value);

    if (selectedInstructors.length === 0) {
        showToast('אנא בחר לפחות מדריך אחד מהרשימה.', 'red');
        return;
    }

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> מכין קבצים...';

        const plan = window.planningSettings || {};
        const allFlights = window.savedFlights || [];

        const periodFlights = allFlights.filter(f => {
            // תיקון: גיחות מנהל משתמשות בתקופה השמורה, גיחות רגילות מחושבות דינמית לפי תאריך
            const rawPeriod = f.isAdminAdded ? f.period : getFlightPeriodName(f.date, plan);
            const periodOfFlight = String(rawPeriod || '').trim();

            const isSamePeriod = periodOfFlight === selectedPeriodName.trim();
            const isCancelled = f.executionStatus === 'בוטלה' || !!(f.data && f.data['סיבת ביטול']);
            const isPending = f.executionStatus === 'טרם דווחה' || !f.executionStatus;

            return isSamePeriod && !isCancelled && !isPending;
        });

        const periodConfig = plan.periodConfigs ? plan.periodConfigs[selectedPeriodName] : null;

        const reportsData = selectedInstructors.map(instructorName => {
            let instTarget = 0;
            let instMin = 0;
            const populations = window.pilotPopulations || {};
            const instructorGroups = populations.instructorGroups || [];

            instructorGroups.forEach(g => {
                const members = (g.members || g.students || []).map(m => m.trim());
                if (members.includes(instructorName)) {
                    if (g.target) instTarget = parseInt(g.target);
                    if (g.minimum) instMin = parseInt(g.minimum);
                }
            });

            if (!instTarget && periodConfig && periodConfig.target) instTarget = parseInt(periodConfig.target);
            if (!instMin && periodConfig && periodConfig.min) instMin = parseInt(periodConfig.min);

            return collectDataForInstructor(instructorName, periodFlights, selectedPeriodName, instMin, instTarget);
        });

        // משיכת נתוני הברקודים שהמשתמש הזין
        const title1 = document.getElementById('custom-barcode-title-1')?.value || "הרשמה ליום אימון";
        const title2 = document.getElementById('custom-barcode-title-2')?.value || "משוב יום אימון";
        const file1 = document.getElementById('custom-barcode-file-1')?.files?.[0];
        const file2 = document.getElementById('custom-barcode-file-2')?.files?.[0];

        const getBase64 = (file) => new Promise((resolve) => {
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
        });

        const customBarcode1 = await getBase64(file1);
        const customBarcode2 = await getBase64(file2);

        const customData = { title1, title2, customBarcode1, customBarcode2 };

        const hasCreated = await createAndDownloadPDFReport(reportsData, selectedPeriodName, customData);

        if (hasCreated) {
            showToast('תיקיית ה-ZIP עם דוחות ה-PDF הורדה בהצלחה.', 'green');
            document.getElementById('instructor-report-modal').classList.add('hidden');
        }

    } catch (error) {
        console.error("שגיאה ביצירת דוחות:", error);
        showToast('שגיאה בהפקת הקבצים.', 'red');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-download"></i> הורד דו"חות';
    }
};

function collectDataForInstructor(instructorName, flights, periodName, periodMin, periodTarget) {
    let report = {
        name: instructorName,
        period: periodName,
        totalMinutes: 0,
        instructorMinutes: 0,
        studentMinutes: 0,
        studentFlights: { details: [] },
        personalFitness: [],
        metGoalsList: [],
        target: periodTarget,
        minimum: periodMin
    };

    const mapping = window.pilotPopulations?.flightMapping || { students: [], instructors: [], conversion: [] };
    const mappedInstructors = (mapping.instructors || []).map(n => n.trim());
    const mappedStudents = (mapping.students || []).map(n => n.trim());

    flights.forEach(f => {
        const d = f.data || {};
        const isRightPilot = d['טייס ימין']?.trim() === instructorName || d['pilot-right']?.trim() === instructorName;
        const isLeftPilot = d['טייס שמאל']?.trim() === instructorName || d['pilot-left']?.trim() === instructorName;
        const isInstructor = d['מדריך']?.trim() === instructorName || d['מדריכה']?.trim() === instructorName || d['instructor-main']?.trim() === instructorName;

        if (!isRightPilot && !isLeftPilot && !isInstructor) return;

        // איסוף היעדים שהושגו + סינון חיוויי סטטוס שגויים ("עמד" / "לא")
        if (f.goalsStatus) {
            Object.entries(f.goalsStatus).forEach(([id, status]) => {
                if (status === 'עמד.ה') {
                    const goalName = getGoalName(id, f);
                    if (goalName) {
                        const cleanGoal = goalName.trim();
                        // רשימת מילים לסינון כדי שלא ייכנסו ככותרת יעד
                        const filterWords = ['עמד', 'לא', 'עמד.ה', 'לא עמד', 'לא עמד.ה', '-', 'ללא', 'יעדים', 'יעד', '---', 'אין', 'חסר', 'לא דווח', 'לא דווחה', 'יעד 1', 'יעד 2', 'יעד 3', 'יעד 4', 'יעד 5', 'יעד 6', 'יעד 7', 'יעד 8', 'יעד 9', 'יעד 10'];
                        if (filterWords.includes(cleanGoal)) {
                            return; // מדלג ומסנן את היעד הנוכחי
                        }

                        // בדיקת כפילויות כדי למנוע הצגת אותו יעד פעמיים
                        if (!report.metGoalsList.some(g => g.trim() === cleanGoal)) {
                            report.metGoalsList.push(cleanGoal);
                        }
                    }
                }
            });
        }

        const durationMinutes = parseInt(d['שעות טיסה (דקות)']) || 0;
        const flightName = d['שם גיחה']?.trim() || 'ללא שם';
        const dateStr = f.date ? new Date(f.date).toLocaleDateString('he-IL') : 'תאריך חסר';

        report.totalMinutes += durationMinutes;

        const isPersonalFlight = mappedInstructors.includes(flightName);
        const isStudentFlight = mappedStudents.includes(flightName);

        let lessonText = '';
        if (isRightPilot) lessonText = d['לקחי מתאמן - ימין'] || d['lesson-right'];
        else if (isLeftPilot) lessonText = d['לקחי מתאמן - שמאל'] || d['lesson-left'];

        if (isPersonalFlight) {
            report.instructorMinutes += durationMinutes;
            let finalLessonDisplay = lessonText && lessonText.trim() && !['אין', '-', '---'].includes(lessonText.trim()) ? lessonText.trim() : '-';

            report.personalFitness.push({
                date: dateStr,
                flightName: flightName,
                lesson: finalLessonDisplay
            });

        } else if (isStudentFlight) {
            report.studentMinutes += durationMinutes;
            report.studentFlights.details.push({
                flightName: flightName
            });
        }
    });

    return report;
}

const formatHM = (totalMinutes) => {
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

// פונקציית הגנה קלה לגרשיים כדי למנוע שבירת HTML (ללא פגיעה ברווחים)
function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// טעינת תמונות בטוחה: אם יש שגיאת 404 מחזיר מיד את תמונת הגיבוי ולא קורס
async function getBase64ImageFromUrl(imageUrl, fallbackBase64 = "") {
    try {
        const res = await fetch(imageUrl);
        if (!res.ok) return fallbackBase64;
        const blob = await res.blob();

        if (!blob.type.startsWith('image/')) return fallbackBase64;

        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                let base64data = reader.result;
                if (base64data.startsWith('data:image/jpeg;base64,iVBORw0K')) {
                    base64data = base64data.replace('data:image/jpeg;base64,', 'data:image/png;base64,');
                }
                resolve(base64data);
            };
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        return fallbackBase64;
    }
}

function generatePieChartBase64(met, notMet) {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const total = met + notMet;
    const centerX = 200, centerY = 180, radius = 130;

    if (total === 0) {
        ctx.fillStyle = "#e2e8f0";
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = "#64748b";
        ctx.font = "bold 20px Arial";
        ctx.textAlign = "center";
        ctx.fillText("אין יעדים מדווחים", centerX, centerY);
        return canvas.toDataURL('image/png');
    }

    const metAngle = (met / total) * 2 * Math.PI;

    ctx.fillStyle = "#10B981";
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, -Math.PI / 2, -Math.PI / 2 + metAngle);
    ctx.lineTo(centerX, centerY);
    ctx.fill();

    ctx.fillStyle = "#EF4444";
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, -Math.PI / 2 + metAngle, 1.5 * Math.PI);
    ctx.lineTo(centerX, centerY);
    ctx.fill();

    ctx.font = "bold 26px Arial"; // טקסט מוגדל
    ctx.textAlign = "left"; // יישור שמאלה למניעת חיתוך הטקסט המוגדל

    ctx.fillStyle = "#10B981";
    ctx.fillRect(50, 350, 24, 24);
    ctx.fillStyle = "#333";
    ctx.fillText(`עמד (${met})`, 85, 370);

    ctx.fillStyle = "#EF4444";
    ctx.fillRect(220, 350, 24, 24);
    ctx.fillStyle = "#333";
    ctx.fillText(`לא עמד (${notMet})`, 255, 370);

    return canvas.toDataURL('image/png');
}

/**
 * יצירת תיקיית ZIP ודוחות PDF.
 * מונע לחלוטין את הדף הלבן על ידי קיבוע קואורדינטות (0,0) ללא שינוי ה-body.dir!
 */
async function createAndDownloadPDFReport(reportsData, periodName, customData = {}) {
    if (typeof html2pdf === 'undefined' || typeof JSZip === 'undefined') {
        showToast('ספריות חסרות (html2pdf או JSZip).', 'red');
        return false;
    }

    const activeReports = reportsData.filter(r => r.totalMinutes > 0);
    if (activeReports.length === 0) {
        showToast('לא נמצאו טיסות למדריכים שנבחרו.', 'yellow');
        return false;
    }

    // גלילה למעלה חובה - קריטי בשביל ש-html2canvas לא ייצר דף לבן!
    window.scrollTo(0, 0);

    // מסך טעינה שמסתיר את כל המסך
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(255, 255, 255, 0.95)';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.innerHTML = `
        <i class="fas fa-spinner fa-spin" style="font-size: 50px; color: #3b82f6; margin-bottom: 20px;"></i>
        <h2 style="font-family: Arial; font-size: 24px; color: #333;">מפיק דוחות, אנא המתן...</h2>
    `;
    document.body.appendChild(overlay);

    const logoRightBase64 = await getBase64ImageFromUrl(REPORT_CONFIG.logoRight);
    const logoLeftBase64 = await getBase64ImageFromUrl(REPORT_CONFIG.logoLeft);
    const barcodeRegBase64 = customData.customBarcode1 || await getBase64ImageFromUrl(REPORT_CONFIG.barcodeRegister, DEFAULT_BARCODE_BASE64);
    const barcodeFbBase64 = customData.customBarcode2 || await getBase64ImageFromUrl(REPORT_CONFIG.barcodeFeedback, DEFAULT_BARCODE_BASE64);
    const barcodeTitle1 = customData.title1 || "הרשמה ליום אימון";
    const barcodeTitle2 = customData.title2 || "משוב יום אימון";

    const zip = new JSZip();
    const cleanPeriodName = periodName.replace(/\//g, '-');
    const folderName = `סיכום מדריכים תקופה ${cleanPeriodName}`;
    const folder = zip.folder(folderName);

    for (let i = 0; i < activeReports.length; i++) {
        const report = activeReports[i];

        const safePeriod = escapeHtml(report.period);
        const safeFilename = report.name.replace(/[\\/:*?"<>|]/g, '_');

        const performed = report.personalFitness.length;
        const targetColor = (report.target > 0 && performed >= report.target) ? '#10B981' : '#EF4444';
        const minColor = (report.minimum > 0 && performed >= report.minimum) ? '#10B981' : '#EF4444';

        const metGoal = Math.min(performed, report.target);
        const notMetGoal = Math.max(0, report.target - performed);
        const pieChartImg = generatePieChartBase64(metGoal, notMetGoal);

        // --- פונקציית עזר להצלת הרווחים מבאג ה-RTL ---
        const fixSpaces = (str) => {
            if (!str) return '';
            // החלפה לרווח קשיח נקי שמכריח את מנוע ה-PDF להציג רווח ויזואלי ברור
            return str.toString().replace(/ /g, '&nbsp;');
        };
        const safeName = fixSpaces(escapeHtml(report.name));

        // קיבוץ גיחות הדרכה זהות וספירתן
        const flightCounts = {};
        report.studentFlights.details.forEach(f => {
            flightCounts[f.flightName] = (flightCounts[f.flightName] || 0) + 1;
        });
        const studentFlightsList = Object.keys(flightCounts).map(name => {
            const count = flightCounts[name];
            return count > 1 ? `${escapeHtml(name)} (${count})` : escapeHtml(name);
        });

        const halfLength = Math.ceil(studentFlightsList.length / 2);
        const col1 = studentFlightsList.slice(0, halfLength);
        const col2 = studentFlightsList.slice(halfLength);

        let studentRowsHTML = '';
        if (studentFlightsList.length === 0) {
            studentRowsHTML = `<tr><td align="center" style="border: 1px solid #000; padding: 15px; font-size: 13px;">לא בוצעו גיחות הדרכה</td></tr>`;
        } else {
            for (let j = 0; j < halfLength; j++) {
                const text1 = col1[j] ? escapeHtml(col1[j]) : '';
                const text2 = col2[j] ? escapeHtml(col2[j]) : '';
                studentRowsHTML += `
                <tr>
                    <td align="right" style="border: 1px solid #000; padding: 6px; width: 50%; font-size: 13px; line-height: 1.3; word-break: normal; overflow-wrap: break-word;">${text1}</td>
                    <td align="right" style="border: 1px solid #000; padding: 6px; width: 50%; font-size: 13px; line-height: 1.3; word-break: normal; overflow-wrap: break-word;">${text2}</td>
                </tr>`;
            }
        }

        // קביעת מידות של דף A4 מדויק
        const wrapper = document.createElement('div');
        wrapper.style.position = 'relative';
        wrapper.style.width = '794px';
        wrapper.style.height = '1122px'; // חובה כדי להדביק את התחתית (גובה A4 בפיקסלים)
        wrapper.style.backgroundColor = '#ffffff';
        wrapper.style.direction = 'rtl';
        wrapper.style.margin = '0 auto';

        const htmlString = `
            <div style="direction: rtl; width: 100%; height: 100%; padding: 25px 35px; box-sizing: border-box; font-family: Arial, sans-serif; color: #000; display: flex; flex-direction: column; justify-content: space-between;">
                
                <div style="flex: 0 0 auto;">
                    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom: 20px;">
                        <tr>
                            <td width="20%" align="right" valign="middle">
                                ${logoRightBase64 ? `<img src="${logoRightBase64}" style="height: 55px;">` : ''}
                            </td>
                            <td width="60%" align="center" valign="middle" style="font-size: 24px; font-weight: bold; white-space: nowrap;">
                                סיכום תקופה ${safePeriod} - ${safeName}
                            </td>
                            <td width="20%" align="left" valign="middle">
                                ${logoLeftBase64 ? `<img src="${logoLeftBase64}" style="height: 55px;">` : ''}
                            </td>
                        </tr>
                    </table>

                    <table width="100%" border="0" cellpadding="0" cellspacing="0">
                        <tr>
                            <td width="5%"></td>
                            
                            <td width="38%" valign="middle" style="border: 2px solid #000; padding: 12px; text-align: center; border-radius: 5px;">
                                
                                <table border="0" cellpadding="0" cellspacing="0" align="center" style="margin-bottom: 8px;">
                                    <tr>
                                        <td dir="ltr" style="font-size: 20px; font-weight: bold; padding-left: 6px;">${formatHM(report.totalMinutes)}</td>
                                        <td style="font-size: 20px; font-weight: bold;">ש'&nbsp;טיסה</td>
                                    </tr>
                                </table>
                                
                                <div style="font-weight: bold; margin-bottom: 6px; font-size: 14px; text-decoration: underline;">:מתוכן</div>
                                
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" style="font-weight: bold; font-size: 13px; margin-bottom: 12px;">
                                    <tr>
                                        <td width="50%" align="center" style="line-height: 1.4;">
                                            <table border="0" cellpadding="0" cellspacing="0" align="center">
                                                <tr>
                                                    <td dir="ltr" style="font-size: 13px; font-weight: bold; padding-left: 4px;">${formatHM(report.instructorMinutes)}</td>
                                                    <td style="font-size: 13px; font-weight: bold;">'ש</td>
                                                </tr>
                                            </table>
                                            <div>כשירות&nbsp;אישית</div>
                                        </td>
                                        <td width="50%" align="center" style="line-height: 1.4;">
                                            <table border="0" cellpadding="0" cellspacing="0" align="center">
                                                <tr>
                                                    <td dir="ltr" style="font-size: 13px; font-weight: bold; padding-left: 4px;">${formatHM(report.studentMinutes)}</td>
                                                    <td style="font-size: 13px; font-weight: bold;">'ש</td>
                                                </tr>
                                            </table>
                                            <div>הדרכה</div>
                                        </td>
                                    </tr>
                                </table>
                                
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" style="font-weight: bold; font-size: 15px;">
                                    <tr>
                                        <td width="50%" align="center">
                                            <table border="0" cellpadding="0" cellspacing="0" align="center">
                                                <tr>
                                                    <td style="font-size: 15px; font-weight: bold; padding-left: 8px;">:יעד</td>
                                                    <td style="color: ${targetColor}; font-size: 15px; font-weight: bold;">
                                                        <table border="0" cellpadding="0" cellspacing="0" align="center" dir="ltr">
                                                            <tr>
                                                                <td style="color: ${targetColor};">${performed}</td>
                                                                <td style="color: ${targetColor}; padding: 0 4px;">/</td>
                                                                <td style="color: ${targetColor};">${report.target}</td>
                                                            </tr>
                                                        </table>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                        <td width="50%" align="center">
                                            <table border="0" cellpadding="0" cellspacing="0" align="center">
                                                <tr>
                                                    <td style="font-size: 15px; font-weight: bold; padding-left: 8px;">:מזער</td>
                                                    <td style="color: ${minColor}; font-size: 15px; font-weight: bold;">
                                                        <table border="0" cellpadding="0" cellspacing="0" align="center" dir="ltr">
                                                            <tr>
                                                                <td style="color: ${minColor};">${performed}</td>
                                                                <td style="color: ${minColor}; padding: 0 4px;">/</td>
                                                                <td style="color: ${minColor};">${report.minimum}</td>
                                                            </tr>
                                                        </table>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                            </td>

                            <td width="4%"></td>
                            
                            <td width="48%" align="center" valign="middle">
                                <table width="100%" border="0" cellpadding="0" cellspacing="0" style="table-layout: fixed;">
                                    <tr>
                                        <td width="180" align="center" valign="middle" style="width: 180px; min-width: 170px; max-width: 180px;">
                                            <img src="${pieChartImg}" style="width: 160px; height: 160px; object-fit: contain;">
                                        </td>
                                     <td valign="middle" style="padding-right: 10px; text-align: right;">
                                            ${(() => {
                if (!report.metGoalsList || report.metGoalsList.length === 0) {
                    return `<div style="font-size: 12px; color: #666; font-style: italic; text-align: center; padding-top: 15px;">אין יעדים מדווחים שהושגו</div>`;
                }

                // הסרת כפילויות לחלוטין (ניקוי רווחים וסינון כפולות)
                const uniqueGoals = [...new Set(report.metGoalsList.map(g => g.trim()))];

                // --- התיקון: פונקציית עזר לסידור מספרים ורווחים במנוע ה-PDF ---
                const fixPdfRtl = (text) => {
                    if (!text) return '';
                    return escapeHtml(text).split(' ').map(word => {
                        // בדיקה אם המילה מכילה ספרות
                        const isNumber = /\d/.test(word);
                        // inline-block מכריח מדידה נפרדת, margin-left מדמה רווח בטוח, direction: ltr מונע דריסת מספרים
                        return `<span style="display: inline-block; margin-left: 4px; ${isNumber ? 'direction: ltr; unicode-bidi: isolate;' : ''}">${word}</span>`;
                    }).join('');
                };

                return `
        <div style="font-size: 11px; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 8px; direction: rtl; text-align: right;">
            <div style="font-weight: bold; color: #166534; margin-bottom: 6px; text-decoration: underline; font-size: 12px;">${fixSpaces('יעדים שהושגו')}</div>
            <table width="100%" border="0" cellpadding="0" cellspacing="0" style="table-layout: fixed; width: 100%; color: #15803d; font-size: 11px;">
                ${uniqueGoals.map(g => `
                    <tr>
                        <td valign="top" width="8" style="width: 8px; padding: 0 0 5px 0; line-height: 1.4; font-weight: bold;">•</td>
                        <td valign="top" dir="rtl" style="padding: 0 0 5px 0; line-height: 1.4; white-space: normal; word-break: normal; overflow-wrap: break-word; text-align: right;">
                            ${fixPdfRtl(g)}
                        </td>
                    </tr>
                `).join('')}
            </table>
        </div>
        `;
            })()}
</td>
                                    </tr>
                                </table>
                            </td>
                            
                            <td width="5%"></td>
                        </tr>
                    </table>
                </div>

                <div style="flex: 1 1 auto; padding: 15px 0; display: flex; flex-direction: column;">
                    <!-- הקו העליון -->
                    <div style="width: 100%; border-top: 2px solid #000;"></div>

                    
                    
                    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="table-layout: fixed; margin-bottom: 6px; margin-top: 6px;">
                        <tr>
                            <td width="54%" align="center" style="font-weight: bold; font-size: 15px; text-decoration: underline;">${fixSpaces('כשירות אישית')}</td>
                            <td width="2%"></td>
                            <td width="44%" align="center" style="font-weight: bold; font-size: 15px; text-decoration: underline;">${fixSpaces('פירוט גיחות הדרכה')}</td>
                        </tr>
                    </table>

                    
                    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="table-layout: fixed; height: 100%; flex: 1;">
                        <tr>
                            <td width="54%" valign="top" style="padding-left: 10px; padding-top: 8px; padding-bottom: 8px;">
                                <table width="100%" border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; border: 1px solid #000;">
                                    <thead>
                                        <tr style="background-color: #f0f0f0;">
                                            <th align="right" style="width: 45%; font-size: 13px;">${fixSpaces('שם גיחה / תאריך')}</th>
                                            <th align="right" style="width: 55%; font-size: 13px;">לקחים</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${report.personalFitness.map(f => `
                                        <tr>
                                            <td align="right" valign="top" style="font-weight: bold; font-size: 12px; line-height: 1.3; padding: 5px 6px; word-break: normal; overflow-wrap: break-word;">
                                                <div>${escapeHtml(f.flightName)}</div>
                                                <div style="font-size: 10px; color: #666; font-weight: normal; margin-top: 2px;">${fixSpaces(escapeHtml(f.date))}</div>
                                            </td>
                                            <td align="right" valign="top" style="font-size: 12px; line-height: 1.4; padding: 5px 6px; word-break: normal; overflow-wrap: break-word;">
                                                <div style="direction: rtl; text-align: right;">
                                                    ${fixSpaces(escapeHtml(f.lesson)).replace(/\n/g, '<br>')}
                                                </div>
                                            </td>
                                        </tr>
                                        `).join('') || `<tr><td colspan="2" align="center" style="padding: 15px; font-size: 13px;">לא בוצעו גיחות כשירות</td></tr>`}
                                    </tbody>
                                </table>
                            </td>

                            <!-- הקו המרכזי שנמתח לכל האורך -->
                            <td width="2%" align="center" valign="top">
                                <div style="border-left: 2px solid #000; height: 100%; min-height: 260px;"></div>
                            </td>

                            <td width="44%" valign="top" style="padding-right: 10px; padding-top: 8px; padding-bottom: 8px;">
                                <table width="100%" border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; border: 1px solid #000;">
                                    <tbody>
                                        ${studentRowsHTML}
                                    </tbody>
                                </table>
                            </td>
                        </tr>
                    </table>
                    
                    <!-- הקו התחתון -->
                    <div style="width: 100%; border-top: 2px solid #000;"></div>

                </div>

                <div style="flex: 0 0 auto;">
                    <div style="width: 100%; margin-bottom: 15px;"></div>
                    <table width="100%" border="0" cellpadding="0" cellspacing="0">
                        <tr>
                            <td width="48%" valign="top">
                                <div style="border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; background-color: #f9fafb; text-align: center; box-sizing: border-box;">
<div style="font-weight: bold; font-size: 14px; color: #1f2937; margin-bottom: 6px; word-spacing: 2px;">${fixSpaces(escapeHtml(barcodeTitle1))}</div>
                                    ${barcodeRegBase64 !== DEFAULT_BARCODE_BASE64
                ? `<div style="width: 105px; height: 105px; margin: 0 auto; background-color: #ffffff; background-image: url('${barcodeRegBase64}'); background-size: contain; background-position: center; background-repeat: no-repeat; border: 1px solid #e5e7eb; padding: 4px; border-radius: 4px; box-sizing: border-box;"></div>`
                : `<div style="width: 105px; height: 105px; border: 2px dashed #cbd5e1; line-height: 105px; color: #94a3b8; font-size: 11px; margin: 0 auto; background-color: #ffffff; text-align: center; border-radius: 4px;">מקום&nbsp;לברקוד</div>`
            }
                                </div>
                            </td>
                            
                            <td width="4%"></td>

                            <td width="48%" valign="top">
                                <div style="border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; background-color: #f9fafb; text-align: center; box-sizing: border-box;">
<div style="font-weight: bold; font-size: 14px; color: #1f2937; margin-bottom: 6px; word-spacing: 2px;">${fixSpaces(escapeHtml(barcodeTitle2))}</div>
                                    ${barcodeFbBase64 !== DEFAULT_BARCODE_BASE64
                ? `<div style="width: 105px; height: 105px; margin: 0 auto; background-color: #ffffff; background-image: url('${barcodeFbBase64}'); background-size: contain; background-position: center; background-repeat: no-repeat; border: 1px solid #e5e7eb; padding: 4px; border-radius: 4px; box-sizing: border-box;"></div>`
                : `<div style="width: 105px; height: 105px; border: 2px dashed #cbd5e1; line-height: 105px; color: #94a3b8; font-size: 11px; margin: 0 auto; background-color: #ffffff; text-align: center; border-radius: 4px;">מקום&nbsp;לברקוד</div>`
            }
                                </div>
                            </td>
                        </tr>
                    </table>
                </div>

            </div>
        `;

        wrapper.innerHTML = htmlString;
        document.body.appendChild(wrapper);

        // המתנה ודאית לרינדור תמונות וגופנים במסמך לפני הצילום
        await new Promise(r => setTimeout(r, 400));

        const pdfOptions = {
            margin: 0,
            filename: `סיכום_${safeFilename}.pdf`,
            image: { type: 'jpeg', quality: 1.0 },
            html2canvas: {
                scale: 2,
                useCORS: true,
                scrollY: 0,
                backgroundColor: '#ffffff'
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };
        try {
            const pdfBlob = await html2pdf().set(pdfOptions).from(wrapper).output('blob');

            if (pdfBlob && pdfBlob.size > 0) {
                folder.file(`סיכום_${safeFilename}.pdf`, pdfBlob);
            } else {
                console.error("שגיאה: נוצר קובץ PDF ריק (0 בתים) עבור", report.name);
            }

        } catch (err) {
            console.error("שגיאה ביצירת PDF עבור", report.name, err);
        } finally {
            if (wrapper.parentElement) {
                document.body.removeChild(wrapper);
            }
        }
    }

    if (overlay.parentElement) {
        document.body.removeChild(overlay);
    }

    try {
        const zipBlob = await zip.generateAsync({ type: "blob" });
        downloadBlob(zipBlob, `${folderName}.zip`);
        return true;
    } catch (error) {
        console.error("Error generating final ZIP file:", error);
        throw new Error("שגיאה באריזת הנתונים לקובץ ZIP.");
    }
}

function downloadBlob(blob, fileName) {
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

window.profileManager.promptAddAdminFlight = function (pilot, flightName, period) {
    if (!window.isAdmin) return; // רק למנהלים

    const overlay = document.createElement('div');
    overlay.className = "fixed inset-0 bg-gray-900 bg-opacity-60 overflow-y-auto h-full w-full z-[100] flex justify-center items-center";
    overlay.id = "admin-add-flight-modal";

    overlay.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-xl w-96 text-right" dir="rtl">
            <h3 class="text-xl font-bold mb-2 text-ofer-dark-brown border-b pb-2">אישור גיחה ידני (ע"י מנהל)</h3>
            <p class="text-sm text-gray-600 mb-4">האם לאשר את הגיחה <span class="font-bold text-green-600">"${flightName}"</span> כבוצעה עבור <span class="font-bold">${pilot}</span>?</p>
            
            <div class="mb-4">
                <label class="block text-sm font-bold mb-2">כמות זמן לגיחה (בדקות):</label>
                <input type="number" id="admin-flight-minutes" value="60" class="w-full p-2 border rounded border-gray-300 focus:ring-ofer-orange bg-gray-50">
                <p class="text-xs text-gray-500 mt-1">* הזמן יתווסף לשעות הטיסה במעקב האישי ובהדפסת דוח הסיכום.</p>
            </div>

            <div class="flex justify-end gap-3 mt-6">
                <button id="cancel-admin-flight-btn" class="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 font-bold transition">ביטול</button>
                <button id="confirm-admin-flight-btn" class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 font-bold shadow transition">אשר גיחה</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('cancel-admin-flight-btn').onclick = () => {
        document.body.removeChild(overlay);
    };

    document.getElementById('confirm-admin-flight-btn').onclick = () => {
        const minutesInput = document.getElementById('admin-flight-minutes').value;
        const minutes = parseInt(minutesInput);
        if (isNaN(minutes) || minutes < 0) {
            import('../components/modals.js').then(m => m.showToast("יש להזין מספר דקות תקין", "red"));
            return;
        }
        document.body.removeChild(overlay);
        window.profileManager.saveAdminFlight(pilot, flightName, period, minutes);
    };
};

window.profileManager.saveAdminFlight = async function (pilot, flightName, period, minutes) {
    import('../components/modals.js').then(m => m.showToast("שומר גיחה...", "blue"));

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    const flightData = {
        executionStatus: "בוצעה",
        isAdminAdded: true, // חיווי שהגיחה נוספה ידנית
        date: dateStr,
        period: period,
        trainingType: "GENERIC_FLIGHT",
        data: {
            "שם גיחה": flightName,
            "סוג גיחה": "אישור מנהל",
            "טייס ימין": pilot, // נשמר תחת טייס ימין כדי שיספר נכון
            "שעות טיסה (דקות)": minutes,
            "תאריך": dateStr
        },
        timestamp: Date.now()
    };

    try {
        const { collection, addDoc } = window.firestoreFunctions;
        const docRef = await addDoc(collection(window.db, "flights"), flightData);

        flightData.id = docRef.id;
        if (!window.savedFlights) window.savedFlights = [];
        window.savedFlights.push(flightData);

        window.profileManager.updateMatrix();
        import('../components/modals.js').then(m => m.showToast("גיחה אושרה ידנית בהצלחה", "green"));
    } catch (e) {
        console.error(e);
        import('../components/modals.js').then(m => m.showToast("שגיאה בשמירת הגיחה", "red"));
    }
};

window.profileManager.promptRemoveAdminFlight = async function (flightId) {
    if (!window.isAdmin) return;
    if (!confirm("גיחה זו אושרה ידנית על ידי מנהל. האם ברצונך למחוק אותה ולהחזירה לסטטוס חסר (אדום)?")) return;

    import('../components/modals.js').then(m => m.showToast("מבטל אישור ידני...", "blue"));
    try {
        const { doc, deleteDoc } = window.firestoreFunctions;
        await deleteDoc(doc(window.db, "flights", flightId));

        // עדכון הרשימה הגלובלית המקומית
        window.savedFlights = window.savedFlights.filter(f => f.id !== flightId);

        window.profileManager.updateMatrix();
        import('../components/modals.js').then(m => m.showToast("אישור הגיחה בוטל והוחזר לאדום", "green"));
    } catch (e) {
        console.error(e);
        import('../components/modals.js').then(m => m.showToast("שגיאה בביטול אישור הגיחה", "red"));
    }
};

window.showFlightDetails = window.showFlightDetails || ((id) => { if (window.showFlightDetailsModal) window.showFlightDetailsModal(id); });