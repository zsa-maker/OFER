// public/js/features/simulatorManager.js

import { getPeriodDisplay } from '../core/util.js';
import { showFaultDetailsModal } from './faultManager.js';

window.facilityCloseTimes = {};

let isListenerAttached = false;
let lastGeneratedPeriodicReport = null; // שמירת נתוני הדוח האחרון לייצוא לאקסל

export async function initSimulatorManager() {
    if (!window.planningSettings && window.db) {
        try {
            const { doc, getDoc } = window.firestoreFunctions;
            const snap = await getDoc(doc(window.db, "settings", "planning"));
            if (snap.exists()) window.planningSettings = snap.data();
        } catch (e) { console.error("Failed to load planning settings", e); }
    }
    setupFilters();
    await fetchFacilityCloseTimes();
    renderSimulatorDashboard();
    checkMissingCloseTimes();

    if (!isListenerAttached) {
        window.addEventListener('personnelListsUpdated', () => renderSimulatorDashboard());
        isListenerAttached = true;
    }
}

// ============================================================================
// פונקציות עזר מתוקנות לזיהוי תקופה, שבוע, משך גיחה וסטטוס ביצוע
// ============================================================================

function getEffectivePeriodName(dateInput, flightObj = null) {
    if (flightObj?.data?.manualPeriod && flightObj.data.manualPeriod !== 'auto') {
        return String(flightObj.data.manualPeriod).trim();
    }
    if (flightObj?.isAdminAdded && flightObj?.period) {
        return String(flightObj.period).trim();
    }
    if (typeof window.getPeriodName === 'function' && dateInput) {
        return String(window.getPeriodName(dateInput)).trim();
    }
    return dateInput ? getPeriodDisplay(new Date(dateInput)) : '';
}

function getStartSundayOfDate(d) {
    if (!d) return null;
    const s = new Date(d);
    s.setHours(0, 0, 0, 0);
    s.setDate(s.getDate() - s.getDay());
    return s;
}

function getPeriodStartSunday(periodName) {
    const planning = window.planningSettings || {};
    const config = planning.periodConfigs?.[periodName];

    if (config && config.startDate) {
        return getStartSundayOfDate(new Date(config.startDate));
    }

    if (planning.periodCurrStart && getEffectivePeriodName(planning.periodCurrStart) === periodName) {
        return getStartSundayOfDate(new Date(planning.periodCurrStart));
    }
    if (planning.periodPrevStart && getEffectivePeriodName(planning.periodPrevStart) === periodName) {
        return getStartSundayOfDate(new Date(planning.periodPrevStart));
    }
    if (planning.periodNextStart && getEffectivePeriodName(planning.periodNextStart) === periodName) {
        return getStartSundayOfDate(new Date(planning.periodNextStart));
    }

    if (periodName && periodName.includes('/')) {
        const [pNum, pYear] = periodName.split('/');
        const fullYear = 2000 + parseInt(pYear);
        if (!isNaN(fullYear)) {
            return pNum === "1"
                ? getStartSundayOfDate(new Date(fullYear - 1, 11, 15))
                : getStartSundayOfDate(new Date(fullYear, 5, 15));
        }
    }
    return null;
}

export function getWeekNumberInPeriod(dateInput, periodName) {
    if (!dateInput) return 1;
    const dSunday = getStartSundayOfDate(new Date(dateInput));
    const startSunday = getPeriodStartSunday(periodName);
    if (!dSunday || !startSunday) return 1;
    const diffDays = Math.round((dSunday.getTime() - startSunday.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.floor(diffDays / 7) + 1);
}

/**
 * חישוב שעות גיחה מתוך 'שעות טיסה (דקות)' או מתוך 'שעת התחלה' ו-'שעת סיום'
 */
export function getFlightHours(flight) {
    if (!flight || !flight.data) return 0;
    const d = flight.data;

    const explicitMins = parseFloat(d['שעות טיסה (דקות)']);
    if (!isNaN(explicitMins) && explicitMins > 0) {
        return explicitMins / 60;
    }

    const start = (d['שעת התחלה'] || '').trim();
    const end = (d['שעת סיום'] || '').trim();
    if (!start || !end || !start.includes(':') || !end.includes(':')) return 0;

    let diff = (new Date(`1970-01-01T${end}:00`) - new Date(`1970-01-01T${start}:00`)) / 60000;
    if (isNaN(diff)) return 0;
    if (diff < 0) diff += 1440;
    return diff / 60;
}

export function isFlightCancelled(f) {
    if (!f) return false;
    const d = f.data || {};
    return f.executionStatus === 'בוטלה' || f.executionStatus === 'גיחה בוטלה' || Boolean(d['סיבת ביטול']) || d['סוג גיחה'] === 'ביטול גיחה';
}

export function isFlightPartial(f) {
    if (!f || isFlightCancelled(f)) return false;
    const d = f.data || {};
    const execType = d['סוג ביצוע'] || '';
    return execType === 'חלקי' || execType === 'מופרעת' || execType === 'ביצוע חלקי' ||
        f.executionStatus === 'בוצעה חלקית' || f.executionStatus === 'גיחה חלקית' || f.executionStatus === 'גיחה מופרעת';
}

export function isFlightExecuted(f) {
    if (!f || isFlightCancelled(f)) return false;
    if (f.executionStatus === 'טרם דווחה') return false;
    return ['בוצעה', 'דווחה', 'בוצעה ידנית', 'בוצעה חלקית', 'גיחה חלקית', 'גיחה מופרעת'].includes(f.executionStatus);
}

/**
 * חישוב זמן השבתה שסומן בגיחה או עקב ביטול טכני (בשעות)
 */
export function getFlightDowntimeHours(f) {
    if (!f || !f.data) return 0;
    const d = f.data;

    // 1. אם הוזן שדה מפורש של זמן השבתה בטופס הגיחה
    if (d['זמן השבתה (דקות)'] !== undefined && d['זמן השבתה (דקות)'] !== '') {
        return (parseFloat(d['זמן השבתה (דקות)']) || 0) / 60;
    }
    if (d['זמן השבתה'] !== undefined && d['זמן השבתה'] !== '') {
        const val = parseFloat(d['זמן השבתה']) || 0;
        return val > 10 ? val / 60 : val;
    }

    // 2. אם הגיחה בוטלה מסיבה טכנית - משך הגיחה נחשב כזמן השבתה
    const cancelReason = (d['סיבת ביטול'] || '').trim();
    if (isFlightCancelled(f) && cancelReason.includes('טכני')) {
        return getFlightHours(f);
    }

    // 3. אם בגיחה דווחה תקלה משביתה (isDowntime) והגיחה חלקית עם דרישה לביצוע חוזר
    const hasDowntimeFault = Array.isArray(f.faults) && f.faults.some(fl => fl.isDowntime);
    if (hasDowntimeFault && isFlightPartial(f) && d['נדרש ביצוע חוזר'] === 'כן') {
        return getFlightHours(f);
    }

    return 0;
}

/**
 * חישוב זמן אימון חלקי (בשעות) עבור נוסחת הזמינות החוזית
 */
export function getFlightPartialHours(f) {
    if (!f || !isFlightPartial(f)) return 0;
    const d = f.data || {};

    if (d['זמן אימון חלקי (דקות)'] !== undefined && d['זמן אימון חלקי (דקות)'] !== '') {
        return (parseFloat(d['זמן אימון חלקי (דקות)']) || 0) / 60;
    }
    if (d['זמן אימון חלקי'] !== undefined && d['זמן אימון חלקי'] !== '') {
        const val = parseFloat(d['זמן אימון חלקי']) || 0;
        return val > 10 ? val / 60 : val;
    }

    // ברירת מחדל: משך הגיחה החלקית
    return getFlightHours(f);
}

/**
 * זיהוי תקלות חוזרות בכל המאגר:
 * תקלה באותה תת-קבוצה של סיווג מערכת (או מערכת אם אין תת-מערכת) באותו מאמן
 * בהפרש של פחות מ-48 שעות או בפחות מ-5 גיחות מהתקלה האחרונה בתת-המערכת,
 * כולל תמיכה בטיוב ידני של משתמש מנהל בלבד (manualRecurringOverride).
 */
export function computeRecurringFaultsMap() {
    if (typeof window.processFaultsData === 'function') {
        window.processFaultsData();
    }

    const allFaults = Object.values(window.unifiedFaultsDatabase || {});
    const executedFlights = (window.savedFlights || []).filter(f => isFlightExecuted(f));

    // מיון גיחות שבוצעו לפי חותמת זמן
    const flightsTimeline = executedFlights.map(f => {
        const datePart = typeof f.date === 'string' ? f.date.split('T')[0] : new Date(f.date).toISOString().split('T')[0];
        const startStr = (f.data?.['שעת התחלה'] || '00:00').trim();
        const ts = f.flightStartTimestamp || new Date(`${datePart}T${startStr}:00`).getTime() || new Date(f.date).getTime();
        return {
            id: f.id,
            sim: (f.data?.['סימולטור'] || '').trim().toUpperCase(),
            ts: ts
        };
    }).sort((a, b) => a.ts - b.ts);

    // מיון כל התקלות בסדר כרונולוגי עולה
    const sortedFaults = [...allFaults].sort((a, b) => (a.firstReportTimestamp || 0) - (b.firstReportTimestamp || 0));

    const lastFaultBySimAndSubsys = {};
    const recurringResult = {};

    sortedFaults.forEach(fault => {
        const key = fault.key;
        const category = fault.status?.faultCategory || '';

        // 1. בדיקת טיוב ידני ע"י מנהל
        if (fault.status && fault.status.manualRecurringOverride !== undefined && fault.status.manualRecurringOverride !== null) {
            recurringResult[key] = Boolean(fault.status.manualRecurringOverride);
        } else if (category === 'לא תקלה') {
            recurringResult[key] = false;
        } else {
            const sim = (fault.simulator || '').trim().toUpperCase();
            const sysRaw = (fault.systemClassification || fault.status?.systemClassification || '').trim();
            const groupKey = `${sim}|${sysRaw || 'ללא_סיווג'}`;
            const currentTs = fault.firstReportTimestamp || 0;

            const prevFault = lastFaultBySimAndSubsys[groupKey];
            if (prevFault && currentTs > 0 && prevFault.ts > 0) {
                const diffHours = (currentTs - prevFault.ts) / (1000 * 60 * 60);

                // ספירת גיחות שבוצעו במאמן זה בין התקלה הקודמת לתקלה הנוכחית
                const flightsBetween = flightsTimeline.filter(fl =>
                    fl.sim === sim && fl.ts > prevFault.ts && fl.ts <= currentTs
                ).length;

                recurringResult[key] = (diffHours < 48 || flightsBetween < 5);
            } else {
                recurringResult[key] = false;
            }
        }

        // עדכון התקלה האחרונה באותה תת-מערכת (כל עוד אינה "לא תקלה")
        if (category !== 'לא תקלה') {
            const sim = (fault.simulator || '').trim().toUpperCase();
            const sysRaw = (fault.systemClassification || fault.status?.systemClassification || '').trim();
            const groupKey = `${sim}|${sysRaw || 'ללא_סיווג'}`;
            lastFaultBySimAndSubsys[groupKey] = {
                ts: fault.firstReportTimestamp || 0,
                key: key
            };
        }
    });

    return recurringResult;
}
window.computeRecurringFaultsMap = computeRecurringFaultsMap;

// ============================================================================
// ניהול שעות סגירה וסינונים בעמוד המאמנים
// ============================================================================

async function fetchFacilityCloseTimes() {
    if (!window.db || !window.firestoreFunctions) return;
    try {
        const { collection, getDocs } = window.firestoreFunctions;
        const snap = await getDocs(collection(window.db, "facility_status"));
        snap.forEach(doc => {
            const data = doc.data();
            window.facilityCloseTimes[doc.id] = data.simulators || {};

            if (data.closeTime && Object.keys(window.facilityCloseTimes[doc.id]).length === 0) {
                window.facilityCloseTimes[doc.id] = { 'FFS': data.closeTime, 'VIPT': data.closeTime };
            }
        });
    } catch (e) { console.error("Failed to fetch close times", e); }
}

function checkMissingCloseTimes() {
    if (!window.savedFlights || window.savedFlights.length === 0) return;

    const today = new Date();

    for (let i = 7; i >= 0; i--) {
        const checkDate = new Date();
        checkDate.setDate(today.getDate() - i);

        const y = checkDate.getFullYear();
        const m = String(checkDate.getMonth() + 1).padStart(2, '0');
        const d = String(checkDate.getDate()).padStart(2, '0');
        const dateStr = `${y}-${m}-${d}`;

        if (i === 0 && today.getHours() < 21) continue;

        const hasFlownFlights = window.savedFlights.some(f => {
            if (!f.date || !f.data) return false;
            if (!isFlightExecuted(f)) return false;
            if (!f.data['שעת התחלה']) return false;

            let fDateStr = typeof f.date === 'string' ? f.date : new Date(f.date).toISOString();
            if (fDateStr.includes('T')) fDateStr = fDateStr.split('T')[0];

            return fDateStr === dateStr;
        });

        if (hasFlownFlights && !window.facilityCloseTimes[dateStr]) {
            showMissingCloseModal(dateStr);
            return;
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

export function renderSimulatorDashboard() {
    const container = document.getElementById('simulators-dashboard-container');
    if (!container) return;

    const personnel = window.personnelLists || {};
    const simulators = Array.isArray(personnel.simulators) ? personnel.simulators : [];

    if (simulators.length === 0) {
        container.innerHTML = `<div class="col-span-full text-center py-10">לא נמצאו מאמנים.</div>`;
        return;
    }

    container.innerHTML = simulators.map((sim, index) => createSimulatorCardHTML(sim, index)).join('');

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

function isDateInSimFilter(dateObj, flightObj = null) {
    const timeFilterType = document.getElementById('sim-time-filter-type')?.value || 'all';
    const d = new Date(dateObj);
    d.setHours(0, 0, 0, 0);

    const itemPeriod = getEffectivePeriodName(d, flightObj);

    if (timeFilterType === 'period') {
        const selectedPeriod = document.getElementById('sim-period-select')?.value;
        return itemPeriod === selectedPeriod;
    }
    else if (timeFilterType === 'month') {
        const selectedPeriod = document.getElementById('sim-period-select')?.value;
        const selectedMonth = parseInt(document.getElementById('sim-month-select')?.value);
        return itemPeriod === selectedPeriod && d.getMonth() === selectedMonth;
    }
    else if (timeFilterType === 'week') {
        const selectedWeek = parseInt(document.getElementById('sim-week-select')?.value);
        const selectedPeriod = document.getElementById('sim-period-select')?.value;
        if (!selectedPeriod) return true;
        if (itemPeriod !== selectedPeriod) return false;
        if (!selectedWeek) return true;
        return getWeekNumberInPeriod(d, selectedPeriod) === selectedWeek;
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

function getAllAvailablePeriods() {
    const periods = new Set();
    if (window.planningSettings?.periodConfigs) {
        Object.keys(window.planningSettings.periodConfigs).forEach(p => periods.add(p.trim()));
    }
    (window.savedFlights || []).forEach(f => {
        if (f.date) {
            const p = getEffectivePeriodName(f.date, f);
            if (p) periods.add(p);
        }
    });
    Object.values(window.unifiedFaultsDatabase || {}).forEach(f => {
        if (f.firstReportTimestamp) {
            const p = getEffectivePeriodName(new Date(f.firstReportTimestamp));
            if (p) periods.add(p);
        }
    });

    return Array.from(periods).sort((a, b) => {
        const [pA, yA] = a.split('/').map(Number);
        const [pB, yB] = b.split('/').map(Number);
        return yA !== yB ? yA - yB : pA - pB;
    });
}

function setupFilters() {
    const periodSelect = document.getElementById('sim-period-select');
    if (periodSelect) {
        const sortedPeriods = getAllAvailablePeriods();
        periodSelect.innerHTML = sortedPeriods.map(p => `<option value="${p}">${p}</option>`).join('');
        if (sortedPeriods.length > 0) {
            const currP = getEffectivePeriodName(new Date());
            periodSelect.value = sortedPeriods.includes(currP) ? currP : sortedPeriods[sortedPeriods.length - 1];
        }
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
        return isDateInSimFilter(new Date(f.date), f);
    });
}

// ============================================================================
// חישוב מדדים מתוקן לכרטיסי המאמנים בעמוד הראשי
// ============================================================================

function calculateSimulatorMetrics(simName, faults, filteredFlights) {
    // גיחות מתוכננות (ללא גיחות שסומנו כלא מתוכננות)
    const plannedFlights = filteredFlights.filter(f => !f.isUnplanned);
    const totalPlannedHours = plannedFlights.reduce((acc, f) => acc + getFlightHours(f), 0);

    // גיחות שבוצעו בפועל (כולל 'בוצעה', 'דווחה', 'בוצעה ידנית', ולמעט גיחה חלקית שדורשת ביצוע חוזר)
    const actualFlights = filteredFlights.filter(f => {
        if (!isFlightExecuted(f)) return false;
        if (isFlightPartial(f) && f.data?.['נדרש ביצוע חוזר'] === 'כן') return false;
        return true;
    });
    const actualHours = actualFlights.reduce((acc, f) => acc + getFlightHours(f), 0);

    // זמן השבתה
    const downtimeHours = filteredFlights.reduce((acc, f) => acc + getFlightDowntimeHours(f), 0);

    // ספירת תקלות אמיתיות (ללא "לא תקלה")
    const validFaults = faults.filter(f => f.status?.faultCategory !== 'לא תקלה');

    // תקלות מפעיל (תקלות תפעול / שדווחו בטופס גיחה ע"י מדריכה ולא ידנית ע"י טכנאי)
    const operatorFaults = validFaults.filter(f => f.status?.faultCategory === 'תפעול' || !f.isManualEntry);

    // ביטולים (גיחות שבוטלו + גיחות חלקיות שדורשות ביצוע חוזר)
    const cancelledOrRepeatCount = plannedFlights.filter(f =>
        isFlightCancelled(f) || (isFlightPartial(f) && f.data?.['נדרש ביצוע חוזר'] === 'כן')
    ).length;

    const availability = totalPlannedHours > 0
        ? Math.max(0, ((totalPlannedHours - downtimeHours) / totalPlannedHours) * 100).toFixed(1)
        : "100.0";

    const cancellationRate = plannedFlights.length > 0
        ? ((cancelledOrRepeatCount / plannedFlights.length) * 100).toFixed(1)
        : "0.0";

    const utilization = totalPlannedHours > 0
        ? ((actualHours / totalPlannedHours) * 100).toFixed(1)
        : "0.0";

    // MTBF = זמן הפעלה / סכום התקלות
    const mtbf = validFaults.length > 0
        ? (totalPlannedHours / validFaults.length).toFixed(1)
        : totalPlannedHours.toFixed(1);

    // MTBPC = זמן אימון בפועל / סכום תקלות מפעיל
    const mtbpc = operatorFaults.length > 0
        ? (actualHours / operatorFaults.length).toFixed(1)
        : actualHours.toFixed(1);

    return {
        availability,
        cancellationRate,
        mtbpc,
        utilization,
        mtbf
    };
}

function calculateAverageClosureTime(faults) {
    const resolved = faults.filter(f => f.status?.isResolved && !f.status?.isClosedWithPermission && f.status?.timestamp && f.firstReportTimestamp);
    if (resolved.length === 0) return "0";
    const totalMs = resolved.reduce((acc, f) => acc + (f.status.timestamp - f.firstReportTimestamp), 0);
    return (totalMs / resolved.length / (1000 * 60 * 60)).toFixed(1);
}

function createSimulatorCardHTML(simName, index) {
    const faults = getFilteredFaults(simName);
    const openFaults = faults.filter(f => f.status && !f.status.isResolved);
    const avgCloseTime = calculateAverageClosureTime(faults);

    const isDown = openFaults.some(f => f.isDowntime);
    const headerBgColor = isDown ? 'bg-red-600' : 'bg-ofer-dark-brown';
    const metrics = calculateSimulatorMetrics(simName, faults, getFilteredFlights(simName));

    const openFaultsList = openFaults.length > 0
        ? openFaults.map(f => {
            const safeKey = f.key ? f.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n').replace(/\r/g, '') : '';
            const safeDesc = f.description ? f.description.replace(/"/g, '&quot;') : 'ללא תיאור';
            const displayDesc = f.description || 'ללא תיאור';

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

// ============================================================================
// הפקת דוח תקופתי מחולק לשבועות (25 עמודות)
// ============================================================================

// החלף את PERIODIC_REPORT_COLUMNS בקובץ simulatorManager.js במערך הבא:
const PERIODIC_REPORT_COLUMNS = [
    {
        label: "שבוע",
        tooltip: "מספר השבוע בתקופה וטווח התאריכים שלו (מיום ראשון עד שבת)"
    },
    {
        label: "זמן הפעלה (24/7)",
        tooltip: "סך שעות היממה בשבוע: 24 שעות × 7 ימים = 168 שעות שבועיות"
    },
    {
        label: "STT זמן תכנון",
        tooltip: "סכום שעות הגיחות המתוכננות שהוזנו ע\"י המדריכות (ללא גיחות שסומנו כלא מתוכננות)"
    },
    {
        label: "זמן אימון בפועל",
        tooltip: "סכום שעות הגיחות שבוצעו בפועל במאמן (למעט גיחות שבוטלו או גיחות חלקיות הדורשות ביצוע חוזר)"
    },
    {
        label: "כמות גיחות",
        tooltip: "סך כל הגיחות המתוכננות והמדווחות בשבוע זה"
    },
    {
        label: "כמות ביטולי גיחה בגלל תקלת איוש",
        tooltip: "כמות הגיחות שבוטלו כאשר סיבת הביטול הוגדרה כ'איוש'"
    },
    {
        label: "כמות ביטולי גיחות טכניות",
        tooltip: "כמות הגיחות שבוטלו כאשר סיבת הביטול הוגדרה כ'טכני'"
    },
    {
        label: "כמות ביטולי גיחה בגלל כוח עליון (מלחמה/חשמל/בינוי)",
        tooltip: "כמות הגיחות שבוטלו עקב כוח עליון (מלחמה / חשמל / בינוי)"
    },
    {
        label: "כמות גיחות חלקיות",
        tooltip: "כמות הגיחות שדווחו בסטטוס ביצוע חלקי"
    },
    {
        label: "כמות גיחות עם היתר",
        tooltip: "כמות הגיחות שבהן דווחה תקלה שנסגרה בהיתר או שסומנו כגיחה עם היתר"
    },
    {
        label: "זמן השבתה",
        tooltip: "סך שעות ההשבתה שסומנו בטופס הגיחה או שעות גיחות שבוטלו מסיבה טכנית"
    },
    {
        label: "כמות תקלות מאומתות",
        tooltip: "כמות התקלות שנסגרו וסומנו כ'אומת' ע\"י הטכנאי (למעט 'לא תקלה')"
    },
    {
        label: "כמות תקלות לא מאומתות",
        tooltip: "כמות התקלות שנסגרו וסומנו כ'לא אומת' ע\"י הטכנאי (למעט 'לא תקלה')"
    },
    {
        label: "אחוז אימות תקלות",
        tooltip: "נוסחה: (כמות תקלות מאומתות / סך התקלות שנסגרו עם סטטוס אימות) × 100"
    },
    {
        label: "כמות תקלות טכנאי",
        tooltip: "כמות התקלות שהוזנו ידנית במערכת ע\"י טכנאי (למעט 'לא תקלה')"
    },
    {
        label: "סה\"כ כמות תקלות",
        tooltip: "סך כל התקלות שדווחו במאמן בשבוע זה (למעט דיווחים שסווגו כ'לא תקלה')"
    },
    {
        label: "כמות תקלות שהוגדרו כ\"לא תקלה\"",
        tooltip: "כמות הדיווחים שנסגרו תחת סיווג סגירה 'לא תקלה'"
    },
    {
        label: "כמות תקלות שהועברו להנדסה",
        tooltip: "כמות התקלות שנסגרו תחת סיווג 'הועבר לצוות פיתוח' / הנדסה"
    },
    {
        label: "כמות תקלות תפעול",
        tooltip: "כמות התקלות שנסגרו תחת סיווג 'תפעול' (תפעול שגוי של המדריכה / הטייס)"
    },
    {
        label: "כמות תקלות חוזרות",
        tooltip: "תקלה באותה תת-מערכת (או מערכת אם אין תת-מערכת) בהפרש של פחות מ-48 שעות או פחות מ-5 גיחות מהתקלה האחרונה בתת-המערכת, או שסומנה ידנית ע\"י מנהל"
    },
    {
        label: "אחוז זמינות טכנית",
        tooltip: "נוסחה: ((STT זמן תכנון - זמן השבתה) / STT זמן תכנון) × 100"
    },
    {
        label: "אחוז זמינות חוזית",
        tooltip: "נוסחה: ((זמן הגיחות המתוכננות - (זמן השבתה + זמן האימון החלקי)) / זמן הגיחות המתוכננות) × 100"
    },
    {
        label: "אחוז ביטולי הגיחות",
        tooltip: "נוסחה: (סה\"כ גיחות שבוטלו / סה\"כ כמות הגיחות) × 100"
    },
    {
        label: "אחוז ניצול",
        tooltip: "נוסחה: (זמן אימון בפועל / STT זמן תכנון) × 100"
    },
    {
        label: "MTBF",
        tooltip: "נוסחה: זמן הפעלה (24/7) / סה\"כ כמות התקלות"
    },
    {
        label: "MTBPC",
        tooltip: "נוסחה: זמן אימון בפועל / סכום תקלות מפעיל"
    }
];

window.openSimulatorPeriodicReportModal = function () {
    const modal = document.getElementById('simulator-periodic-report-modal');
    if (!modal) return;

    const periodSelect = document.getElementById('sim-report-period-select');
    const simSelect = document.getElementById('sim-report-sim-select');

    // אכלוס תקופות
    const periods = getAllAvailablePeriods();
    if (periodSelect) {
        periodSelect.innerHTML = periods.map(p => `<option value="${p}">${p}</option>`).join('');
        const mainSelectedPeriod = document.getElementById('sim-period-select')?.value;
        const currentPeriod = getEffectivePeriodName(new Date());
        if (mainSelectedPeriod && periods.includes(mainSelectedPeriod)) {
            periodSelect.value = mainSelectedPeriod;
        } else if (periods.includes(currentPeriod)) {
            periodSelect.value = currentPeriod;
        } else if (periods.length > 0) {
            periodSelect.value = periods[periods.length - 1];
        }
    }

    // אכלוס מאמנים
    const sims = window.personnelLists?.simulators || [];
    if (simSelect) {
        simSelect.innerHTML = `<option value="ALL">כל המאמנים (מאוחד)</option>` +
            sims.map(s => `<option value="${s}">${s}</option>`).join('');
    }

    modal.classList.remove('hidden');
    window.generateSimulatorPeriodicReport();
};

/**
 * חישוב שורת נתונים (25 מדדים) עבור שבוע ספציפי או עבור סיכום התקופה
 */
function computeMetricsRowForBucket(label, flightsInBucket, faultsInBucket, recurringMap, weeksCountInBucket = 1) {
    // 1. זמן הפעלה (24/7) -> 168 שעות לכל שבוע
    const operatingTime24_7 = weeksCountInBucket * 168;

    // 2. STT זמן תכנון - התכנון שהוזן ע"י המדריכות (גיחות מתוכננות ללא גיחות לא מתוכננות)
    const plannedFlights = flightsInBucket.filter(f => !f.isUnplanned);
    const sttHours = plannedFlights.reduce((sum, f) => sum + getFlightHours(f), 0);

    // 3. זמן אימון בפועל - זמן שבו התאמנו במאמן
    const executedFlights = flightsInBucket.filter(f => isFlightExecuted(f));
    const actualTrainingHours = executedFlights.reduce((sum, f) => {
        if (isFlightPartial(f) && f.data?.['נדרש ביצוע חוזר'] === 'כן') return sum;
        return sum + getFlightHours(f);
    }, 0);

    // 4. כמות גיחות (סה"כ גיחות מתוכננות/מדווחות באותו שבוע)
    const totalFlightsCount = flightsInBucket.length;

    // 5. כמות ביטולי גיחה בגלל תקלת איוש
    const cancelledStaffingCount = flightsInBucket.filter(f => {
        if (!isFlightCancelled(f)) return false;
        const r = (f.data?.['סיבת ביטול'] || '').trim();
        return r.includes('איוש');
    }).length;

    // 6. כמות ביטולי גיחות טכניות
    const cancelledTechCount = flightsInBucket.filter(f => {
        if (!isFlightCancelled(f)) return false;
        const r = (f.data?.['סיבת ביטול'] || '').trim();
        return r.includes('טכני');
    }).length;

    // 7. כמות ביטולי גיחה בגלל כוח עליון (מלחמה/חשמל/בינוי)
    const cancelledForceMajeureCount = flightsInBucket.filter(f => {
        if (!isFlightCancelled(f)) return false;
        const r = (f.data?.['סיבת ביטול'] || '').trim();
        return r.includes('כוח עליון') || r.includes('מלחמה') || r.includes('חשמל') || r.includes('בינוי');
    }).length;

    // 8. כמות גיחות חלקיות
    const partialFlightsCount = flightsInBucket.filter(f => isFlightPartial(f)).length;

    // 9. כמות גיחות עם היתר (גיחות שבהן דווחה תקלה שנסגרה בהיתר או שצוין היתר בנתוני הגיחה)
    const permissionFaultFlightIds = new Set();
    faultsInBucket.forEach(fl => {
        if (fl.status?.isClosedWithPermission || fl.status?.wasClosedWithPermission) {
            (fl.sourceFlights || []).forEach(fid => permissionFaultFlightIds.add(fid));
        }
    });
    const flightsWithPermissionCount = flightsInBucket.filter(f =>
        permissionFaultFlightIds.has(f.id) ||
        f.data?.['היתר'] === 'כן' ||
        f.data?.['בוצעה בהיתר'] === 'כן'
    ).length;

    // 10. זמן השבתה (שסומן בטופס הגיחה / ביטול טכני)
    const downtimeHours = flightsInBucket.reduce((sum, f) => sum + getFlightDowntimeHours(f), 0);
    const partialLostHours = flightsInBucket.reduce((sum, f) => sum + getFlightPartialHours(f), 0);

    // סיווגי תקלות (11-19)
    // 16. כמות תקלות שהוגדרו כ"לא תקלה"
    const notAFaultCount = faultsInBucket.filter(fl => fl.status?.faultCategory === 'לא תקלה').length;

    // תקלות תקפות (ללא "לא תקלה")
    const validFaults = faultsInBucket.filter(fl => fl.status?.faultCategory !== 'לא תקלה');

    // 11. כמות תקלות מאומתות
    const verifiedFaultsCount = validFaults.filter(fl => fl.status?.isResolved && fl.status?.isVerified === true).length;

    // 12. כמות תקלות לא מאומתות
    const unverifiedFaultsCount = validFaults.filter(fl => fl.status?.isResolved && fl.status?.isVerified === false).length;

    // 13. אחוז אימות תקלות
    const totalCheckedForVerification = verifiedFaultsCount + unverifiedFaultsCount;
    const verificationRate = totalCheckedForVerification > 0
        ? ((verifiedFaultsCount / totalCheckedForVerification) * 100).toFixed(1) + '%'
        : '0.0%';

    // 14. כמות תקלות טכנאי (תקלות שהוזנו ידנית ע"י טכנאי)
    const technicianFaultsCount = validFaults.filter(fl => Boolean(fl.isManualEntry)).length;

    // 15. סה"כ כמות תקלות
    const totalFaultsCount = validFaults.length;

    // 17. כמות תקלות שהועברו להנדסה
    const engineeringFaultsCount = validFaults.filter(fl => {
        const cat = (fl.status?.faultCategory || '').trim();
        return cat === 'הועבר לצוות פיתוח' || cat.includes('הנדסה') || cat.includes('פיתוח');
    }).length;

    // 18. כמות תקלות תפעול - תפעול שגוי של המדריכה / הטייס
    const operationFaultsCount = validFaults.filter(fl => (fl.status?.faultCategory || '').trim() === 'תפעול').length;

    // 19. כמות תקלות חוזרות (לפי <48 שעות או <5 גיחות באותה תת-מערכת + טיוב ידני של מנהל)
    const recurringFaultsCount = validFaults.filter(fl => Boolean(recurringMap[fl.key])).length;

    // 20. אחוז זמינות טכנית = (STT - זמן השבתה) / STT
    const techAvailabilityRate = sttHours > 0
        ? (Math.max(0, (sttHours - downtimeHours) / sttHours) * 100).toFixed(1) + '%'
        : '100.0%';

    // 21. אחוז זמינות חוזית = (זמן הגיחות המתוכננות - (זמן השבתה + זמן האימון החלקי)) / זמן הגיחות המתוכננות
    const contractualAvailabilityRate = sttHours > 0
        ? (Math.max(0, (sttHours - (downtimeHours + partialLostHours)) / sttHours) * 100).toFixed(1) + '%'
        : '100.0%';

    // 22. אחוז ביטולי הגיחות
    const totalCancelledFlights = flightsInBucket.filter(f => isFlightCancelled(f)).length;
    const cancellationRate = totalFlightsCount > 0
        ? ((totalCancelledFlights / totalFlightsCount) * 100).toFixed(1) + '%'
        : '0.0%';

    // 23. אחוז ניצול = (זמן אימון בפועל / STT)
    const utilizationRate = sttHours > 0
        ? ((actualTrainingHours / sttHours) * 100).toFixed(1) + '%'
        : '0.0%';

    // 24. MTBF = (זמן הפעלה / סכום התקלות)
    const mtbfVal = totalFaultsCount > 0
        ? (operatingTime24_7 / totalFaultsCount).toFixed(1)
        : '-';

    // 25. MTBPC = (זמן אימון בפועל / סכום תקלות מפעיל)
    // תקלות מפעיל: תקלות תפעול (או תקלות שדווחו ע"י מפעיל אם אין סיווג סגירה עדיין)
    const operatorFaultsCount = operationFaultsCount > 0
        ? operationFaultsCount
        : validFaults.filter(fl => !fl.isManualEntry).length;

    const mtbpcVal = operatorFaultsCount > 0
        ? (actualTrainingHours / operatorFaultsCount).toFixed(1)
        : '-';

    return [
        label,
        operatingTime24_7.toFixed(1),
        sttHours.toFixed(2),
        actualTrainingHours.toFixed(2),
        totalFlightsCount,
        cancelledStaffingCount,
        cancelledTechCount,
        cancelledForceMajeureCount,
        partialFlightsCount,
        flightsWithPermissionCount,
        downtimeHours.toFixed(2),
        verifiedFaultsCount,
        unverifiedFaultsCount,
        verificationRate,
        technicianFaultsCount,
        totalFaultsCount,
        notAFaultCount,
        engineeringFaultsCount,
        operationFaultsCount,
        recurringFaultsCount,
        techAvailabilityRate,
        contractualAvailabilityRate,
        cancellationRate,
        utilizationRate,
        mtbfVal,
        mtbpcVal
    ];
}

window.generateSimulatorPeriodicReport = function () {
    const selectedPeriod = document.getElementById('sim-report-period-select')?.value;
    const selectedSim = document.getElementById('sim-report-sim-select')?.value || 'ALL';

    const thead = document.getElementById('sim-periodic-report-thead');
    const tbody = document.getElementById('sim-periodic-report-tbody');
    const tfoot = document.getElementById('sim-periodic-report-tfoot');
    if (!thead || !tbody || !tfoot) return;

    const recurringMap = computeRecurringFaultsMap();

    // סינון גיחות לתקופה ולמאמן
    const periodFlights = (window.savedFlights || []).filter(f => {
        if (!f.date) return false;
        const p = getEffectivePeriodName(f.date, f);
        if (p !== selectedPeriod) return false;
        if (selectedSim !== 'ALL') {
            const sim = (f.data?.['סימולטור'] || '').trim().toUpperCase();
            if (sim !== selectedSim.trim().toUpperCase()) return false;
        }
        return true;
    });

    // סינון תקלות לתקופה ולמאמן
    const periodFaults = Object.values(window.unifiedFaultsDatabase || {}).filter(fl => {
        if (!fl.firstReportTimestamp) return false;
        const p = getEffectivePeriodName(new Date(fl.firstReportTimestamp));
        if (p !== selectedPeriod) return false;
        if (selectedSim !== 'ALL') {
            const sim = (fl.simulator || '').trim().toUpperCase();
            if (sim !== selectedSim.trim().toUpperCase()) return false;
        }
        return true;
    });

    // קביעת השבועות להצגה בתקופה
    let maxWeek = 26;
    periodFlights.forEach(f => {
        const w = getWeekNumberInPeriod(f.date, selectedPeriod);
        if (w >= 1 && w <= 52 && w > maxWeek) maxWeek = w;
    });
    periodFaults.forEach(fl => {
        const w = getWeekNumberInPeriod(new Date(fl.firstReportTimestamp), selectedPeriod);
        if (w >= 1 && w <= 52 && w > maxWeek) maxWeek = w;
    });

    // בניית כותרות הטבלה לתצוגה במסך (ה-Tooltip מוצג רק במעבר עכבר על המסך)
    thead.innerHTML = `
        <tr>
            ${PERIODIC_REPORT_COLUMNS.map((col, idx) => `
                <th title="${col.tooltip.replace(/"/g, '&quot;')}"
                    class="group relative border border-gray-300 px-2.5 py-2.5 whitespace-nowrap font-bold cursor-help select-none ${idx === 0 ? 'sticky right-0 bg-gray-200 z-30' : 'bg-gray-100 hover:bg-gray-200 transition'}">
                    <div class="flex items-center justify-center gap-1">
                        <span>${col.label}</span>
                        <i class="fas fa-info-circle text-gray-400 group-hover:text-ofer-orange text-[10px] no-print"></i>
                    </div>
                    <div class="no-print hidden group-hover:block absolute top-full mt-1 ${idx < 3 ? 'right-0' : (idx > PERIODIC_REPORT_COLUMNS.length - 4 ? 'left-0' : 'left-1/2 -translate-x-1/2')} z-50 w-56 p-2 bg-gray-900 text-white text-[11px] font-normal rounded-lg shadow-xl whitespace-normal text-right leading-relaxed pointer-events-none">
                        ${col.tooltip}
                    </div>
                </th>
            `).join('')}
        </tr>
    `;

    const startSunday = getPeriodStartSunday(selectedPeriod);
    const rowsData = [];
    let tbodyHtml = '';

    for (let w = 1; w <= maxWeek; w++) {
        const wFlights = periodFlights.filter(f => getWeekNumberInPeriod(f.date, selectedPeriod) === w);
        const wFaults = periodFaults.filter(fl => getWeekNumberInPeriod(new Date(fl.firstReportTimestamp), selectedPeriod) === w);

        let weekLabel = `שבוע ${w}`;
        if (startSunday) {
            const wStart = new Date(startSunday);
            wStart.setDate(wStart.getDate() + (w - 1) * 7);
            const wEnd = new Date(wStart);
            wEnd.setDate(wEnd.getDate() + 6);
            const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
            weekLabel = `שבוע ${w} (${fmt(wStart)}-${fmt(wEnd)})`;
        }

        const rowValues = computeMetricsRowForBucket(weekLabel, wFlights, wFaults, recurringMap, 1);
        rowsData.push(rowValues);

        const hasActivity = wFlights.length > 0 || wFaults.length > 0;
        const rowClass = hasActivity ? 'hover:bg-blue-50 font-medium text-gray-800' : 'text-gray-400 bg-gray-50/40';

        tbodyHtml += `
            <tr class="${rowClass}">
                ${rowValues.map((val, cIdx) => `
                    <td class="border border-gray-200 px-2 py-1.5 whitespace-nowrap ${cIdx === 0 ? 'sticky right-0 bg-gray-100 font-bold text-gray-900 z-10' : ''}">
                        ${val}
                    </td>
                `).join('')}
            </tr>
        `;
    }

    tbody.innerHTML = tbodyHtml;

    // שורת סיכום תקופתית
    const summaryRow = computeMetricsRowForBucket(`סה"כ / ממוצע תקופה (${selectedPeriod})`, periodFlights, periodFaults, recurringMap, maxWeek);
    tfoot.innerHTML = `
        <tr>
            ${summaryRow.map((val, cIdx) => `
                <td class="border border-gray-400 px-2 py-2 whitespace-nowrap ${cIdx === 0 ? 'sticky right-0 bg-orange-200 z-30' : ''}">
                    ${val}
                </td>
            `).join('')}
        </tr>
    `;

    // שמירת הכותרות הנקיות בלבד (label) עבור ייצוא והדפסה
    lastGeneratedPeriodicReport = {
        period: selectedPeriod,
        simulator: selectedSim,
        headers: PERIODIC_REPORT_COLUMNS.map(c => typeof c === 'object' ? c.label : String(c)),
        rows: rowsData,
        summary: summaryRow
    };
};

window.exportSimulatorPeriodicReportCSV = function () {
    if (!lastGeneratedPeriodicReport) {
        window.generateSimulatorPeriodicReport();
    }
    if (!lastGeneratedPeriodicReport) return;

    const { period, simulator, headers, rows, summary } = lastGeneratedPeriodicReport;
    const escapeCSV = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

    let csvContent = "\uFEFF";
    // ייצוא שמות העמודות בלבד ללא נוסחאות ה-Tooltip
    csvContent += headers.map(escapeCSV).join(",") + "\n";
    rows.forEach(r => {
        csvContent += r.map(escapeCSV).join(",") + "\n";
    });
    csvContent += summary.map(escapeCSV).join(",") + "\n";

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safePeriod = (period || 'all').replace(/\//g, '-');
    link.setAttribute("href", url);
    link.setAttribute("download", `דוח_מאמנים_תקופתי_${simulator}_תקופה_${safePeriod}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

window.printSimulatorPeriodicReport = function () {
    if (!lastGeneratedPeriodicReport) {
        window.generateSimulatorPeriodicReport();
    }
    if (!lastGeneratedPeriodicReport) return;

    const { period, simulator, headers, rows, summary } = lastGeneratedPeriodicReport;

    // בניית טבלה נקייה להדפסה מתוך הכותרות בלבד (ללא אלמנטי ה-Tooltip)
    const theadHtml = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
    const tbodyHtml = rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('');
    const tfootHtml = `<tr>${summary.map(cell => `<td>${cell}</td>`).join('')}</tr>`;

    const win = window.open('', '_blank');
    win.document.write(`
        <html dir="rtl" lang="he">
        <head>
            <title>דוח מאמנים תקופתי - ${simulator === 'ALL' ? 'כל המאמנים' : simulator} (${period})</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 15px; direction: rtl; }
                h2 { text-align: center; margin-bottom: 10px; }
                table { width: 100%; border-collapse: collapse; font-size: 10px; text-align: center; }
                th, td { border: 1px solid #444; padding: 4px; }
                thead { background: #e5e7eb; font-weight: bold; }
                tfoot { background: #fed7aa; font-weight: bold; }
                @page { size: landscape; margin: 10mm; }
            </style>
        </head>
        <body>
            <h2>דוח מאמנים תקופתי מחולק לשבועות - מאמן: ${simulator === 'ALL' ? 'כל המאמנים' : simulator} | תקופה: ${period}</h2>
            <table>
                <thead>${theadHtml}</thead>
                <tbody>${tbodyHtml}</tbody>
                <tfoot>${tfootHtml}</tfoot>
            </table>
        </body>
        </html>
    `);
    win.document.close();
    setTimeout(() => win.print(), 400);
};

// ============================================================================
// גרפים, מודאלי פירוט ושעות סגירת מאמנים (מתוקנים)
// ============================================================================

function getTrendChartData(faults) {
    const dataCounts = {};
    const filterType = document.getElementById('sim-time-filter-type')?.value || 'all';

    if (filterType === 'week') {
        const selectedWeek = parseInt(document.getElementById('sim-week-select')?.value);
        const selectedPeriod = document.getElementById('sim-period-select')?.value;
        let weekStartDate = null;

        if (selectedWeek && selectedPeriod) {
            const startSunday = getPeriodStartSunday(selectedPeriod);
            if (startSunday) {
                weekStartDate = new Date(startSunday);
                weekStartDate.setDate(weekStartDate.getDate() + (selectedWeek - 1) * 7);
            }
        }

        const dayNames = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "שבת"];
        const dateLabels = [];

        for (let i = 0; i < 7; i++) {
            if (weekStartDate) {
                const d = new Date(weekStartDate);
                d.setDate(d.getDate() + i);
                const dayStr = String(d.getDate()).padStart(2, '0');
                const monthStr = String(d.getMonth() + 1).padStart(2, '0');
                dateLabels.push(`${dayStr}/${monthStr} (${dayNames[i]})`);
            } else {
                dateLabels.push(`יום ${dayNames[i]}`);
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

function renderSimulatorCharts(simName, index) {
    if (typeof Chart === 'undefined') return;

    const faults = getFilteredFaults(simName);
    const ctxTrend = document.getElementById(`chart-sim-trend-${index}`);
    if (!ctxTrend) return;

    const filterType = document.getElementById('sim-time-filter-type')?.value || 'all';
    const trendTitleEl = document.getElementById(`trend-title-${index}`);
    if (trendTitleEl) {
        if (filterType === 'week') trendTitleEl.textContent = 'תקלות לפי ימים (לחץ להגדלה)';
        else if (filterType === 'month') trendTitleEl.textContent = 'תקלות לפי שבועות (לחץ להגדלה)';
        else trendTitleEl.textContent = 'תקלות לפי חודשים (לחץ להגדלה)';
    }

    const chartDataMap = getTrendChartData(faults);

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

    const filteredFaults = getFilteredFaults(simName);
    const filteredOpenFaults = filteredFaults.filter(f => f.status && !f.status.isResolved);

    const allFaults = Object.values(window.unifiedFaultsDatabase || {}).filter(f => f.simulator === simName);
    const allOpenFaults = allFaults.filter(f => f.status && !f.status.isResolved);

    const flights = getFilteredFlights(simName);

    const sortedFaults = [...filteredFaults].sort((a, b) => {
        if (a.status?.isResolved !== b.status?.isResolved) return a.status?.isResolved ? 1 : -1;
        return (b.firstReportTimestamp || 0) - (a.firstReportTimestamp || 0);
    });

    const generalResolved = filteredFaults.filter(f => f.status?.isResolved && !f.status?.isClosedWithPermission && f.status?.timestamp && f.firstReportTimestamp);
    let generalAvg = "0";
    if (generalResolved.length > 0) {
        const totalMs = generalResolved.reduce((acc, f) => acc + (f.status.timestamp - f.firstReportTimestamp), 0);
        generalAvg = (totalMs / generalResolved.length / (1000 * 60 * 60)).toFixed(1);
    }

    const permissionFaults = filteredFaults.filter(f => f.status && f.status.isResolved && (f.status.isClosedWithPermission || f.status.wasClosedWithPermission));
    let totalOperatingHours = 0;
    let validCount = 0;

    permissionFaults.forEach(f => {
        if (f.firstReportTimestamp && f.status.timestamp) {
            totalOperatingHours += calculateOperatingHoursBetween(f.firstReportTimestamp, f.status.timestamp, flights, simName);
            validCount++;
        }
    });
    const avgOpCloseTime = validCount > 0 ? (totalOperatingHours / validCount).toFixed(1) : "0";

    const renderFaultList = (faultList) => {
        if (faultList.length === 0) return '<li class="text-gray-500">אין תקלות פתוחות.</li>';
        return faultList.map(f => {
            const safeKey = f.key ? f.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n').replace(/\r/g, '') : '';
            return `
            <li class="pb-1 border-b border-gray-200 last:border-0 ${f.isDowntime ? 'text-red-600 font-bold' : ''} cursor-pointer hover:bg-gray-200 transition p-1 rounded" onclick="window.showFaultDetailsModal('${safeKey}')">
                ${f.isDowntime ? '⚠️ ' : ''}<strong>${f.description || 'ללא תיאור'}</strong> 
                <span class="text-gray-500 text-xs mr-2">(דווח ב: ${f.firstReportTimestamp ? new Date(f.firstReportTimestamp).toLocaleDateString('he-IL') : 'לא ידוע'})</span>
            </li>
        `;
        }).join('');
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
                           כל התקלות בתקופה (${filteredOpenFaults.length})
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
                const safeKey = f.key ? f.key.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n').replace(/\r/g, '') : '';
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

window.exportSimulatorFaultsToExcel = function (simName) {
    const faults = getFilteredFaults(simName);
    if (faults.length === 0) {
        import('../components/modals.js').then(m => m.showToast('אין תקלות לייצוא לתקופה זו.', 'yellow'));
        return;
    }

    const recurringMap = computeRecurringFaultsMap();

    let csvContent = "\uFEFF";
    csvContent += "מאמן,תיאור תקלה,מערכת,תקלה חוזרת,תאריך דיווח,סטטוס,סיווג סגירה,תאריך סגירה,זמן טיפול (שעות),נסגר בהיתר,טכנאי מטפל,תיאור פתרון\n";

    const sortedFaults = [...faults].sort((a, b) => {
        if (a.status?.isResolved !== b.status?.isResolved) return a.status?.isResolved ? 1 : -1;
        return (b.firstReportTimestamp || 0) - (a.firstReportTimestamp || 0);
    });

    sortedFaults.forEach(f => {
        const desc = f.description ? f.description.replace(/,/g, ' - ').replace(/\n/g, ' ') : 'ללא תיאור';
        const sys = f.systemClassification ? f.systemClassification.replace(/,/g, ' - ') : '-';
        const isRec = recurringMap[f.key] ? 'כן' : 'לא';
        const reportDate = f.firstReportTimestamp ? new Date(f.firstReportTimestamp).toLocaleDateString('he-IL') : 'לא ידוע';

        let status = 'פתוחה';
        let category = '-';
        let closeDate = '';
        let handleTime = '';
        let permission = 'לא';
        let technician = '';
        let resolutionDesc = '';

        if (f.status && f.status.isResolved) {
            status = 'טופלה';
            category = f.status.faultCategory || '-';
            closeDate = f.status.date || '';
            if (f.status.isClosedWithPermission || f.status.wasClosedWithPermission) permission = 'כן';

            if (f.status.timestamp && f.firstReportTimestamp) {
                const diffHours = (f.status.timestamp - f.firstReportTimestamp) / (1000 * 60 * 60);
                handleTime = diffHours.toFixed(1);
            }

            technician = f.status.technicianName ? f.status.technicianName.replace(/,/g, ' - ') : '';
            resolutionDesc = f.status.resolutionDescription ? f.status.resolutionDescription.replace(/,/g, ' - ').replace(/\n/g, ' ') : '';
        }

        csvContent += `${simName},${desc},${sys},${isRec},${reportDate},${status},${category},${closeDate},${handleTime},${permission},${technician},${resolutionDesc}\n`;
    });

    const encodedUri = encodeURI("data:text/csv;charset=utf-8," + csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `דוח_תקלות_${simName}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

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

export function getDailyOperatingWindow(dateStr, flights, simName) {
    const dayFlights = flights.filter(f => {
        let fDateStr = typeof f.date === 'string' ? f.date.split('T')[0] : '';
        if (fDateStr !== dateStr || !isFlightExecuted(f) || !f.data?.['שעת התחלה']) return false;
        const flightSim = (f.data['סימולטור'] || '').toUpperCase();
        return flightSim === simName.toUpperCase();
    });

    if (dayFlights.length === 0) return null;

    let earliest = "23:59";
    let latest = "00:00";
    dayFlights.forEach(f => {
        if (f.data['שעת התחלה'] < earliest) earliest = f.data['שעת התחלה'];
        if (f.data['שעת סיום'] > latest) latest = f.data['שעת סיום'];
    });

    const startDt = new Date(`${dateStr}T${earliest}:00`);
    startDt.setMinutes(startDt.getMinutes() - 15);

    let endDt;
    const dailyCloseData = window.facilityCloseTimes[dateStr] || {};
    const closeTimeStr = typeof dailyCloseData === 'object' ? dailyCloseData[simName] : dailyCloseData;

    if (closeTimeStr) {
        endDt = new Date(`${dateStr}T${closeTimeStr}:00`);
        if (endDt < startDt) endDt.setDate(endDt.getDate() + 1);
    } else {
        endDt = new Date(`${dateStr}T${latest}:00`);
    }

    return { start: startDt.getTime(), end: endDt.getTime(), durationHours: (endDt.getTime() - startDt.getTime()) / 3600000 };
}

function calculateOperatingHoursBetween(startTs, endTs, flights, simName) {
    const datesWithFlights = [...new Set(flights.map(f => typeof f.date === 'string' ? f.date.split('T')[0] : ''))].filter(Boolean);
    let operatingMs = 0;

    datesWithFlights.forEach(dateStr => {
        const opWindow = getDailyOperatingWindow(dateStr, flights, simName);
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
};

window.saveGlobalCloseTime = async function () {
    const timeVal = document.getElementById('global-close-time-input').value;
    const dateStr = new Date().toISOString().split('T')[0];
    await _saveFacilityTime(dateStr, timeVal, 'global-close-modal');
};

window.saveMissingCloseTime = async function () {
    const timeVal = document.getElementById('missing-close-time-input').value;
    const dateStr = document.getElementById('missing-date-input').value;
    if (!timeVal) {
        import('../components/modals.js').then(m => m.showToast('נא להזין שעה', 'red'));
        return;
    }
    await _saveFacilityTime(dateStr, timeVal, 'missing-close-modal');
};

async function _saveFacilityTime(dateStr, timeVal, modalId) {
    if (!timeVal) return;
    if (window.firestoreFunctions && window.db) {
        const { doc, setDoc } = window.firestoreFunctions;
        try {
            const sims = window.personnelLists?.simulators || ['FFS', 'VIPT'];
            const simulatorsMap = {};
            sims.forEach(s => { simulatorsMap[s] = timeVal; });

            await setDoc(doc(window.db, "facility_status", dateStr), {
                date: dateStr,
                closeTime: timeVal,
                simulators: simulatorsMap,
                timestamp: Date.now()
            }, { merge: true });

            window.facilityCloseTimes[dateStr] = simulatorsMap;
            import('../components/modals.js').then(m => m.showToast('שעת סגירת מתקן נשמרה', 'green'));
            document.getElementById(modalId).classList.add('hidden');
            renderSimulatorDashboard();
        } catch (e) {
            console.error(e);
            import('../components/modals.js').then(m => m.showToast('שגיאה בשמירה', 'red'));
        }
    }
}

window.openSpecificSimulatorCloseModal = function () {
    const now = new Date();
    document.getElementById('specific-sim-close-time').value = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });

    const select = document.getElementById('specific-sim-select');
    const simulators = window.personnelLists?.simulators || [];
    select.innerHTML = simulators.map(sim => `<option value="${sim}">${sim}</option>`).join('');

    document.getElementById('specific-sim-close-modal').classList.remove('hidden');
};

window.saveSpecificSimulatorCloseTime = async function () {
    const timeVal = document.getElementById('specific-sim-close-time').value;
    const simName = document.getElementById('specific-sim-select').value;
    const dateStr = new Date().toISOString().split('T')[0];

    if (!timeVal) {
        import('../components/modals.js').then(m => m.showToast('נא להזין שעה', 'red'));
        return;
    }

    if (window.firestoreFunctions && window.db) {
        const { doc, setDoc, getDoc } = window.firestoreFunctions;
        try {
            const docRef = doc(window.db, "facility_status", dateStr);
            const docSnap = await getDoc(docRef);

            let simulatorsData = {};
            if (docSnap.exists() && docSnap.data().simulators) {
                simulatorsData = docSnap.data().simulators;
            } else if (docSnap.exists() && docSnap.data().closeTime) {
                simulatorsData = { 'FFS': docSnap.data().closeTime, 'VIPT': docSnap.data().closeTime };
            }

            simulatorsData[simName] = timeVal;

            await setDoc(docRef, {
                date: dateStr,
                simulators: simulatorsData,
                timestamp: Date.now()
            }, { merge: true });

            window.facilityCloseTimes[dateStr] = simulatorsData;

            import('../components/modals.js').then(m => m.showToast(`שעת סגירה נשמרה למאמן ${simName}`, 'green'));
            document.getElementById('specific-sim-close-modal').classList.add('hidden');
            renderSimulatorDashboard();
        } catch (e) {
            console.error(e);
            import('../components/modals.js').then(m => m.showToast('שגיאה בשמירה', 'red'));
        }
    }
};

window.openSimulatorHoursModal = function () {
    const gridHeader = document.getElementById('calendar-grid-container');
    const rowsContainer = document.getElementById('simulators-calendar-rows');
    if (!gridHeader || !rowsContainer) return;

    const simulators = window.personnelLists?.simulators || [];
    const flights = window.savedFlights || [];
    const now = new Date();
    const currentTime = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false });

    let headerHtml = '';
    const days = [];
    let daysBack = 0;

    while (days.length < 5) {
        const d = new Date();
        d.setDate(now.getDate() - daysBack);
        daysBack++;

        if (d.getDay() === 5 || d.getDay() === 6) continue;
        days.unshift(d);
    }

    gridHeader.className = 'grid grid-cols-5 gap-4 min-w-[600px] mb-4';

    days.forEach((d) => {
        const dayName = d.toLocaleDateString('he-IL', { weekday: 'short' });
        const dateDisplay = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
        const isToday = d.toDateString() === now.toDateString();

        headerHtml += `
            <div class="text-center p-2 bg-gray-100 rounded-t-lg border-x border-t">
                <div class="font-bold text-gray-700">${isToday ? 'היום' : dayName}</div>
                <div class="text-[10px] text-gray-500">${dateDisplay}</div>
            </div>
        `;
    });
    gridHeader.innerHTML = headerHtml;

    let rowsHtml = '';
    simulators.forEach(simName => {
        rowsHtml += `
            <div class="border rounded-xl p-4 bg-white shadow-sm">
                <div class="flex items-center gap-2 mb-3 border-b pb-2">
                    <div class="w-3 h-3 rounded-full bg-ofer-orange"></div>
                    <h4 class="font-black text-lg text-gray-800">${simName}</h4>
                </div>
                <div class="grid grid-cols-5 gap-4">
        `;

        days.forEach((dateObj) => {
            const dateStr = dateObj.toISOString().split('T')[0];
            const isToday = dateObj.toDateString() === now.toDateString();

            const hasActivity = flights.some(f => {
                const flightSim = (f.data?.['סימולטור'] || '').toUpperCase();
                return f.date === dateStr && flightSim.includes(simName) && isFlightExecuted(f);
            });

            const dailyData = window.facilityCloseTimes[dateStr] || {};
            const savedTime = dailyData[simName];

            const cardClass = savedTime ? 'bg-green-50 border-green-200' : (hasActivity ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100');

            rowsHtml += `
                <div class="flex flex-col gap-2 p-2 rounded-lg border ${cardClass} transition-all hover:shadow-md">
                    <div class="text-[10px] font-bold ${hasActivity ? 'text-blue-600' : 'text-gray-400'}">
                        ${hasActivity ? '⚡ פעילות זוהתה' : 'אין גיחות'}
                    </div>
                    
                    <input type="time" id="cal-time-${dateStr}-${simName}" 
                        value="${savedTime || (isToday ? currentTime : '')}" 
                        class="w-full text-center text-sm font-bold border rounded p-1 focus:ring-2 focus:ring-ofer-orange outline-none">
                    
                    <button onclick="window.saveSpecificSimTime('${dateStr}', '${simName}')" 
                        class="w-full py-1 text-[10px] font-bold rounded uppercase tracking-tighter transition ${savedTime ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-ofer-orange hover:text-white'}">
                        ${savedTime ? 'עדכון' : 'שמירה'}
                    </button>
                </div>
            `;
        });

        rowsHtml += `</div></div>`;
    });

    rowsContainer.innerHTML = rowsHtml;
    document.getElementById('simulators-hours-modal').classList.remove('hidden');
};

window.saveSpecificSimTime = async function (dateStr, simName) {
    const inputId = `cal-time-${dateStr}-${simName}`;
    const timeVal = document.getElementById(inputId).value;

    if (!timeVal) {
        import('../components/modals.js').then(m => m.showToast('נא להזין שעה', 'yellow'));
        return;
    }

    if (window.firestoreFunctions && window.db) {
        const { doc, setDoc, getDoc } = window.firestoreFunctions;
        try {
            const docRef = doc(window.db, "facility_status", dateStr);
            const docSnap = await getDoc(docRef);

            let simulatorsData = {};
            if (docSnap.exists() && docSnap.data().simulators) {
                simulatorsData = docSnap.data().simulators;
            }

            simulatorsData[simName] = timeVal;

            await setDoc(docRef, {
                date: dateStr,
                simulators: simulatorsData,
                timestamp: Date.now()
            }, { merge: true });

            if (!window.facilityCloseTimes[dateStr]) window.facilityCloseTimes[dateStr] = {};
            window.facilityCloseTimes[dateStr][simName] = timeVal;

            import('../components/modals.js').then(m => m.showToast(`נשמר: ${simName} | ${timeVal}`, 'green'));

            const btn = document.querySelector(`button[onclick*="'${dateStr}', '${simName}'"]`);
            if (btn) {
                btn.textContent = 'עדכון';
                btn.className = 'w-full py-1 text-[10px] font-bold rounded bg-green-600 text-white';
                btn.closest('.border').classList.replace('bg-blue-50', 'bg-green-50');
            }

            if (typeof renderSimulatorDashboard === 'function') renderSimulatorDashboard();
        } catch (e) {
            console.error(e);
            import('../components/modals.js').then(m => m.showToast('שגיאה בשמירה', 'red'));
        }
    }
};

window.renderSimulatorDashboard = renderSimulatorDashboard;