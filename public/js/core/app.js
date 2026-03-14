import { showScreen, populateWeekOptions, renderFlightTable, currentForm, savedFlights } from './global.js';
import { calculateFlightDuration } from './util.js';
import { initializeAuth } from '../auth/auth.js';

// שינוי 1: הסרת toggleGoalStatus מהייבוא
import { showFormStep2, saveCurrentStepData, saveFlightForm } from '../features/flightForm.js';
import { addFaultFromForm, populateFaultOptions, toggleOtherFaultInput, renderFaultDatabaseTable, showFaultDetailsModal, renderFaultsTable, processFaultsData, saveFaultResolutionStatus } from '../features/faultManager.js';
import { confirmGoHome, goHomeConfirmed, hideAlert, showFlightDetailsModal, enableEditMode, disableEditMode, saveEditedFlight, toggleGoalStatusInModal, showToast, hideAllModals } from '../components/modals.js';
import { setupFormEvents } from '../features/flightFormEvents.js';
import { loadPersonnelLists, initAdminPage, loadGoalsAndSystems } from '../features/adminManager.js';
import { setPeriodDates } from './util.js';
import { initProfilePage } from '../features/profileManager.js';
import { initSimulatorManager } from '../features/simulatorManager.js';


export function initializeAppEventListeners() {

    showFaultDetailsModal();
    initializeAuth();
    setupFormEvents();
    loadPersonnelLists();
    loadGoalsAndSystems();
    initSimulatorManager();
    initProfilePage();

    // *** המאזינים של סרגל הניווט (showScreen) ***
    document.querySelectorAll('#sidebar button[data-screen-id]').forEach(button => {
        button.addEventListener('click', (event) => {
            const screenId = event.target.getAttribute('data-screen-id');
            showScreen(screenId);

            if (screenId === 'admin-screen') {
                initAdminPage();
            }
        });
    });

    document.getElementById('fault-system-filter')?.addEventListener('change', () => {
        renderFaultDatabaseTable();
    });

    // *** יצירת טופס חדש (הזן גיחה) ***
    const createFlightBtn = document.getElementById('create-flight-btn');
    if (createFlightBtn) {
        createFlightBtn.addEventListener('click', () => {
            showFormStep2('גיחה רגילה');
        });
    }

    // *** המאזינים של מודלי ההתראה הכלליים ***
    const confirmButton = document.getElementById('alert-confirm-button');
    const cancelButton = document.getElementById('alert-cancel-button');
    if (confirmButton) confirmButton.addEventListener('click', goHomeConfirmed);
    if (cancelButton) cancelButton.addEventListener('click', hideAlert);

    const flightTableContainer = document.getElementById('flight-table-container');
    const flightTableContainerDb = document.getElementById('flight-table-container-db');

    // *** מאזין ללחיצה על שורה בטבלה (פתיחת פרטים) ***
    [flightTableContainer, flightTableContainerDb].filter(c => c).forEach(container => {
        container.addEventListener('click', (e) => {
            const row = e.target.closest('tr[data-flight-id]');
            if (row) {
                showFlightDetailsModal(row.dataset.flightId);
            }
        });
    });

    // *** מאזינים למסך מאגר תקלות ***
    const faultDatabaseScreen = document.getElementById('fault-database-screen');
    if (faultDatabaseScreen) {
        faultDatabaseScreen.addEventListener('change', (e) => {
            if (e.target.id === 'fault-simulator-filter' || e.target.id === 'fault-status-filter') {
                renderFaultDatabaseTable();
            }
        });

        const faultDatabaseTableContainer = document.getElementById('fault-database-table-container');
        if (faultDatabaseTableContainer) {
            faultDatabaseTableContainer.addEventListener('click', (e) => {
                const row = e.target.closest('tr[data-fault-key]');
                if (row) {
                    showFaultDetailsModal(row.dataset.faultKey);
                }
            });
        }
    }

    // ------------------------------------------------------------------
    // *** Delegation על form-step-2 (טופס גיחה) ***
    // ------------------------------------------------------------------
    const formStep2 = document.getElementById('form-step-2');
    if (formStep2) {
        // מאזין ללחיצות (כפתורים)
        formStep2.addEventListener('click', (e) => {
            const target = e.target;
            
            // טיפול בכפתור מחיקת תקלה
            const deleteBtn = target.closest('.delete-fault-btn');
            if (deleteBtn) {
                const index = parseInt(deleteBtn.dataset.faultIndex);
                if (currentForm.faults[index]) {
                    currentForm.faults.splice(index, 1);
                    renderFaultsTable(currentForm.faults);
                    showToast('תקלה נמחקה.', 'red');
                }
            }
        });

        // מאזין לשינויים (שדות קלט)
        formStep2.addEventListener('change', (e) => {
            const target = e.target;

            // ניקוי סימון שגיאה
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
                target.classList.remove('border-red-500', 'ring-red-500', 'border-4');
                target.classList.add('border-gray-300');

                if (target.id === 'start-time' || target.id === 'end-time' || target.id === 'flight-date') {
                    calculateFlightDuration();
                }
            }

            // עדכון סימולטור ותקלות
            if (target.id === 'simulator-select') {
                saveCurrentStepData();
                processFaultsData();
                populateFaultOptions(target.value);
            }

            // טיפול בשדה "אחר" בתקלות
            if (target.id === 'fault-select') {
                toggleOtherFaultInput(target);
            }
        });

        document.querySelectorAll('button[data-action="confirm-go-home"]').forEach(button => {
            button.addEventListener('click', confirmGoHome);
        });
    }

    // ------------------------------------------------------------------
    // *** מאזינים של מודל פרטי הגיחה (עריכה/צפייה) ***
    // ------------------------------------------------------------------
    const detailsCloseButton = document.getElementById('details-close-button');
    const detailsEditButton = document.getElementById('details-edit-button');
    const detailsCancelEditButton = document.getElementById('details-cancel-edit-button');
    const detailsSaveEditButton = document.getElementById('details-save-edit-button');
    const flightDetailsModal = document.getElementById('flight-details-modal');

    if (detailsCloseButton) detailsCloseButton.addEventListener('click', hideAllModals);

    // *** לוגיקת עריכה (מעבר לטופס המלא) ***
    if (detailsEditButton) {
        detailsEditButton.addEventListener('click', async () => {
            const modal = document.getElementById('flight-details-modal');
            const flightId = modal.dataset.flightId;

            if (!flightId) {
                console.error("לא נמצא ID לגיחה לעריכה.");
                showToast('שגיאה בזיהוי הגיחה.', 'red');
                return;
            }

            let flightData = savedFlights.find(f => f.id === flightId);

            if (!flightData) {
                const { doc, getDoc } = window.firestoreFunctions;
                try {
                    const docRef = doc(window.db, "flights", flightId);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        flightData = { ...docSnap.data(), flightId: docSnap.id, id: docSnap.id };
                    }
                } catch (e) {
                    console.error("שגיאה בשליפת נתונים:", e);
                }
            } else {
                flightData.flightId = flightId;
            }

            if (flightData) {
                hideAllModals();
                const status = flightData.data['סוג גיחה'] || 'גיחה רגילה';
                showFormStep2(status, flightData);
            } else {
                showToast('לא ניתן לטעון את נתוני הגיחה לעריכה.', 'red');
            }
        });
    }

    if (detailsCancelEditButton) detailsCancelEditButton.addEventListener('click', disableEditMode);
    if (detailsSaveEditButton) detailsSaveEditButton.addEventListener('click', saveEditedFlight);

    if (flightDetailsModal) {
        flightDetailsModal.addEventListener('click', (e) => {
            const button = e.target.closest('.goal-status-edit-btn');
            if (button && !button.disabled) {
                toggleGoalStatusInModal(button);
            }
        });
    }

    // *** מאזינים למודל תקלות ***
    const faultResolutionModal = document.getElementById('fault-resolution-modal');
    if (faultResolutionModal) {
        const closeButton = document.getElementById('fault-resolution-close-button');
        if (closeButton) closeButton.addEventListener('click', hideAllModals);

        faultResolutionModal.addEventListener('click', (e) => {
            const resolveBtn = e.target.closest('#mark-resolved-btn');
            if (resolveBtn) {
                saveFaultResolutionStatus(resolveBtn.dataset.faultKey, false);
            }

            const updateBtn = e.target.closest('#update-classification-btn');
            if (updateBtn) {
                saveFaultResolutionStatus(updateBtn.dataset.faultKey, true);
            }
        });
    }

    // ניקוי סימוני שגיאה כללי
    document.querySelectorAll('#flight-name, #flight-type-select, #flight-date, #start-time, #end-time, #simulator-select, #instructor-name-1, #pilot-right, #pilot-left').forEach(input => {
        input.addEventListener('change', (e) => {
            e.target.classList.remove('border-red-500', 'ring-red-500', 'border-4');
            e.target.classList.add('border-gray-300');
        });
    });

    loadGlobalSettings();
    const exportBtn = document.getElementById('btn-open-export');
    const performExportBtn = document.getElementById('btn-perform-export');

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (window.openExportModal) {
                window.openExportModal();
            } else {
                console.error("Export function not loaded yet");
            }
        });
    }

    if (performExportBtn) {
        performExportBtn.addEventListener('click', () => {
            if (window.performExport) {
                window.performExport();
            }
        });
    }
}

async function loadGlobalSettings() {
    if (!window.firestoreFunctions || !window.db) return;
    const { doc, getDoc } = window.firestoreFunctions;

    try {
        const docRef = doc(window.db, "settings", "planning");
        const snap = await getDoc(docRef);

        if (snap.exists()) {
            const data = snap.data();
            const p1 = data.period1Start || data.periodStartDate;
            const p2 = data.period2Start;

            setPeriodDates(p1, p2);
            console.log("Global settings loaded: Periods updated");
        }
    } catch (e) {
        console.error("Error loading global settings:", e);
    }
}

