// public/js/core/global.js

import { showToast, hideAllModals } from '../components/modals.js';
import { getExecutionStatusBadge, EXECUTION_STATUS_MANUAL, EXECUTION_STATUS_NOT_REPORTED } from '../features/executionStatusManager.js';
import { renderStatsDashboard } from '../features/statsManager.js';
import missionDatabase from '../features/missionDatabase.js';
import { initProfilePage } from '../features/profileManager.js';
import { loadPersonnelLists, loadGoalsAndSystems } from '../features/adminManager.js';

// --- משתנים גלובליים (EXPORTS) ---
export const trainingTemplates = {
    'GENERIC_FLIGHT': {
        goals: [],
        step2: [],
        step3: []
    }
};

export const simulatorFaults = {};

let isPendingSelectionMode = false;
let pendingSelectedSet = new Set();

export const flightTypes = ['גיחה רגילה', 'ביצוע חלקי', 'ביטול גיחה'];

// משתנים גלובליים דינמיים
export let savedFlights = [];
export let currentForm = {};
export let currentViewFlight = null;
export let currentScreen = 'flight-form-screen';
export let unifiedFaultsDatabase = {};
export let faultResolutionStatus = {};

export let systemClassifications = {};
export let goalConfigurations = [];

window.pilotPopulations = { instructorGroups: [], courses: [], flightMapping: { students: [], instructors: [] } };

// *** חשיפה קריטית ל-Window למניעת שגיאות undefined במודולים אחרים ***
window.savedFlights = savedFlights;
window.currentForm = currentForm;
window.unifiedFaultsDatabase = unifiedFaultsDatabase;
window.faultResolutionStatus = faultResolutionStatus;
window.simulatorFaults = simulatorFaults;
window.trainingTemplates = trainingTemplates;
window.systemClassifications = systemClassifications;
window.goalConfigurations = goalConfigurations;

// ******************************************************
// פונקציות ליבה
// ******************************************************

export function setCurrentViewFlight(flight) {
    currentViewFlight = flight;
}

/**
 * פונקציה מרכזית לטעינת כל הנתונים מ-Firebase וסנכרון המערכת
 */
export async function fetchFlights() {
    if (!window.currentUsername) return;
    if (typeof window.db === 'undefined' || typeof window.firestoreFunctions === 'undefined') return;

    const { getDocs, collection } = window.firestoreFunctions;

    try {
        await Promise.all([
            loadPersonnelLists(),
            loadGoalsAndSystems()
        ]);

        if (window.personnelLists) {
            const sims = window.personnelLists.simulators || [];
            Object.keys(simulatorFaults).forEach(key => delete simulatorFaults[key]);
            sims.forEach(sim => {
                simulatorFaults[sim] = [];
            });
        }

        try {
            const resSnapshot = await getDocs(collection(window.db, "fault_resolutions"));
            Object.keys(faultResolutionStatus).forEach(key => delete faultResolutionStatus[key]);
            resSnapshot.docs.forEach(doc => {
                const data = doc.data();
                faultResolutionStatus[data.faultKey || doc.id] = { ...data, isResolved: true };
            });
        } catch (e) { console.warn("Error loading fault resolutions:", e); }

        const snapshot = await getDocs(collection(window.db, "flights"));
        const flights = snapshot.docs.map(doc => {
            const flight = doc.data();
            flight.id = doc.id;
            const dStr = flight.data?.['תאריך'];
            const tStr = flight.data?.['שעת התחלה'];
            // חישוב Timestamp למיון
            flight.flightStartTimestamp = (dStr && tStr) ? new Date(`${dStr}T${tStr}:00`).getTime() : 0;
            return flight;
        });

        savedFlights.length = 0;
        savedFlights.push(...flights);
        window.savedFlights = savedFlights;

        if (window.processFaultsData) {
            window.processFaultsData();
        }
        if (currentScreen === 'fault-database-screen') {
            const { initFaultDatabase } = await import('../features/faultManager.js');
            initFaultDatabase();
        }

        refreshCurrentScreen();
    } catch (error) {
        console.error('Error fetching flights:', error);
        showToast('שגיאה בסנכרון הנתונים', 'red');
    }
}

function refreshCurrentScreen() {
    if (currentScreen === 'mission-database-screen') missionDatabase.init(savedFlights);
    else if (currentScreen === 'fault-database-screen' && window.renderFaultDatabaseTable) window.renderFaultDatabaseTable();
    else if (currentScreen === 'stats-screen') renderStatsDashboard();
    else if (currentScreen === 'profile-screen') initProfilePage();
    else if (currentScreen === 'simulator-management-screen') {
        import('../features/simulatorManager.js').then(module => module.initSimulatorManager());
    }
    else if (currentScreen === 'flight-form-screen') renderFlightTable();
}

export function showScreen(screenId) {
    if (!window.currentUsername) {
        document.getElementById('login-screen').classList.remove('hidden');
        return;
    }

    document.querySelectorAll('.screen').forEach(s => {
        s.classList.add('hidden');
        s.style.display = 'none';
    });

    const target = document.getElementById(screenId);
    if (target) {
        target.classList.remove('hidden');
        target.style.display = 'block';
        window.scrollTo(0, 0);
    }

    hideAllModals();

    document.querySelectorAll('nav button[data-screen-id]').forEach(btn => {
        if (btn.dataset.screenId === screenId) {
            btn.classList.remove('text-gray-600', 'hover:bg-gray-50');
            btn.classList.add('bg-ofer-orange', 'text-white');
        } else {
            btn.classList.remove('bg-ofer-orange', 'text-white');
            btn.classList.add('text-gray-600', 'hover:bg-gray-50');
        }
    });

    currentScreen = screenId;

    if (screenId === 'flight-form-screen') {
        populateFilters(screenId);
        fetchFlights().then(renderFlightTable);
    } else if (screenId === 'home-screen') {
        fetchFlights();
    } else {
        fetchFlights();
    }
}

export function populateFilters(screenId = 'flight-form-screen') {
    const container = document.getElementById(screenId);
    const periodSelect = container?.querySelector('#period-select');
    const weekSelect = container?.querySelector('#week-select');
    if (!periodSelect || !weekSelect) return;

    const today = new Date();
    const currentYear = today.getFullYear();
    periodSelect.innerHTML = '<option value="">בחר תקופה...</option>';
    for (let year = currentYear - 1; year <= currentYear + 1; year++) {
        for (let period = 1; period <= 2; period++) {
            let option = document.createElement('option');
            const val = `${period}/${String(year).slice(-2)}`;
            option.value = val;
            option.textContent = val;
            periodSelect.appendChild(option);
        }
    }
    populateWeekOptions(periodSelect, weekSelect);
}

export function populateWeekOptions(periodSelect, weekSelect) {
    if (!periodSelect || !weekSelect) return;
    const selectedPeriod = periodSelect.value;
    weekSelect.innerHTML = '<option value="">בחר שבוע...</option>';
    if (selectedPeriod) {
        const periodNum = parseInt(selectedPeriod.split('/')[0]);
        const start = periodNum === 1 ? 1 : 27;
        const end = periodNum === 1 ? 26 : 54;
        for (let i = start; i <= end; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `שבוע ${i}`;
            weekSelect.appendChild(option);
        }
    }
}

/**
 * רינדור טבלת הגיחות הממתינות לדיווח
 */
export function renderFlightTable() {
    const tableBody = document.getElementById('flight-table-body');
    if (!tableBody) return;

    const isAdmin = window.isAdmin === true;

    document.getElementById('pending-admin-controls')?.classList.toggle('hidden', !isAdmin);
    document.querySelector('.pending-select-col')?.classList.toggle('hidden', !isPendingSelectionMode);

    const pendingFlights = (window.savedFlights || []).filter(f =>
        f.executionStatus === 'טרם דווחה' || !f.executionStatus
    );

    // מיון כרונולוגי: מהישן (תאריך קטן) לחדש (תאריך גדול)
    pendingFlights.sort((a, b) => (a.flightStartTimestamp || 0) - (b.flightStartTimestamp || 0));

    if (pendingFlights.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-gray-500">אין גיחות הממתינות לדיווח.</td></tr>';
        return;
    }

    tableBody.innerHTML = pendingFlights.map((flight, index) => {
        const d = flight.data || {};
        const isChecked = pendingSelectedSet.has(flight.id);

        return `
            <tr class="cursor-pointer hover:bg-ofer-primary-50 transition border-b" 
                onclick="window.showFormStep2(null, window.savedFlights.find(f => f.id === '${flight.id}'))">
                
                <td class="px-4 py-4 text-center ${isPendingSelectionMode ? '' : 'hidden'}" onclick="event.stopPropagation()">
                    <input type="checkbox" class="pending-flight-checkbox" data-id="${flight.id}" 
                        ${isChecked ? 'checked' : ''} 
                        onchange="window.togglePendingCheckbox('${flight.id}')">
                </td>

                <td class="px-4 py-4 text-sm">${new Date(flight.date).toLocaleDateString('he-IL')}</td>
                <td class="px-4 py-4 text-sm font-medium">${d['שם גיחה'] || '---'}</td>
                <td class="px-4 py-4 text-sm">${d['מדריכה'] || '---'}</td>
                <td class="px-4 py-4 text-sm">${d['סוג גיחה'] || '---'}</td>
                <td class="px-4 py-4 text-sm">${d['שעת התחלה'] || '---'}</td>
                <td class="px-4 py-4 text-sm">${d['שעת סיום'] || '---'}</td>
                <td class="px-4 py-4">
                    <span class="px-2 py-1 rounded-full text-[10px] bg-yellow-100 text-yellow-800">טרם דווחה</span>
                </td>
                <td class="px-4 py-4 text-gray-500 text-xs text-center">${index + 1}</td>
            </tr>`;
    }).join('');
}

window.togglePendingAdminMode = function () {
    isPendingSelectionMode = !isPendingSelectionMode;
    const btn = document.getElementById('toggle-pending-mode-btn');
    if (btn) {
        btn.innerHTML = isPendingSelectionMode ?
            '<i class="fas fa-times ml-2"></i> צא ממצב ניהול' :
            '<i class="fas fa-edit ml-2"></i> מצב ניהול';
        btn.classList.toggle('bg-gray-500', isPendingSelectionMode);
        btn.classList.toggle('bg-gray-700', !isPendingSelectionMode);
    }
    if (!isPendingSelectionMode) {
        pendingSelectedSet.clear();
        window.updatePendingDeleteBtn();
    }
    renderFlightTable();
};

window.togglePendingCheckbox = function (id) {
    if (pendingSelectedSet.has(id)) pendingSelectedSet.delete(id);
    else pendingSelectedSet.add(id);
    window.updatePendingDeleteBtn();
};

window.toggleAllPending = function (isChecked) {
    const checkboxes = document.querySelectorAll('.pending-flight-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = isChecked;
        if (isChecked) pendingSelectedSet.add(cb.dataset.id);
        else pendingSelectedSet.delete(cb.dataset.id);
    });
    window.updatePendingDeleteBtn();
};

window.updatePendingDeleteBtn = function () {
    const btn = document.getElementById('delete-pending-selected-btn');
    const countSpan = document.getElementById('pending-selected-count');
    if (btn && countSpan) {
        countSpan.textContent = pendingSelectedSet.size;
        btn.classList.toggle('hidden', pendingSelectedSet.size === 0);
    }
};

window.deletePendingSelected = async function () {
    if (pendingSelectedSet.size === 0) return;
    if (!confirm(`האם למחוק ${pendingSelectedSet.size} גיחות?`)) return;

    const { doc, deleteDoc } = window.firestoreFunctions;
    try {
        for (const id of pendingSelectedSet) {
            await deleteDoc(doc(window.db, "flights", id));
        }
        showToast('הגיחות נמחקו', 'green');
        pendingSelectedSet.clear();
        isPendingSelectionMode = false;
        window.togglePendingAdminMode(); 
        await fetchFlights();
    } catch (e) {
        console.error(e);
        showToast('שגיאה במחיקה', 'red');
    }
};