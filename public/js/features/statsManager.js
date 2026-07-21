// public/js/features/statsManager.js

import { savedFlights } from '../core/global.js';
import { EXECUTION_STATUS_NOT_REPORTED } from './executionStatusManager.js';
import { pilotPopulations } from './adminManager.js';
import { setPeriodDates, getPeriodNumber, getWeekNumber, getPeriodDisplay, getEffectivePeriod } from '../core/util.js';

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
let instructorsChartMode = 'hours'; // יכול להיות 'hours' או 'flights'

async function getActivePeriodData() {
    // משיכה ישירה מההגדרות של עמוד המנהל
    const settings = window.planningSettings;
    if (!settings || !settings.periodConfigs) return null;

    const today = new Date();
    // מציאת התקופה הנוכחית לפי תאריכים מוגדרים במנהל
    const currentPeriod = Object.keys(settings.periodConfigs).find(pName => {
        const conf = settings.periodConfigs[pName];
        return today >= new Date(conf.startDate) && today <= new Date(conf.endDate);
    });

    return {
        name: currentPeriod,
        config: settings.periodConfigs[currentPeriod]
    };
}

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
        return dateFilterPredicate(f); // מעבירים את הגיחה כולה כדי להתחשב בדריסה
    });

    updateCrewFilterState();
    updateCrewFilterOptions(timeFilteredFlights);

    let finalFlights = filterFlightsByCrew(timeFilteredFlights);

    updateSimulatorFilterOptions(finalFlights);
    const selectedSimulator = document.getElementById('filter-simulator')?.value;
    if (selectedSimulator) {
        finalFlights = finalFlights.filter(f => f.data && f.data['סימולטור'] === selectedSimulator);
    }

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

    const simCard = document.getElementById('stats-card-sim-hours');
    const typeCard = document.getElementById('stats-card-flight-types');
    if (simCard) {
        if (selectedFlightType) {
            simCard.classList.add('hidden');
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

    requestAnimationFrame(() => {
        renderExecutionStatusChart(finalFlights);
        renderCancellationReasonsChart(finalFlights);
        renderFlightTypesChart(finalFlights);
        renderInstructorsChart(finalFlights);
        renderPlanningVsExecutionChart(finalFlights, cachedPlanningData, dateFilterPredicate);

        if (!selectedFlightType) {
            renderSimulatorsUsageChart(timeFilteredFlights);
        }

        if (typeof renderGoalsChart === 'function') {
            renderGoalsChart(finalFlights);
        }
    });
}

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

    const currentSelectedName = selector.value;
    const namesSet = new Set();
    flights.forEach(f => {
        if (f.data?.['שם גיחה']) namesSet.add(f.data['שם גיחה']);
    });

    selector.innerHTML = '<option value="">כל הגיחות</option>' +
        Array.from(namesSet).map(name => `<option value="${name}" ${name === currentSelectedName ? 'selected' : ''}>${name}</option>`).join('');

    const activeFlightName = selector.value;
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
                backgroundColor: ['#10B981', '#EF4444'],
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

    const goalsCanvas = document.getElementById('chart-goals-status');
    const metricsCanvas = document.getElementById('chart-metrics-utilization');

    const goalsImg = goalsCanvas ? goalsCanvas.toDataURL('image/png') : '';
    const metricsImg = metricsCanvas ? metricsCanvas.toDataURL('image/png') : '';

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
    setTimeout(() => { printWindow.focus(); }, 500);
};

window.statsManager.refreshGoalsChart = () => {
    renderGoalsChart(window.currentFilteredFlights || []);
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

// === פונקציית עזר גלובלית לטעינת אוכלוסיות באופן בטוח (הוספה חסרה) ===
async function getPopDataForPeriod(selectedPeriod) {
    let popData = window.pilotPopulations;
    let periodToFetch = selectedPeriod;

    // חישוב התקופה הנוכחית דרך הגדרות המנהל במקום חישוב מתמטי נוקשה
    if (!periodToFetch || periodToFetch === "ALL") {
        if (typeof window.getPeriodName === 'function') {
            // מביא את התקופה המדויקת לפי הגדרות המנהל (planningSettings)
            periodToFetch = window.getPeriodName(new Date());
        } else {
            // גיבוי אחרון בלבד (אם הפונקציה טרם נטענה)
            const d = new Date();
            let year = d.getFullYear();
            const month = d.getMonth();
            if (month === 11) {
                year++;
                periodToFetch = `1/${year.toString().slice(-2)}`;
            } else {
                periodToFetch = `${month < 5 ? "1" : "2"}/${year.toString().slice(-2)}`;
            }
        }
    }
    // ניסיון משיכה מהשרת לפי התקופה הספציפית
    if (periodToFetch && window.firestoreFunctions && window.db) {
        try {
            const { doc, getDoc } = window.firestoreFunctions;
            const safePeriodName = periodToFetch.replace(/\//g, '-');
            const periodPopRef = doc(window.db, "populations_by_period", safePeriodName);
            const periodPopSnap = await getDoc(periodPopRef);
            if (periodPopSnap.exists()) {
                popData = periodPopSnap.data();
                return popData;
            }
        } catch (e) {
            console.error("Firebase error loading period populations:", e);
        }
    }

    // גיבוי למאגר הכללי הישן
    if (!popData) {
        if (window.firestoreFunctions && window.db) {
            try {
                const { doc, getDoc } = window.firestoreFunctions;
                const popSnap = await getDoc(doc(window.db, "settings", "populations"));
                if (popSnap.exists()) popData = popSnap.data();
            } catch (e) { }
        }
        if (!popData) {
            try {
                const { pilotPopulations } = await import('./adminManager.js');
                popData = pilotPopulations;
            } catch (e) { }
        }
        window.pilotPopulations = popData;
    }

    return popData || { instructorGroups: [], courses: [], conversionGroups: [], flightMapping: {} };
}

function filterFlightsByCrew(flights) {
    const { instructorFem, instructorMale } = currentCrewFilters;
    return flights.filter(flight => {
        const d = flight.data || {};
        const fFem = getInstructorName(flight);
        const fMale = (d['מדריך'] || '').trim();
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
    const existingChart = Chart.getChart(canvasId);
    if (existingChart) {
        existingChart.destroy();
    }
}

function renderExecutionStatusChart(flights) {
    const id = 'chart-execution-status';
    const ctx = document.getElementById(id);
    if (!ctx) return;
    destroyChartIfExists('execution', id);

    let counts = { 'בוצעו במלואן': 0, 'גיחות מופרעות': 0, 'בוטלו': 0 };
    flights.forEach(f => {
        const status = getFlightStatus(f);
        if (status === 'full') counts['בוצעו במלואן']++;
        else if (status === 'partial') counts['גיחות מופרעות']++;
        else if (status === 'cancelled') counts['בוטלו']++;
    });

    chartInstances.execution = new Chart(ctx, {
        type: 'pie',
        plugins: [ChartDataLabels],
        data: {
            labels: Object.keys(counts),
            datasets: [{
                data: Object.values(counts),
                backgroundColor: ['#69caaaff', '#dab678ff', '#da7373ff']
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                datalabels: {
                    color: '#3f3f3fff', font: { weight: 'bold' },
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

function renderCancellationReasonsChart(flights) {
    const id = 'chart-cancellation-reasons';
    const ctx = document.getElementById(id);
    if (!ctx) return;
    destroyChartIfExists('cancellation', id);

    // 1. נסנן רק את הגיחות שבוטלו (עבור כל הגרף)
    const allCancelledFlights = flights.filter(f => getFlightStatus(f) === 'cancelled');

    // 2. נספור את כל סיבות הביטול עבור הגרף
    const counts = countByKey(allCancelledFlights, f => f.data?.['סיבת ביטול'] || 'לא צוינה סיבה');

    // 3. הכנת מפת תקלות (עבור הפירוט ב-Tooltip)
    const flightIdToFaults = {};
    Object.values(window.unifiedFaultsDatabase || {}).forEach(fault => {
        if (fault.sourceFlights && Array.isArray(fault.sourceFlights)) {
            fault.sourceFlights.forEach(fId => {
                if (!flightIdToFaults[fId]) flightIdToFaults[fId] = [];
                flightIdToFaults[fId].push(fault);
            });
        }
    });

    // 4. הגדרת הצבעים והגרף
    const bgColors = ['#f0c5c5', '#af7c7c', '#701f1f', '#fa0101', '#835757', '#3b0202'];

    chartInstances.cancellation = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(counts),
            datasets: [{ data: Object.values(counts), backgroundColor: bgColors }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        afterBody: (tooltipItems) => {
                            const label = tooltipItems[0].label;

                            // התנאי החדש: הצג פירוט רק אם הלייבל מכיל "טכני"
                            if (label.includes('טכני')) {
                                const techFlights = allCancelledFlights.filter(f =>
                                    f.data?.['סיבת ביטול']?.includes('טכני')
                                );

                                const techBreakdown = {};
                                techFlights.forEach(f => {
                                    const fId = f.id || f.flightId;
                                    const faults = [...(flightIdToFaults[fId] || []), ...(f.faults || [])];
                                    faults.forEach(fault => {
                                        const sys = fault.systemClassification || fault.classification || 'ללא סיווג';
                                        techBreakdown[sys] = (techBreakdown[sys] || 0) + 1;
                                    });
                                });

                                if (Object.keys(techBreakdown).length > 0) {
                                    let extra = ['', '📌 פירוט תקלות במערכות:'];
                                    Object.entries(techBreakdown).forEach(([sys, count]) => {
                                        extra.push(`  • ${sys}: ${count}`);
                                    });
                                    return extra;
                                }
                            }
                            // אם לא "טכני", לא מחזירים כלום (או הודעה כללית)
                            return [];
                        }
                    }
                }
            }
        }
    });
}

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
        data: { labels: Object.keys(counts), datasets: [{ label: 'מספר גיחות', data: Object.values(counts), backgroundColor: '#3B82F6' }] },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function renderInstructorsChart(flights) {
    const id = 'chart-instructors';
    const ctx = document.getElementById(id);
    if (!ctx) return;
    destroyChartIfExists('instructors', id);

    const hoursByInstructor = {};
    const flightsByInstructor = {};

    flights.forEach(f => {
        const name = getInstructorName(f);
        if (!name || name === 'ללא' || f.data?.['שם גיחה'] === 'תרגול התנעה') return;

        // ספירת גיחות
        flightsByInstructor[name] = (flightsByInstructor[name] || 0) + 1;

        // ספירת שעות
        const start = f.data?.['שעת התחלה'];
        const end = f.data?.['שעת סיום'];
        if (start && end) {
            const [h1, m1] = start.split(':').map(Number);
            const [h2, m2] = end.split(':').map(Number);
            let sMins = h1 * 60 + m1;
            let eMins = h2 * 60 + m2;
            if (eMins < sMins) eMins += 1440;
            hoursByInstructor[name] = (hoursByInstructor[name] || 0) + ((eMins - sMins) / 60);
        }
    });

    const isHours = instructorsChartMode === 'hours';
    const dataToUse = isHours ? hoursByInstructor : flightsByInstructor;
    const labelText = isHours ? 'שעות מאמן' : 'מספר גיחות';
    const dataArr = Object.values(dataToUse).map(v => isHours ? v.toFixed(1) : v);

    chartInstances.instructors = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(dataToUse),
            datasets: [{ label: labelText, data: dataArr, backgroundColor: '#8B5CF6' }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: () => {
                // החלפת מצב ורינדור מחדש בלחיצה
                instructorsChartMode = isHours ? 'flights' : 'hours';
                renderInstructorsChart(flights);
            },
            scales: { y: { beginAtZero: true, title: { display: true, text: isHours ? 'שעות' : 'גיחות' } } },
            plugins: {
                tooltip: {
                    callbacks: {
                        footer: () => '💡 לחץ על הגרף כדי להחליף בין שעות לגיחות'
                    }
                }
            }
        }
    });
}


function renderPlanningVsExecutionChart(executedFlights, planningData, dateFilterPredicate) {
    const id = 'chart-planning-execution';
    const ctx = document.getElementById(id);
    if (!ctx) return;
    destroyChartIfExists('planning', id);

    const filterType = document.getElementById('stats-filter-type')?.value;
    const isPeriodMode = filterType === 'period';
    const isWeekMode = filterType === 'week';
    const selectedWeekVal = document.getElementById('stats-week-value')?.value; 
    const selectedFlightType = document.getElementById('filter-flight-type')?.value;

    const dailyData = {};
    const allDates = new Set();

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

    let lastFlightDate = null;
    savedFlights.forEach(f => {
        if (!f.date) return;
        const d = createLocalMidnight(getLocalDStr(f.date));
        if (!lastFlightDate || d > lastFlightDate) lastFlightDate = d;
    });

    // 1. תכנון מקורי - שואב ישירות מעמוד המנהל
    if (!selectedFlightType && planningData?.dailyPlans) {
        Object.entries(planningData.dailyPlans).forEach(([dStr, dataVal]) => {
            if (dateFilterPredicate(createLocalMidnight(dStr))) {
                allDates.add(dStr);
                if (!dailyData[dStr]) dailyData[dStr] = { planned: 0, current: 0, actual: 0 };
                
                let count = 0;
                if (typeof dataVal === 'object' && dataVal !== null) {
                    count = dataVal.count !== undefined ? dataVal.count : 0;
                } else {
                    count = Number(dataVal) || 0;
                }
                dailyData[dStr].planned = count;
            }
        });
    }

    // 2. תכנון עדכני 
    const dbCounts = {};
    savedFlights.forEach(f => {
        if (!f.date || (selectedFlightType && f.data?.['סוג גיחה'] !== selectedFlightType)) return;
        
        const isManual = f.isManualEntry === true;
        if (!isManual) {
            const dStr = getLocalDStr(f.date);
            dbCounts[dStr] = (dbCounts[dStr] || 0) + 1;
        }
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
                    dailyData[dStr].current = dbCounts[dStr] || 0;
                } else {
                    const calData = planningData?.dailyPlans?.[dStr];
                    dailyData[dStr].current = (typeof calData === 'object') ? (Number(calData.count) || 0) : (Number(calData) || 0);
                }
            }
        }
    });

    // 3. ביצוע בפועל - גיחות שסומנו כבוצעו או מופרעות (ללא צורך בביצוע נוסף)
    executedFlights.forEach(f => {
        if (!f.date) return;
        const status = getFlightStatus(f);
        const needsRepeat = f.data?.['נדרש ביצוע חוזר'] === 'כן';

        // תנאי מדויק: בוצעו במלואן או מופרעות שלא דורשות ביצוע חוזר
        if (status === 'full' || (status === 'partial' && !needsRepeat)) {
            const dStr = getLocalDStr(f.date);
            allDates.add(dStr);
            if (!dailyData[dStr]) dailyData[dStr] = { planned: 0, current: 0, actual: 0 };
            dailyData[dStr].actual++;
        }
    });

    const sortedDates = Array.from(allDates).sort();
    let labels, seriesPlanned, seriesCurrent, seriesActual;

    if (isPeriodMode) {
        // מצב תקופה: מציג 26 שבועות בצורה מצטברת
        labels = Array.from({ length: 26 }, (_, i) => `שבוע ${i + 1}`);
        seriesPlanned = new Array(26).fill(0);
        seriesCurrent = new Array(26).fill(0);
        seriesActual = new Array(26).fill(0);

        sortedDates.forEach(dStr => {
            const weekIdx = getWeekOfPeriod(createLocalMidnight(dStr), planningData) - 1;
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
    } else if (isWeekMode && selectedWeekVal && selectedWeekVal !== "ALL") {
        // מצב שבוע ספציפי: מציג פירוט לפי ימים בתוך אותו השבוע בלבד (ללא צבירה שגויה)
        labels = sortedDates.map(d => d.split('-').reverse().slice(0, 2).join('/'));
        seriesPlanned = sortedDates.map(d => dailyData[d].planned);
        seriesCurrent = sortedDates.map(d => dailyData[d].current);
        seriesActual = sortedDates.map(d => dailyData[d].actual);
    } else {
        // ברירת מחדל יומית / טווח תאריכים
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
        type: 'line', data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
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
                            return '\n-----------------------\n' +
                                `אחוז נק"ע מוגדר: ${nakaPercent}%\nיעד נק"ע (גיחות): ${(currentPlan * (nakaPercent / 100)).toFixed(1)}\n` +
                                `עמידה ביחס לתכנון: ${((actual / currentPlan) * 100).toFixed(1)}%\n`;
                        }
                    },
                    bodyFont: { size: 13 }, footerFont: { size: 12, weight: 'bold' }, footerColor: '#fbbf24', padding: 10
                }
            }
        }
    });
}

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
            if (eMins < sMins) eMins += 1440;

            const duration = (eMins - sMins) / 60;
            const status = getFlightStatus(f);
            const isSuccess = (status === 'full') || (status === 'partial' && f.data['נדרש ביצוע חוזר'] !== 'כן');

            if (isSuccess) usageSuccess[group] += duration;
            else usageFailed[group] += duration;

            if (!dayWindows[group][f.date]) dayWindows[group][f.date] = { min: 1440, max: 0 };
            dayWindows[group][f.date].min = Math.min(dayWindows[group][f.date].min, sMins);
            dayWindows[group][f.date].max = Math.max(dayWindows[group][f.date].max, eMins);
        }
    });

    const capacity = { 'FFS': 0, 'VIPT': 0 };
    ['FFS', 'VIPT'].forEach(group => {
        Object.values(dayWindows[group]).forEach(win => {
            if (win.max > win.min) capacity[group] += (win.max - win.min) / 60;
        });
    });

    chartInstances.simHours = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['FFS', 'VIPT'],
            datasets: [
                { label: 'ביצוע מוצלח', data: [usageSuccess['FFS'].toFixed(1), usageSuccess['VIPT'].toFixed(1)], backgroundColor: '#6366F1', borderRadius: 4, order: 2, stack: 'usage' },
                { label: 'ביטולים / ביצוע חוזר', data: [usageFailed['FFS'].toFixed(1), usageFailed['VIPT'].toFixed(1)], backgroundColor: 'rgba(99, 102, 241, 0.4)', borderRadius: 4, order: 2, stack: 'usage' },
                { label: ' שעות הפעלה', data: [capacity['FFS'].toFixed(1), capacity['VIPT'].toFixed(1)], backgroundColor: 'rgba(209, 213, 219, 0.5)', borderColor: '#9CA3AF', borderWidth: 1, borderRadius: 4, order: 1 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'top', rtl: true, labels: { font: { family: 'Rubik' } } } },
            scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'שעות' } } }
        }
    });
}

function getFlightStatus(flight) {
    const status = flight.executionStatus;
    const d = flight.data || {};
    const flightType = d['סוג גיחה'] || '';
    if (status === 'בוטלה' || status === 'גיחה בוטלה' || d['סיבת ביטול'] || flightType === 'ביטול גיחה') return 'cancelled';
    if (flightType === 'ביצוע גיחה מופרעת' || d['סוג ביצוע'] === 'מופרעת' || d['סוג ביצוע'] === 'חלקי' || flightType === 'גיחה חלקי') return 'partial';
    return 'full';
}

function countByKey(items, keyExtractor) {
    return items.reduce((acc, item) => {
        const key = keyExtractor(item);
        if (key) acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function getWeekOfPeriod(date, planningData) {
    const periodName = window.getPeriodName(date);
    const calculatedWeek = window.calculateWeekNumber(date, periodName);
    return calculatedWeek ? calculatedWeek : 1; // 1 כברירת מחדל אם משהו חסר
}

function populateStatsWeekSelect() {
    const weekSelect = document.getElementById('stats-week-value');
    const periodSelect = document.getElementById('stats-period-select');
    if (!weekSelect || !periodSelect) return;

    const selectedPeriod = periodSelect.value;
    const currentVal = weekSelect.value;
    const weeksSet = new Set();

    // סריקת הגיחות ואיסוף שבועות רלוונטיים לתקופה שנבחרה בלבד
    (window.savedFlights || []).forEach(f => {
        if (!f.date) return;
        const fPeriod = window.getPeriodName ? window.getPeriodName(f.date) : getPeriodDisplay(f.date);
        if (!selectedPeriod || fPeriod === selectedPeriod) {
            const calcWeek = window.calculateWeekNumber ? window.calculateWeekNumber(f.date, fPeriod) : 1;
            if (calcWeek) weeksSet.add(calcWeek);
        }
    });

    // ניקוי ואכלוס מחדש עם אופציית "כל השבועות" כברירת מחדל
    weekSelect.innerHTML = '<option value="ALL">כל השבועות</option>';
    Array.from(weeksSet).sort((a, b) => a - b).forEach(w => {
        const option = document.createElement('option');
        option.value = w;
        option.textContent = `שבוע ${w}`;
        weekSelect.appendChild(option);
    });

    // שמירה על הבחירה הקודמת במידה והיא עדיין רלוונטית
    if (currentVal && (currentVal === "ALL" || weeksSet.has(parseInt(currentVal)))) {
        weekSelect.value = currentVal;
    } else {
        weekSelect.value = "ALL";
    }
}

function populateWeekDropdown() {
    const weekSelect = document.getElementById('stats-week-value');
    if (!weekSelect || weekSelect.options.length > 0) return;
    weekSelect.innerHTML = '';

    // שינינו את הלולאה מ-54 ל-26 (שבועות בתקופה)
    for (let i = 1; i <= 26; i++) {
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
        const display = getEffectivePeriod(f);
        if (display) periods.add(display);
    });

    // --- התיקון: מיון בטוח שממיר הכל לטקסט לפני שהוא מפצל, כדי שלא תהיה קריסה ---
    const sortedPeriods = Array.from(periods).sort((a, b) => {
        // המרה לטקסט מחריבה בעיות של מספרים נקיים
        const strA = String(a || "");
        const strB = String(b || "");

        const partsA = strA.split('/');
        const partsB = strB.split('/');

        const pA = Number(partsA[0]) || 0;
        const yA = Number(partsA[1]) || 0;
        const pB = Number(partsB[0]) || 0;
        const yB = Number(partsB[1]) || 0;

        return yA !== yB ? yA - yB : pA - pB;
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

    populateStatsWeekSelect();
}

function getDateFilterPredicate() {
    const elFilterType = document.getElementById('stats-filter-type');
    const filterType = elFilterType ? elFilterType.value : 'period';

    if (filterType === 'period') {
        const selectedVal = document.getElementById('stats-period-select')?.value;
        if (!selectedVal) return () => false;
        return (item) => {
            // שליפה חכמה: אם זה אובייקט גיחה נשתמש ב-Effective, אחרת רק תאריך
            const fPeriod = (item && typeof item === 'object' && item.date) ? getEffectivePeriod(item) : getPeriodDisplay(item);
            return fPeriod === selectedVal;
        };
    }

    if (filterType === 'week') {
        const selectedPeriod = document.getElementById('stats-period-select')?.value;
        const elWeek = document.getElementById('stats-week-value');
        if (!elWeek) return () => false;
        const selectedWeekVal = elWeek.value;

        return (item) => {
            const dateObj = (item && item.date) ? new Date(item.date) : new Date(item);
            const fPeriod = (item && typeof item === 'object' && item.date) ? getEffectivePeriod(item) : (window.getPeriodName ? window.getPeriodName(dateObj) : getPeriodDisplay(dateObj));

            if (selectedPeriod && fPeriod !== selectedPeriod) return false;

            if (selectedWeekVal && selectedWeekVal !== "ALL") {
                const weekOfPeriod = window.calculateWeekNumber ? window.calculateWeekNumber(dateObj, fPeriod) : 1;
                return weekOfPeriod === parseInt(selectedWeekVal);
            }
            return true;
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
        return (item) => {
            const d = new Date((item && item.date) ? item.date : item);
            return d >= startDate && d <= endDate;
        };
    }
    return () => true;
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

    mainCard.classList.remove('md:col-span-2', 'md:row-span-2');
    mainCard.querySelector('.chart-wrapper').classList.replace('h-[500px]', 'h-[200px]');

    clickedCard.classList.add('md:col-span-2', 'md:row-span-2');
    clickedCard.querySelector('.chart-wrapper').classList.replace('h-[200px]', 'h-[500px]');

    container.prepend(clickedCard);
    currentMainCardId = clickedCardId;

    const duration = 500;
    const startTime = performance.now();

    function animateResize(currentTime) {
        const elapsed = currentTime - startTime;
        Object.values(chartInstances).forEach(chart => { if (chart) chart.resize(); });
        if (elapsed < duration) requestAnimationFrame(animateResize);
        else {
            Object.values(chartInstances).forEach(chart => {
                if (chart) { chart.resize(); chart.update('none'); }
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
    if (elWeekVal) {
        // שימוש בפונקציה הגלובלית של התקופה במקום של השנה הכללית
        const currentPeriod = window.getPeriodName ? window.getPeriodName(today) : null;
        const weekNum = window.calculateWeekNumber ? window.calculateWeekNumber(today, currentPeriod) : 1;
        elWeekVal.value = weekNum;
    }

    const filterTypeSelect = document.getElementById('stats-filter-type');
    if (filterTypeSelect) {
        filterTypeSelect.addEventListener('change', (e) => toggleFilterInputs(e.target.value));
    }

    const periodSelect = document.getElementById('stats-period-select');
    if (periodSelect) {
        periodSelect.addEventListener('change', () => {
            populateStatsWeekSelect();
        });
    }

    Object.assign(window.statsManager, {
        renderStatsDashboard,
        onCrewFilterChange,
        swapToMain,

        showPopulationTable: () => {
            const container = document.getElementById('stats-population-table-container');
            if (container) {
                container.classList.remove('hidden');
                window.statsManager.updateSubPops();
                window.statsManager.updatePopTable();
                container.scrollIntoView({ behavior: 'smooth' });
            }
        },

        updateSubPops: async () => {
            const type = document.getElementById('stats-table-pop-type').value;
            const subPopSelect = document.getElementById('stats-table-sub-pop');
            if (!subPopSelect) return;

            subPopSelect.innerHTML = '<option value="">כל התתי-אוכלוסיות</option>';

            const popData = await getPopDataForPeriod(null); // בטבלת האוכלוסיות נמשוך מהמאגר הכללי

            let list = [];
            if (type === 'instructors') list = popData.instructorGroups || [];
            else if (type === 'conversion') list = popData.conversionGroups || [];
            else list = popData.courses || [];

            list.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.name;
                opt.textContent = item.name;
                subPopSelect.appendChild(opt);
            });
            window.statsManager.updatePopTable();
        },

        updatePopTable: async () => {
            const type = document.getElementById('stats-table-pop-type').value;
            const subPopName = document.getElementById('stats-table-sub-pop').value;
            const tbody = document.getElementById('pop-table-body');
            if (!tbody) return;

            const popData = await getPopDataForPeriod(null);

            const mapping = popData.flightMapping || { students: [], instructors: [], conversion: [] };
            let relevantFlightNames = [];
            if (type === 'instructors') relevantFlightNames = mapping.instructors || [];
            else if (type === 'conversion') relevantFlightNames = mapping.conversion || [];
            else relevantFlightNames = mapping.students || [];

            let relevantPilots = [];
            let groups = [];
            if (type === 'instructors') groups = popData.instructorGroups || [];
            else if (type === 'conversion') groups = popData.conversionGroups || [];
            else groups = popData.courses || [];

            const cleanSubPopName = subPopName ? subPopName.trim().replace(/["']/g, '"') : "ALL";

            if (cleanSubPopName === "ALL" || cleanSubPopName === "") {
                groups.forEach(g => {
                    let members = g.members || g.students || [];
                    if (g.inactiveStudents) members = members.filter(m => !g.inactiveStudents.includes(m));
                    relevantPilots.push(...members);
                });
                relevantPilots = [...new Set(relevantPilots)];
            } else {
                const group = groups.find(g => {
                    const gName = g.name ? g.name.trim().replace(/["']/g, '"') : "";
                    return gName === cleanSubPopName;
                });
                if (group) {
                    let members = group.members || group.students || [];
                    if (group.inactiveStudents) members = members.filter(m => !group.inactiveStudents.includes(m));
                    relevantPilots = members;
                }
            }

            const cleanRelevantPilots = relevantPilots.map(p => p?.trim()).filter(Boolean);

            const filtered = (window.savedFlights || []).filter(f => {
                const fData = f.data || {};
                const pilotsInFlight = [
                    fData['טייס ימין'], fData['טייס שמאל'], fData['pilot-right'], fData['pilot-left']
                ].map(p => p?.toString().trim()).filter(Boolean);

                return cleanRelevantPilots.length > 0 && pilotsInFlight.some(p => cleanRelevantPilots.includes(p));
            });
            filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

            if (filtered.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center p-6 text-gray-500 italic">אין נתונים התואמים לסיווג</td></tr>';
            } else {
                tbody.innerHTML = filtered.map(f => `
                    <tr class="border-b hover:bg-gray-50 transition-colors">
                        <td class="p-3 text-sm text-center border-l border-gray-100">${f.data['טייס ימין'] || f.data['pilot-right'] || '---'}</td>
                        <td class="p-3 text-sm text-center border-l border-gray-100">${f.data['שם גיחה'] || '---'}</td>
                        <td class="p-3 text-sm text-center border-l border-gray-100">${new Date(f.date).toLocaleDateString('he-IL')}</td>
                        <td class="p-3 text-sm text-center font-bold">
                            <span class="${f.executionStatus === 'בוצעה' ? 'text-green-600' : 'text-gray-600'}">${f.executionStatus || 'בוצעה'}</span>
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

    if (type === 'period') {
        document.getElementById('filter-period-group')?.classList.remove('hidden');
    } else if (type === 'week') {
        // הצגת שתי התיבות יחד לטובת בחירה היררכית
        document.getElementById('filter-period-group')?.classList.remove('hidden');
        document.getElementById('filter-week-group')?.classList.remove('hidden');
        populateStatsWeekSelect();
    } else if (type === 'range') {
        document.getElementById('filter-range-group')?.classList.remove('hidden');
    }
}

function updateSimulatorFilterOptions(flights) {
    const selectSim = document.getElementById('filter-simulator');
    if (!selectSim) return;

    const currentVal = selectSim.value;
    const simSet = new Set();

    flights.forEach(f => {
        const sim = f.data?.['סימולטור'];
        if (sim) simSet.add(sim);
    });

    selectSim.innerHTML = '<option value="">כל הסימולטורים</option>';
    Array.from(simSet).sort().forEach(sim => {
        const op = document.createElement('option');
        op.value = sim;
        op.textContent = sim;
        selectSim.appendChild(op);
    });

    if (simSet.has(currentVal)) {
        selectSim.value = currentVal;
    }
}

// --- ניהול מסך יעדים ומדדים ---

let showAsPercent = false;
let lastFilteredFlightsForMetrics = [];

window.statsManager.toggleValueType = function () {
    showAsPercent = !showAsPercent;
    const btn = document.getElementById('toggle-percent-btn');
    if (btn) btn.textContent = showAsPercent ? "הצג במספרים #" : "הצג באחוזים %";

    window.statsManager.renderStatsDashboard();
    if (typeof window.statsManager.refreshGoalsAndMetrics === 'function') {
        window.statsManager.refreshGoalsAndMetrics();
    }
};

window.statsManager.refreshMetricsChart = () => {
    renderMetricsUtilizationChart(lastFilteredFlightsForMetrics);
};

function renderMetricsUtilizationChart(flights) {
    const id = 'chart-metrics-utilization';
    const ctx = document.getElementById(id);
    const selector = document.getElementById('stats-metric-selector');
    if (!ctx || !selector) return;

    lastFilteredFlightsForMetrics = flights;
    destroyChartIfExists('metrics', id);

    const metricsData = {};
    flights.forEach(f => {
        const selectedMetrics = Array.isArray(f.data?.['מדדי ביצוע']) ? f.data['מדדי ביצוע'] : [];
        selectedMetrics.forEach(m => {
            if (m && m.main && m.value) {
                if (!metricsData[m.main]) metricsData[m.main] = {};
                metricsData[m.main][m.value] = (metricsData[m.main][m.value] || 0) + 1;
            }
        });
    });

    const currentSelected = selector.value;
    const newHtml = Object.keys(metricsData).map(m =>
        `<option value="${m}" ${m === currentSelected ? 'selected' : ''}>${m}</option>`
    ).join('') || '<option value="">אין מדדים</option>';

    if (selector.innerHTML !== newHtml) {
        selector.innerHTML = newHtml;
    }

    const activeMetric = selector.value;
    if (!activeMetric || !metricsData[activeMetric]) return;

    const subLabels = Object.keys(metricsData[activeMetric]);
    const subValues = Object.values(metricsData[activeMetric]);

    chartInstances.metrics = new Chart(ctx, {
        type: 'pie', plugins: [ChartDataLabels],
        data: { labels: subLabels, datasets: [{ data: subValues, backgroundColor: ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'], borderWidth: 1 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', rtl: true },
                datalabels: {
                    color: '#fff', font: { weight: 'bold', size: 12 },
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

window.statsManager.initGoalsScreen = async function () {
    if (!cachedPlanningData) {
        cachedPlanningData = await fetchPlanningData();
    }

    const selectType = document.getElementById('goals-filter-flight-type');
    if (selectType) {
        const typesSet = new Set();
        (window.savedFlights || []).forEach(f => {
            if (f.data?.['סוג גיחה']) typesSet.add(f.data['סוג גיחה']);
        });
        selectType.innerHTML = '<option value="">כל הסוגים</option>';
        Array.from(typesSet).sort().forEach(type => {
            selectType.innerHTML += `<option value="${type}">${type}</option>`;
        });

        if (!selectType.dataset.listenerAttached) {
            selectType.addEventListener('change', window.statsManager.refreshGoalsAndMetrics);
            selectType.dataset.listenerAttached = "true";
        }
    }

    const periodSelect = document.getElementById('goals-period-select');
    const weekSelect = document.getElementById('goals-week-select');

    if (periodSelect && !periodSelect.dataset.listenerAttached) {
        periodSelect.addEventListener('change', () => window.statsManager.updateGoalsSubPops());
        periodSelect.dataset.listenerAttached = "true";
    }
    if (weekSelect && !weekSelect.dataset.listenerAttached) {
        weekSelect.addEventListener('change', window.statsManager.refreshGoalsAndMetrics);
        weekSelect.dataset.listenerAttached = "true";
    }

    const popTypeSelect = document.getElementById('goals-pop-type');
    const subPopSelect = document.getElementById('goals-sub-pop');

    if (popTypeSelect && !popTypeSelect.dataset.listenerAttached) {
        popTypeSelect.addEventListener('change', () => window.statsManager.updateGoalsSubPops());
        popTypeSelect.dataset.listenerAttached = "true";
    }
    if (subPopSelect && !subPopSelect.dataset.listenerAttached) {
        subPopSelect.addEventListener('change', window.statsManager.refreshGoalsAndMetrics);
        subPopSelect.dataset.listenerAttached = "true";
    }

    const goalFlightSelector = document.getElementById('stats-goal-flight-selector');
    if (goalFlightSelector && !goalFlightSelector.dataset.listenerAttached) {
        goalFlightSelector.addEventListener('change', window.statsManager.refreshGoalsChart);
        goalFlightSelector.dataset.listenerAttached = "true";
    }

    const metricSelector = document.getElementById('stats-metric-selector');
    if (metricSelector && !metricSelector.dataset.listenerAttached) {
        metricSelector.addEventListener('change', window.statsManager.refreshMetricsChart);
        metricSelector.dataset.listenerAttached = "true";
    }

    await window.statsManager.updateGoalsSubPops();
};

window.statsManager.updateGoalsSubPops = async function () {
    const typeSelect = document.getElementById('goals-pop-type');
    const subPopSelect = document.getElementById('goals-sub-pop');
    const periodSelect = document.getElementById('goals-period-select');
    if (!typeSelect || !subPopSelect) return;

    const type = typeSelect.value;
    const selectedPeriod = periodSelect?.value;

    if (!type || type === "") {
        subPopSelect.innerHTML = '<option value="ALL">כל הקבוצות</option>';
        subPopSelect.disabled = true;
        await window.statsManager.refreshGoalsAndMetrics();
        return;
    }

    subPopSelect.disabled = false;

    // קריאה לפונקציית העזר כדי להבטיח משיכה נכונה של התקופה
    let popData = await getPopDataForPeriod(selectedPeriod);

    let list = [];
    if (type === 'instructors') list = popData.instructorGroups || [];
    else if (type === 'conversion') list = popData.conversionGroups || [];
    else list = popData.courses || [];

    let optionsHtml = '<option value="ALL">כל הקבוצות</option>';
    optionsHtml += list.map(item => {
        const safeName = (item.name || '').trim().replace(/"/g, '&quot;');
        return `<option value="${safeName}">${item.name}</option>`;
    }).join('');

    subPopSelect.innerHTML = optionsHtml;
    await window.statsManager.refreshGoalsAndMetrics();
};

window.statsManager.ensureDataLoaded = async function () {
    if (!cachedPlanningData) {
        cachedPlanningData = await fetchPlanningData();
    }
};

window.statsManager.refreshGoalsAndMetrics = async function () {
    const type = document.getElementById('goals-pop-type')?.value;
    const subPopName = document.getElementById('goals-sub-pop')?.value.trim().replace(/["']/g, '"') || "ALL";
    const selectedFlightType = document.getElementById('goals-filter-flight-type')?.value;
    const selectedPeriod = document.getElementById('goals-period-select')?.value;
    const selectedWeek = parseInt(document.getElementById('goals-week-select')?.value);
    const normalize = (name) => name ? name.trim().replace(/&quot;/g, '"').replace(/["']/g, '"') : "";

    let filtered = (window.savedFlights || []).filter(f =>
        f.executionStatus !== 'טרם דווחה' && f.executionStatus !== 'בוטלה'
    );

    // 1. סינון לפי תקופה
    if (selectedPeriod && selectedPeriod !== "ALL" && selectedPeriod !== "") {
        filtered = filtered.filter(f => {
            const display = window.getPeriodDisplay ? window.getPeriodDisplay(f.date) : f.period;
            const rawPeriod = f.isAdminAdded ? f.period : display;
            return String(rawPeriod || '').trim() === selectedPeriod.trim();
        });
    }

    // 2. סינון לפי שבוע 
    if (selectedWeek && !isNaN(selectedWeek) && selectedPeriod && cachedPlanningData) {
        filtered = filtered.filter(f => {
            if (!f.date) return false;
            const weekNum = getWeekOfPeriod(f.date, cachedPlanningData);
            return weekNum === selectedWeek;
        });
    }

    // 3. סינון לפי סוג גיחה
    if (selectedFlightType) {
        filtered = filtered.filter(f => f.data?.['סוג גיחה'] === selectedFlightType);
    }

    // 4. סינון לפי אוכלוסייה (סוף סוף מכיל גם מדריכים!)
    if (type && type !== "") {
        let popData = await getPopDataForPeriod(selectedPeriod);

        if (popData) {
            let groups = [];
            if (type === 'instructors') groups = popData.instructorGroups || [];
            else if (type === 'conversion') groups = popData.conversionGroups || [];
            else groups = popData.courses || [];

            const cleanSubPopName = subPopName === "ALL" ? "ALL" : subPopName.trim().replace(/["']/g, '"');

            let relevantPilots = [];
            if (cleanSubPopName === "ALL" || cleanSubPopName === "") {
                groups.forEach(g => {
                    let members = g.members || g.students || [];
                    if (g.inactiveStudents) members = members.filter(m => !g.inactiveStudents.includes(m));
                    relevantPilots.push(...members);
                });
                relevantPilots = [...new Set(relevantPilots)];
            } else {
                const group = groups.find(g => {
                    const gName = g.name ? g.name.trim().replace(/["']/g, '"') : "";
                    return gName === cleanSubPopName;
                });
                if (group) {
                    let members = group.members || group.students || [];
                    if (group.inactiveStudents) members = members.filter(m => !group.inactiveStudents.includes(m));
                    relevantPilots = members;
                }
            }

            const cleanRelevantPilots = relevantPilots.map(p => p?.trim()).filter(Boolean);

            filtered = filtered.filter(f => {
                const fData = f.data || {};
                const pilotsInFlight = [
                    fData['טייס ימין'], fData['טייס שמאל'], fData['pilot-right'], fData['pilot-left']
                ].map(p => p?.toString().trim()).filter(Boolean);

                return cleanRelevantPilots.length > 0 && pilotsInFlight.some(p => cleanRelevantPilots.includes(p));
            });
        }
    }

    // 5. רינדור סופי
    window.currentFilteredFlights = filtered;

    if (typeof renderGoalsChart === 'function') {
        renderGoalsChart(filtered);
    }
    if (typeof renderMetricsUtilizationChart === 'function') {
        renderMetricsUtilizationChart(filtered);
    }
};