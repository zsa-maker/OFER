// public/js/features/simulatorManager.js

import { getPeriodDisplay } from '../core/util.js';
import { showFaultDetailsModal } from './faultManager.js';

window.facilityCloseTimes = {};

let isListenerAttached = false;
// משתני פילטר מקומיים
let currentFilter = {
    period: '',
    month: ''
};

export async function initSimulatorManager() {
    // טעינת הגדרות תקופה (עבור חישובי השבועות)
    if (!window.planningSettings && window.db) {
        try {
            const { doc, getDoc } = window.firestoreFunctions;
            const snap = await getDoc(doc(window.db, "settings", "planning"));
            if (snap.exists()) window.planningSettings = snap.data();
        } catch (e) { console.error("Failed to load planning settings", e); }
    }
    setupFilters();
    await fetchFacilityCloseTimes(); // משיכת שעות הסגירה מהדאטהבייס
    renderSimulatorDashboard();
    checkMissingCloseTimes(); // בדיקה אם שכחו לסגור אתמול

    if (!isListenerAttached) {
        window.addEventListener('personnelListsUpdated', () => renderSimulatorDashboard());
        isListenerAttached = true;
    }
}

async function fetchFacilityCloseTimes() {
    if (!window.db || !window.firestoreFunctions) return;
    try {
        const { collection, getDocs } = window.firestoreFunctions;
        const snap = await getDocs(collection(window.db, "facility_status"));
        snap.forEach(doc => {
            window.facilityCloseTimes[doc.id] = doc.data().closeTime;
        });
    } catch (e) { console.error("Failed to fetch close times", e); }
}


function checkMissingCloseTimes() {
    if (!window.savedFlights || window.savedFlights.length === 0) return;

    const today = new Date();

    // נסרוק 7 ימים אחורה, מהישן לחדש (כדי לטפל קודם בחובות ישנים של השבוע שעבר)
    for (let i = 7; i >= 0; i--) {
        const checkDate = new Date();
        checkDate.setDate(today.getDate() - i);

        // תיקון אזורי זמן כדי לקבל את התאריך המקומי המדויק YYYY-MM-DD
        const y = checkDate.getFullYear();
        const m = String(checkDate.getMonth() + 1).padStart(2, '0');
        const d = String(checkDate.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${d}`;

        // עבור היום הנוכחי, נבקש סגירה רק אם השעה אחרי 21:00
        if (i === 0 && today.getHours() < 21) continue;

        // בדיקה האם היו גיחות אמיתיות באותו תאריך
        const hasFlownFlights = window.savedFlights.some(f => {
            if (!f.date || !f.data) return false;

            // סינון גיחות שבוטלו
            const isCancelled = f.executionStatus === 'בוטלה' ||
                f.executionStatus === 'גיחה בוטלה' ||
                f.data['סוג גיחה'] === 'ביטול גיחה';

            if (isCancelled) return false;
            if (!f.data['שעת התחלה']) return false;

            // התאמת פורמט התאריך למקרה שיש בו חותמת זמן
            let fDateStr = f.date;
            if (fDateStr.includes('T')) fDateStr = fDateStr.split('T')[0];

            return fDateStr === dateStr;
        });

        // אם היו גיחות ואין שעת סגירה רשומה
        if (hasFlownFlights && !window.facilityCloseTimes[dateStr]) {
            showMissingCloseModal(dateStr);
            return; // עוצרים אחרי המודאל הראשון כדי לא להציף את המשתמש בכמה פופאפים בבת אחת
        }
    }
}

function showMissingCloseModal(dateStr) {
    const display = document.getElementById('missing-date-display');
    const inputDate = document.getElementById('missing-date-input');
    const modal = document.getElementById('missing-close-modal');
    if (display && inputDate && modal) {
        display.textContent = new Date(dateStr).toLocaleDateString('he-IL');
        inputDate.value = dateStr;
        modal.classList.remove('hidden');
    }
}

function getLocalPeriodDisplay(dateInput) {
    if (!dateInput) return null;
    const d = new Date(dateInput);
    let year = d.getFullYear();
    const month = d.getMonth();
    if (month === 11) { year++; return `1/${year.toString().slice(-2)}`; }
    return `${month < 5 ? "1" : "2"}/${year.toString().slice(-2)}`;
}


export function renderSimulatorDashboard() {
    const container = document.getElementById('simulators-dashboard-container');
    if (!container) return;

    const personnel = window.personnelLists || {};
    const simulators = Array.isArray(personnel.simulators) ? personnel.simulators : [];

    if (simulators.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center py-10">לא נמצאו מאמנים.</div>`;
        return;
    }

    // בניית הכרטיסים עם הנתונים המסוננים
    container.innerHTML = simulators.map((sim, index) => createSimulatorCardHTML(sim, index)).join('');

    // רינדור גרפים
    simulators.forEach((sim, index) => {
        try { renderSimulatorCharts(sim, index); } catch (e) { console.error(e); }
    });
}

window.toggleSimTimeFilters = function (type) {
    document.getElementById('sim-filter-period-group')?.classList.add('hidden');
    document.getElementById('sim-filter-month-group')?.classList.add('hidden');
    document.getElementById('sim-filter-week-group')?.classList.add('hidden');
    document.getElementById('sim-filter-range-group')?.classList.add('hidden');

    if (type === 'period') {
        document.getElementById('sim-filter-period-group')?.classList.remove('hidden');
    } else if (type === 'month') {
        document.getElementById('sim-filter-period-group')?.classList.remove('hidden');
        document.getElementById('sim-filter-month-group')?.classList.remove('hidden');
    } else if (type === 'week') {
        document.getElementById('sim-filter-period-group')?.classList.remove('hidden');
        document.getElementById('sim-filter-week-group')?.classList.remove('hidden');
    } else if (type === 'range') {
        document.getElementById('sim-filter-range-group')?.classList.remove('hidden');
    }
};

function isDateInSimFilter(dateObj) {
    const timeFilterType = document.getElementById('sim-time-filter-type')?.value || 'all';
    const d = new Date(dateObj);
    d.setHours(0, 0, 0, 0);

    if (timeFilterType === 'period') {
        const selectedPeriod = document.getElementById('sim-period-select')?.value;
        return getPeriodDisplay(d) === selectedPeriod;
    }
    else if (timeFilterType === 'month') {
        const selectedPeriod = document.getElementById('sim-period-select')?.value;
        const selectedMonth = parseInt(document.getElementById('sim-month-select')?.value);
        return getPeriodDisplay(d) === selectedPeriod && d.getMonth() === selectedMonth;
    }
    else if (timeFilterType === 'week') {
        const selectedWeek = parseInt(document.getElementById('sim-week-select')?.value);
        const selectedPeriod = document.getElementById('sim-period-select')?.value;
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
                const diffDays = Math.round((d - baseDate) / (1000 * 60 * 60 * 24));
                const weekNum = Math.floor(diffDays / 7) + 1;
                return weekNum === selectedWeek;
            }
        }
        return true;
    }
    else if (timeFilterType === 'range') {
        const startStr = document.getElementById('sim-date-start')?.value;
        const endStr = document.getElementById('sim-date-end')?.value;
        if (startStr && endStr) {
            const startDate = new Date(startStr);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(endStr);
            endDate.setHours(23, 59, 59, 999);
            return d >= startDate && d <= endDate;
        }
    }
    return true;
}

function setupFilters() {
    const periodSelect = document.getElementById('sim-period-select');
    if (periodSelect) {
        const periods = new Set();
        (window.savedFlights || []).forEach(f => {
            if (f.date) { const p = getPeriodDisplay(new Date(f.date)); if (p) periods.add(p); }
        });
        Object.values(window.unifiedFaultsDatabase || {}).forEach(f => {
            if (f.firstReportTimestamp) { const p = getPeriodDisplay(new Date(f.firstReportTimestamp)); if (p) periods.add(p); }
        });
        const sortedPeriods = Array.from(periods).sort((a, b) => {
            const [pA, yA] = a.split('/');
            const [pB, yB] = b.split('/');
            return yA !== yB ? Number(yA) - Number(yB) : Number(pA) - Number(pB);
        });

        periodSelect.innerHTML = sortedPeriods.map(p => `<option value="${p}">${p}</option>`).join('');
        if (sortedPeriods.length > 0) periodSelect.value = sortedPeriods[sortedPeriods.length - 1];
    }

    const weekSelect = document.getElementById('sim-week-select');
    if (weekSelect) {
        let html = '<option value="">בחר שבוע...</option>';
        for (let i = 1; i <= 26; i++) html += `<option value="${i}">שבוע ${i}</option>`;
        weekSelect.innerHTML = html;
    }
}


function getFilteredFaults(simName) {
    const allFaults = window.unifiedFaultsDatabase || {};
    let faults = Object.values(allFaults).filter(f => f && f.simulator === simName);
    return faults.filter(f => {
        if (!f.firstReportTimestamp) return false;
        return isDateInSimFilter(new Date(f.firstReportTimestamp));
    });
}

function getFilteredFlights(simName) {
    let flights = (window.savedFlights || []).filter(f => f.data && f.data['סימולטור'] === simName);
    return flights.filter(f => {
        if (!f.date) return false;
        return isDateInSimFilter(new Date(f.date));
    });
}

function createSimulatorCardHTML(simName, index) {
    const allFaults = window.unifiedFaultsDatabase || {};
    const faults = getFilteredFaults(simName);
    const openFaults = faults.filter(f => f.status && !f.status.isResolved);
    const avgCloseTime = calculateAverageClosureTime(faults);

    const isDown = openFaults.some(f => f.isDowntime); // האם יש תקלה פתוחה שהשביתה?

    const faultsForCard = getFilteredFaults(simName);
    const cardGeneralResolved = faultsForCard.filter(f => f.status?.isResolved && !f.status?.isClosedWithPermission && f.status?.timestamp && f.firstReportTimestamp);
    let cardGeneralAvg = "0";
    if (cardGeneralResolved.length > 0) {
        const totalMs = cardGeneralResolved.reduce((acc, f) => acc + (f.status.timestamp - f.firstReportTimestamp), 0);
        cardGeneralAvg = (totalMs / cardGeneralResolved.length / (1000 * 60 * 60)).toFixed(1);
    }

    const headerBgColor = isDown ? 'bg-red-600' : 'bg-ofer-dark-brown'; // צביעה באדום
    const metrics = calculateSimulatorMetrics(simName, faults, getFilteredFlights(simName));
    const openFaultsList = openFaults.length > 0
        ? openFaults.map(f => {
            const safeKey = f.key ? f.key.replace(/'/g, "\\'").replace(/"/g, '&quot;') : '';
            const safeDesc = f.description ? f.description.replace(/"/g, '&quot;') : 'ללא תיאור';
            const displayDesc = f.description || 'ללא תיאור';

            // בדיקה האם התקלה השביתה
            const isFaultDown = f.isDowntime;
            const itemBg = isFaultDown ? 'bg-red-500 text-white border-red-600 shadow-sm' : 'bg-red-50 text-gray-800 border-red-100 hover:bg-red-100';
            const textClass = isFaultDown ? 'font-bold' : 'font-medium';
            const dateClass = isFaultDown ? 'text-red-100' : 'text-gray-500';

            return `
            <div class="flex justify-between items-center p-2 rounded border mb-1 cursor-pointer transition ${itemBg}"
                 onclick="window.showFaultDetailsModal('${safeKey}')">
                <span class="text-xs ${textClass} truncate w-2/3" title="${safeDesc}">${isFaultDown ? '⚠️ ' : ''}${displayDesc}</span>
                <span class="text-[10px] ${dateClass}">${f.firstReportTimestamp ? new Date(f.firstReportTimestamp).toLocaleDateString('he-IL') : ''}</span>
            </div>
          `;
        }).join('')
        : `<div class="text-center text-gray-400 text-xs py-2">אין תקלות פתוחות 🎉</div>`;

    return `
<div class="bg-white rounded-xl shadow-md overflow-hidden border ${isDown ? 'border-red-500 ring-2 ring-red-300' : 'border-gray-100'} flex flex-col h-[500px]">
        <div class="${headerBgColor} text-white px-4 py-3 flex justify-between items-center relative">
            <h2 class="font-bold text-lg cursor-pointer hover:text-ofer-light-orange transition underline" onclick="window.openSimulatorDetailsModal('${simName}')">${simName}</h2>
        <div class="flex items-center gap-2">
           <span class="bg-white text-ofer-dark-brown text-xs px-2 py-1 rounded-full font-bold">
               ${openFaults.length} תקלות פתוחות
           </span>
        </div>
    </div>
    <div class="p-4 bg-gray-50 border-t border-b grid grid-cols-5 gap-2 text-center text-[10px] font-bold">
        <div class="flex flex-col">
            <span class="text-gray-500">זמינות טכנית</span>
            <span class="text-blue-600 text-sm">${metrics.availability}%</span>
        </div>
        <div class="flex flex-col">
            <span class="text-gray-500">אחוז ביטולים</span>
            <span class="text-red-600 text-sm">${metrics.cancellationRate}%</span>
        </div>
        <div class="flex flex-col">
            <span class="text-gray-500">MTBPC</span>
            <span class="text-orange-600 text-sm">${metrics.mtbpc} ש'</span>
        </div>
        <div class="flex flex-col">
            <span class="text-gray-500">ניצולת</span>
            <span class="text-green-600 text-sm">${metrics.utilization}%</span>
        </div>
        <div class="flex flex-col">
            <span class="text-gray-500">MTBF</span>
            <span class="text-purple-600 text-sm">${metrics.mtbf} ש'</span>
        </div>
    </div>
        <div class="flex-grow grid grid-cols-2 gap-4 p-4 min-h-0 text-right" dir="rtl">
            <div class="flex flex-col gap-4 overflow-hidden">
                <div class="flex-grow flex flex-col min-h-0 border rounded-lg p-2">
                    <h3 class="text-xs font-bold text-gray-700 mb-2 border-b pb-1">פירוט תקלות פתוחות</h3>
                    <div class="overflow-y-auto flex-grow custom-scrollbar">
                        ${openFaultsList}
                    </div>
                </div>
            </div>
<div class="flex flex-col gap-2 min-h-0">
                <div class="flex-grow relative border rounded-lg p-2 bg-gray-50 cursor-pointer hover:bg-gray-100 transition" 
                     onclick="window.openSimulatorTrendModal('${simName}')">
                    <h3 id="trend-title-${index}" class="text-xs font-bold text-gray-700 absolute top-2 right-2 z-10">תקלות לפי חודשים (לחץ להגדלה)</h3>
                    <canvas id="chart-sim-trend-${index}"></canvas>
                </div>
                <div class="h-1/3 relative border rounded-lg p-2 bg-gray-50 flex flex-col justify-center items-center">
                     <h3 class="text-xs font-bold text-gray-700 absolute top-2 right-2">זמן טיפול ממוצע</h3>
                     <div class="text-2xl font-bold text-gray-700 mt-4">${avgCloseTime} ש'</div>
                </div>
            </div>
        </div>
    </div>`;
}

function getTrendChartData(faults) {
    const dataCounts = {};
    const filterType = document.getElementById('sim-time-filter-type')?.value || 'all';

    if (filterType === 'week') {
        const selectedWeek = parseInt(document.getElementById('sim-week-select')?.value);
        const selectedPeriod = document.getElementById('sim-period-select')?.value;
        const planning = window.planningSettings || {};
        let weekStartDate = null;

        // מציאת התאריך האמיתי של תחילת השבוע המסונן
        if (selectedWeek && selectedPeriod) {
            let baseDateStr = null;
            if (planning.periodCurrStart && selectedPeriod === getPeriodDisplay(new Date(planning.periodCurrStart))) baseDateStr = planning.periodCurrStart;
            else if (planning.periodPrevStart && selectedPeriod === getPeriodDisplay(new Date(planning.periodPrevStart))) baseDateStr = planning.periodPrevStart;
            else if (planning.periodNextStart && selectedPeriod === getPeriodDisplay(new Date(planning.periodNextStart))) baseDateStr = planning.periodNextStart;

            if (baseDateStr) {
                weekStartDate = new Date(baseDateStr);
                weekStartDate.setHours(0, 0, 0, 0);
                weekStartDate.setDate(weekStartDate.getDate() - weekStartDate.getDay()); // הולך ליום ראשון של תחילת התקופה
                weekStartDate.setDate(weekStartDate.getDate() + (selectedWeek - 1) * 7); // מוסיף את מספר השבועות
            }
        }

        const dayNames = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "שבת"];
        const dateLabels = [];

        // בניית תוויות עם תאריכים מדויקים
        for (let i = 0; i < 7; i++) {
            if (weekStartDate) {
                const d = new Date(weekStartDate);
                d.setDate(d.getDate() + i);
                const dayStr = String(d.getDate()).padStart(2, '0');
                const monthStr = String(d.getMonth() + 1).padStart(2, '0');
                dateLabels.push(`${dayStr}/${monthStr} (${dayNames[i]})`);
            } else {
                dateLabels.push(`יום ${dayNames[i]}`); // גיבוי במידה ולא נמצא תאריך בסיס
            }
        }

        dateLabels.forEach(label => dataCounts[label] = 0);

        faults.forEach(f => {
            if (!f.firstReportTimestamp) return;
            const d = new Date(f.firstReportTimestamp);
            const dayIdx = d.getDay();
            dataCounts[dateLabels[dayIdx]]++;
        });

    } else if (filterType === 'month') {
        const selectedMonth = document.getElementById('sim-month-select')?.value;
        const mStr = String(parseInt(selectedMonth) + 1).padStart(2, '0');
        
        // בניית תוויות עם טווחי תאריכים במקום "שבוע 1"
        const weeks = [
            `01-07/${mStr}`, 
            `08-14/${mStr}`, 
            `15-21/${mStr}`, 
            `22-28/${mStr}`, 
            `29+/${mStr}`
        ];
        weeks.forEach(w => dataCounts[w] = 0);
        
        faults.forEach(f => {
            if (!f.firstReportTimestamp) return;
            const d = new Date(f.firstReportTimestamp);
            const dateNum = d.getDate();
            if (dateNum <= 7) dataCounts[weeks[0]]++;
            else if (dateNum <= 14) dataCounts[weeks[1]]++;
            else if (dateNum <= 21) dataCounts[weeks[2]]++;
            else if (dateNum <= 28) dataCounts[weeks[3]]++;
            else dataCounts[weeks[4]]++;
        });

    } else if (filterType === 'period' || filterType === 'range') {
        faults.forEach(f => {
            if (!f.firstReportTimestamp) return;
            const d = new Date(f.firstReportTimestamp);
            const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear().toString().slice(-2)}`;
            if (dataCounts[key] === undefined) dataCounts[key] = 0;
            dataCounts[key]++;
        });
        if (Object.keys(dataCounts).length === 0) {
            const now = new Date();
            dataCounts[`${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear().toString().slice(-2)}`] = 0;
        }

    } else {
        // ברירת מחדל (כל הזמן) - 6 חודשים אחרונים
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear().toString().slice(-2)}`;
            dataCounts[key] = 0;
        }
        faults.forEach(f => {
            if (!f.firstReportTimestamp) return;
            const d = new Date(f.firstReportTimestamp);
            const key = `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear().toString().slice(-2)}`;
            if (dataCounts[key] !== undefined) dataCounts[key]++;
        });
    }
    
    return dataCounts;
}

// פונקציית עזר לחישוב המדדים המבוקשים
function calculateSimulatorMetrics(simName, faults, filteredFlights) {
    // 1. זמן תכנון (סך שעות הגיחות שהיו אמורות להתקיים)
    const totalPlannedMinutes = filteredFlights.reduce((acc, f) => {
        const start = f.data['שעת התחלה'], end = f.data['שעת סיום'];
        if (!start || !end) return acc;
        let diff = (new Date(`1970-01-01T${end}:00`) - new Date(`1970-01-01T${start}:00`)) / 60000;
        return acc + (diff > 0 ? diff : diff + 1440);
    }, 0);
    const totalPlannedHours = totalPlannedMinutes / 60;

    const actualFlights = filteredFlights.filter(f => {
        const status = f.executionStatus;
        return status === 'בוצעה' || (status === 'בוצעה חלקית' && f.data['נדרש ביצוע חוזר'] !== 'כן');
    });
    const actualHours = actualFlights.reduce((acc, f) => {
        const start = f.data['שעת התחלה'], end = f.data['שעת סיום'];
        if (!start || !end) return acc; // <--- שורת ההגנה שהוספנו
        let diff = (new Date(`1970-01-01T${end}:00`) - new Date(`1970-01-01T${start}:00`)) / 60000;
        return acc + (diff > 0 ? diff : diff + 1440);
    }, 0) / 60;

    // 3. זמן השבתה (גיחות שבוטלו בגלל סיבה טכנית / תקלה משביתה)
    const downtimeHours = filteredFlights.filter(f => f.executionStatus === 'בוטלה' && f.data['סיבת ביטול'] === 'טכני')
        .reduce((acc, f) => {
            const start = f.data['שעת התחלה'], end = f.data['שעת סיום'];
            if (!start || !end) return acc; // <--- שורת ההגנה שהוספנו
            let diff = (new Date(`1970-01-01T${end}:00`) - new Date(`1970-01-01T${start}:00`)) / 60000;
            return acc + (diff > 0 ? diff : diff + 1440);
        }, 0) / 60;
    // 4. ספירת תקלות (סינון "לא תקלה")
    const validFaults = faults.filter(f => f.status?.faultCategory !== 'לא תקלה');
    const downtimeFaultsCount = validFaults.filter(f => f.isDowntime).length;

    // חישוב המדדים
    const metrics = {
        availability: totalPlannedHours > 0 ? ((totalPlannedHours - downtimeHours) / totalPlannedHours * 100).toFixed(1) : "0",
        cancellationRate: filteredFlights.length > 0 ?
            (((filteredFlights.filter(f => f.executionStatus === 'בוטלה' || (f.executionStatus === 'בוצעה חלקית' && f.data['נדרש ביצוע חוזר'] === 'כן')).length) / filteredFlights.length) * 100).toFixed(1) : "0",
        mtbpc: validFaults.length > 0 ? (actualHours / validFaults.length).toFixed(1) : actualHours.toFixed(1),
        utilization: totalPlannedHours > 0 ? (actualHours / totalPlannedHours * 100).toFixed(1) : "0",
        mtbf: downtimeFaultsCount > 0 ? (totalPlannedHours / downtimeFaultsCount).toFixed(1) : totalPlannedHours.toFixed(1)
    };

    return metrics;
}

function calculateAverageClosureTime(faults) {
    const resolved = faults.filter(f => f.status?.isResolved && f.status?.timestamp && f.firstReportTimestamp);
    if (resolved.length === 0) return "0";
    const totalMs = resolved.reduce((acc, f) => acc + (f.status.timestamp - f.firstReportTimestamp), 0);
    return (totalMs / resolved.length / (1000 * 60 * 60)).toFixed(1);
}

function renderSimulatorCharts(simName, index) {
    if (typeof Chart === 'undefined') return;

    const faults = getFilteredFaults(simName);
    const ctxTrend = document.getElementById(`chart-sim-trend-${index}`);
    
    if (!ctxTrend) return; 

    // עדכון כותרת הגרף בעמוד הראשי בהתאם לסינון
    const filterType = document.getElementById('sim-time-filter-type')?.value || 'all';
    const trendTitleEl = document.getElementById(`trend-title-${index}`);
    if (trendTitleEl) {
        if (filterType === 'week') trendTitleEl.textContent = 'תקלות לפי ימים (לחץ להגדלה)';
        else if (filterType === 'month') trendTitleEl.textContent = 'תקלות לפי שבועות (לחץ להגדלה)';
        else trendTitleEl.textContent = 'תקלות לפי חודשים (לחץ להגדלה)';
    }

    const chartDataMap = getTrendChartData(faults);

    const now = new Date();
    let currentMonthCount = 0;
    faults.forEach(f => {
        if (!f.firstReportTimestamp) return;
        const d = new Date(f.firstReportTimestamp);
        if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) {
            currentMonthCount++;
        }
    });

    const currentCountEl = document.getElementById(`monthly-count-${index}`);
    if (currentCountEl) currentCountEl.textContent = currentMonthCount;

    const existingTrend = Chart.getChart(ctxTrend);
    if (existingTrend) existingTrend.destroy();

    new Chart(ctxTrend, {
        type: 'line',
        data: {
            labels: Object.keys(chartDataMap),
            datasets: [{
                data: Object.values(chartDataMap),
                borderColor: '#F59E0B',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}

window.openSimulatorTrendModal = function (simName) {
    const modal = document.getElementById('generic-modal');
    const title = document.getElementById('modal-title');
    const content = document.getElementById('modal-content');
    if (!modal || !title || !content) return;

    // עדכון כותרת המודאל הפנימי בהתאם לסינון
    const filterType = document.getElementById('sim-time-filter-type')?.value || 'all';
    let titleStr = `מגמת תקלות (חודשית) - ${simName}`;
    if (filterType === 'week') titleStr = `מגמת תקלות (יומית) - ${simName}`;
    if (filterType === 'month') titleStr = `מגמת תקלות (שבועית) - ${simName}`;
    title.textContent = titleStr;

    content.innerHTML = `<div class="w-full h-80 relative bg-white p-4 rounded-lg"><canvas id="modal-expanded-trend-chart"></canvas></div>`;
    modal.classList.remove('hidden');

    const faults = getFilteredFaults(simName);
    const chartDataMap = getTrendChartData(faults);

    setTimeout(() => {
        const ctx = document.getElementById('modal-expanded-trend-chart');
        if (!ctx) return;
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: Object.keys(chartDataMap),
                datasets: [{
                    label: 'כמות תקלות שדווחו',
                    data: Object.values(chartDataMap),
                    borderColor: '#F59E0B',
                    backgroundColor: 'rgba(245, 158, 11, 0.2)',
                    fill: true,
                    tension: 0.3, pointBackgroundColor: '#F59E0B', pointRadius: 5
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'top' } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
        });
    }, 50);
};

window.openSimulatorDetailsModal = function (simName) {
    const modal = document.getElementById('generic-modal');
    const title = document.getElementById('modal-title');
    const content = document.getElementById('modal-content');

    if (!modal || !title || !content) return;

    title.textContent = `תמונת מצב מפורטת: ${simName}`;

    // תקלות מסוננות (לפי חודש/תקופה)
    const filteredFaults = getFilteredFaults(simName);
    const filteredOpenFaults = filteredFaults.filter(f => f.status && !f.status.isResolved);


    // כל התקלות (ללא קשר לסינון בעמוד)
    const allFaults = Object.values(window.unifiedFaultsDatabase || {}).filter(f => f.simulator === simName);
    const allOpenFaults = allFaults.filter(f => f.status && !f.status.isResolved);

    const flights = getFilteredFlights(simName);

    const sortedFaults = [...filteredFaults].sort((a, b) => {
        if (a.status?.isResolved !== b.status?.isResolved) return a.status?.isResolved ? 1 : -1;
        return (b.firstReportTimestamp || 0) - (a.firstReportTimestamp || 0);
    });

    // ממוצע 24/7 לכלל התקלות שאינן בהיתר (לפי הסינון)
    const generalResolved = filteredFaults.filter(f => f.status?.isResolved && !f.status?.isClosedWithPermission && f.status?.timestamp && f.firstReportTimestamp);
    let generalAvg = "0";
    if (generalResolved.length > 0) {
        const totalMs = generalResolved.reduce((acc, f) => acc + (f.status.timestamp - f.firstReportTimestamp), 0);
        generalAvg = (totalMs / generalResolved.length / (1000 * 60 * 60)).toFixed(1);
    }

    // חישוב ממוצע סגירת תקלה בהיתר (רק לפי שעות הפעלה - לפי הסינון)
    const permissionFaults = filteredFaults.filter(f => f.status && f.status.isResolved && (f.status.isClosedWithPermission || f.status.wasClosedWithPermission));
    let totalOperatingHours = 0;
    let validCount = 0;

    permissionFaults.forEach(f => {
        if (f.firstReportTimestamp && f.status.timestamp) {
            totalOperatingHours += calculateOperatingHoursBetween(f.firstReportTimestamp, f.status.timestamp, flights);
            validCount++;
        }
    });
    const avgOpCloseTime = validCount > 0 ? (totalOperatingHours / validCount).toFixed(1) : "0";

    // יצירת רשימה לחיצה לטאב "כל התקלות הפתוחות"
    const renderFaultList = (faultList) => {
        if (faultList.length === 0) return '<li class="text-gray-500">אין תקלות פתוחות.</li>';
        return faultList.map(f => {
            const safeKey = f.key ? f.key.replace(/'/g, "\\'").replace(/"/g, '&quot;') : '';
            return `
            <li class="pb-1 border-b border-gray-200 last:border-0 ${f.isDowntime ? 'text-red-600 font-bold' : ''} cursor-pointer hover:bg-gray-200 transition p-1 rounded" onclick="window.showFaultDetailsModal('${safeKey}')">
                ${f.isDowntime ? '⚠️ ' : ''}<strong>${f.description || 'ללא תיאור'}</strong> 
                <span class="text-gray-500 text-xs mr-2">(דווח ב: ${f.firstReportTimestamp ? new Date(f.firstReportTimestamp).toLocaleDateString('he-IL') : 'לא ידוע'})</span>
            </li>
        `}).join('');
    };

    content.innerHTML = `
        <div class="p-4" dir="rtl">
            <div class="grid grid-cols-4 gap-4 mb-6 text-center">
                <div class="bg-blue-50 p-4 rounded-lg border border-blue-100 shadow-sm">
                    <div class="text-3xl font-bold text-blue-700">${filteredFaults.length}</div>
                    <div class="text-[10px] font-bold text-gray-600 mt-1">סה"כ תקלות (בסינון)</div>
                </div>
                <div class="bg-red-50 p-4 rounded-lg border border-red-100 shadow-sm">
                    <div class="text-3xl font-bold text-red-700">${filteredOpenFaults.length}</div>
                    <div class="text-[10px] font-bold text-gray-600 mt-1">תקלות פתוחות (בסינון)</div>
                </div>
                <div class="bg-gray-50 p-4 rounded-lg border border-gray-200 shadow-sm">
                    <div class="text-2xl font-bold text-gray-700">${generalAvg} ש'</div>
                    <div class="text-[10px] font-bold text-gray-600 mt-1">זמן טיפול ממוצע (בסינון)</div>
                </div>
                <div class="bg-green-50 p-4 rounded-lg border border-green-200 shadow-sm">
                    <div class="text-2xl font-bold text-green-700">${avgOpCloseTime} ש'</div>
                    <div class="text-[10px] font-bold text-gray-600 mt-1">ממוצע שעות הפעלה בהיתר</div>
                </div>
            </div>
            
            <div class="flex justify-between items-center mb-3 border-b pb-2">
                <h3 class="font-bold text-lg">כל התקלות בתקופה זו:</h3>
                <button onclick="window.exportSimulatorFaultsToExcel('${simName}')" class="bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-1.5 px-3 rounded flex items-center gap-2 shadow transition">
                    <i class="fas fa-file-excel"></i> ייצא לאקסל
                </button>
            </div>
            
            <div class="mb-4 border-b border-gray-200">
                <ul class="flex flex-wrap -mb-px text-sm font-medium text-center">
                    <li class="mr-2">
                        <button class="inline-block p-2 text-sm border-b-2 border-transparent hover:text-gray-600 hover:border-gray-300" id="tab-all-open" onclick="window.switchSimFaultTab('all')">
                             התקלות הפתוחות במאמן (${allOpenFaults.length})
                        </button>
                    </li>
                    <li class="mr-2">
                        <button class="inline-block p-2 text-sm border-b-2 border-ofer-orange text-ofer-orange font-bold active" id="tab-filtered-open" onclick="window.switchSimFaultTab('filtered')">
                           כל התקלות בתקופה(${filteredOpenFaults.length})
                        </button>
                    </li>
                </ul>
            </div>

            <div id="tab-content-all" class="bg-gray-50 p-3 rounded-lg border hidden h-48 overflow-y-auto custom-scrollbar">
                <ul class="list-disc list-inside text-sm space-y-2">
                    ${renderFaultList(allOpenFaults)}
                </ul>
            </div>
            
            <div id="tab-content-filtered" class="bg-gray-50 p-3 rounded-lg border h-48 overflow-y-auto custom-scrollbar">
                <ul class="list-disc list-inside text-sm space-y-2">
                    ${sortedFaults.length > 0 ?
            sortedFaults.map(f => {
                const safeKey = f.key ? f.key.replace(/'/g, "\\'").replace(/"/g, '&quot;') : '';
                const isResolved = f.status?.isResolved;
                const statusText = isResolved ? 'טופלה' : 'פתוחה';
                const textColor = isResolved ? 'text-gray-500' : 'text-red-600 font-bold';
                return `
                            <li class="pb-1 border-b border-gray-200 last:border-0 ${textColor} cursor-pointer hover:bg-gray-200 transition p-1 rounded" onclick="window.showFaultDetailsModal('${safeKey}')">
                                <strong>${f.description || 'ללא תיאור'}</strong> 
                                <span class="text-xs text-gray-500 mr-2">
                                    (דווח ב: ${f.firstReportTimestamp ? new Date(f.firstReportTimestamp).toLocaleDateString('he-IL') : 'לא ידוע'}) 
                                    - <span class="${textColor}">${statusText}</span>
                                </span>
                            </li>
                            `;
            }).join('')
            : '<li class="text-gray-500">לא דווחו תקלות למאמן זה בתקופה המסוננת.</li>'}
                </ul>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
};

window.exportSimulatorFaultsToExcel = function(simName) {
    const faults = getFilteredFaults(simName);
    if (faults.length === 0) {
        import('../components/modals.js').then(m => m.showToast('אין תקלות לייצוא לתקופה זו.', 'yellow'));
        return;
    }

    let csvContent = "\uFEFF"; // קידוד שמוודא שעברית נפתחת נכון באקסל
    csvContent += "מאמן,תיאור תקלה,מערכת,תאריך דיווח,סטטוס,תאריך סגירה,זמן טיפול (שעות),נסגר בהיתר,טכנאי מטפל,תיאור פתרון\n";

    // מיון כמו בפופאפ
    const sortedFaults = [...faults].sort((a, b) => {
        if (a.status?.isResolved !== b.status?.isResolved) return a.status?.isResolved ? 1 : -1;
        return (b.firstReportTimestamp || 0) - (a.firstReportTimestamp || 0);
    });

    sortedFaults.forEach(f => {
        // ניקוי פסיקים ושורות חדשות כדי לא לשבור את העמודות ב-CSV
        const desc = f.description ? f.description.replace(/,/g, ' - ').replace(/\n/g, ' ') : 'ללא תיאור';
        const sys = f.systemClassification ? f.systemClassification.replace(/,/g, ' - ') : '-';
        const reportDate = f.firstReportTimestamp ? new Date(f.firstReportTimestamp).toLocaleDateString('he-IL') : 'לא ידוע';
        
        let status = 'פתוחה';
        let closeDate = '';
        let handleTime = '';
        let permission = 'לא';
        let technician = '';
        let resolutionDesc = '';

        if (f.status && f.status.isResolved) {
            status = 'טופלה';
            closeDate = f.status.date || '';
            if (f.status.isClosedWithPermission || f.status.wasClosedWithPermission) permission = 'כן';
            
            if (f.status.timestamp && f.firstReportTimestamp) {
                const diffHours = (f.status.timestamp - f.firstReportTimestamp) / (1000 * 60 * 60);
                handleTime = diffHours.toFixed(1);
            }
            
            technician = f.status.technicianName ? f.status.technicianName.replace(/,/g, ' - ') : '';
            resolutionDesc = f.status.resolutionDescription ? f.status.resolutionDescription.replace(/,/g, ' - ').replace(/\n/g, ' ') : '';
        }

        csvContent += `${simName},${desc},${sys},${reportDate},${status},${closeDate},${handleTime},${permission},${technician},${resolutionDesc}\n`;
    });

    const encodedUri = encodeURI("data:text/csv;charset=utf-8," + csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `דוח_תקלות_${simName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// פונקציה להחלפת הטאבים (הוסיפי אותה מיד מתחת ל- openSimulatorDetailsModal)
window.switchSimFaultTab = function (tab) {
    const btnAll = document.getElementById('tab-all-open');
    const btnFiltered = document.getElementById('tab-filtered-open');
    const contentAll = document.getElementById('tab-content-all');
    const contentFiltered = document.getElementById('tab-content-filtered');

    if (tab === 'all') {
        btnAll.className = 'inline-block p-2 text-sm border-b-2 border-ofer-orange text-ofer-orange font-bold active';
        btnFiltered.className = 'inline-block p-2 text-sm border-b-2 border-transparent hover:text-gray-600 hover:border-gray-300';
        contentAll.classList.remove('hidden');
        contentFiltered.classList.add('hidden');
    } else {
        btnFiltered.className = 'inline-block p-2 text-sm border-b-2 border-ofer-orange text-ofer-orange font-bold active';
        btnAll.className = 'inline-block p-2 text-sm border-b-2 border-transparent hover:text-gray-600 hover:border-gray-300';
        contentFiltered.classList.remove('hidden');
        contentAll.classList.add('hidden');
    }
};

// פונקציה שמחשבת את חלון ההפעלה של יום ספציפי: 15 דק' לפני גיחה ראשונה עד שעת הסגירה
export function getDailyOperatingWindow(dateStr, flights) {
    const dayFlights = flights.filter(f => f.date === dateStr && f.executionStatus !== 'בוטלה' && f.data['שעת התחלה']);
    if (dayFlights.length === 0) return null;

    let earliest = "23:59";
    let latest = "00:00";
    dayFlights.forEach(f => {
        if (f.data['שעת התחלה'] < earliest) earliest = f.data['שעת התחלה'];
        if (f.data['שעת סיום'] > latest) latest = f.data['שעת סיום'];
    });

    // התחלה: 15 דקות לפני גיחה ראשונה
    const startDt = new Date(`${dateStr}T${earliest}:00`);
    startDt.setMinutes(startDt.getMinutes() - 15);

    // סיום: שעת סגירה מהדאטהבייס, ואם אין - שעת סיום של גיחה אחרונה
    let endDt;
    const closeTimeStr = window.facilityCloseTimes[dateStr];
    if (closeTimeStr) {
        endDt = new Date(`${dateStr}T${closeTimeStr}:00`);
        if (endDt < startDt) endDt.setDate(endDt.getDate() + 1); // אם גלש מעבר לחצות
    } else {
        endDt = new Date(`${dateStr}T${latest}:00`);
    }

    return { start: startDt.getTime(), end: endDt.getTime(), durationHours: (endDt.getTime() - startDt.getTime()) / 3600000 };
}

// חישוב שעות חופפות בין זמן התקלה לזמני ההפעלה האמיתיים
function calculateOperatingHoursBetween(startTs, endTs, flights) {
    const datesWithFlights = [...new Set(flights.map(f => f.date))];
    let operatingMs = 0;

    datesWithFlights.forEach(dateStr => {
        const opWindow = getDailyOperatingWindow(dateStr, flights);
        if (!opWindow) return;

        const overlapStart = Math.max(startTs, opWindow.start);
        const overlapEnd = Math.min(endTs, opWindow.end);

        if (overlapEnd > overlapStart) {
            operatingMs += (overlapEnd - overlapStart);
        }
    });

    return operatingMs / (1000 * 60 * 60);
}

window.openGlobalCloseModal = function () {
    const now = new Date();
    document.getElementById('global-close-time-input').value = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('global-close-modal').classList.remove('hidden');
}

window.saveGlobalCloseTime = async function () {
    const timeVal = document.getElementById('global-close-time-input').value;
    const dateStr = new Date().toISOString().split('T')[0];
    await _saveFacilityTime(dateStr, timeVal, 'global-close-modal');
}

window.saveMissingCloseTime = async function () {
    const timeVal = document.getElementById('missing-close-time-input').value;
    const dateStr = document.getElementById('missing-date-input').value;
    if (!timeVal) {
        import('../components/modals.js').then(m => m.showToast('נא להזין שעה', 'red'));
        return;
    }
    await _saveFacilityTime(dateStr, timeVal, 'missing-close-modal');
}

async function _saveFacilityTime(dateStr, timeVal, modalId) {
    if (!timeVal) return;
    if (window.firestoreFunctions && window.db) {
        const { doc, setDoc } = window.firestoreFunctions;
        try {
            await setDoc(doc(window.db, "facility_status", dateStr), {
                date: dateStr,
                closeTime: timeVal,
                timestamp: Date.now()
            });
            window.facilityCloseTimes[dateStr] = timeVal; // עדכון מקומי
            import('../components/modals.js').then(m => m.showToast('שעת סגירת מתקן נשמרה', 'green'));
            document.getElementById(modalId).classList.add('hidden');
            renderSimulatorDashboard(); // רענון נתונים
        } catch (e) {
            console.error(e);
            import('../components/modals.js').then(m => m.showToast('שגיאה בשמירה', 'red'));
        }
    }
}

window.renderSimulatorDashboard = renderSimulatorDashboard;