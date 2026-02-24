// public/js/features/statsManager.js

import { savedFlights } from '../core/global.js';
import { EXECUTION_STATUS_NOT_REPORTED } from './executionStatusManager.js';
import { setPeriodDates, getPeriodNumber, getWeekNumber, getPeriodDisplay } from '../core/util.js';

window.statsManager = window.statsManager || {};

// משתנה לשמירת מופעי הגרפים
let chartInstances = {
    execution: null,
    cancellation: null,
    types: null,
    instructors: null,
    planning: null,
    simHours: null,
    metrics: null,
    goals: null
};

let listenersInitialized = false;

let currentCrewFilters = {
    instructorFem: "",
    instructorMale: ""
};

let modalChartInstance = null;
let currentFilteredFlights = [];

// משתנה לשמירת נתוני התכנון (מטמון)
let cachedPlanningData = null;

let currentMainCardId = 'stats-card-planning';

export async function renderStatsDashboard() {
    initFiltersUI();
    cachedPlanningData = await fetchPlanningData();

    if (cachedPlanningData) {
        const p1 = cachedPlanningData.periodCurrStart;
        const p2 = cachedPlanningData.periodNextStart;
        setPeriodDates(p1, p2);
    }

    const allActiveFlights = savedFlights.filter(f => f.executionStatus !== EXECUTION_STATUS_NOT_REPORTED);
    populateStatsPeriodSelect(allActiveFlights);

    const dateFilterPredicate = getDateFilterPredicate();

    const timeFilteredFlights = allActiveFlights.filter(f => {
        if (!f.date) return false;
        return dateFilterPredicate(new Date(f.date));
    });

    updateCrewFilterState();
    updateCrewFilterOptions(timeFilteredFlights);

    // סינון לפי צוות
    let finalFlights = filterFlightsByCrew(timeFilteredFlights);

    // --- הוספה: עדכון וסינון לפי סוג גיחה ---
    updateFlightTypeFilterOptions(finalFlights);
    const selectedFlightType = document.getElementById('filter-flight-type')?.value;

    if (selectedFlightType) {
        finalFlights = finalFlights.filter(f => f.data && f.data['סוג גיחה'] === selectedFlightType);
    }

    currentFilteredFlights = finalFlights;

    const exportBtn = document.getElementById('export-report-btn');
    if (exportBtn) {
        exportBtn.classList.toggle('hidden', !selectedFlightType);
    }

    // --- הוספה: הסתרת גרף שעות מאמן כאשר נבחר סוג גיחה ---
    const simCard = document.getElementById('stats-card-sim-hours');
    const typeCard = document.getElementById('stats-card-flight-types');
    if (simCard) {
        if (selectedFlightType) {
            simCard.classList.add('hidden');
            // אם במקרה גרף המאמנים הוא המוגדל כרגע, נחזיר את המיקוד לגרף התכנון כדי לא להשאיר חור במסך
            if (currentMainCardId === 'stats-card-sim-hours') {
                window.statsManager.swapToMain('stats-card-planning');
            }
        } else {
            simCard.classList.remove('hidden');
        }
    }
    if (typeCard) {
        if (selectedFlightType) {
            typeCard.classList.add('hidden');
            if (currentMainCardId === 'stats-card-flight-types') {
                window.statsManager.swapToMain('stats-card-planning');
            }
        } else {
            typeCard.classList.remove('hidden');
        }
    }
    // ----------------------------------------------------

    requestAnimationFrame(() => {
        renderExecutionStatusChart(finalFlights);
        renderCancellationReasonsChart(finalFlights);
        renderFlightTypesChart(finalFlights);
        renderInstructorsChart(finalFlights);
        renderPlanningVsExecutionChart(finalFlights, cachedPlanningData, dateFilterPredicate);

        // נרנדר את גרף שעות מאמן רק אם לא בחרנו סוג גיחה ספציפי
        if (!selectedFlightType) {
            renderSimulatorsUsageChart(timeFilteredFlights);
        }

        renderMetricsUtilizationChart(finalFlights);
        if (typeof renderGoalsChart === 'function') {
            renderGoalsChart(finalFlights);
        }
    });
}

// --- פונקציות עזר (Helpers) ---

function updateFlightTypeFilterOptions(flights) {
    const selectType = document.getElementById('filter-flight-type');
    if (!selectType) return;

    const currentVal = selectType.value;
    const typesSet = new Set();

    flights.forEach(f => {
        const type = f.data?.['סוג גיחה'];
        if (type) typesSet.add(type);
    });

    selectType.innerHTML = '<option value="">כל הסוגים</option>';
    Array.from(typesSet).sort().forEach(type => {
        const op = document.createElement('option');
        op.value = type;
        op.textContent = type;
        selectType.appendChild(op);
    });

    if (typesSet.has(currentVal)) {
        selectType.value = currentVal;
    }
}

function renderGoalsChart(flights) {
    const id = 'chart-goals-status';
    const ctx = document.getElementById(id);
    const selector = document.getElementById('stats-goal-flight-selector');
    if (!ctx || !selector) return;

    destroyChartIfExists('goals', id);

    // עדכון סלקטור שמות הגיחות הפנימי
    const currentSelectedName = selector.value;
    const namesSet = new Set();
    flights.forEach(f => {
        if (f.data?.['שם גיחה']) namesSet.add(f.data['שם גיחה']);
    });

    selector.innerHTML = '<option value="">כל הגיחות</option>' +
        Array.from(namesSet).map(name => `<option value="${name}" ${name === currentSelectedName ? 'selected' : ''}>${name}</option>`).join('');

    const activeFlightName = selector.value;

    // סינון הגיחות לחישוב במידה ונבחרה גיחה ספציפית
    const flightsToProcess = activeFlightName ? flights.filter(f => f.data?.['שם גיחה'] === activeFlightName) : flights;

    let met = 0;
    let notMet = 0;

    flightsToProcess.forEach(f => {
        if (f.goalsStatus) {
            Object.values(f.goalsStatus).forEach(status => {
                if (status === 'עמד.ה') met++;
                if (status === 'לא עמד.ה') notMet++;
            });
        }
    });

    chartInstances.goals = new Chart(ctx, {
        type: 'pie',
        plugins: [ChartDataLabels],
        data: {
            labels: ['עמד.ה ביעדים', 'לא עמד.ה ביעדים'],
            datasets: [{
                data: [met, notMet],
                backgroundColor: ['#10B981', '#EF4444'], // ירוק ואדום
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                datalabels: {
                    color: '#fff',
                    font: { weight: 'bold', size: 14 },
                    formatter: (value, ctx) => {
                        if (value === 0) return '';
                        if (!showAsPercent) return value;
                        const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                        return ((value / total) * 100).toFixed(1) + "%";
                    }
                }
            }
        }
    });
}

window.statsManager.exportReport = function () {
    const flightType = document.getElementById('filter-flight-type').value;
    if (!flightType) {
        alert('יש לבחור סוג גיחה תחילה.');
        return;
    }

    // איסוף תמונות הגרפים (מוודא שהגרפים קיימים)
    const goalsCanvas = document.getElementById('chart-goals-status');
    const metricsCanvas = document.getElementById('chart-metrics-utilization');

    const goalsImg = goalsCanvas ? goalsCanvas.toDataURL('image/png') : '';
    const metricsImg = metricsCanvas ? metricsCanvas.toDataURL('image/png') : '';

    // איסוף הערות כלליות (אם קיים והסוג הוא יום אימון)
    let remarksHTML = '';
    if (flightType === 'יום אימון') {
        const remarks = currentFilteredFlights
            .filter(f => f.data && f.data['הערות כלליות'])
            .map(f => {
                const date = new Date(f.date).toLocaleDateString('he-IL');
                const name = f.data['שם גיחה'] || 'ללא שם';
                const remark = f.data['הערות כלליות'];
                return `<li style="margin-bottom: 10px;"><strong>${date} - ${name}:</strong> ${remark}</li>`;
            });

        if (remarks.length > 0) {
            remarksHTML = `
                <div style="margin-top: 30px; page-break-inside: avoid;">
                    <h3 style="color: #333; border-bottom: 2px solid #ddd; padding-bottom: 5px;">הערות כלליות (ימי אימון):</h3>
                    <ul style="line-height: 1.6;">${remarks.join('')}</ul>
                </div>
            `;
        } else {
            remarksHTML = `<p style="margin-top: 20px; font-style: italic;">לא נרשמו הערות כלליות בימי אימון אלו.</p>`;
        }
    }

    // יצירת חלון ההדפסה
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html dir="rtl" lang="he">
        <head>
            <title>דוח סיכום - ${flightType}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
                h1 { text-align: center; color: #1e3a8a; }
                .report-info { text-align: center; margin-bottom: 30px; color: #666; }
                .charts-container { display: flex; justify-content: space-around; flex-wrap: wrap; margin-top: 20px; }
                .chart-box { width: 45%; text-align: center; margin-bottom: 20px; }
                .chart-box img { max-width: 100%; height: auto; border: 1px solid #eee; border-radius: 8px; padding: 10px; }
                @media print {
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="no-print" style="text-align: left; margin-bottom: 20px;">
                <button onclick="window.print()" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 5px; cursor: pointer;">הדפס / שמור כ-PDF</button>
            </div>
            
            <h1>דוח ביצוע - ${flightType}</h1>
            <div class="report-info">
                <p>הדוח כולל נתונים בהתאם לסינוני הזמן והצוות שהוגדרו במערכת.</p>
                <p>תאריך הפקה: ${new Date().toLocaleDateString('he-IL')}</p>
            </div>

            <div class="charts-container">
                <div class="chart-box">
                    <h3>עמידה ביעדים</h3>
                    ${goalsImg ? `<img src="${goalsImg}" alt="גרף יעדים"/>` : '<p>אין נתונים לגרף זה</p>'}
                </div>
                <div class="chart-box">
                    <h3>מיצוי מדדי ביצוע</h3>
                    ${metricsImg ? `<img src="${metricsImg}" alt="גרף מדדים"/>` : '<p>אין נתונים לגרף זה</p>'}
                </div>
            </div>

            ${remarksHTML}
        </body>
        </html>
    `);

    printWindow.document.close();

    // מפעיל את חלון ההדפסה אוטומטית (עם עיכוב קל כדי לוודא שהתמונות נטענו)
    setTimeout(() => {
        printWindow.focus();
        // אופציונלי: printWindow.print();
    }, 500);
};

// חשיפת הפונקציה לאירוע onchange של הסלקטור
window.statsManager.refreshGoalsChart = () => {
    renderGoalsChart(currentFilteredFlights);
};

function getInstructorName(flight) {
    const d = flight.data || {};
    return (d['מדריכה'] || d['instructor-name-1'] || '').trim();
}

async function fetchPlanningData() {
    if (!window.firestoreFunctions || !window.db) return null;
    const { doc, getDoc } = window.firestoreFunctions;
    try {
        const docRef = doc(window.db, "settings", "planning");
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? docSnap.data() : null;
    } catch (e) {
        console.error("Error fetching planning data:", e);
        return null;
    }
}

function getDateFilterPredicate() {
    const elFilterType = document.getElementById('stats-filter-type');
    const filterType = elFilterType ? elFilterType.value : 'period';
    const planning = cachedPlanningData || {};

    const getStartSunday = (d) => {
        const s = new Date(d);
        s.setHours(0, 0, 0, 0);
        s.setDate(s.getDate() - s.getDay());
        return s;
    };

    if (filterType === 'period') {
        const selectedVal = document.getElementById('stats-period-select')?.value;
        if (!selectedVal) return () => false;
        return (date) => {
            return getPeriodDisplay(date) === selectedVal; // השוואה לפי המחרוזת המוצגת (למשל 1/26)
        };
    }

    if (filterType === 'week') {
        const elWeek = document.getElementById('stats-week-value');
        if (!elWeek) return () => false;
        const selectedWeekNum = parseInt(elWeek.value);
        return (date) => {
            const pCurr = planning.periodCurrStart ? new Date(planning.periodCurrStart) : null;
            const currSun = getStartSunday(date);
            if (!pCurr) return false;
            const relevantStartSun = getStartSunday(pCurr);
            const diffDays = Math.round((currSun - relevantStartSun) / (1000 * 60 * 60 * 24));
            const weekOfPeriod = Math.floor(diffDays / 7) + 1;
            return weekOfPeriod === selectedWeekNum;
        };
    }

    if (filterType === 'range') {
        const startStr = document.getElementById('stats-date-start')?.value;
        const endStr = document.getElementById('stats-date-end')?.value;
        if (!startStr || !endStr) return () => true;
        const startDate = new Date(startStr);
        const endDate = new Date(endStr);
        startDate.setHours(0, 0, 0, 0);
        endDate.setHours(23, 59, 59, 999);
        return (date) => {
            const d = new Date(date);
            return d >= startDate && d <= endDate;
        };
    }
    return () => true;
}

function filterFlightsByCrew(flights) {
    const { instructorFem, instructorMale } = currentCrewFilters;
    return flights.filter(flight => {
        const d = flight.data || {};
        const fFem = getInstructorName(flight);
        // const fMale = (d['מדריך'] || '').trim();
        const matchFem = instructorFem === "" || fFem === instructorFem;
        const matchMale = instructorMale === "" || fMale === instructorMale;
        return matchFem && matchMale;
    });
}

function destroyChartIfExists(key, canvasId) {
    if (chartInstances[key]) {
        chartInstances[key].destroy();
        chartInstances[key] = null;
    }
    // פתרון לשגיאת Canvas is already in use - השמדה מפורשת מה-Registry של Chart.js
    const existingChart = Chart.getChart(canvasId);
    if (existingChart) {
        existingChart.destroy();
    }
}

// 1. גרף סטטוס ביצוע
function renderExecutionStatusChart(flights) {
    const id = 'chart-execution-status';
    const ctx = document.getElementById(id);
    if (!ctx) return;
    destroyChartIfExists('execution', id);

    let counts = { 'בוצעו במלואן': 0, 'בוצעו חלקית': 0, 'בוטלו': 0 };
    flights.forEach(f => {
        const status = getFlightStatus(f);
        if (status === 'full') counts['בוצעו במלואן']++;
        else if (status === 'partial') counts['בוצעו חלקית']++;
        else if (status === 'cancelled') counts['בוטלו']++;
    });

    chartInstances.execution = new Chart(ctx, {
        type: 'pie',
        plugins: [ChartDataLabels], // הפעלת התוסף
        data: {
            labels: Object.keys(counts),
            datasets: [{
                data: Object.values(counts),
                backgroundColor: ['#69caaaff', '#dab678ff', '#da7373ff']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                datalabels: {
                    color: '#3f3f3fff',
                    font: { weight: 'bold' },
                    formatter: (value, ctx) => {
                        if (!showAsPercent) return value;
                        const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                        return ((value / total) * 100).toFixed(1) + "%";
                    }
                }
            }
        }
    });
}

// 2. גרף סיבות ביטול
function renderCancellationReasonsChart(flights) {
    const id = 'chart-cancellation-reasons';
    const ctx = document.getElementById(id);
    if (!ctx) return;
    destroyChartIfExists('cancellation', id);

    const cancelledFlights = flights.filter(f => getFlightStatus(f) === 'cancelled');

    // מציג את הסיבה המדויקת כפי שנשמרה בגיחה. אם אין סיבה, נרשום "לא צוינה סיבה"
    const counts = countByKey(cancelledFlights, f => {
        const r = f.data?.['סיבת ביטול'];
        return r ? r : 'לא צוינה סיבה';
    });

    // מערך צבעים גדול יותר למקרה שיש הרבה סיבות (גוונים של אדום)
    const bgColors = [
        '#f0c5c5', '#af7c7c', '#701f1f', '#fa0101', '#835757',
        '#3b0202', '#f78383', '#f3eeee', '#3d2828', '#FFCDD2',
        '#690a3e', '#c45959', '#554906', '#32336d'
    ];

    chartInstances.cancellation = new Chart(ctx, {
        type: 'pie',
        plugins: [ChartDataLabels],
        data: {
            labels: Object.keys(counts),
            datasets: [{
                data: Object.values(counts),
                backgroundColor: bgColors // Chart.js ישתמש בצבעים לפי סדר
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                datalabels: {
                    color: '#3f3f3fff',
                    font: { weight: 'bold' },
                    formatter: (value, ctx) => {
                        if (!showAsPercent) return value;
                        const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                        return ((value / total) * 100).toFixed(1) + "%";
                    }
                }
            }
        }
    });
}

// 3. גרף סוגי גיחות
function renderFlightTypesChart(flights) {
    const id = 'chart-flight-types';
    const ctx = document.getElementById(id);
    if (!ctx) return;
    destroyChartIfExists('types', id);

    const validFlights = flights.filter(f => {
        const s = getFlightStatus(f);
        return s === 'full' || (s === 'partial' && f.data?.['נדרש ביצוע חוזר'] !== 'כן');
    });

    const counts = countByKey(validFlights, f => f.data?.['סוג גיחה']);

    chartInstances.types = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(counts),
            datasets: [{ label: 'מספר גיחות', data: Object.values(counts), backgroundColor: '#3B82F6' }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

// 4. גרף מדריכים
function renderInstructorsChart(flights) {
    const id = 'chart-instructors';
    const ctx = document.getElementById(id);
    if (!ctx) return;
    destroyChartIfExists('instructors', id);

    const hoursByInstructor = {};

    flights.forEach(f => {
        const name = getInstructorName(f);
        // הוספת התנאי: אם השם ריק או שווה ל"ללא", לא נספור את השעות בגרף המדריכים
        if (!name || name === 'ללא') return;

        // סינון "תרגול התנעה" (קיים בקוד)
        if (f.data?.['שם גיחה'] === 'תרגול התנעה') return;

        const start = f.data?.['שעת התחלה'];
        const end = f.data?.['שעת סיום'];
        if (start && end) {
            const [h1, m1] = start.split(':').map(Number);
            const [h2, m2] = end.split(':').map(Number);
            let sMins = h1 * 60 + m1;
            let eMins = h2 * 60 + m2;
            if (eMins < sMins) eMins += 1440;

            const duration = (eMins - sMins) / 60;
            hoursByInstructor[name] = (hoursByInstructor[name] || 0) + duration;
        }
    });

    chartInstances.instructors = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(hoursByInstructor),
            datasets: [{
                label: 'שעות מאמן',
                data: Object.values(hoursByInstructor).map(v => v.toFixed(1)),
                backgroundColor: '#8B5CF6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true, title: { display: true, text: 'שעות' } } }
        }
    });
}

// 5. גרף תכנון מול ביצוע (כולל לוגיקת צבירה)
function renderPlanningVsExecutionChart(executedFlights, planningData, dateFilterPredicate) {
    const id = 'chart-planning-execution';
    const ctx = document.getElementById(id);
    if (!ctx) return;
    destroyChartIfExists('planning', id);

    const filterType = document.getElementById('stats-filter-type')?.value;
    const isPeriodMode = filterType === 'period';
    const selectedFlightType = document.getElementById('filter-flight-type')?.value;

    const dailyData = {};
    const allDates = new Set();

    // פונקציות עזר קריטיות - מונעות את תזוזת התאריכים אחורה בגלל אזור הזמן (UTC לעומת שעון ישראל)
    const getLocalDStr = (dateInput) => {
        const d = new Date(dateInput);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const createLocalMidnight = (dStr) => {
        const [y, m, d] = dStr.split('-');
        return new Date(y, m - 1, d);
    };

    // א. מציאת תאריך הגיחה האחרונה ביותר במאגר
    let lastFlightDate = null;
    savedFlights.forEach(f => {
        if (!f.date) return;
        const dStr = getLocalDStr(f.date);
        const d = createLocalMidnight(dStr);
        if (!lastFlightDate || d > lastFlightDate) {
            lastFlightDate = d;
        }
    });

    // ב. הכנת התכנון המקורי
    if (!selectedFlightType && planningData?.originalPlans) {
        Object.entries(planningData.originalPlans).forEach(([dStr, count]) => {
            const dObj = createLocalMidnight(dStr);
            if (dateFilterPredicate(dObj)) {
                allDates.add(dStr);
                if (!dailyData[dStr]) dailyData[dStr] = { planned: 0, current: 0, actual: 0 };
                dailyData[dStr].planned = Number(count) || 0;
            }
        });
    }

    // ג. חישוב התכנון העדכני (לפי חוקיות: עבר=מאגר, עתיד=לוח שנה)
    const dbCounts = {};
    savedFlights.forEach(f => {
        if (!f.date) return;
        if (selectedFlightType && f.data?.['סוג גיחה'] !== selectedFlightType) return;
        const dStr = getLocalDStr(f.date);
        dbCounts[dStr] = (dbCounts[dStr] || 0) + 1;
    });

    const calendarDates = planningData?.dailyPlans ? Object.keys(planningData.dailyPlans) : [];
    const allRelevantDates = new Set([...Object.keys(dbCounts), ...calendarDates]);

    allRelevantDates.forEach(dStr => {
        const dObj = createLocalMidnight(dStr);

        if (dateFilterPredicate(dObj)) {
            allDates.add(dStr);
            if (!dailyData[dStr]) dailyData[dStr] = { planned: 0, current: 0, actual: 0 };

            if (selectedFlightType) {
                dailyData[dStr].current = dbCounts[dStr] || 0;
            } else {
                if (lastFlightDate && dObj <= lastFlightDate) {
                    dailyData[dStr].current = dbCounts[dStr] || 0; // זמן עבר - נלקח מהמאגר
                } else {
                    const calData = planningData?.dailyPlans?.[dStr];
                    dailyData[dStr].current = (typeof calData === 'object') ? (Number(calData.count) || 0) : (Number(calData) || 0); // זמן עתיד - נלקח מלוח השנה
                }
            }
        }
    });

    // ד. חישוב ביצוע בפועל
    executedFlights.forEach(f => {
        if (!f.date) return;
        const dStr = getLocalDStr(f.date);
        const dObj = createLocalMidnight(dStr);
        
        if (dateFilterPredicate(dObj)) {
            const status = getFlightStatus(f);
            const isSuccess = (status === 'full') || (status === 'partial' && f.data['נדרש ביצוע חוזר'] !== 'כן');
            if (isSuccess) {
                allDates.add(dStr);
                if (!dailyData[dStr]) dailyData[dStr] = { planned: 0, current: 0, actual: 0 };
                dailyData[dStr].actual++;
            }
        }
    });

    const sortedDates = Array.from(allDates).sort();
    let labels, seriesPlanned, seriesCurrent, seriesActual;

    if (isPeriodMode) {
        labels = Array.from({ length: 26 }, (_, i) => `שבוע ${i + 1}`);
        seriesPlanned = new Array(26).fill(0);
        seriesCurrent = new Array(26).fill(0);
        seriesActual = new Array(26).fill(0);

        sortedDates.forEach(dStr => {
            const dObj = createLocalMidnight(dStr);
            const weekIdx = getWeekOfPeriod(dObj, planningData) - 1;
            
            // בטיחות: מוודא שהשבוע לא יחרוג מחוץ למערך ויאבד נתונים
            const safeWeekIdx = Math.min(Math.max(weekIdx, 0), 25);
            
            if (weekIdx >= 0) {
                seriesPlanned[safeWeekIdx] += dailyData[dStr].planned;
                seriesCurrent[safeWeekIdx] += dailyData[dStr].current;
                seriesActual[safeWeekIdx] += dailyData[dStr].actual;
            }
        });

        for (let i = 1; i < 26; i++) {
            seriesPlanned[i] += seriesPlanned[i - 1];
            seriesCurrent[i] += seriesCurrent[i - 1];
            seriesActual[i] += seriesActual[i - 1];
        }
    } else {
        labels = sortedDates.map(d => d.split('-').reverse().slice(0, 2).join('/'));
        seriesPlanned = sortedDates.map(d => dailyData[d].planned);
        seriesCurrent = sortedDates.map(d => dailyData[d].current);
        seriesActual = sortedDates.map(d => dailyData[d].actual);
    }

    const nakaPercent = planningData?.nakaPercentage ? parseFloat(planningData.nakaPercentage) : 85;
    const datasets = [];

    if (!selectedFlightType) {
        datasets.push({ label: 'תכנון מקורי', data: seriesPlanned, borderColor: '#36A2EB', fill: false, tension: 0.1 });
        datasets.push({ label: 'תכנון עדכני', data: seriesCurrent, borderColor: '#FF9F40', borderDash: [5, 5], fill: false, tension: 0.1 });
    } else {
        datasets.push({ label: 'תכנון במאגר', data: seriesCurrent, borderColor: '#FF9F40', borderDash: [5, 5], fill: false, tension: 0.1 });
    }

    datasets.push({ label: 'ביצוע בפועל', data: seriesActual, borderColor: '#4BC0C0', backgroundColor: 'rgba(75, 192, 192, 0.2)', fill: true, tension: 0.1 });

    chartInstances.planning = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    callbacks: {
                        footer: (tooltipItems) => {
                            const currentPlanItem = tooltipItems.find(i => i.dataset.label.includes('עדכני') || i.dataset.label.includes('במאגר'));
                            const actualItem = tooltipItems.find(i => i.dataset.label.includes('בפועל'));
                            if (!currentPlanItem || !actualItem) return '';

                            const currentPlan = currentPlanItem.raw || 0;
                            const actual = actualItem.raw || 0;
                            if (currentPlan === 0) return '';

                            const nakaTarget = currentPlan * (nakaPercent / 100);
                            const executionRate = (actual / currentPlan) * 100;

                            return '\n' +
                                `-----------------------` + '\n' +
                                `אחוז נק"ע מוגדר: ${nakaPercent}%` + '\n' +
                                `יעד נק"ע (גיחות): ${nakaTarget.toFixed(1)}` + '\n' +
                                `עמידה ביחס לתכנון: ${executionRate.toFixed(1)}%` + '\n';
                        }
                    },
                    bodyFont: { size: 13 }, footerFont: { size: 12, weight: 'bold' }, footerColor: '#fbbf24', padding: 10
                }
            }
        }
    });
}

// 6. גרף שעות שימוש במאמנים
function renderSimulatorsUsageChart(flights) {
    const id = 'chart-sim-hours';
    const ctx = document.getElementById(id);
    if (!ctx) return;
    destroyChartIfExists('simHours', id);

    const usageSuccess = { 'FFS': 0, 'VIPT': 0 };
    const usageFailed = { 'FFS': 0, 'VIPT': 0 };
    const dayWindows = { 'FFS': {}, 'VIPT': {} };

    flights.forEach(f => {
        if (!f.date || !f.data) return;

        const dStr = f.date;
        const sim = (f.data?.['סימולטור'] || '').toUpperCase();
        let group = sim.includes('FFS') ? 'FFS' : (sim.includes('VIPT') ? 'VIPT' : null);
        if (!group) return;

        const start = f.data['שעת התחלה'];
        const end = f.data['שעת סיום'];
        if (start && end) {
            const [h1, m1] = start.split(':').map(Number);
            const [h2, m2] = end.split(':').map(Number);
            let sMins = h1 * 60 + m1;
            let eMins = h2 * 60 + m2;
            if (eMins < sMins) eMins += 1440; // טיפול בחציית חצות

            const duration = (eMins - sMins) / 60;
            const status = getFlightStatus(f);

            // לוגיקה לקביעת הצלחה: בוצעה במלואה או בוצעה חלקית ללא צורך בביצוע חוזר
            const isSuccess = (status === 'full') || (status === 'partial' && f.data['נדרש ביצוע חוזר'] !== 'כן');

            if (isSuccess) {
                usageSuccess[group] += duration;
            } else {
                usageFailed[group] += duration;
            }

            // חישוב חלון פעילות (קיבולת) - מציאת הגיחה הראשונה והאחרונה באותו יום
            if (!dayWindows[group][dStr]) {
                dayWindows[group][dStr] = { min: 1440, max: 0 };
            }
            dayWindows[group][dStr].min = Math.min(dayWindows[group][dStr].min, sMins);
            dayWindows[group][dStr].max = Math.max(dayWindows[group][dStr].max, eMins);
        }
    });

    // סכימת הקיבולת הכוללת
    const capacity = { 'FFS': 0, 'VIPT': 0 };
    ['FFS', 'VIPT'].forEach(group => {
        Object.values(dayWindows[group]).forEach(win => {
            if (win.max > win.min) {
                capacity[group] += (win.max - win.min) / 60;
            }
        });
    });

    chartInstances.simHours = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['FFS', 'VIPT'],
            datasets: [
                {
                    label: 'ביצוע מוצלח',
                    data: [usageSuccess['FFS'].toFixed(1), usageSuccess['VIPT'].toFixed(1)],
                    backgroundColor: '#6366F1',
                    borderRadius: 4,
                    order: 2,
                    stack: 'usage' // הצמדה לערמה של הביצוע
                },
                {
                    label: 'ביטולים / ביצוע חוזר',
                    data: [usageFailed['FFS'].toFixed(1), usageFailed['VIPT'].toFixed(1)],
                    backgroundColor: 'rgba(99, 102, 241, 0.4)', // כחול בשקיפות נמוכה
                    borderRadius: 4,
                    order: 2,
                    stack: 'usage' // מופיע מעל הביצוע המוצלח באותה עמודה
                },
                {
                    label: ' שעות הפעלה',
                    data: [capacity['FFS'].toFixed(1), capacity['VIPT'].toFixed(1)],
                    backgroundColor: 'rgba(209, 213, 219, 0.5)',
                    borderColor: '#9CA3AF',
                    borderWidth: 1,
                    borderRadius: 4,
                    order: 1 // מופיע מאחורי עמודות הביצוע
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'top', rtl: true, labels: { font: { family: 'Rubik' } } }
            },
            scales: {
                x: { stacked: true }, // הפעלת ערמה בציר X
                y: {
                    stacked: true, // הפעלת ערמה בציר Y
                    beginAtZero: true,
                    title: { display: true, text: 'שעות' }
                }
            }
        }
    });
}

function getFlightStatus(flight) {
    const status = flight.executionStatus;
    const d = flight.data || {};
    const flightType = d['סוג גיחה'] || '';
    const cancelReason = d['סיבת ביטול'] || '';
    if (status === 'בוטלה' || status === 'גיחה בוטלה' || cancelReason || flightType === 'ביטול גיחה') return 'cancelled';
    if (flightType === 'ביצוע חלקי' || d['סוג ביצוע'] === 'חלקי') return 'partial';
    return 'full';
}

function countByKey(items, keyExtractor) {
    return items.reduce((acc, item) => {
        const key = keyExtractor(item);
        if (key) acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function getWeekOfPeriod(date, planning) {
    const currSun = new Date(date);
    currSun.setDate(currSun.getDate() - currSun.getDay());
    currSun.setHours(0, 0, 0, 0);
    const pStart = planning?.periodCurrStart ? new Date(planning.periodCurrStart) : null;
    if (!pStart) return 1;
    const pStartSun = new Date(pStart);
    pStartSun.setDate(pStartSun.getDate() - pStartSun.getDay());
    pStartSun.setHours(0, 0, 0, 0);

    // התיקון הקריטי: Math.round מונע את זליגת השבוע במעבר לשעון קיץ (DST)
    const diffDays = Math.round((currSun - pStartSun) / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
}


function populateWeekDropdown() {
    const weekSelect = document.getElementById('stats-week-value');
    if (!weekSelect || weekSelect.options.length > 0) return;
    weekSelect.innerHTML = '';
    for (let i = 1; i <= 54; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        weekSelect.appendChild(option);
    }
}

function populateStatsPeriodSelect(flights) {
    const select = document.getElementById('stats-period-select');
    if (!select) return;

    const currentVal = select.value;
    const periods = new Set();

    flights.forEach(f => {
        if (!f.date) return;
        const display = getPeriodDisplay(f.date); // שימוש בפונקציה החדשה מ-util.js
        if (display) periods.add(display);
    });

    const sortedPeriods = Array.from(periods).sort((a, b) => {
        const [pA, yA] = a.split('/');
        const [pB, yB] = b.split('/');
        return yA !== yB ? Number(yA) - Number(yB) : Number(pA) - Number(pB);
    });

    select.innerHTML = '';
    sortedPeriods.forEach(p => {
        const option = document.createElement('option');
        option.value = p;
        option.textContent = p;
        select.appendChild(option);
    });

    if (currentVal && periods.has(currentVal)) select.value = currentVal;
    else if (sortedPeriods.length > 0) select.value = sortedPeriods[sortedPeriods.length - 1];
}

function updateCrewFilterState() {
    const elInstrFem = document.getElementById('filter-instructor');
    const elInstrMale = document.getElementById('filter-instructor-main');
    currentCrewFilters.instructorFem = elInstrFem ? elInstrFem.value : "";
    currentCrewFilters.instructorMale = elInstrMale ? elInstrMale.value : "";
}

export function onCrewFilterChange(type) { renderStatsDashboard(); }

function updateCrewFilterOptions(flights) {
    const selectInstructorFem = document.getElementById('filter-instructor');
    const selectInstructorMale = document.getElementById('filter-instructor-main');
    const femSet = new Set();
    const maleSet = new Set();
    flights.forEach(f => {
        const instrFem = getInstructorName(f);
        if (instrFem) femSet.add(instrFem);
    });
    const populate = (el, set, current, label) => {
        if (!el) return;
        el.innerHTML = `<option value="">${label}</option>`;
        Array.from(set).sort().forEach(name => {
            const op = document.createElement('option');
            op.value = name; op.textContent = name;
            el.appendChild(op);
        });
        el.value = set.has(current) ? current : "";
    };
    populate(selectInstructorFem, femSet, currentCrewFilters.instructorFem, "כל המדריכות");
    populate(selectInstructorMale, maleSet, currentCrewFilters.instructorMale, "כל המדריכים");
}

export function swapToMain(clickedCardId) {
    if (clickedCardId === currentMainCardId) return;

    const container = document.getElementById('stats-charts-container');
    const mainCard = document.getElementById(currentMainCardId);
    const clickedCard = document.getElementById(clickedCardId);

    if (!mainCard || !clickedCard) return;

    // 1. עדכון גבהים
    mainCard.classList.remove('md:col-span-2', 'md:row-span-2');
    mainCard.querySelector('.chart-wrapper').classList.replace('h-[500px]', 'h-[200px]');

    clickedCard.classList.add('md:col-span-2', 'md:row-span-2');
    clickedCard.querySelector('.chart-wrapper').classList.replace('h-[200px]', 'h-[500px]');

    // 2. הזזת הכרטיס ב-DOM
    container.prepend(clickedCard);
    currentMainCardId = clickedCardId;

    // 3. אנימציית Resize חלקה
    const duration = 500; // תואם ל-duration-500 ב-CSS
    const startTime = performance.now();

    function animateResize(currentTime) {
        const elapsed = currentTime - startTime;

        // ביצוע Resize לכל הגרפים כדי שיתאימו לגודל המשתנה של הקונטיינר
        Object.values(chartInstances).forEach(chart => {
            if (chart) chart.resize();
        });

        if (elapsed < duration) {
            requestAnimationFrame(animateResize);
        } else {
            // סנכרון סופי לאחר סיום האנימציה
            Object.values(chartInstances).forEach(chart => {
                if (chart) {
                    chart.resize();
                    chart.update('none'); // 'none' חוסך אנימציה פנימית מיותרת של Chart.js
                }
            });
        }
    }

    requestAnimationFrame(animateResize);
}

function initFiltersUI() {
    if (listenersInitialized) return;

    populateWeekDropdown();
    const today = new Date();
    const elWeekYear = document.getElementById('stats-week-year');
    if (elWeekYear && !elWeekYear.value) elWeekYear.value = today.getFullYear();
    const elWeekVal = document.getElementById('stats-week-value');
    if (elWeekVal) elWeekVal.value = getWeekNumber(today);

    const filterTypeSelect = document.getElementById('stats-filter-type');
    if (filterTypeSelect) {
        filterTypeSelect.addEventListener('change', (e) => toggleFilterInputs(e.target.value));
    }

    // איחוד כל הפונקציות לתוך אובייקט הניהול
    Object.assign(window.statsManager, {
        renderStatsDashboard,
        onCrewFilterChange,
        swapToMain,

        // הצגת טבלת האוכלוסיות
        showPopulationTable: () => {
            const container = document.getElementById('stats-population-table-container');
            if (container) {
                container.classList.remove('hidden');
                window.statsManager.updateSubPops();
                window.statsManager.updatePopTable();
                container.scrollIntoView({ behavior: 'smooth' });
            }
        },

        // עדכון רשימת תתי-האוכלוסיות (קורסים/קבוצות)
        updateSubPops: async () => {
            const type = document.getElementById('stats-table-pop-type').value;
            const subPopSelect = document.getElementById('stats-table-sub-pop');
            if (!subPopSelect) return;

            // איפוס הרשימה
            subPopSelect.innerHTML = '<option value="">כל התתי-אוכלוסיות</option>';

            // ייבוא הנתונים העדכניים
            const { pilotPopulations } = await import('./adminManager.js');

            let list = [];

            // --- לוגיקה לבחירת הרשימה הנכונה ---
            if (type === 'instructors') {
                list = pilotPopulations.instructorGroups || [];
            } else if (type === 'conversion') {
                // כאן התיקון: התייחסות לקבוצות הסבה
                list = pilotPopulations.conversionGroups || [];
            } else {
                // ברירת מחדל: חניכים (students)
                list = pilotPopulations.courses || [];
            }

            // יצירת האפשרויות ב-Select
            list.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.name;
                opt.textContent = item.name;
                subPopSelect.appendChild(opt);
            });

            // קריאה לריענון הטבלה עצמה
            window.statsManager.updatePopTable();
        },

        // רינדור הנתונים לטבלה
        updatePopTable: async () => {
            const type = document.getElementById('stats-table-pop-type').value;
            const subPopName = document.getElementById('stats-table-sub-pop').value;
            const tbody = document.getElementById('pop-table-body');
            if (!tbody) return;

            const { pilotPopulations } = await import('./adminManager.js');
            const mapping = pilotPopulations.flightMapping || { students: [], instructors: [], conversion: [] };

            // 1. בחירת שמות הגיחות הרלוונטיים (לפי מה שהגדרת במסך ניהול)
            let relevantFlightNames = [];
            if (type === 'instructors') {
                relevantFlightNames = mapping.instructors || [];
            } else if (type === 'conversion') {
                relevantFlightNames = mapping.conversion || []; // <--- הוספה
            } else {
                relevantFlightNames = mapping.students || [];
            }

            // 2. בחירת רשימת הטייסים הרלוונטית (לפי הקבוצה שנבחרה)
            let relevantPilots = [];
            if (subPopName) {
                let groups = [];
                if (type === 'instructors') {
                    groups = pilotPopulations.instructorGroups;
                } else if (type === 'conversion') {
                    groups = pilotPopulations.conversionGroups || []; // <--- הוספה
                } else {
                    groups = pilotPopulations.courses;
                }

                const group = groups.find(g => g.name === subPopName);

                if (group) {
                    // אם זה חניכים המערך נקרא students, אחרת members
                    relevantPilots = (type === 'students') ? group.students : group.members;
                }
            }

            // 3. סינון הגיחות בפועל
            const filtered = (window.savedFlights || []).filter(f => {
                const fData = f.data || {};
                const fName = fData['שם גיחה'];
                // איסוף כל השמות שהופיעו בגיחה (ימין/שמאל)
                const pilotsInFlight = [
                    fData['טייס ימין'],
                    fData['טייס שמאל'],
                    fData['pilot-right'],
                    fData['pilot-left']
                ].filter(p => p); // מסנן ערכים ריקים

                // תנאי א': האם שם הגיחה הוא מסוג הגיחות המבוקש?
                const isCorrectFlight = relevantFlightNames.includes(fName);

                // תנאי ב': האם אחד הטייסים בגיחה שייך לקבוצה שנבחרה?
                // (אם לא נבחרה תת-קבוצה, כל הטייסים מתאימים)
                const isCorrectPilot = subPopName === "" || pilotsInFlight.some(p => relevantPilots.includes(p));

                return isCorrectFlight && isCorrectPilot;
            });

            // מיון לפי תאריך (חדש לישן)
            filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

            // יצירת ה-HTML
            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center p-6 text-gray-500 italic">אין נתונים התואמים לסיווג</td></tr>';
            } else {
                tbody.innerHTML = filtered.map(f => `
            <tr class="border-b hover:bg-gray-50 transition-colors">
                <td class="p-3 text-sm text-center border-l border-gray-100">${f.data['טייס ימין'] || f.data['pilot-right'] || '---'}</td>
                <td class="p-3 text-sm text-center border-l border-gray-100">${f.data['שם גיחה'] || '---'}</td>
                <td class="p-3 text-sm text-center border-l border-gray-100">${new Date(f.date).toLocaleDateString('he-IL')}</td>
                <td class="p-3 text-sm text-center font-bold">
                    <span class="${f.executionStatus === 'בוצעה' ? 'text-green-600' : 'text-gray-600'}">
                        ${f.executionStatus || 'בוצעה'}
                    </span>
                </td>
            </tr>
        `).join('');
            }
        }
    });
    listenersInitialized = true;
}

function toggleFilterInputs(type) {
    const groups = { 'period': 'filter-period-group', 'week': 'filter-week-group', 'range': 'filter-range-group' };
    Object.values(groups).forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    const active = document.getElementById(groups[type]);
    if (active) active.classList.remove('hidden');
}

// משתנה עזר לשמירת הטיסות המסוננות לצורך ריענון הגרף בשינוי Select
let lastFilteredFlightsForMetrics = [];

function renderMetricsUtilizationChart(flights) {
    const id = 'chart-metrics-utilization';
    const ctx = document.getElementById(id);
    const selector = document.getElementById('stats-metric-selector');
    if (!ctx || !selector) return;

    lastFilteredFlightsForMetrics = flights;
    destroyChartIfExists('metrics', id);

    const metricsData = {};
    flights.forEach(f => {
        const selectedMetrics = f.data?.['מדדי ביצוע'] || [];
        selectedMetrics.forEach(m => {
            if (!metricsData[m.main]) metricsData[m.main] = {};
            metricsData[m.main][m.value] = (metricsData[m.main][m.value] || 0) + 1;
        });
    });

    // עדכון הסלקטור
    const currentSelected = selector.value;
    selector.innerHTML = Object.keys(metricsData).map(m =>
        `<option value="${m}" ${m === currentSelected ? 'selected' : ''}>${m}</option>`
    ).join('') || '<option value="">אין מדדים</option>';

    const activeMetric = selector.value;
    if (!activeMetric || !metricsData[activeMetric]) return;

    const subLabels = Object.keys(metricsData[activeMetric]);
    const subValues = Object.values(metricsData[activeMetric]);

    // יצירת גרף פאי
    chartInstances.metrics = new Chart(ctx, {
        type: 'pie',
        plugins: [ChartDataLabels],
        data: {
            labels: subLabels,
            datasets: [{
                data: subValues,
                backgroundColor: [
                    '#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', rtl: true },
                datalabels: {
                    color: '#fff',
                    font: { weight: 'bold', size: 12 },
                    formatter: (value, ctx) => {
                        if (!showAsPercent) return value;
                        const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                        return ((value / total) * 100).toFixed(1) + "%";
                    }
                }
            }
        }
    });
}

let showAsPercent = false;

window.statsManager.toggleValueType = function () {
    showAsPercent = !showAsPercent;
    const btn = document.getElementById('toggle-percent-btn');
    btn.textContent = showAsPercent ? "הצג במספרים #" : "הצג באחוזים %";
    window.statsManager.renderStatsDashboard(); // רינדור מחדש עם המצב החדש
};

// פונקציה לריענון בשינוי ה-Select (להוסיף ל-window.statsManager)
window.statsManager.refreshMetricsChart = () => {
    renderMetricsUtilizationChart(lastFilteredFlightsForMetrics);
};
