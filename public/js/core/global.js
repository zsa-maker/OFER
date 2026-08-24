// public/js/core/global.js

import { showToast, hideAllModals } from '../components/modals.js';
import { getExecutionStatusBadge, EXECUTION_STATUS_MANUAL, EXECUTION_STATUS_NOT_REPORTED } from '../features/executionStatusManager.js';
import { renderStatsDashboard } from '../features/statsManager.js';
import missionDatabase from '../features/missionDatabase.js';
import { initProfilePage } from '../features/profileManager.js';
import { loadPersonnelLists, loadGoalsAndSystems } from '../features/adminManager.js';

// --- הגדרות מצב עבודה (App Mode) ---
window.appMode = 'daily'; // 'daily' | 'period'
window.selectedArchivePeriod = null;
window.showScreen = showScreen;

window.configureSidebarForMode = function(mode) {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('hidden');

    const btnFlightForm = document.querySelector('button[data-screen-id="flight-form-screen"]');
    const btnMissionDb  = document.querySelector('button[data-screen-id="mission-database-screen"]');
    const btnFaultDb    = document.querySelector('button[data-screen-id="fault-database-screen"]');
    const btnStats      = document.querySelector('button[data-screen-id="stats-screen"]');
    const btnGoals      = document.querySelector('button[data-screen-id="goals-metrics-screen"]');
    const btnProfile    = document.querySelector('button[data-screen-id="profile-screen"]');
    const btnSimMgmt    = document.querySelector('button[data-screen-id="simulator-management-screen"]');
    
    // פילטרים שצריך לנעול במצב יומי
    const faultStatusFilter = document.getElementById('fault-status-filter');
    const statsFilterType = document.getElementById('stats-filter-type');
    
    if (mode === 'daily') {
        // מציג טופס, מאגר גיחות, מאגר תקלות ותכנון מול ביצוע
        if (btnFlightForm) btnFlightForm.classList.remove('hidden');
        if (btnMissionDb)  btnMissionDb.classList.remove('hidden');
        if (btnFaultDb)    btnFaultDb.classList.remove('hidden');
        if (btnStats)      btnStats.classList.remove('hidden'); 
        
        // מסתיר את השאר
        if (btnGoals)   btnGoals.classList.add('hidden');
        if (btnProfile) btnProfile.classList.add('hidden');
        if (btnSimMgmt) btnSimMgmt.classList.add('hidden');

        // נעילת מסך תקלות ל"פתוחות בלבד"
        if (faultStatusFilter) {
            faultStatusFilter.value = 'OPEN';
            faultStatusFilter.disabled = true;
            faultStatusFilter.classList.add('bg-gray-100', 'cursor-not-allowed');
        }

        // נעילת מסך תכנון מול ביצוע ל"טווח תאריכים" (מבטל צבירה אוטומטית) של 30 יום
        if (statsFilterType) {
            statsFilterType.value = 'range';
            statsFilterType.disabled = true;
            statsFilterType.classList.add('bg-gray-100', 'cursor-not-allowed');
            
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - 30);
            
            const startDateInput = document.getElementById('stats-date-start');
            const endDateInput = document.getElementById('stats-date-end');
            
            if (startDateInput) {
                startDateInput.value = start.toISOString().split('T')[0];
                startDateInput.disabled = true;
            }
            if (endDateInput) {
                endDateInput.value = end.toISOString().split('T')[0];
                endDateInput.disabled = true;
            }
            
            // חשיפת קבוצת התאריכים והסתרת התקופה בממשק הסטטיסטיקות
            document.getElementById('filter-period-group')?.classList.add('hidden');
            document.getElementById('filter-week-group')?.classList.add('hidden');
            document.getElementById('filter-range-group')?.classList.remove('hidden');
        }

    } else if (mode === 'period') {
        // מציג את כל מסכי האנליטיקה
        if (btnMissionDb) btnMissionDb.classList.remove('hidden');
        if (btnStats)     btnStats.classList.remove('hidden');
        if (btnGoals)     btnGoals.classList.remove('hidden');
        if (btnProfile)   btnProfile.classList.remove('hidden');
        if (btnSimMgmt)   btnSimMgmt.classList.remove('hidden');
        
        // מסתיר מסכים תפעוליים
        if (btnFlightForm) btnFlightForm.classList.add('hidden');
        if (btnFaultDb)    btnFaultDb.classList.add('hidden');

        // שחרור נעילות הפילטרים למנהל
        if (faultStatusFilter) {
            faultStatusFilter.disabled = false;
            faultStatusFilter.classList.remove('bg-gray-100', 'cursor-not-allowed');
        }
        if (statsFilterType) {
            statsFilterType.disabled = false;
            statsFilterType.classList.remove('bg-gray-100', 'cursor-not-allowed');
            statsFilterType.value = 'period';
            document.getElementById('stats-date-start').disabled = false;
            document.getElementById('stats-date-end').disabled = false;
            
            document.getElementById('filter-period-group')?.classList.remove('hidden');
            document.getElementById('filter-range-group')?.classList.add('hidden');
        }
    }
};

window.enterDailyWorkflow = function() {
    window.appMode = 'daily';
    window.selectedArchivePeriod = null;
    document.getElementById('period-view-banner')?.classList.add('hidden');
    
    // איפוס המטמון כדי לכפות משיכה חדשה של 30 הימים האחרונים בלבד
    window.savedFlights = []; 
    
    window.showScreen('flight-form-screen'); 
    import('../components/modals.js').then(m => m.showToast("חזרת למצב עבודה יומית", "green"));
    
    // ניקוי אוטומטי של גיחות ישנות מהמאגר היומי (מתבצע שקוף ברקע ע"י אדמין)
    if (window.isAdmin && typeof window.cleanupOldRecentFlights === 'function') {
        window.cleanupOldRecentFlights();
    }
};

window.confirmPeriodView = function() {
    const select = document.getElementById('home-period-select');
    if(!select.value) return;

    window.selectedArchivePeriod = select.value;
    window.appMode = 'period';
    
    document.getElementById('period-selection-modal').classList.add('hidden');
    document.getElementById('banner-period-name').textContent = `תקופה ${window.selectedArchivePeriod}`;
    document.getElementById('period-view-banner').classList.remove('hidden');
    
    // איפוס המטמון כדי לכפות משיכה מלאה של כלל גיחות התקופה מהארכיון ההיסטורי!
    window.savedFlights = []; 
    
    window.showScreen('mission-database-screen'); 
};

window.promptPeriodPassword = function() {
    const modal = document.getElementById('period-password-modal');
    const input = document.getElementById('period-password-input');
    const error = document.getElementById('period-password-error');
    
    if (modal && input) {
        input.value = ''; // ניקוי השדה מניסיונות קודמים
        if (error) error.classList.add('hidden'); // העלמת הודעת שגיאה
        modal.classList.remove('hidden');
        
        // פוקוס אוטומטי על שדה הטקסט (נוחות למשתמש)
        setTimeout(() => input.focus(), 100);
    }
};

window.verifyPeriodPassword = function() {
    const input = document.getElementById('period-password-input');
    const error = document.getElementById('period-password-error');
    
    // בדיקת הסיסמה שהוגדרה
    if (input && input.value === 'ofer') {
        // העלמת חלון הסיסמה
        document.getElementById('period-password-modal').classList.add('hidden');
        input.value = '';
        if (error) error.classList.add('hidden');
        
        // מעבר ישיר לחלון בחירת התקופה
        window.openPeriodSelectionModal();
    } else {
        // סיסמה שגויה - הצגת הודעת שגיאה
        if (error) error.classList.remove('hidden');
        input.value = ''; // מנקה את השדה כדי שינסו שוב
        input.focus();
    }
};

window.openPeriodSelectionModal = async function() {
    const modal = document.getElementById('period-selection-modal');
    const select = document.getElementById('home-period-select');
    
    const periodsSet = new Set();
    const configs = window.planningSettings?.periodConfigs || {};
    Object.keys(configs).forEach(p => periodsSet.add(p.trim()));
    
    const sortedPeriods = Array.from(periodsSet).sort((a, b) => {
        const [pA, yA] = a.split('/').map(Number);
        const [pB, yB] = b.split('/').map(Number);
        return (yB + pB / 10) - (yA + pA / 10);
    });

    select.innerHTML = sortedPeriods.map(p => `<option value="${p}">${p}</option>`).join('');
    
    const currentPeriodName = typeof window.getPeriodName === 'function' ? window.getPeriodName(new Date()) : "";
    if (sortedPeriods.includes(currentPeriodName)) {
        select.value = currentPeriodName;
    }
    
    modal.classList.remove('hidden');
};

// --- משתנים גלובליים (EXPORTS) ---

export const trainingTemplates = {
    'GENERIC_FLIGHT': { goals: [], step2: [], step3: [] }
};

let lastFetchTime = 0;
let lastPendingFetchTime = 0; // מטמון נפרד עבור גיחות פתוחות בלבד
const FETCH_COOLDOWN = 1000 * 60 * 5; // 5 minutes in milliseconds

export const simulatorFaults = {};

let isPendingSelectionMode = false;
let pendingSelectedSet = new Set();

// הערה: נשמרה הטרמינולוגיה "גיחה מופרעת" בהתאם לבקשתך ההיסטורית
export const flightTypes = ['גיחה רגילה', 'גיחה מופרעת', 'ביטול גיחה'];

// משתנים גלובליים דינמיים
export let savedFlights = [];
export let pendingFlights = []; // הוספנו מערך ייעודי כדי לחסוך קריאות
export let currentForm = {};
export let currentViewFlight = null;
export let currentScreen = 'flight-form-screen';
export let unifiedFaultsDatabase = {};
export let faultResolutionStatus = {};

export let systemClassifications = {};
export let goalConfigurations = [];

window.pilotPopulations = { instructorGroups: [], courses: [], flightMapping: { students: [], instructors: [] } };

window.savedFlights = savedFlights;
window.pendingFlights = pendingFlights;
window.currentForm = currentForm;
window.unifiedFaultsDatabase = unifiedFaultsDatabase;
window.faultResolutionStatus = faultResolutionStatus;
window.simulatorFaults = simulatorFaults;
window.trainingTemplates = trainingTemplates;
window.systemClassifications = systemClassifications;
window.goalConfigurations = goalConfigurations;

export function setCurrentViewFlight(flight) {
    currentViewFlight = flight;
}

/**
 * [פונקציה חדשה וחסכונית]
 * טעינה אך ורק של גיחות הממתינות לדיווח באמצעות שאילתת where.
 * חוסך טעינה של אלפי גיחות היסטוריות כשנכנסים למסך הראשי!
 */
export async function fetchPendingFlights(forceRefresh = false) {
    if (!window.currentUsername || typeof window.db === 'undefined' || typeof window.firestoreFunctions === 'undefined') return;
    const now = Date.now();

    if (!forceRefresh && pendingFlights.length > 0 && (now - lastPendingFetchTime < FETCH_COOLDOWN)) {
        renderFlightTable();
        return;
    }

    const { getDocs, collection } = window.firestoreFunctions;

    try {
        // Query the dedicated pending_flights collection directly! No .where() needed.
        const snapshot = await getDocs(collection(window.db, "pending_flights"));
        const flights = snapshot.docs.map(doc => {
            const flight = doc.data();
            flight.id = doc.id;
            return flight;
        });

        pendingFlights.length = 0;
        pendingFlights.push(...flights);
        window.pendingFlights = pendingFlights;

        lastPendingFetchTime = now;
        renderFlightTable();
    } catch (error) {
        console.error('Error fetching pending flights:', error);
        showToast('שגיאה בסנכרון הגיחות הממתינות', 'red');
    }
}

/**
 * פונקציה היסטורית לטעינת כל הנתונים מ-Firebase למסכי המאגר והסטטיסטיקה
 * שודרגה לשלוף רק את השנה האחרונה כדי למנוע Over-fetching!
 */
export async function fetchFlights(forceRefresh = false) {
    if (!window.currentUsername || typeof window.db === 'undefined' || typeof window.firestoreFunctions === 'undefined') return;

    const now = Date.now();

    if (!forceRefresh && savedFlights.length > 0 && (now - lastFetchTime < FETCH_COOLDOWN)) {
        console.log("Using cached data. Skipping Firebase read.");
        refreshCurrentScreen();
        return;
    }

    const { getDocs, collection, query, where, onSnapshot } = window.firestoreFunctions;

   try {
        await Promise.all([
            loadPersonnelLists(),
            loadGoalsAndSystems()
        ]);

        if (window.personnelLists) {
            const sims = window.personnelLists.simulators || [];
            Object.keys(simulatorFaults).forEach(key => delete simulatorFaults[key]);
            sims.forEach(sim => simulatorFaults[sim] = []);
        }

        // 1. Fetch resolutions
        try {
            const resSnapshot = await getDocs(collection(window.db, "fault_resolutions"));
            Object.keys(faultResolutionStatus).forEach(key => delete faultResolutionStatus[key]);
            resSnapshot.docs.forEach(doc => {
                const data = doc.data();
                faultResolutionStatus[data.faultKey || doc.id] = { ...data, isResolved: true };
            });
        } catch (e) { console.warn("Error loading fault resolutions:", e); }

        // 2. Fetch Flights based on App Mode!
       let snapshot;
        if (window.appMode === 'period' && window.selectedArchivePeriod) {
            // PERIOD MODE: Fetch only the selected period's subcollection
            const safePeriod = window.selectedArchivePeriod.replace(/\//g, '-');
            snapshot = await getDocs(collection(window.db, `archive_periods/${safePeriod}/flights`));
        } else {
            // DAILY WORKFLOW: Fetch recent flights (Limited to Last 30 Days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            const y = thirtyDaysAgo.getFullYear();
            const m = String(thirtyDaysAgo.getMonth() + 1).padStart(2, '0');
            const d = String(thirtyDaysAgo.getDate()).padStart(2, '0');
            const dateStrLimit = `${y}-${m}-${d}`;

            // We MUST destructure query and where from window.firestoreFunctions at the top of this try block
            const { query, where } = window.firestoreFunctions;

            const q = query(
                collection(window.db, "recent_flights"),
                where("date", ">=", dateStrLimit)
            );
            snapshot = await getDocs(q);
        }

        const flights = snapshot.docs.map(doc => {
            const flight = doc.data();
            flight.id = doc.id;
            const dStr = flight.data?.['תאריך'];
            const tStr = flight.data?.['שעת התחלה'];
            flight.flightStartTimestamp = (dStr && tStr) ? new Date(`${dStr}T${tStr}:00`).getTime() : 0;
            return flight;
        });

        savedFlights.length = 0;
        savedFlights.push(...flights);
        window.savedFlights = savedFlights;

        lastFetchTime = Date.now();

        if (window.processFaultsData) window.processFaultsData();

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

// שודרג לשאילתות ולשימוש במסנן זמן
export async function fetchAllData() {
    const { collection, getDocs, query, where, onSnapshot } = window.firestoreFunctions;

    const limitDate = new Date();
    limitDate.setMonth(limitDate.getMonth() - 12);

    const qFlights = query(collection(window.db, "flights"), where("date", ">=", limitDate.toISOString().split('T')[0]));
    const flightSnap = await getDocs(qFlights);
    window.savedFlights = flightSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const qFaults = query(collection(window.db, "standalone_faults"), where("timestamp", ">=", limitDate.getTime()));
    const standaloneSnap = await getDocs(qFaults);
    window.standaloneFaults = standaloneSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    processFaultsData();
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

let isInitialLoad = true;

export async function showScreen(screenId) {
    if (!window.currentUsername) {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('sidebar')?.classList.add('hidden'); // מחביא סרגל כשהמשתמש לא מחובר
        return;
    }

    // 1. כפיית מסך הבית מיד לאחר ההתחברות (מבטל ניתובים אוטומטיים של auth.js)
    if (isInitialLoad) {
        screenId = 'home-screen';
        isInitialLoad = false;
    }

    // 2. ניהול סרגל הניווט (Sidebar) בצורה קפדנית
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        if (screenId === 'home-screen' || screenId === 'login-screen') {
            sidebar.classList.add('hidden'); // מסתיר את הסרגל לחלוטין במסך הבית
        } else {
            sidebar.classList.remove('hidden'); // מציג את הסרגל בכל שאר המסכים
            if (window.configureSidebarForMode) {
                window.configureSidebarForMode(window.appMode); // מגדיר איזה כפתורים יראו
            }
        }
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

    // --- ליבת הייעול בניווט המסכים ---
    if (screenId === 'flight-form-screen') {
        populateFilters(screenId);
        if (!window.pendingFlights || window.pendingFlights.length === 0) {
            fetchPendingFlights();
        } else {
            renderFlightTable();
        }
    } else if (screenId !== 'home-screen') { // לא למשוך נתונים אם אנחנו במסך הבית
        if (!window.savedFlights || window.savedFlights.length === 0) {
            await fetchFlights();
        } else {
            refreshCurrentScreen();
        }
    }

    if (screenId === 'fault-database-screen') {
        if (!window.standaloneFaults || window.standaloneFaults.length === 0) {
            if (typeof window.fetchStandaloneFaults === 'function') {
                await fetchStandaloneFaults();
            }
        }
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

    // מעכשיו משתמשים במערך הייעודי pendingFlights שמסונן כבר מהשרת
    const flightsToRender = window.pendingFlights || [];

    // מיון כרונולוגי: מהישן (תאריך קטן) לחדש (תאריך גדול)
    flightsToRender.sort((a, b) => {
        const dateA = new Date(a.date || (a.data && a.data['תאריך']) || 0).getTime();
        const dateB = new Date(b.date || (b.data && b.data['תאריך']) || 0).getTime();

        if (dateA !== dateB) return dateA - dateB;

        const timeA = (a.data && a.data['שעת התחלה']) || '23:59';
        const timeB = (b.data && b.data['שעת התחלה']) || '23:59';
        return timeA.localeCompare(timeB);
    });

    if (flightsToRender.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-gray-500">אין גיחות הממתינות לדיווח.</td></tr>';
        return;
    }

    tableBody.innerHTML = flightsToRender.map((flight, index) => {
        const d = flight.data || {};
        const isChecked = pendingSelectedSet.has(flight.id);

        // במקרה והמשתמש בוחר גיחה ממתינה, נשלוף אותה מהמערך הממתין
        return `
            <tr class="cursor-pointer hover:bg-ofer-primary-50 transition border-b" 
                onclick="window.showFormStep2(null, window.pendingFlights.find(f => f.id === '${flight.id}'))">
                
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
        // ייעול: ריענון מאולץ של הגיחות הממתינות בלבד
        await fetchPendingFlights(true);
    } catch (e) {
        console.error(e);
        showToast('שגיאה במחיקה', 'red');
    }
};

// ==========================================
// פונקציות מעטפת לניהול מטמון וחיסכון בקריאות Firestore
// ==========================================
let planningSettingsPromise = null;

window.getPlanningSettings = async function(forceRefresh = false) {
    if (!window.firestoreFunctions || !window.db) return {};

    // 1. אם הנתונים כבר טעונים בזיכרון ולא ביקשנו רענון כפוי - החזר אותם מיד
    if (!forceRefresh && window.planningSettings) {
        return window.planningSettings;
    }

    // 2. אם כבר יש קריאת רשת שרצה ברקע ממש עכשיו - הצטרף אליה (מונע כפילויות!)
    if (planningSettingsPromise && !forceRefresh) {
        return await planningSettingsPromise;
    }

    // 3. אין נתונים ואין קריאה שרצה - צור קריאה חדשה
    planningSettingsPromise = (async () => {
        try {
            const { doc, getDoc } = window.firestoreFunctions;
            const snap = await getDoc(doc(window.db, "settings", "planning"));
            
            if (snap.exists()) {
                window.planningSettings = snap.data();
            } else {
                window.planningSettings = {};
            }
            return window.planningSettings;
        } catch (e) {
            console.error("Error fetching planning settings:", e);
            return window.planningSettings || {};
        }
    })();

    return await planningSettingsPromise;
};

export async function getPersonnelListsData() {
    // בודק האם הרשימה כבר קיימת ולא ריקה
    if (window.personnelLists && Object.keys(window.personnelLists).length > 0) return window.personnelLists;
    if (!window.firestoreFunctions || !window.db) return {};
    
    try {
        const { doc, getDoc } = window.firestoreFunctions;
        const snap = await getDoc(doc(window.db, "settings", "personnel"));
        if (snap.exists()) {
            window.personnelLists = snap.data();
        }
        return window.personnelLists || {};
    } catch (e) {
        console.error("Error fetching personnel:", e);
        return {};
    }
}

export async function getAdvancedConfigData() {
    if (!window.firestoreFunctions || !window.db) return null;
    try {
        const { doc, getDoc } = window.firestoreFunctions;
        const snap = await getDoc(doc(window.db, "settings", "advanced_config"));
        return snap.exists() ? snap.data() : null;
    } catch (e) {
        console.error("Error fetching advanced config:", e);
        return null;
    }
}

export async function getCachedPopulations(periodName) {
    if (!periodName) return null;
    const safePeriodName = periodName.replace(/\//g, '-');
    const cacheKey = `pop_${safePeriodName}`;

    // 1. חיפוש בזיכרון RAM (הכי מהיר)
    if (window.populationsCache && window.populationsCache[safePeriodName]) {
        return window.populationsCache[safePeriodName];
    }
    if (!window.populationsCache) window.populationsCache = {};

    // 2. חיפוש ב-Session Storage (נשמר גם ברענון עמוד)
    const stored = sessionStorage.getItem(cacheKey);
    if (stored) {
        const data = JSON.parse(stored);
        window.populationsCache[safePeriodName] = data;
        return data;
    }

    // 3. קריאה מהשרת (רק אם לא נמצא במטמון)
    if (window.firestoreFunctions && window.db) {
        try {
            const { doc, getDoc } = window.firestoreFunctions;
            const popSnap = await getDoc(doc(window.db, "populations_by_period", safePeriodName));
            
            if (popSnap.exists()) {
                const data = popSnap.data();
                window.populationsCache[safePeriodName] = data;
                sessionStorage.setItem(cacheKey, JSON.stringify(data));
                return data;
            } else {
                // גיבוי למבנה הישן אם התקופה לא נמצאה
                const oldSnap = await getDoc(doc(window.db, "settings", "populations"));
                if (oldSnap.exists()) {
                    const data = oldSnap.data();
                    window.populationsCache[safePeriodName] = data;
                    return data;
                }
            }
        } catch (e) {
            console.error("Error fetching populations", e);
        }
    }
    return null;
}

// חשיפה גלובלית לשימוש בקבצים ללא Import מפורש
window.getPlanningSettings = getPlanningSettings;
window.getPersonnelListsData = getPersonnelListsData;
window.getAdvancedConfigData = getAdvancedConfigData;
window.getCachedPopulations = getCachedPopulations;

// TEMPORARY MIGRATION SCRIPT - REMOVE AFTER USE
window.runDatabaseMigration = async function() {
    const { collection, getDocs, writeBatch, doc } = window.firestoreFunctions;
    console.log("Starting Migration...");
    
    const flightsSnap = await getDocs(collection(window.db, "flights"));
    let batches = [];
    let currentBatch = writeBatch(window.db);
    let operationCount = 0;

    // שינוי ל-30 יום אחורה במקום 60
    const thirtyDaysAgo = Date.now() - (1000 * 60 * 60 * 24 * 30);

    flightsSnap.forEach(flightDoc => {
        const data = flightDoc.data();
        const id = flightDoc.id;
        
        const safePeriod = String(data.period || "1/26").replace(/\//g, '-'); 
        
        // 1. Archive Subcollection
        const archiveRef = doc(window.db, `archive_periods/${safePeriod}/flights`, id);
        currentBatch.set(archiveRef, data);
        operationCount++;

        // 2. Recent Flights (Only if within the last 30 days)
        const flightDate = data.flightStartTimestamp || (data.date ? new Date(data.date).getTime() : Date.now());
        if (flightDate > thirtyDaysAgo) {
            const recentRef = doc(window.db, "recent_flights", id);
            
            // חישוב תאריך התפוגה של הגיחה ההיסטורית (30 יום מזמן הגיחה המקורי)
            const expiresAt = new Date(flightDate);
            expiresAt.setDate(expiresAt.getDate() + 30);
            
            currentBatch.set(recentRef, { ...data, expiresAt: expiresAt });
            operationCount++;
        }

        // 3. Pending Flights
        if (data.executionStatus === "טרם דווחה") {
            const pendingRef = doc(window.db, "pending_flights", id);
            currentBatch.set(pendingRef, data);
            operationCount++;
        }

        if (operationCount >= 450) {
            batches.push(currentBatch);
            currentBatch = writeBatch(window.db);
            operationCount = 0;
        }
    });
    
    if (operationCount > 0) batches.push(currentBatch);
    
    for (let i = 0; i < batches.length; i++) {
        await batches[i].commit();
        console.log(`Committed batch ${i + 1} of ${batches.length}`);
    }
    console.log("Migration Successfully Completed!");
};

// פונקציה שקטה שמנקה את המאגר היומי מגיחות שעברו את ה-30 יום
window.cleanupOldRecentFlights = async function() {
    const { collection, getDocs, query, where, writeBatch, doc } = window.firestoreFunctions;
    
    // חישוב התאריך של לפני 30 יום בדיוק
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const y = thirtyDaysAgo.getFullYear();
    const m = String(thirtyDaysAgo.getMonth() + 1).padStart(2, '0');
    const d = String(thirtyDaysAgo.getDate()).padStart(2, '0');
    const dateStrLimit = `${y}-${m}-${d}`;

    try {
        // שליפת הגיחות שפג תוקפן במאגר היומי
        const q = query(
            collection(window.db, "recent_flights"),
            where("date", "<", dateStrLimit)
        );
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) return; // אין מה לנקות

        // מחיקה מרוכזת של הגיחות הישנות (מהמאגר היומי בלבד!)
        const batch = writeBatch(window.db);
        snapshot.forEach(flightDoc => {
            batch.delete(doc(window.db, "recent_flights", flightDoc.id));
        });
        
        await batch.commit();
        console.log(`[Janitor] נוקו אוטומטית ${snapshot.size} גיחות ישנות מקולקציית recent_flights.`);
    } catch (error) {
        console.error('[Janitor] שגיאה בניקוי גיחות ישנות:', error);
    }
};