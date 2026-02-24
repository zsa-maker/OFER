
import { importFlightsFromExcel } from './flightImport.js';
import { currentForm } from '../core/global.js';
import {
    handleReportFlight,
    setReportMode,
    saveFlightForm,
    validateForm
} from './flightForm.js';
import { hideAllModals, showToast } from '../components/modals.js';
import {
    addFaultFromForm,
    toggleOtherFaultInput,
    renderFaultsTable
} from './faultManager.js';
import { personnelLists, savePersonnelLists } from './adminManager.js';

let isSavingInProgress = false;

/**
 * פונקציה לאתחול פיצ'ר הייבוא (כפתור + קלט קובץ)
 */
export function initializeImportFeature() {
    const importButton = document.getElementById('import-flights-btn');
    const fileInput = document.getElementById('flights-file-input');

    if (!importButton || !fileInput) return;

    importButton.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (file) {
            await importFlightsFromExcel(file);
        }
        fileInput.value = '';
    });
}

async function handleFinalFlightSave() {
    if (isSavingInProgress) return;

    const btnSave = document.getElementById('save-flight-btn');
    isSavingInProgress = true;
    if (btnSave) btnSave.disabled = true;

    try {
        const cancellationSection = document.getElementById('cancellation-section');
        const isCancellationModeActive = cancellationSection && !cancellationSection.classList.contains('hidden');

        if (isCancellationModeActive) {
            const cancelSelect = document.getElementById('cancellation-reason-select');
            const cancelDetails = document.getElementById('cancellation-reason-details');
            let finalReason = '';
            let isValidCancel = true;

            if (!cancelSelect || cancelSelect.value === '') {
                isValidCancel = false;
            } else if (cancelSelect.value === 'אחר') {
                finalReason = cancelDetails ? cancelDetails.value.trim() : '';
                if (!finalReason) isValidCancel = false;
                else {
                    // --- קוד חדש: הוספת הסיבה לרשימה למניעת כפילויות ---
                    // נוודא שהרשימה קיימת
                    if (!personnelLists.cancellationReasons) {
                        personnelLists.cancellationReasons = ["אחר"];
                    }
                    
                    // בדיקה אם הסיבה לא קיימת (ללא התחשבות באותיות גדולות/קטנות אם יש)
                    const reasonExists = personnelLists.cancellationReasons.some(
                        reason => reason.toLowerCase() === finalReason.toLowerCase()
                    );

                    if (!reasonExists) {
                        personnelLists.cancellationReasons.push(finalReason);
                        // מיון אופציונלי:
                        // personnelLists.cancellationReasons.sort();
                        
                        // שמירת הרשימה המעודכנת ב-Firebase (באופן 'שקט' בלי להקפיץ הודעת Toast נפרדת)
                        if (typeof savePersonnelLists === 'function') {
                            await savePersonnelLists(true); 
                        }
                    }
                    // --------------------------------------------------------
                }
            } else {
                finalReason = cancelSelect.value;
            }

            if (!isValidCancel) {
                showToast('חובה לבחור ולפרט את סיבת הביטול.', 'red');
                isSavingInProgress = false;
                if (btnSave) btnSave.disabled = false;
                return;
            }

            currentForm.data['סיבת ביטול'] = finalReason;
            currentForm.executionStatus = 'בוטלה';

            if (!validateForm(true)) {
                isSavingInProgress = false;
                if (btnSave) btnSave.disabled = false;
                return;
            }

            await saveFlightForm(true);
        } else {
            await handleReportFlight();
        }
    } catch (e) {
        console.error('שגיאה בשמירה:', e);
        showToast('אירעה שגיאה בעת השמירה', 'red');
    } finally {
        isSavingInProgress = false;
        if (btnSave) btnSave.disabled = false;
    }
}

function updateFlightPeriodAndWeek(dateString) {
    if (!window.planningSettings || !dateString) return;

    const dateObj = new Date(dateString);
    const pPrev = window.planningSettings.periodPrevStart ? new Date(window.planningSettings.periodPrevStart) : null;
    const pCurr = window.planningSettings.periodCurrStart ? new Date(window.planningSettings.periodCurrStart) : null;
    const pNext = window.planningSettings.periodNextStart ? new Date(window.planningSettings.periodNextStart) : null;

    let relevantStart = null;
    let periodName = "";

    // לוגיקת זיהוי תקופה (זהה לזו שבמנהל)
    if (pNext && dateObj >= pNext) {
        relevantStart = pNext;
        periodName = getPeriodName(pNext); // פונקציה שמחזירה 1/26 וכו'
    } else if (pCurr && dateObj >= pCurr) {
        relevantStart = pCurr;
        periodName = getPeriodName(pCurr);
    } else if (pPrev && dateObj >= pPrev) {
        relevantStart = pPrev;
        periodName = getPeriodName(pPrev);
    }

    // עדכון השדות בטופס
    const periodInput = document.getElementById('auto-period');
    const weekInput = document.getElementById('auto-week');

    if (periodInput) periodInput.value = periodName || "לא בטווח";

    if (weekInput && relevantStart) {
        const diffTime = dateObj.getTime() - relevantStart.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        const weekNum = Math.floor(diffDays / 7) + 1;
        weekInput.value = weekNum > 0 ? weekNum : "-";
    }
}

// יש להוסיף מאזין לשדה התאריך בטופס (בפונקציית האתחול של הטופס)
document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'simulator-select') {
        const simId = e.target.value;
        // עדכון התקלות ברגע שהסימולטור משתנה
        if (typeof window.populateFaultOptions === 'function') {
            window.populateFaultOptions(simId);
        }
    }
});

// פונקציה שמחברת את כל האירועים בצורה בטוחה (Delegation)
export function setupFormEvents() {

    // 1. האזנה כללית ללחיצות (Clicks) על המסמך
    document.addEventListener('click', async (event) => {
        const target = event.target;

        // --- א. הוספת תקלה ---
        if (target && target.id === 'add-fault-btn') {
            console.log('נלחץ כפתור הוספת תקלה'); // לדיבאג
            addFaultFromForm();
            return;
        }

        // --- ב. מחיקת תקלה (מתוך הטבלה) ---
        if (target && target.classList.contains('delete-fault-btn')) {
            const index = target.dataset.faultIndex;
            if (index !== undefined) {
                currentForm.faults.splice(index, 1);
                renderFaultsTable(currentForm.faults);
            }
            return;
        }

        // --- ג. שמירת גיחה ---
        if (target && target.id === 'save-flight-btn') {
            handleFinalFlightSave();
            return;
        }

        // --- ד. כפתורי בחירת סטטוס (מלא/חלקי/ביטול) ---
        if (target && target.classList.contains('flight-report-status-btn')) {
            const status = target.dataset.reportStatus;
            setReportMode(status);
            return;
        }

        // --- ה. סגירת מודל ---
        if (target && target.id === 'close-modal-btn') {
            hideAllModals();
            return;
        }
    });

    // 2. האזנה לשינויים (Change) בשדות ספציפיים
    document.addEventListener('change', (event) => {
        const target = event.target;

        // --- שינוי בבחירת תקלה (הצגת שדה "אחר") ---
        if (target && target.id === 'fault-select') {
            toggleOtherFaultInput(target);
            return;
        }

        // --- שינוי ברדיו "ביצוע חוזר" ---
        if (target && target.name === 'repeat-required') {
            const detailsContainer = document.getElementById('repeat-details-container');
            const detailsInput = document.getElementById('repeat-details');

            if (target.value === 'yes') {
                if (detailsContainer) detailsContainer.classList.remove('hidden');
            } else {
                if (detailsContainer) detailsContainer.classList.add('hidden');
                if (detailsInput) detailsInput.value = '';
            }
            return;
        }
    });
    console.log('Flight form events initialized (Delegation Mode)');
}