import { savedFlights } from '../core/global.js';

window.goalsManager = window.goalsManager || {};

window.goalsManager.initGoalsScreen = async function () {
    // 1. ווידוא טעינת נתונים בסיסית מול השרת/מטמון
    if (typeof window.statsManager?.ensureDataLoaded === 'function') {
        await window.statsManager.ensureDataLoaded();
    }
    
    console.log("DEBUG: Initializing UI listeners...");

    const weekSelect = document.getElementById('goals-week-select');
    const periodSelect = document.getElementById('goals-period-select');
    const typeSelect = document.getElementById('goals-filter-flight-type');

    // 2. אכלוס הרשימות מראש (חובה לעשות לפני הוספת מאזינים)
    await populateGoalsPeriodSelect();
    window.goalsManager.populateFlightTypeSelect();

    // 3. הגדרת מאזינים (Event Listeners)
    if (periodSelect) {
        periodSelect.addEventListener('change', () => {
            const isAll = periodSelect.value === 'ALL';
            if (weekSelect) {
                weekSelect.style.display = isAll ? 'none' : 'block';
                const weekLabel = document.querySelector('label[for="goals-week-select"]');
                if (weekLabel) weekLabel.style.display = isAll ? 'none' : 'block';
            }
            window.goalsManager.populateWeekSelect();
            window.goalsManager.refreshGoalsAndMetrics();
        });
    }

    if (weekSelect) {
        weekSelect.addEventListener('change', () => {
            window.goalsManager.refreshGoalsAndMetrics();
        });
    }

    if (typeSelect) {
        typeSelect.addEventListener('change', () => {
            window.goalsManager.refreshGoalsAndMetrics();
        });
    }

    // 4. חישוב והגדרת התקופה הנוכחית
    if (periodSelect) {
        const currentPeriod = (window.getPeriodName ? window.getPeriodName(new Date()) : "").trim();
        const optionExists = [...periodSelect.options].some(o => o.value.trim() === currentPeriod);
        periodSelect.value = optionExists ? currentPeriod : 'ALL';
    }

    // 5. אכלוס שבועות רלוונטיים
    window.goalsManager.populateWeekSelect();

    // 6. הטריגר ההתחלתי: משתמשים בהשהייה קלה (150ms) כדי לתת ל-HTML להירנדר
    // ואז משגרים אירוע 'change' שמפעיל את שרשרת הרינדור בדיוק כאילו המשתמש ביצע סינון.
    setTimeout(() => {
        console.log("DEBUG: Triggering initial render...");
        if (periodSelect) {
            periodSelect.dispatchEvent(new Event('change'));
        } else {
            window.goalsManager.refreshGoalsAndMetrics();
        }
    }, 150);
};

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

// פונקציית עזר חדשה לאכלוס תקופות שמושכת גם מהגיחות וגם מהגדרות
async function populateGoalsPeriodSelect() {
    const select = document.getElementById('goals-period-select');
    if (!select) return;

    const periods = new Set();
    const configs = window.planningSettings?.periodConfigs || {};
    Object.keys(configs).forEach(p => periods.add(p.trim()));

    // הוספת תקופות מתוך הגיחות - עם בדיקת תקינות
    (window.savedFlights || []).forEach(f => {
        if (f.date && typeof window.getPeriodName === 'function') {
            const p = window.getPeriodName(f.date);
            // אם קיבלנו תקופה שבורה (כמו 1/00), נתעלם ממנה
            if (p && !p.includes('/00')) {
                periods.add(p.trim());
            }
        }
    });

    const sortedPeriods = Array.from(periods).sort((a, b) => {
        const [pA, yA] = a.split('/');
        const [pB, yB] = b.split('/');
        return (Number(yB) + Number(pB) / 10) - (Number(yA) + Number(pA) / 10);
    });

    select.innerHTML = '<option value="ALL">כל התקופות</option>';
    sortedPeriods.forEach(p => {
        select.innerHTML += `<option value="${p}">${p}</option>`;
    });
}

window.goalsManager.populateFlightTypeSelect = function() {
    const typeSelect = document.getElementById('goals-filter-flight-type');
    if (!typeSelect) {
        console.warn("Dropdown 'goals-filter-flight-type' not found.");
        return;
    }

    // גישה לרשימה מתוך המשתנה הגלובלי שהוגדר ב-adminManager
    // אם window.personnelLists לא זמין, נוודא שיש גיבוי או נבצע Import
    const types = window.personnelLists?.flightTypes || ["יום אימון", "חניכים", "הסבת מדריכים", "צ'ק", "השכלה", "פנימי", "אבלואציה"];

    // בניית האופציות
    typeSelect.innerHTML = '<option value="ALL">כל הסוגים</option>' +
        types.map(type => `<option value="${type}">${type}</option>`).join('');
    
    console.log("DEBUG: Flight types dropdown populated.");
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
    console.log("DEBUG: Refreshing goals with Type filter...");

    const periodSelect = document.getElementById('goals-period-select');
    const weekSelect = document.getElementById('goals-week-select');
    // הוספת קריאה לאלמנט של סוג הגיחה
    const typeSelect = document.getElementById('goals-filter-flight-type');

    const selectedPeriod = periodSelect?.value;
    const selectedWeek = weekSelect?.value;
    const selectedType = typeSelect?.value; // קריאת סוג הגיחה הנבחר

    try {
        let filtered = (window.savedFlights || []).filter(f =>
            f.executionStatus !== 'טרם דווחה' && f.executionStatus !== 'בוטלה'
        );

        // 1. סינון תקופה
        if (selectedPeriod && selectedPeriod !== "ALL" && selectedPeriod !== "") {
            filtered = filtered.filter(f => {
                const rawPeriod = f.isAdminAdded ? f.period : window.getPeriodName(f.date);
                return String(rawPeriod || '').trim() === selectedPeriod.trim();
            });
        }

        // 2. סינון שבוע
        if (selectedWeek && selectedWeek !== "ALL" && selectedWeek !== "") {
            filtered = filtered.filter(f => {
                const fPeriod = window.getPeriodName ? window.getPeriodName(f.date) : f.period;
                // מתעלמים מהמסד (f.week) ומחשבים על המקום
                const flightWeek = window.calculateWeekNumber ? window.calculateWeekNumber(f.date, fPeriod) : f.week;
                return String(flightWeek) === String(selectedWeek);
            });
        }

        // 3. הוספת הסינון לפי סוג גיחה (התיקון)
        if (selectedType && selectedType !== "ALL" && selectedType !== "") {
            filtered = filtered.filter(f => {
                return String(f.data?.['סוג גיחה'] || '').trim() === selectedType.trim();
            });
        }

        console.log("DEBUG: Filtered count after all filters:", filtered.length);

        currentFilteredFlights = filtered;
        renderGoalsChart(filtered);
        renderMetricsUtilizationChart(filtered);

    } catch (error) {
        console.error("CRITICAL ERROR in refreshGoalsAndMetrics:", error);
    }
};
// פונקציית עזר מאוחדת לחישוב מספר שבוע לפי תקופה
window.goalsManager.getWeekNumber = function (dateVal, periodName) {
    if (window.calculateWeekNumber) {
        return window.calculateWeekNumber(dateVal, periodName);
    }
    return null;
};


function safeDate(dateVal) {
    if (dateVal instanceof Date) return dateVal;
    const d = new Date(dateVal);
    return isNaN(d.getTime()) ? null : d;
}

function renderGoalsChart(flights) {
    const id = 'chart-goals-status';
    const ctx = document.getElementById(id);
    const selector = document.getElementById('stats-goal-flight-selector');
    
    // הגנת קריסה: אם אין קנבס או שאין סלקטור, לא להמשיך!
    if (!ctx || !selector) {
        console.warn("DEBUG: renderGoalsChart missing canvas or selector. Aborting.");
        return;
    }

    destroyChartIfExists('goals', id);

    const currentSelectedName = selector.value || "";
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

    // המשך בניית הגרף (Chart.js)...
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


window.goalsManager.populateWeeksFromAdmin = function () {
    const weekSelect = document.getElementById('goals-week-select');
    const periodSelect = document.getElementById('goals-period-select');
    if (!weekSelect || !periodSelect || !window.planningSettings) return;

    const activePeriod = periodSelect.value;
    const config = window.planningSettings.periodConfigs?.[activePeriod];

    weekSelect.innerHTML = '<option value="ALL">כל השבועות</option>';

    if (config?.weeks) {
        for (let i = 1; i <= config.weeks; i++) {
            weekSelect.innerHTML += `<option value="${i}">שבוע ${i}</option>`;
        }
    }
};

window.goalsManager.populateWeekSelect = function () {
    const weekSelect = document.getElementById('goals-week-select');
    const periodSelect = document.getElementById('goals-period-select');
    if (!weekSelect || !periodSelect) return;

    const selectedPeriod = periodSelect.value;
    const currentVal = weekSelect.value;
    const weeksSet = new Set();

    (window.savedFlights || []).forEach(f => {
        const fPeriod = window.getPeriodName ? window.getPeriodName(f.date) : f.period;
        if (selectedPeriod === "ALL" || fPeriod === selectedPeriod) {
            // התעלמות מהשדה הישן במסד הנתונים, חישוב בזמן אמת!
            const calcWeek = window.calculateWeekNumber ? window.calculateWeekNumber(f.date, fPeriod) : Number(f.week);
            if (calcWeek) {
                weeksSet.add(calcWeek);
            }
        }
    });

    // ניקוי ואכלוס מחדש
    weekSelect.innerHTML = '<option value="ALL">כל השבועות</option>';

    Array.from(weeksSet).sort((a, b) => a - b).forEach(w => {
        weekSelect.innerHTML += `<option value="${w}">שבוע ${w}</option>`;
    });

    if (currentVal && (currentVal === "ALL" || weeksSet.has(Number(currentVal)))) {
        weekSelect.value = currentVal;
    }
};

function renderMetricsUtilizationChart(flights) {
    const id = 'chart-metrics-utilization';
    const ctx = document.getElementById(id);
    const selector = document.getElementById('stats-metric-selector');
    if (!ctx || !selector) return;

    console.log("DEBUG: Rendering Metrics Chart. Flights count:", flights.length);

    destroyChartIfExists('metrics', id);

    const metricsData = {};
    flights.forEach(f => {
        // וודאי שאנחנו מחפשים בשדה הנכון - המדדים נמצאים בתוך f.data['מדדי ביצוע']
        const selectedMetrics = Array.isArray(f.data?.['מדדי ביצוע']) ? f.data['מדדי ביצוע'] : [];
        selectedMetrics.forEach(m => {
            if (m && m.main && m.value) {
                if (!metricsData[m.main]) metricsData[m.main] = {};
                metricsData[m.main][m.value] = (metricsData[m.main][m.value] || 0) + 1;
            }
        });
    });

    console.log("DEBUG: Metrics Data keys:", Object.keys(metricsData));

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
    // השמדה דרך המשתנה הגלובלי שלנו
    if (chartInstances[key]) {
        chartInstances[key].destroy();
        chartInstances[key] = null;
    }

    // השמדה דרך ה-Registry של Chart.js (זה החלק החשוב שמונע את השגיאה)
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