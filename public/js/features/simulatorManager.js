// public/js/features/simulatorManager.js

import { getPeriodDisplay } from '../core/util.js';
import { showFaultDetailsModal } from './faultManager.js';

let isListenerAttached = false;
// משתני פילטר מקומיים
let currentFilter = {
    period: '',
    month: ''
};
export function initSimulatorManager() {
    // אתחול הפילטרים ב-UI
    setupFilters();
    renderSimulatorDashboard();

    if (!isListenerAttached) {
        window.addEventListener('personnelListsUpdated', () => renderSimulatorDashboard());

        // מאזינים לשינוי פילטרים
        document.getElementById('sim-filter-period')?.addEventListener('change', (e) => {
            currentFilter.period = e.target.value;
            renderSimulatorDashboard();
        });
        document.getElementById('sim-filter-month')?.addEventListener('change', (e) => {
            currentFilter.month = e.target.value;
            renderSimulatorDashboard();
        });

        isListenerAttached = true;
    }
}

function setupFilters() {
    const periodSelect = document.getElementById('sim-filter-period');
    if (!periodSelect || periodSelect.options.length > 1) return;

    const today = new Date();
    const currentYear = today.getFullYear();
    // יצירת אפשרויות לתקופות (כמו ב-global.js)
    for (let year = currentYear - 1; year <= currentYear + 1; year++) {
        [1, 2].forEach(p => {
            const val = `${p}/${String(year).slice(-2)}`;
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            periodSelect.appendChild(opt);
        });
    }
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

function getFilteredFaults(simName) {
    const allFaults = window.unifiedFaultsDatabase || {};
    let faults = Object.values(allFaults).filter(f => f && f.simulator === simName);

    // סינון לפי חודש
    if (currentFilter.month !== '') {
        const targetMonth = parseInt(currentFilter.month);
        faults = faults.filter(f => {
            if (!f.firstReportTimestamp) return false;
            return new Date(f.firstReportTimestamp).getMonth() === targetMonth;
        });
    }

    // סינון לפי תקופה (חציון ושנה - למשל "1/24")
    if (currentFilter.period !== '') {
        const [period, year] = currentFilter.period.split('/');
        const fullYear = 2000 + parseInt(year);

        faults = faults.filter(f => {
            if (!f.firstReportTimestamp) return false;
            const d = new Date(f.firstReportTimestamp);
            const isYearMatch = d.getFullYear() === fullYear;
            // חציון 1 = חודשים 0-5 (ינואר-יוני), חציון 2 = חודשים 6-11 (יולי-דצמ)
            const isPeriodMatch = period === '1' ? d.getMonth() < 6 : d.getMonth() >= 6;

            return isYearMatch && isPeriodMatch;
        });
    }

    return faults;
}

/**
 * פונקציה לסינון הגיחות עבור מאמן ספציפי בהתאם לפילטרים של המערכת
 */
function getFilteredFlights(simName) {
    let flights = (window.savedFlights || []).filter(f => f.data && f.data['סימולטור'] === simName);

    // סינון לפי חודש
    if (currentFilter.month !== '') {
        const targetMonth = parseInt(currentFilter.month);
        flights = flights.filter(f => {
            if (!f.date) return false;
            return new Date(f.date).getMonth() === targetMonth;
        });
    }

    // סינון לפי תקופה (חציון ושנה - למשל "1/24")
    if (currentFilter.period !== '') {
        const [period, year] = currentFilter.period.split('/');
        const fullYear = 2000 + parseInt(year);

        flights = flights.filter(f => {
            if (!f.date) return false;
            const d = new Date(f.date);
            const isYearMatch = d.getFullYear() === fullYear;
            // חציון 1 = חודשים 0-5 (ינואר-יוני), חציון 2 = חודשים 6-11 (יולי-דצמ)
            const isPeriodMatch = period === '1' ? d.getMonth() < 6 : d.getMonth() >= 6;

            return isYearMatch && isPeriodMatch;
        });
    }

    return flights;
}

function createSimulatorCardHTML(simName, index) {
    const allFaults = window.unifiedFaultsDatabase || {};
    const faults = getFilteredFaults(simName);
    const openFaults = faults.filter(f => f.status && !f.status.isResolved);
    const avgCloseTime = calculateAverageClosureTime(faults);

    const isDown = openFaults.some(f => f.isDowntime); // האם יש תקלה פתוחה שהשביתה?
    const headerBgColor = isDown ? 'bg-red-600' : 'bg-ofer-dark-brown'; // צביעה באדום
    const metrics = calculateSimulatorMetrics(simName, faults, getFilteredFlights(simName));
    const openFaultsList = openFaults.length > 0
        ? openFaults.map(f => {
            // יצירת מחרוזות בטוחות כדי למנוע שבירה של ה-HTML בגלל גרשיים או מרכאות
            const safeKey = f.key ? f.key.replace(/'/g, "\\'").replace(/"/g, '&quot;') : '';
            const safeDesc = f.description ? f.description.replace(/"/g, '&quot;') : 'ללא תיאור';
            const displayDesc = f.description || 'ללא תיאור';

            return `
            <div class="flex justify-between items-center bg-red-50 p-2 rounded border border-red-100 mb-1 cursor-pointer hover:bg-red-100 transition"
                 onclick="window.showFaultDetailsModal('${safeKey}')">
                <span class="text-xs font-medium truncate w-2/3" title="${safeDesc}">${displayDesc}</span>
                <span class="text-[10px] text-gray-500">${f.firstReportTimestamp ? new Date(f.firstReportTimestamp).toLocaleDateString('he-IL') : ''}</span>
            </div>
          `;
        }).join('')
        : `<div class="text-center text-gray-400 text-xs py-2">אין תקלות פתוחות 🎉</div>`;

    return `
<div class="bg-white rounded-xl shadow-md overflow-hidden border ${isDown ? 'border-red-500 ring-2 ring-red-300' : 'border-gray-100'} flex flex-col h-[500px]">
        <div class="${headerBgColor} text-white px-4 py-3 flex justify-between items-center relative">
            <h2 class="font-bold text-lg cursor-pointer hover:text-ofer-light-orange transition underline" onclick="window.openSimulatorDetailsModal('${simName}')">${simName}</h2>
        <div class="flex items-center gap-2">
           <button onclick="window.openCloseSimulatorModal('${simName}')" class="bg-red-500 hover:bg-red-600 text-white text-xs px-2 py-1 rounded shadow">סגור מאמן להיום</button>
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
                <div class="grid grid-cols-2 gap-2">
                    <div class="bg-blue-50 p-3 rounded-lg text-center border border-blue-100 flex flex-col justify-center">
                        <div class="text-[11px] text-gray-500 mb-1 leading-tight">זמן ממוצע לסגירת תקלה בהיתר</div>
                        <div class="text-lg font-bold text-blue-700">${avgCloseTime}</div>
                        <div class="text-[10px] text-gray-400">שעות</div>
                    </div>
                    <div class="bg-orange-50 p-3 rounded-lg text-center border border-orange-100 flex flex-col justify-center">
                        <div class="text-xs text-gray-500 mb-1">סה"כ דווחו (חודשי)</div>
                        <div class="text-lg font-bold text-ofer-orange" id="monthly-count-${index}">-</div>
                        <div class="text-[10px] text-gray-400">החודש הנוכחי</div>
                    </div>
                </div>
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
                <div class="h-1/3 relative border rounded-lg p-2 bg-gray-50">
                     <h3 class="text-xs font-bold text-gray-700 absolute top-2 right-2">זמן טיפול (שעות)</h3>
                     <canvas id="chart-sim-time-${index}"></canvas>
                </div>
            </div>
        </div>
    </div>`;
}

function getTrendChartData(faults) {
    const dataCounts = {};

    // אם נבחר חודש מסוים בפילטר - נחלק את הנתונים ל-5 שבועות
    if (currentFilter.month !== '') {
        const weeks = ['שבוע 1', 'שבוע 2', 'שבוע 3', 'שבוע 4', 'שבוע 5'];
        weeks.forEach(w => dataCounts[w] = 0);

        faults.forEach(f => {
            if (!f.firstReportTimestamp) return;
            const d = new Date(f.firstReportTimestamp);
            const dateNum = d.getDate();

            if (dateNum <= 7) dataCounts['שבוע 1']++;
            else if (dateNum <= 14) dataCounts['שבוע 2']++;
            else if (dateNum <= 21) dataCounts['שבוע 3']++;
            else if (dateNum <= 28) dataCounts['שבוע 4']++;
            else dataCounts['שבוע 5']++;
        });
    } else {
        // אם לא נבחר חודש, נציג 6 חודשים אחרונים (כמו קודם)
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getMonth() + 1}/${d.getFullYear().toString().slice(-2)}`;
            dataCounts[key] = 0;
        }

        faults.forEach(f => {
            if (!f.firstReportTimestamp) return;
            const d = new Date(f.firstReportTimestamp);
            const key = `${d.getMonth() + 1}/${d.getFullYear().toString().slice(-2)}`;
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
    const ctxTime = document.getElementById(`chart-sim-time-${index}`);
    if (!ctxTrend || !ctxTime) return;

    // שינוי הכותרת בהתאם לפילטר
    const trendTitleEl = document.getElementById(`trend-title-${index}`);
    if (trendTitleEl) {
        trendTitleEl.textContent = currentFilter.month !== '' ? 'תקלות לפי שבועות (לחץ להגדלה)' : 'תקלות לפי חודשים (לחץ להגדלה)';
    }

    // משיכת הנתונים (שבועות או חודשים)
    const chartDataMap = getTrendChartData(faults);

    // ספירת "החודש הנוכחי" - נשאר רלוונטי לחודש הנוכחי קלנדרית
    const now = new Date();
    const currentMonthKey = `${now.getMonth() + 1}/${now.getFullYear().toString().slice(-2)}`;
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

    const avgTime = parseFloat(calculateAverageClosureTime(faults));

    const existingTrend = Chart.getChart(ctxTrend);
    if (existingTrend) existingTrend.destroy();
    const existingTime = Chart.getChart(ctxTime);
    if (existingTime) existingTime.destroy();

    // גרף מגמה מותאם
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

    // גרף זמן טיפול נשאר ללא שינוי
    new Chart(ctxTime, {
        type: 'bar',
        data: {
            labels: ['ממוצע'],
            datasets: [{
                data: [avgTime],
                backgroundColor: avgTime > 48 ? '#EF4444' : (avgTime > 24 ? '#F59E0B' : '#10B981')
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true }, y: { display: false } }
        }
    });
}

window.openSimulatorTrendModal = function (simName) {
    const modal = document.getElementById('generic-modal');
    const title = document.getElementById('modal-title');
    const content = document.getElementById('modal-content');

    if (!modal || !title || !content) return;

    title.textContent = currentFilter.month !== '' ? `מגמת תקלות (שבועית) - ${simName}` : `מגמת תקלות (חודשית) - ${simName}`;

    content.innerHTML = `
        <div class="w-full h-80 relative bg-white p-4 rounded-lg">
            <canvas id="modal-expanded-trend-chart"></canvas>
        </div>
    `;

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
                    tension: 0.3,
                    pointBackgroundColor: '#F59E0B',
                    pointRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: true, position: 'top' }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });
    }, 50);
};

window.openSimulatorDetailsModal = function (simName) {
    const modal = document.getElementById('generic-modal');
    const title = document.getElementById('modal-title');
    const content = document.getElementById('modal-content');

    if (!modal || !title || !content) return;

    title.textContent = `תמונת מצב מפורטת: ${simName}`;

    // משיכת הנתונים על סמך הפילטרים הקיימים
    const faults = getFilteredFaults(simName);
    const openFaults = faults.filter(f => f.status && !f.status.isResolved);

    content.innerHTML = `
        <div class="p-4" dir="rtl">
            <div class="grid grid-cols-2 gap-4 mb-6 text-center">
                <div class="bg-blue-50 p-4 rounded-lg border border-blue-100 shadow-sm">
                    <div class="text-3xl font-bold text-blue-700">${faults.length}</div>
                    <div class="text-sm text-gray-600 mt-1">סה"כ תקלות בתקופה זו</div>
                </div>
                <div class="bg-red-50 p-4 rounded-lg border border-red-100 shadow-sm">
                    <div class="text-3xl font-bold text-red-700">${openFaults.length}</div>
                    <div class="text-sm text-gray-600 mt-1">תקלות פתוחות להמשך טיפול</div>
                </div>
            </div>
            
            <h3 class="font-bold text-lg mb-3 border-b pb-2">כל התקלות הפתוחות:</h3>
            <div class="bg-gray-50 p-3 rounded-lg border">
                <ul class="list-disc list-inside text-sm space-y-2">
                    ${openFaults.length > 0 ?
            openFaults.map(f => `
                            <li class="pb-1 border-b border-gray-200 last:border-0">
                                <strong>${f.description || 'ללא תיאור'}</strong> 
                                <span class="text-gray-500 text-xs mr-2">(דווח ב: ${f.firstReportTimestamp ? new Date(f.firstReportTimestamp).toLocaleDateString('he-IL') : 'לא ידוע'})</span>
                            </li>
                        `).join('')
            : '<li class="text-gray-500">אין תקלות פתוחות כרגע למאמן זה.</li>'}
                </ul>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
};

window.saveSimulatorCloseTime = async function (simName, dateStr) {
    const timeVal = document.getElementById('sim-close-time-input').value;
    if (!timeVal) {
        alert("נא להזין שעה");
        return;
    }

    if (window.firestoreFunctions && window.db) {
        const { doc, setDoc } = window.firestoreFunctions;
        try {
            await setDoc(doc(window.db, "simulator_status", `${simName}_${dateStr}`), {
                simName: simName,
                date: dateStr,
                closeTime: timeVal,
                timestamp: Date.now()
            });
            import('../components/modals.js').then(m => m.showToast('שעת סגירה נשמרה', 'green'));
            document.getElementById('generic-modal').classList.add('hidden');
        } catch (e) {
            console.error(e);
            import('../components/modals.js').then(m => m.showToast('שגיאה בשמירה', 'red'));
        }
    }
}
window.renderSimulatorDashboard = renderSimulatorDashboard;