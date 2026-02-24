// public/js/features/flightForm.js

import { currentForm, fetchFlights, showScreen, goalConfigurations, systemClassifications } from '../core/global.js';
import { processFaultsData, populateFaultOptions, setupCustomDropdown } from './faultManager.js';
import { showToast, hideAllModals } from '../components/modals.js';
import { calculateFlightDuration, clearFieldHighlight, getWeekNumber, getPeriodNumber } from '../core/util.js';
import { personnelLists, loadPersonnelLists, loadGoalsAndSystems } from './adminManager.js';
import { EXECUTION_STATUS_MANUAL, EXECUTION_STATUS_REPORTED } from './executionStatusManager.js';

let currentReportMode = 'manual';

const FIELD_MAPPING = {
    'flight-name': 'שם גיחה',
    'flight-date': 'תאריך',
    'start-time': 'שעת התחלה',
    'end-time': 'שעת סיום',
    'flight-duration-minutes': 'שעות טיסה (דקות)',
    'observer': 'מתצפת',
    // 'instructor-main': 'מדריך',
    'simulator-select': 'סימולטור',
    'instructor-name-1': 'מדריכה',
    'instructor-name-2': 'מדריכה נוספת',
    'pilot-right': 'טייס ימין',
    'pilot-left': 'טייס שמאל',
    'flight-type-select': 'סוג גיחה',
    'lessons-right': 'לקחי מתאמן - ימין',
    'lessons-left': 'לקחי מתאמן - שמאל',
    'general-remarks-input': 'הערות כלליות'
};

/**
 * פתיחת שלב 2 של הטופס (פרטי הגיחה)
 */
export async function showFormStep2(flightStatus, flightData = null) {
    if (!window.currentUsername) return;

    // --- תיקון קריטי: מעבר למסך הטופס ---
    showScreen('flight-form-screen');
    // ------------------------------------

    hideAllModals();
    const formStep2 = document.getElementById('form-step-2');
    if (!formStep2) {
        console.error("Critical: form-step-2 element missing");
        return;
    }

    const defaultTrainingType = 'GENERIC_FLIGHT';
    Object.keys(currentForm).forEach(key => delete currentForm[key]);

    if (flightData) {
        Object.assign(currentForm, flightData);
        if (!currentForm.trainingType) currentForm.trainingType = defaultTrainingType;
        if (!currentForm.faults) currentForm.faults = [];
        if (!currentForm.goalsStatus) currentForm.goalsStatus = {};
        if (!currentForm.data) currentForm.data = {};
    } else {
        Object.assign(currentForm, {
            flightId: null,
            trainingType: defaultTrainingType,
            flightType: flightStatus,
            flightGrounding: 'גיחה',
            executionStatus: EXECUTION_STATUS_MANUAL,
            goalsStatus: {},
            data: {},
            crew: [],
            faults: [],
            flightStartTimestamp: null
        });
    }

    formStep2.classList.remove('hidden');

    // טעינת רשימות בצורה בטוחה
    try {
        if (!personnelLists.pilots || personnelLists.pilots.length === 0) {
            await loadPersonnelLists().catch(e => console.warn("List load skipped:", e));
        }
        await loadGoalsAndSystems().catch(e => console.warn("Goals load skipped:", e));
        window.goalConfigurations = goalConfigurations;
        window.systemClassifications = systemClassifications;
    } catch (e) {
        console.warn("Initialization warning:", e);
    }

    populateDatalists();

    setupCustomDropdown(
        'fault-system-class-trigger',
        'fault-system-class-menu',
        'fault-system-class',
        'fault-system-class-display'
    );

    if (typeof processFaultsData === 'function') {
        processFaultsData();
    }

    const simVal = document.getElementById('simulator-select')?.value;
    if (simVal) {
        window.populateFaultOptions(simVal);
    }
    if (typeof populateFaultOptions === 'function') {
        populateFaultOptions(simVal || null);
    }

    if (flightData) {
        restoreFormValues();
        const typeSelect = document.getElementById('flight-type-select');
        const nameInput = document.getElementById('flight-name');
        const typeVal = typeSelect ? typeSelect.value : '';
        const nameVal = nameInput ? nameInput.value : '';

        const remarksContainer = document.getElementById('general-remarks-container');
        if (remarksContainer && typeVal === 'יום אימון') {
            remarksContainer.classList.remove('hidden');
        } else if (remarksContainer) {
            remarksContainer.classList.add('hidden');
        }

        const hasSavedGoals = flightData && flightData.goalsStatus && Object.keys(flightData.goalsStatus).length > 0;
        if (hasSavedGoals) {
            renderGoalsHTML(null, Object.keys(flightData.goalsStatus));
        } else {
            checkAndPopulateGoals();
        }

        // הוספת קריאה מפורשת לרינדור מדדים (גם לגיחות קיימות)
        if (typeof renderMetricsHTML === 'function') {
            const savedMetrics = (flightData && flightData.data) ? flightData.data['מדדי ביצוע'] : [];
            renderMetricsHTML(typeVal, nameVal, savedMetrics);
        }
    } else {
        const today = new Date();
        const dateEl = document.getElementById('flight-date');
        if (dateEl) dateEl.value = today.toISOString().split('T')[0];
    }
    if (flightData && flightData.data) {
        const simValue = flightData.data['סימולטור'];
        const simSelect = document.getElementById('simulator-select');

        if (simSelect && simValue) {
            simSelect.value = simValue;

            // שורת המפתח: הפעלת הלוגיקה של התקלות באופן יזום
            if (window.populateFaultOptions) {
                window.populateFaultOptions(simValue);
            }
        }
    }

    const hasSavedGoals = flightData && flightData.goalsStatus && Object.keys(flightData.goalsStatus).length > 0;
    if (hasSavedGoals) {
        renderGoalsHTML(null, Object.keys(flightData.goalsStatus));
    } else {
        checkAndPopulateGoals();
    }

    const faultSection = formStep2.querySelector('#fault-reporting-section');
    if (faultSection) faultSection.classList.remove('hidden');

    setupReportMode(flightStatus, flightData);
    clearFieldHighlight();
    calculateFlightDuration();
    attachEventListeners();
}

function checkAndPopulateGoals() {
    const typeSelect = document.getElementById('flight-type-select');
    const nameInput = document.getElementById('flight-name');
    const typeVal = typeSelect ? typeSelect.value : '';
    const nameVal = nameInput ? nameInput.value : '';

    // רינדור יעדים (קיים)
    const goalConfigs = window.goalConfigurations || goalConfigurations || [];
    const config = goalConfigs.find(c => c.type === typeVal && c.name === nameVal);
    renderGoalsHTML(config);

    // רינדור מדדים (הוספה)
    if (typeof renderMetricsHTML === 'function') {
        renderMetricsHTML(typeVal, nameVal);
    }
}

function renderGoalsHTML(config, explicitGoals = null) {
    const formStep2 = document.getElementById('form-step-2');
    const goalsContainer = formStep2 ? formStep2.querySelector('#goals-container') : null;
    if (!goalsContainer) return;

    goalsContainer.classList.remove('hidden');
    goalsContainer.innerHTML = '';

    const title = document.createElement('h3');
    title.className = "text-xl font-bold mb-2";
    title.textContent = 'יעדי אימון';
    goalsContainer.appendChild(title);

    const listDiv = document.createElement('div');
    listDiv.id = "goals-list-wrapper";
    listDiv.className = "space-y-3 mb-4";
    goalsContainer.appendChild(listDiv);

    let goalsToRender = [];
    if (explicitGoals && Array.isArray(explicitGoals)) {
        goalsToRender = explicitGoals;
    } else if (config && config.goals) {
        goalsToRender = config.goals;
    }

    if (goalsToRender.length > 0) {
        goalsToRender.forEach(goal => {
            const goalDiv = document.createElement('div');
            goalDiv.innerHTML = generateGoalHTML(goal);
            listDiv.appendChild(goalDiv.firstElementChild);
        });
    } else {
        const goalDiv = document.createElement('div');
        goalDiv.innerHTML = generateGoalHTML("");
        listDiv.appendChild(goalDiv.firstElementChild);
    }

    const addBtn = document.createElement('button');
    addBtn.type = "button";
    addBtn.className = "text-sm text-ofer-primary-600 hover:text-ofer-primary-800 font-medium flex items-center gap-1 mt-2 border border-ofer-primary-600 px-3 py-1 rounded hover:bg-ofer-primary-50 transition-colors";
    addBtn.innerHTML = '<i class="fas fa-plus"></i> הוסף יעד נוסף';
    addBtn.onclick = () => window.addCustomGoal();
    goalsContainer.appendChild(addBtn);
}

const escapeHTML = (str) => {
    if (!str) return "";
    return str.toString().replace(/"/g, '&quot;');
};

function generateGoalHTML(goalValue = "") {
    let status = 'עמד.ה';
    let reason = '';
    if (goalValue && currentForm.goalsStatus && currentForm.goalsStatus[goalValue]) {
        status = currentForm.goalsStatus[goalValue];
        reason = currentForm.goalsDetails ? (currentForm.goalsDetails[goalValue] || '') : '';
    }
    const isMet = status === 'עמד.ה';
    const colorClass = isMet ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700";

    return `
        <div class="goal-row flex flex-col bg-white p-3 rounded border border-gray-200 shadow-sm mb-3">
            <div class="flex items-center gap-3">
                <div class="flex-grow">
                    <input type="text" class="goal-name-input w-full text-sm border-gray-300 rounded px-2 py-2" 
                           placeholder="הזן יעד..." value="${escapeHTML(goalValue)}">
                </div>
                <div class="flex-shrink-0 relative">
                    <select class="goal-status-select appearance-none font-bold text-xs py-2 px-8 rounded-full cursor-pointer ${colorClass}" onchange="window.updateGoalStatusColor(this)">
                        <option value="עמד.ה" ${status === 'עמד.ה' ? 'selected' : ''}>עמד.ה</option>
                        <option value="לא עמד.ה" ${status === 'לא עמד.ה' ? 'selected' : ''}>לא עמד.ה</option>
                    </select>
                </div>
                <button type="button" class="text-gray-400 hover:text-red-500 p-2" onclick="this.closest('.goal-row').remove()"><i class="fas fa-trash-alt"></i></button>
            </div>
            <div class="goal-reason-container mt-2 ${isMet ? 'hidden' : ''}">
                <textarea class="goal-reason-input w-full text-sm border-red-300 rounded px-2 py-2" 
                          placeholder="פרט מדוע היעד לא הושג...">${escapeHTML(reason)}</textarea>
            </div>
        </div>
    `;
}

export function updateGoalStatusColor(selectElement) {
    const goalRow = selectElement.closest('.goal-row');
    const reasonContainer = goalRow.querySelector('.goal-reason-container');
    if (selectElement.value === 'עמד.ה') {
        selectElement.classList.remove('bg-red-100', 'text-red-700');
        selectElement.classList.add('bg-green-100', 'text-green-700');
        if (reasonContainer) reasonContainer.classList.add('hidden');
    } else {
        selectElement.classList.remove('bg-green-100', 'text-green-700');
        selectElement.classList.add('bg-red-100', 'text-red-700');
        if (reasonContainer) reasonContainer.classList.remove('hidden');
    }
}

function collectGoalsData() {
    const goalsStatus = {};
    const goalsDetails = {};
    const rows = document.querySelectorAll('#goals-list-wrapper .goal-row');
    rows.forEach(row => {
        const nameInput = row.querySelector('.goal-name-input');
        const name = nameInput ? nameInput.value.trim() : '';
        if (name) {
            const select = row.querySelector('.goal-status-select');
            const reasonInput = row.querySelector('.goal-reason-input');
            goalsStatus[name] = select.value;
            if (select.value === 'לא עמד.ה') {
                goalsDetails[name] = reasonInput ? reasonInput.value.trim() : '';
            }
        }
    });
    currentForm.goalsStatus = goalsStatus;
    currentForm.goalsDetails = goalsDetails;
}

export function addCustomGoal() {
    const listWrapper = document.getElementById('goals-list-wrapper');
    if (!listWrapper) return;
    const div = document.createElement('div');
    div.innerHTML = generateGoalHTML("");
    listWrapper.appendChild(div.firstElementChild);
}

function restoreFormValues() {
    if (!currentForm.data) return;
    Object.keys(FIELD_MAPPING).forEach(htmlId => {
        const hebrewKey = FIELD_MAPPING[htmlId];
        const el = document.getElementById(htmlId);
        if (el) {
            let val = currentForm.data[hebrewKey] || currentForm.data[htmlId] || '';
            if (htmlId === 'simulator-select' && !val) {
                const fallbackKey = Object.keys(currentForm.data).find(k => k.includes('simulator') || k.includes('סימולטור'));
                if (fallbackKey) val = currentForm.data[fallbackKey];
            }
            el.value = val;
        }
    });
}

function setupReportMode(flightStatus, flightData) {
    const partialSection = document.getElementById('partial-flight-section');
    const cancellationSection = document.getElementById('cancellation-section');
    const statusSelector = document.getElementById('future-flight-status-selector');

    if (partialSection) partialSection.classList.add('hidden');
    if (cancellationSection) cancellationSection.classList.add('hidden');

    if (statusSelector) {
        // התיקון: תמיד להציג את הבורר כשנמצאים בטופס הגיחה (במקום להסתיר בגיחה חדשה)
        statusSelector.classList.remove('hidden');
    }

    let mode = 'full'; // ברירת מחדל לגיחה חדשה
    if (flightStatus === 'ביטול גיחה' || (flightData && flightData.executionStatus === 'בוטלה')) mode = 'cancel';
    else if (flightStatus === 'ביצוע חלקי' || (flightData && flightData.data && flightData.data['סוג ביצוע'] === 'חלקי')) mode = 'partial';
    else if (flightStatus === 'טרם דווחה') mode = 'not_reported';

    setReportMode(mode);

    if (mode === 'cancel' && flightData) {
        const reason = flightData.data['סיבת ביטול'];
        const select = document.getElementById('cancellation-reason-select');
        const details = document.getElementById('cancellation-reason-details');
        if (select) {
            const options = Array.from(select.options).map(o => o.value);
            if (options.includes(reason)) select.value = reason;
            else {
                select.value = 'אחר';
                document.getElementById('cancellation-details-wrapper')?.classList.remove('hidden');
                if (details) details.value = reason;
            }
        }
    }
}

export function setReportMode(mode) {
    currentReportMode = mode;
    const partialSection = document.getElementById('partial-flight-section');
    const cancellationSection = document.getElementById('cancellation-section');
    const saveButton = document.getElementById('save-flight-btn');

    if (partialSection) partialSection.classList.toggle('hidden', mode !== 'partial');
    if (cancellationSection) cancellationSection.classList.toggle('hidden', mode !== 'cancel');
    if (mode === 'not_reported') {
        saveButton.textContent = 'שמור כטרם דווחה';
        saveButton.classList.add('bg-gray-600', 'hover:bg-gray-700');
    }

    document.querySelectorAll('.flight-report-status-btn').forEach(btn => {
        btn.classList.remove('ring-4', 'ring-offset-2', 'ring-red-500', 'ring-ofer-light-orange', 'ring-green-600');
        if (btn.dataset.reportStatus === mode) {
            let color = mode === 'cancel' ? 'ring-red-500' : (mode === 'partial' ? 'ring-ofer-light-orange' : 'ring-green-600');
            btn.classList.add('ring-4', 'ring-offset-2', color);
        }
    });

    if (saveButton) {
        saveButton.classList.remove('bg-green-600', 'hover:bg-green-700', 'bg-ofer-light-orange', 'hover:bg-ofer-orange', 'bg-red-500', 'hover:bg-red-600', 'bg-ofer-primary-500', 'hover:bg-ofer-primary-600');
        if (mode === 'full') {
            saveButton.textContent = 'דווח גיחה';
            saveButton.classList.add('bg-green-600', 'hover:bg-green-700');
        } else if (mode === 'partial') {
            saveButton.textContent = 'אשר וסיים גיחה חלקית';
            saveButton.classList.add('bg-ofer-light-orange', 'hover:bg-ofer-orange');
        } else if (mode === 'cancel') {
            saveButton.textContent = 'אשר ביטול גיחה';
            saveButton.classList.add('bg-red-500', 'hover:bg-red-600');
        } else {
            saveButton.textContent = 'דווח גיחה';
            saveButton.classList.add('bg-ofer-primary-500', 'hover:bg-ofer-primary-600');
        }
    }
}

export function isPartialMode() {
    return currentReportMode === 'partial';
}

function attachEventListeners() {
    const typeSelect = document.getElementById('flight-type-select');
    const nameInput = document.getElementById('flight-name');
    const simSelect = document.getElementById('simulator-select');

    if (simSelect) {
        currentForm.data['סימולטור'] = simSelect.value;
        simSelect.onchange = (e) => {
            const simId = e.target.value;
            console.log("סימולטור נבחר:", simId);
            if (window.currentForm) window.currentForm.data['סימולטור'] = simId;

            // עדכון רשימת התקלות מיד עם הבחירה
            if (typeof window.populateFaultOptions === 'function') {
                window.populateFaultOptions(simId);
            }
        };
    }

    const typeOther = document.getElementById('flight-type-other');

    if (typeSelect) {
        typeSelect.onchange = () => {
            if (typeSelect.value === 'אחר') typeOther.classList.remove('hidden');
            else typeOther.classList.add('hidden');
            checkAndPopulateGoals();
            const remarksContainer = document.getElementById('general-remarks-container');
            if (remarksContainer) {
                if (typeSelect.value === 'יום אימון') {
                    remarksContainer.classList.remove('hidden');
                } else {
                    remarksContainer.classList.add('hidden');
                }
            }
        };
    }
    if (nameInput) nameInput.onchange = checkAndPopulateGoals;
}

export { attachEventListeners };

function populateDatalists() {
    const fill = (id, list, addNoneOption = false) => {
        const elements = document.querySelectorAll(`[id="${id}"]`);
        elements.forEach(el => {
            if (el && list) {
                // שומר על אופציית 'אחר' אם מדובר ברשימת ביטול, אחרת סתם בחר...
                const isCancelSelect = id === 'cancellation-reason-select';
                
                el.innerHTML = '<option value="" disabled selected>בחר...</option>';

                if (addNoneOption) {
                    const noneOpt = document.createElement('option');
                    noneOpt.value = 'ללא';
                    noneOpt.textContent = 'ללא';
                    el.appendChild(noneOpt);
                }

                list.forEach(item => {
                    // כדי שלא נוסיף את "אחר" פעמיים (נוסיף אותו באופן ידני בסוף)
                    if (isCancelSelect && item === 'אחר') return;
                    
                    const opt = document.createElement('option');
                    opt.value = item;
                    opt.textContent = item;
                    el.appendChild(opt);
                });
                
                // הוספת "אחר" תמיד בסוף עבור רשימת הביטולים
                if (isCancelSelect) {
                    const otherOpt = document.createElement('option');
                    otherOpt.value = 'אחר';
                    otherOpt.textContent = 'אחר';
                    el.appendChild(otherOpt);
                }
            }
        });
    };

    fill('simulator-select', personnelLists.simulators);
    // הוספת "ללא" למדריכות
    fill('instructor-name-1', personnelLists.instructorsFemale, true);
    fill('instructor-name-2', personnelLists.instructorsFemale, true);
    fill('flight-name', personnelLists.flightNames);
    fill('pilot-right', personnelLists.pilots);
    fill('pilot-left', personnelLists.pilots);
    fill('flight-type-select', personnelLists.flightTypes);
    
    // --- הוספת מילוי לרשימת סיבות הביטול ---
    fill('cancellation-reason-select', personnelLists.cancellationReasons || []);
}

export function saveCurrentStepData() {
    const inputs = document.querySelectorAll('#general-data-section [data-field], #flight-name, #flight-date, #start-time, #end-time, #general-remarks-input');
    inputs.forEach(input => {
        if (input.id === 'flight-type-select') return;
        
        // וידוא שהערות כלליות נשמרות רק ביום אימון
        const typeSelect = document.getElementById('flight-type-select');
        if (input.id === 'general-remarks-input' && typeSelect && typeSelect.value !== 'יום אימון') {
            return; // אל תשמור את ההערות אם זה לא יום אימון
        }

        const key = FIELD_MAPPING[input.id] || input.dataset.field || input.id;
        currentForm.data[key] = input.value.trim();
    });

    const typeSelect = document.getElementById('flight-type-select');
    const typeOther = document.getElementById('flight-type-other');
    if (typeSelect) {
        if (typeSelect.value === 'אחר') currentForm.data['סוג גיחה'] = typeOther.value.trim();
        else currentForm.data['סוג גיחה'] = typeSelect.value;
    }

    collectGoalsData();
    collectMetricsData();
}
export function validateForm(isCancellation = false) {
    saveCurrentStepData();
    let requiredIds = ['flight-name', 'flight-type-select', 'flight-date', 'start-time', 'end-time'];

    let isValid = true;
    requiredIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value.trim()) {
            el.classList.add('border-red-500', 'ring-red-500', 'border-4');
            isValid = false;
        }
    });

    if (!isValid) { showToast('יש למלא שם, סוג גיחה, תאריך, שעת התחלה וסיום.', 'red'); return false; }

    if (currentReportMode !== 'cancel') {
        const rows = document.querySelectorAll('#goals-list-wrapper .goal-row');
        let missingReason = false;
        rows.forEach(row => {
            const select = row.querySelector('.goal-status-select');
            const reasonInput = row.querySelector('.goal-reason-input');
            if (select && select.value === 'לא עמד.ה' && (!reasonInput || !reasonInput.value.trim())) {
                reasonInput.classList.add('border-red-500', 'ring-1', 'ring-red-500');
                missingReason = true;
            }
        });
        if (missingReason) { showToast('חובה לפרט על יעדים שלא הושגו.', 'red'); return false; }
    }
    return true;
}

export async function handleReportFlight() {
    collectGoalsData();
    if (currentReportMode === 'partial') {
        const repeatRequired = document.querySelector('input[name="repeat-required"]:checked');
        if (!repeatRequired) return showToast('חובה לסמן האם נדרש לבצע שוב.', 'red');
        if (repeatRequired.value === 'yes') {
            const repeatDetails = document.getElementById('repeat-details');
            if (!repeatDetails || !repeatDetails.value.trim()) return showToast('חובה לפרט מה נדרש לבצע שוב.', 'red');
            currentForm.data['נדרש ביצוע חוזר'] = 'כן';
            currentForm.data['פירוט ביצוע חוזר'] = repeatDetails.value.trim();
        } else {
            currentForm.data['נדרש ביצוע חוזר'] = 'לא';
        }
        currentForm.data['סוג ביצוע'] = 'חלקי';
    } else if (currentReportMode === 'full') {
        currentForm.data['סוג ביצוע'] = 'מלא';
    }
    if (!validateForm(false)) return;
    currentForm.executionStatus = EXECUTION_STATUS_REPORTED;
    await saveFlightForm(true);
}

export async function saveFlightForm(skipValidation = false) {
    if (!window.currentUsername) return;
    if (!skipValidation && !validateForm()) return;
    saveCurrentStepData();
    calculateFlightDuration();

    if (!window.db) return showToast('שגיאה: Firebase לא מחובר.', 'red');

    currentForm.data['סוג'] = currentForm.trainingType || 'GENERIC_FLIGHT';
    const d = new Date(currentForm.data['תאריך']);
    currentForm.date = currentForm.data['תאריך'];
    currentForm.week = getWeekNumber(d);
    currentForm.period = getPeriodNumber(d);

    try {
        const { collection, addDoc, updateDoc, doc } = window.firestoreFunctions;
        let statusToSet = currentForm.executionStatus;
        if (currentReportMode === 'full' || currentReportMode === 'partial') statusToSet = 'בוצעה';
        if (currentReportMode === 'cancel') statusToSet = 'בוטלה';
        if (currentReportMode === 'not_reported') statusToSet = 'טרם דווחה'; // הוספת הסטטוס החדש

        const dataToSave = { ...currentForm, executionStatus: statusToSet, timestamp: window.getServerTimestamp() };

        if (currentForm.flightId) {
            const docRef = doc(collection(window.db, "flights"), currentForm.flightId);
            delete dataToSave.flightId;
            await updateDoc(docRef, dataToSave);
        } else {
            const newDoc = await addDoc(collection(window.db, "flights"), dataToSave);
            currentForm.flightId = newDoc.id;
        }
        showToast('הגיחה נשמרה!', 'green');
        await fetchFlights();
        showScreen('flight-form-screen');
    } catch (e) {
        console.error('Error saving:', e);
        showToast('שגיאה בשמירה.', 'red');
    }
}

// עדכון פונקציית הרינדור
function renderMetricsHTML(flightType, flightName, savedMetrics = []) {
    const metricsContainer = document.getElementById('metrics-container');
    if (!metricsContainer) return;

    metricsContainer.innerHTML = '<h3 class="text-xl font-bold mb-2 mt-6">מדדי ביצוע</h3>';

    const config = (window.metricConfigurations || []).find(c => c.type === flightType && c.name === flightName);

    if (!config || !config.metrics || config.metrics.length === 0) {
        metricsContainer.classList.add('hidden');
        return;
    }

    metricsContainer.classList.remove('hidden');

    config.metrics.forEach(m => {
        const div = document.createElement('div');
        div.className = "bg-white p-4 rounded border mb-4 shadow-sm";
        div.innerHTML = `<h4 class="font-bold text-purple-700 mb-2">${m.mainName}</h4>`;

        const grid = document.createElement('div');
        grid.className = "grid grid-cols-2 gap-2";

        m.subs.forEach((sub, idx) => {
            // בדיקה האם המדד היה מסומן בעבר
            const isChecked = Array.isArray(savedMetrics) && savedMetrics.some(sm => sm.main === m.mainName && sm.value === sub);

            grid.innerHTML += `
    <label class="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer border border-transparent hover:border-gray-200">
        <input type="checkbox" class="metric-checkbox" data-main="${escapeHTML(m.mainName)}" 
               value="${escapeHTML(sub)}" ${isChecked ? 'checked' : ''}>
        <span class="text-sm">${idx + 1}. ${sub}</span>
    </label>
`;
        });
        div.appendChild(grid);
        metricsContainer.appendChild(div);
    });
}

// פונקציה חדשה לאיסוף המדדים שנבחרו (יש לקרוא לה בתוך saveCurrentStepData)
function collectMetricsData() {
    const selectedMetrics = [];
    document.querySelectorAll('.metric-checkbox:checked').forEach(cb => {
        selectedMetrics.push({
            main: cb.dataset.main,
            value: cb.value
        });
    });
    if (!currentForm.data) currentForm.data = {};
    currentForm.data['מדדי ביצוע'] = selectedMetrics;
}

// חשיפה ל-Window
window.showFormStep2 = showFormStep2;
window.addCustomGoal = addCustomGoal;
window.updateGoalStatusColor = updateGoalStatusColor;
window.setReportMode = setReportMode;
window.handleReportFlight = handleReportFlight;
window.saveFlightForm = saveFlightForm;
window.validateForm = validateForm;