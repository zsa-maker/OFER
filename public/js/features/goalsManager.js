// public/js/features/goalsManager.js

import { savedFlights } from '../core/global.js';

window.goalsManager = window.goalsManager || {};

let chartInstances = {
    goals: null,
    metrics: null
};

let currentFilteredFlights = [];
let showAsPercent = false;

// === פונקציית עזר גלובלית לטעינת אוכלוסיות באופן בטוח (הוספה חסרה) ===
async function getPopDataForPeriod(selectedPeriod) {
    let popData = window.pilotPopulations;
    let periodToFetch = selectedPeriod;

    // חישוב עצמאי ובטוח של התקופה הנוכחית אם לא נבחרה תקופה ספציפית
    if (!periodToFetch || periodToFetch === "ALL") {
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
            } catch(e) {}
        }
        if (!popData) {
            try {
                const { pilotPopulations } = await import('./adminManager.js');
                popData = pilotPopulations;
            } catch(e) {}
        }
        window.pilotPopulations = popData; 
    }
    
    return popData || { instructorGroups: [], courses: [], conversionGroups: [], flightMapping: {} };
}

// 1. אתחול מסך היעדים
window.goalsManager.initGoalsScreen = async function () {
    // --- אכלוס רשימת סוגי גיחות ---
    const selectType = document.getElementById('goals-filter-flight-type');
    if (selectType) {
        const typesSet = new Set();
        (window.savedFlights || []).forEach(f => {
            if (f.data && f.data['סוג גיחה']) typesSet.add(f.data['סוג גיחה']);
        });

        selectType.innerHTML = '<option value="">כל הסוגים</option>';
        Array.from(typesSet).sort().forEach(type => {
            selectType.innerHTML += `<option value="${type}">${type}</option>`;
        });

        if (!selectType.dataset.listenerAttached) {
            selectType.addEventListener('change', window.goalsManager.refreshGoalsAndMetrics);
            selectType.dataset.listenerAttached = "true";
        }
    }

    // --- אכלוס רשימת התקופות מתוך עמוד הניהול ---
    const periodSelect = document.getElementById('goals-period-select');
    if (periodSelect) {
        if (window.planningSettings && window.planningSettings.periodConfigs) {
             const periods = Object.keys(window.planningSettings.periodConfigs).sort((a, b) => {
                const [pA, yA] = a.split('/').map(Number);
                const [pB, yB] = b.split('/').map(Number);
                return (yA + pA / 10) - (yB + pB / 10);
            });
            
            periodSelect.innerHTML = '<option value="ALL">כל התקופות</option>' + 
                                     periods.map(p => `<option value="${p}">${p}</option>`).join('');

            // בחירת התקופה הנוכחית כברירת מחדל
            if (window.getPeriodName) {
                const currPeriod = window.getPeriodName(new Date());
                if (periods.includes(currPeriod)) {
                    periodSelect.value = currPeriod;
                }
            }
        }

        if (!periodSelect.dataset.listenerAttached) {
            periodSelect.addEventListener('change', () => {
                window.goalsManager.updateGoalsSubPops();
            });
            periodSelect.dataset.listenerAttached = "true";
        }
    }

    const weekSelect = document.getElementById('goals-week-select');
    if (weekSelect && !weekSelect.dataset.listenerAttached) {
        weekSelect.addEventListener('change', window.goalsManager.refreshGoalsAndMetrics);
        weekSelect.dataset.listenerAttached = "true";
    }

    const popTypeSelect = document.getElementById('goals-pop-type');
    const subPopSelect = document.getElementById('goals-sub-pop');

    if (popTypeSelect && !popTypeSelect.dataset.listenerAttached) {
        popTypeSelect.addEventListener('change', () => {
            window.goalsManager.updateGoalsSubPops();
        });
        popTypeSelect.dataset.listenerAttached = "true";
    }

    if (subPopSelect && !subPopSelect.dataset.listenerAttached) {
        subPopSelect.addEventListener('change', window.goalsManager.refreshGoalsAndMetrics);
        subPopSelect.dataset.listenerAttached = "true";
    }

    const goalFlightSelector = document.getElementById('stats-goal-flight-selector');
    if (goalFlightSelector && !goalFlightSelector.dataset.listenerAttached) {
        goalFlightSelector.addEventListener('change', window.goalsManager.refreshGoalsChart);
        goalFlightSelector.dataset.listenerAttached = "true";
    }

    const metricSelector = document.getElementById('stats-metric-selector');
    if (metricSelector && !metricSelector.dataset.listenerAttached) {
        metricSelector.addEventListener('change', window.goalsManager.refreshMetricsChart);
        metricSelector.dataset.listenerAttached = "true";
    }

    await window.goalsManager.updateGoalsSubPops();
};

// 2. עדכון רשימת תתי-האוכלוסיות (קורסים/קבוצות)
window.goalsManager.updateGoalsSubPops = async function () {
    try {
        const typeSelect = document.getElementById('goals-pop-type');
        const subPopSelect = document.getElementById('goals-sub-pop');
        const periodSelect = document.getElementById('goals-period-select');
        if (!typeSelect || !subPopSelect) return;

        const type = typeSelect.value;
        const selectedPeriod = periodSelect?.value;

        if (!type || type === "") {
            subPopSelect.innerHTML = '<option value="ALL">כל הקבוצות</option>';
            subPopSelect.disabled = true;
            await window.goalsManager.refreshGoalsAndMetrics();
            return;
        }

        subPopSelect.disabled = false;

        // שימוש בפונקציה המאובטחת לטעינת נתונים
        let popData = await getPopDataForPeriod(selectedPeriod);

        let list = [];
        if (type === 'instructors') {
            list = popData.instructorGroups || [];
        } else if (type === 'conversion') {
            list = popData.conversionGroups || [];
        } else {
            list = popData.courses || [];
        }

        let optionsHtml = '<option value="ALL">כל הקבוצות</option>';
        optionsHtml += list.map(item => `<option value="${(item.name || '').trim().replace(/"/g, '&quot;')}">${item.name}</option>`).join('');

        subPopSelect.innerHTML = optionsHtml;

        await window.goalsManager.refreshGoalsAndMetrics();
    } catch (error) {
        console.error("Error updating goals sub pops:", error);
    }
};

// 3. סינון הגיחות ורינדור הגרפים
window.goalsManager.refreshGoalsAndMetrics = async function () {
    const selectedPeriod = document.getElementById('goals-period-select')?.value;
    const selectedWeek = parseInt(document.getElementById('goals-week-select')?.value);
    
    try {
        const type = document.getElementById('goals-pop-type')?.value;
        const subPopName = document.getElementById('goals-sub-pop')?.value.trim() || "ALL";
        const selectedFlightType = document.getElementById('goals-filter-flight-type')?.value;

        const normalize = (name) => name ? name.trim().replace(/&quot;/g, '"').replace(/["']/g, '"') : "";

        let filtered = (window.savedFlights || []).filter(f =>
            f.executionStatus !== 'טרם דווחה' && f.executionStatus !== 'בוטלה'
        );

        if (selectedPeriod && selectedPeriod !== "ALL" && selectedPeriod !== "") {
            filtered = filtered.filter(f => {
                const rawPeriod = f.isAdminAdded ? f.period : (window.getPeriodName ? window.getPeriodName(f.date) : f.period);
                return String(rawPeriod || '').trim() === selectedPeriod.trim();
            });
        }

        if (selectedWeek && !isNaN(selectedWeek) && selectedPeriod && window.planningSettings) {
            const planning = window.planningSettings;
            filtered = filtered.filter(f => {
                if (!f.date) return false;
                const reportDate = new Date(f.date);
                reportDate.setHours(0, 0, 0, 0);

                let baseDateStr = null;
                if (selectedPeriod === window.getPeriodName?.(new Date(planning.periodCurrStart))) baseDateStr = planning.periodCurrStart;
                else if (selectedPeriod === window.getPeriodName?.(new Date(planning.periodPrevStart))) baseDateStr = planning.periodPrevStart;
                else if (selectedPeriod === window.getPeriodName?.(new Date(planning.periodNextStart))) baseDateStr = planning.periodNextStart;

                if (baseDateStr) {
                    const baseDate = new Date(baseDateStr);
                    baseDate.setHours(0, 0, 0, 0);
                    baseDate.setDate(baseDate.getDate() - baseDate.getDay()); 

                    const diffDays = Math.round((reportDate - baseDate) / (1000 * 60 * 60 * 24));
                    const faultWeekNum = Math.floor(diffDays / 7) + 1;
                    return faultWeekNum === selectedWeek;
                }
                return true; 
            });
        }

        if (selectedFlightType) {
            filtered = filtered.filter(f => f.data?.['סוג גיחה'] === selectedFlightType);
        }

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

                // ניקוי רווחים בלבד, בדיוק כמו במעקב הקבוצתי
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

        currentFilteredFlights = filtered;
        renderGoalsChart(filtered);
        renderMetricsUtilizationChart(filtered);
    } catch (error) {
        console.error("Error in refreshGoalsAndMetrics:", error);
    }
};

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

    const newHtml = '<option value="">כל הגיחות</option>' +
        Array.from(namesSet).map(name => `<option value="${name}" ${name === currentSelectedName ? 'selected' : ''}>${name}</option>`).join('');
    
    if (selector.innerHTML !== newHtml) {
        selector.innerHTML = newHtml;
    }

    const activeFlightName = selector.value;
    const flightsToProcess = activeFlightName && activeFlightName !== "" ? flights.filter(f => f.data?.['שם גיחה'] === activeFlightName) : flights;

    let met = 0; let notMet = 0;

    flightsToProcess.forEach(f => {
        if (f.goalsStatus && typeof f.goalsStatus === 'object') {
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

function renderMetricsUtilizationChart(flights) {
    const id = 'chart-metrics-utilization';
    const ctx = document.getElementById(id);
    const selector = document.getElementById('stats-metric-selector');
    if (!ctx || !selector) return;

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
        type: 'pie',
        plugins: [ChartDataLabels],
        data: {
            labels: subLabels,
            datasets: [{
                data: subValues,
                backgroundColor: ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'],
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

window.goalsManager.refreshGoalsChart = () => { renderGoalsChart(currentFilteredFlights); };
window.goalsManager.refreshMetricsChart = () => { renderMetricsUtilizationChart(currentFilteredFlights); };

window.goalsManager.toggleValueType = function () {
    showAsPercent = !showAsPercent;
    const btn = document.getElementById('toggle-percent-btn');
    if (btn) btn.textContent = showAsPercent ? "הצג במספרים #" : "הצג באחוזים %";
    window.goalsManager.refreshGoalsAndMetrics();
};

window.goalsManager.exportReport = function () {
    const flightType = document.getElementById('goals-filter-flight-type')?.value;
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
                @media print { .no-print { display: none; } }
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