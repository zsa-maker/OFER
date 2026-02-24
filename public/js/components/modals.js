// ==========================================================
// js/components/modals.js
// ניהול מודלים, הודעות Toast ולוגיקת עריכת גיחות קיימות.
// ==========================================================

import { fetchFlights, trainingTemplates, savedFlights, currentViewFlight, setCurrentViewFlight, unifiedFaultsDatabase } from '../core/global.js';
import { showScreen } from '../core/global.js';

// --- פונקציות הודעות וסגירה (EXPORTS) ---

export function showToast(message, type) {
    const toast = document.getElementById('toast-notification');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.remove('bg-green-500', 'bg-red-500', 'hidden', 'bg-yellow-500');

    let colorClass;
    if (type === 'green') {
        colorClass = 'bg-green-500';
    } else if (type === 'red') {
        colorClass = 'bg-red-500';
    } else {
        colorClass = 'bg-yellow-500';
    }

    toast.classList.add(colorClass);
    toast.classList.remove('hidden');
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

export function hideAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.classList.add('hidden');
    });
}

export function confirmGoHome() {
    if (!window.currentUsername) return;
    const alertModal = document.getElementById('alert-modal');
    if (!alertModal) return;

    document.getElementById('alert-title').textContent = 'אזהרה';
    document.getElementById('alert-message').textContent = 'הפעולה עלולה להוביל לאובדן הנתונים. האם להשלים את הפעולה?';
    
    const confirmButton = document.getElementById('alert-confirm-button');
    confirmButton.textContent = 'המשך';
    confirmButton.onclick = goHomeConfirmed;

    alertModal.classList.remove('hidden');
}

export function goHomeConfirmed() {
    hideAlert();
    showScreen('flight-form-screen');
}

export function hideAlert() {
    const alertModal = document.getElementById('alert-modal');
    if (alertModal) alertModal.classList.add('hidden');
}

// --- פונקציות עריכה וצפייה (EXPORTS) ---

export async function showFlightDetailsModal(flightId) {
    if (!window.currentUsername) return;

    hideAllModals();
    const flight = savedFlights.find(f => f.id === flightId);
    if (!flight) {
        showToast('שגיאה: פרטי הגיחה לא נמצאו.', 'red');
        return;
    }

    // שמירת ה-ID ב-dataset של המודל
    const modal = document.getElementById('flight-details-modal');
    if (modal) modal.dataset.flightId = flightId;

    setCurrentViewFlight(flight);

    const content = document.getElementById('flight-details-content');
    const title = document.getElementById('details-modal-title');
    const editBtn = document.getElementById('details-edit-button');

    if (!modal || !content || !title) return;

    // --- תיקון: הסתרת כפתור עריכה בעמוד פרופיל טייס ---
    if (editBtn) {
        if (window.currentScreen === 'profile-screen') {
            editBtn.style.display = 'none';
        } else {
            editBtn.style.display = 'block';
        }
    }

    title.textContent = `פרטי גיחה: ${flight.data['שם גיחה'] || flight.data['סוג גיחה']}`;
    content.innerHTML = '';

    // *** 1. תצוגת סטטוס מיוחד (ביטול / חלקי) ***
    let statusHtml = '';

    // בדיקה אם הגיחה בוטלה
    const isCancelled = flight.executionStatus === 'בוטלה' || flight.data['סיבת ביטול'];
    if (isCancelled) {
        statusHtml += `
            <div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg shadow-sm">
                <h3 class="text-lg font-bold text-red-800 mb-2 flex items-center">
                    <span class="text-2xl mr-2">⛔</span> הגיחה בוטלה
                </h3>
                <div class="bg-white p-3 rounded border border-red-100">
                    <strong class="block text-red-700 mb-1">סיבת הביטול:</strong>
                    <p class="text-gray-800">${flight.data['סיבת ביטול'] || 'לא צוינה סיבה'}</p>
                </div>
            </div>
        `;
    }

    // בדיקה אם הגיחה בוצעה חלקית
    const isPartial = flight.data['סוג ביצוע'] === 'חלקי';
    if (isPartial) {
        const repeatRequired = flight.data['נדרש ביצוע חוזר'] === 'כן';
        const repeatText = flight.data['נדרש ביצוע חוזר'] || 'לא צוין';

        statusHtml += `
            <div class="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-lg shadow-sm">
                <h3 class="text-lg font-bold text-orange-800 mb-2 flex items-center">
                    <span class="text-2xl mr-2">⚠️</span> ביצוע חלקי
                </h3>
                <div class="grid grid-cols-1 gap-3 text-sm">
                    <div class="flex items-center">
                        <span class="font-bold text-gray-700 ml-2">האם נדרש ביצוע חוזר?</span>
                        <span class="px-2 py-1 rounded ${repeatRequired ? 'bg-red-100 text-red-700 font-bold' : 'bg-green-100 text-green-700'}">
                            ${repeatText}
                        </span>
                    </div>
                    ${repeatRequired ? `
                    <div class="mt-2">
                        <strong class="block text-orange-800 mb-1">פירוט ביצוע חוזר:</strong>
                        <div class="bg-white p-3 rounded border border-orange-100 text-gray-800">
                            ${flight.data['פירוט ביצוע חוזר'] || 'לא צוין פירוט'}
                        </div>
                    </div>` : ''}
                </div>
            </div>
        `;
    }

    // --- 2. נתונים כלליים ---
    let generalHtml = '<h3 class="text-xl font-bold border-b pb-1 mb-2 text-gray-800">נתונים כלליים</h3>';

    const generalFieldsMap = [
        { label: 'שם גיחה', key: 'שם גיחה' },
        { label: 'סוג גיחה', key: 'סוג גיחה' },
        { label: 'סימולטור', key: 'סימולטור' },
        { label: 'תאריך', key: 'תאריך' },
        { label: 'שעת התחלה', key: 'שעת התחלה' },
        { label: 'שעת סיום', key: 'שעת סיום' },
        { label: 'שעות טיסה (דקות)', key: 'שעות טיסה (דקות)' },
        // { label: 'מדריך', key: 'מדריך' },
        { label: 'מדריכה', key: 'מדריכה' },
        { label: 'מדריכה נוספת', key: 'מדריכה נוספת' },
        { label: 'מתצפת', key: 'מתצפת' },
        { label: 'טייס ימין', key: 'טייס ימין' },
        { label: 'טייס שמאל', key: 'טייס שמאל' },
    ];

    generalHtml += `<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">`;

    generalFieldsMap.forEach(field => {
        let value = flight.data[field.key] || '---';
        if (field.key === 'תאריך' && flight.date) {
            try {
                value = new Date(flight.date).toISOString().split('T')[0];
            } catch (e) { value = flight.data['תאריך'] || ''; }
        } else if (field.key !== 'שעות טיסה (דקות)' && value === '---') {
            value = '';
        }

        const isDuration = field.key === 'שעות טיסה (דקות)';
        const type = (field.key === 'תאריך') ? 'date' : (field.key.startsWith('שעת') ? 'time' : 'text');

        generalHtml += `
            <div class="flex flex-col ${isDuration ? 'opacity-60' : ''}">
                <label class="block text-xs font-semibold text-gray-500 mb-1">${field.label}</label>
                <input type="${type}" data-edit-field="${field.key}" value="${value}" ${isDuration ? 'readonly disabled' : 'readonly'} 
                       class="block w-full rounded-md border border-gray-300 shadow-sm ${isDuration ? 'bg-gray-100 cursor-not-allowed' : 'bg-gray-50'} p-2 text-sm transition-all">
            </div>
        `;
    });
    generalHtml += `</div>`;

    // לקחי מתאמן
    generalHtml += `
        <div class="mt-4 grid grid-cols-1 gap-4">
            <div>
                <label class="block text-xs font-semibold text-gray-500 mb-1">לקחי מתאמן - ימין</label>
                <textarea data-edit-field="לקחי מתאמן - ימין" rows="2" readonly 
                          class="block w-full rounded-md border border-gray-300 shadow-sm bg-gray-50 p-2 text-sm transition-all">${flight.data['לקחי מתאמן - ימין'] || ''}</textarea>
            </div>
            <div>
                <label class="block text-xs font-semibold text-gray-500 mb-1">לקחי מתאמן - שמאל</label>
                <textarea data-edit-field="לקחי מתאמן - שמאל" rows="2" readonly 
                          class="block w-full rounded-md border border-gray-300 shadow-sm bg-gray-50 p-2 text-sm transition-all">${flight.data['לקחי מתאמן - שמאל'] || ''}</textarea>
            </div>
        </div>
        <hr class="mt-6 mb-4 border-gray-200">
    `;

    // --- 3. יעדים ---
    let goalsHtml = '<h3 class="text-xl font-bold border-b pb-1 mb-4 text-gray-800">יעדי אימון</h3>';
    const goals = Object.keys(flight.goalsStatus || {});

    if (goals.length > 0) {
        goals.forEach(goal => {
            // ב-flightForm.js ביטלת את הפירוט, לכן נשתמש רק בסטטוס
            const status = flight.goalsStatus[goal] || 'עמד.ה';
            const isMet = status === 'עמד.ה';

            goalsHtml += `
            <div class="flex flex-col sm:flex-row items-start mb-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div class="w-full mb-2 sm:mb-0" data-goal-status-container="${goal}">
                    <span class="block font-bold text-gray-700 mb-1">${goal}</span>
                    <button data-edit-goal-status="${goal}" data-current-status="${status}" disabled
                        class="goal-status-edit-btn text-xs font-bold py-1 px-3 rounded-full border ${isMet ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200'}">
                        ${status}
                    </button>
                </div>
            </div>
        `;
        });
    } else {
        goalsHtml += '<p class="text-gray-500 italic">לא הוגדרו יעדים לגיחה זו.</p>';
    }

    // --- 4. תקלות ---
    let faultsHtml = '';
    const flightSimulator = flight.data['סימולטור'] || 'לא נבחר';

    faultsHtml += `
        <h3 class="text-xl font-bold border-b pb-1 mb-2 mt-6 text-gray-800">תקלות שדווחו</h3>
        <p class="text-sm text-gray-600 mb-3">סימולטור: <span class="font-semibold text-ofer-orange">${flightSimulator}</span></p>
    `;

    if (flight.faults && flight.faults.length > 0) {
        faultsHtml += `
            <div class="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">סימולטור</th>
                            <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">תיאור תקלה</th>
                            <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">סטטוס נוכחי</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
        `;

        flight.faults.forEach(fault => {
            const baseKey = `${fault.simulator}|${fault.description}`;
            let statusCell = `<span class="text-gray-400 text-xs">לא ידוע</span>`;

            // בדיקת סטטוס מול המאגר המאוחד
            const cycleKey = Object.keys(unifiedFaultsDatabase).find(key =>
                unifiedFaultsDatabase[key].baseKey === baseKey &&
                unifiedFaultsDatabase[key].firstReportTimestamp === fault.timestamp
            );

            if (cycleKey && unifiedFaultsDatabase[cycleKey]) {
                const resolvedStatus = unifiedFaultsDatabase[cycleKey].status;
                statusCell = resolvedStatus.isResolved
                    ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">טופלה</span>`
                    : `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">פתוחה</span>`;
            }

            faultsHtml += `
                <tr>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${fault.simulator}</td>
                    <td class="px-4 py-3 text-sm text-gray-900">${fault.description}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm">${statusCell}</td>
                </tr>
            `;
        });
        faultsHtml += `</tbody></table></div>`;
    } else {
        faultsHtml += `<div class="p-4 bg-gray-50 rounded border border-dashed border-gray-300 text-center text-gray-500 text-sm">לא דווחו תקלות בגיחה זו.</div>`;
    }

    // הזרקת כל התוכן למודל
    content.innerHTML = statusHtml + generalHtml + goalsHtml + faultsHtml;

    // מוודא שהמודל במצב צפייה (לא עריכה) ופותח אותו
    disableEditMode();
    modal.classList.remove('hidden');
}

export function enableEditMode() {
    if (!window.currentUsername) return;

    const content = document.getElementById('flight-details-content');
    const detailsActions = document.getElementById('details-modal-actions');
    const editActions = document.getElementById('details-edit-actions');

    if (!content || !detailsActions || !editActions) return;

    detailsActions.classList.add('hidden');
    editActions.classList.remove('hidden');

    // הופך את השדות הקבועים והיעדים לעריכים
    const allEditableFields = content.querySelectorAll('[data-edit-field]');

    allEditableFields.forEach(input => {
        // שעות טיסה בדקות נשאר קריאה-בלבד
        if (input.dataset.editField !== 'שעות טיסה (דקות)') {
            input.removeAttribute('readonly');
            input.classList.replace('bg-gray-50', 'bg-white');
            input.classList.add('border-ofer-primary-500', 'ring-1', 'ring-ofer-primary-500');
        }
    });

    // הפעלת כפתורי סטטוס יעד
    document.querySelectorAll('.goal-status-edit-btn').forEach(btn => {
        btn.removeAttribute('disabled');
        btn.classList.add('cursor-pointer', 'hover:opacity-80');
    });

    showToast('מצב עריכה הופעל.', 'yellow');
}

// export function disableEditMode() {
//     const content = document.getElementById('flight-details-content');
//     const detailsActions = document.getElementById('details-modal-actions');
//     const editActions = document.getElementById('details-edit-actions');

//     if (!content || !detailsActions || !editActions) return;

//     detailsActions.classList.remove('hidden');
//     editActions.classList.add('hidden');

//     const allEditableFields = content.querySelectorAll('[data-edit-field]');

//     allEditableFields.forEach(input => {
//         input.setAttribute('readonly', true);
//         input.classList.add('bg-gray-50');
//         input.classList.remove('bg-white', 'border-ofer-primary-500', 'ring-1', 'ring-ofer-primary-500');
//         input.classList.remove('border-red-500', 'ring-red-500', 'border-4');

//         if (input.dataset.editField === 'שעות טיסה (דקות)') {
//             input.setAttribute('disabled', true);
//             input.classList.add('bg-gray-100', 'cursor-not-allowed');
//         } else {
//             input.removeAttribute('disabled');
//         }
//     });

//     document.querySelectorAll('.goal-status-edit-btn').forEach(btn => {
//         btn.setAttribute('disabled', true);
//         btn.classList.remove('cursor-pointer', 'hover:opacity-80');
//     });

//     // שחזור נתונים מקומי
//     if (currentViewFlight) {
//         allEditableFields.forEach(input => {
//             const key = input.dataset.editField;
//             let originalValue;

//             if (key.startsWith('פירוט - ')) {
//                 const goalName = key.replace('פירוט - ', '');
//                 originalValue = currentViewFlight.goalsDetails[goalName] || '';
//             } else {
//                 originalValue = currentViewFlight.data[key] || '';
//                 if (key === 'תאריך' && currentViewFlight.date) {
//                     originalValue = new Date(currentViewFlight.date).toISOString().split('T')[0];
//                 }
//             }
//             input.value = originalValue;
//         });

//         document.querySelectorAll('.goal-status-edit-btn').forEach(button => {
//             const goal = button.dataset.editGoalStatus;
//             const originalStatus = currentViewFlight.goalsStatus[goal] || 'לא דווח';
//             const isMet = originalStatus === 'עמד.ה';

//             button.dataset.currentStatus = originalStatus;
//             button.textContent = originalStatus;
//             button.classList.remove('bg-green-100', 'text-green-700', 'bg-red-100', 'text-red-700');
//             button.classList.add(isMet ? 'bg-green-100' : 'bg-red-100', isMet ? 'text-green-700' : 'text-red-700');
//         });
//     }
// }

export async function saveEditedFlight() {
    if (!window.currentUsername) return;

    if (!currentViewFlight) return;

    const dataToUpdate = { ...currentViewFlight.data };
    const goalsToUpdate = { ...currentViewFlight.goalsDetails };
    const goalsStatusToUpdate = { ...currentViewFlight.goalsStatus };
    let allRequiredFilled = true;

    document.querySelectorAll('#flight-details-content [data-edit-field]').forEach(input => {
        const key = input.dataset.editField;
        const value = input.value;

        input.classList.remove('border-red-500', 'ring-red-500', 'border-4');
        input.classList.add('border-gray-300');

        if (key.startsWith('פירוט - ')) {
            const goalName = key.replace('פירוט - ', '');
            goalsToUpdate[goalName] = value;

            if (value.trim() === '') {
                allRequiredFilled = false;
                input.classList.add('border-red-500', 'ring-red-500', 'border-4');
                input.classList.remove('border-gray-300');
            }
        } else {
            dataToUpdate[key] = value;
        }

        const requiredKeys = ['שם גיחה', 'סוג גיחה', 'תאריך', 'שעת התחלה', 'שעת סיום', 'מדריכה', 'סימולטור', 'טייס ימין', 'טייס שמאל'];
        if (requiredKeys.includes(key) && (value.trim() === '' || value.trim() === '---')) {
            allRequiredFilled = false;
            if (!key.startsWith('פירוט - ')) {
                input.classList.add('border-red-500', 'ring-red-500', 'border-4');
                input.classList.remove('border-gray-300');
            }
        }
    });

    document.querySelectorAll('.goal-status-edit-btn').forEach(button => {
        const goal = button.dataset.editGoalStatus;
        goalsStatusToUpdate[goal] = button.dataset.currentStatus;
    });

    if (!allRequiredFilled) {
        showToast('יש למלא את כל שדות החובה .', 'red');
        return;
    }

    if (typeof window.db === 'undefined' || typeof window.firestoreFunctions === 'undefined') {
        showToast('שגיאה: Firebase לא מאותחל.', 'red');
        return;
    }

    const { doc, updateDoc } = window.firestoreFunctions;

    try {
        const flightRef = doc(window.db, "flights", currentViewFlight.id);

        const flightDateString = dataToUpdate['תאריך'];
        const startTimeStr = dataToUpdate['שעת התחלה'];
        let flightStartTimestamp = currentViewFlight.flightStartTimestamp;
        if (flightDateString && startTimeStr) {
            const isoDateTimeStr = `${flightDateString}T${startTimeStr}:00`;
            flightStartTimestamp = new Date(isoDateTimeStr).getTime();
        }

        const start = dataToUpdate['שעת התחלה'];
        const end = dataToUpdate['שעת סיום'];
        let durationMinutes = currentViewFlight.data['שעות טיסה (דקות)'];

        if (start && end) {
            const [startHour, startMinute] = start.split(':').map(Number);
            const [endHour, endMinute] = end.split(':').map(Number);

            const totalStartMinutes = startHour * 60 + startMinute;
            let totalEndMinutes = endHour * 60 + endMinute;

            if (totalEndMinutes < totalStartMinutes) {
                totalEndMinutes += 24 * 60;
            }

            durationMinutes = totalEndMinutes - totalStartMinutes;
            dataToUpdate['שעות טיסה (דקות)'] = durationMinutes;
        }

        await updateDoc(flightRef, {
            data: dataToUpdate,
            goalsDetails: goalsToUpdate,
            goalsStatus: goalsStatusToUpdate,
            flightStartTimestamp: flightStartTimestamp,
            timestamp: window.getServerTimestamp()
        });

        showToast('הגיחה נשמרה ועדכנה בהצלחה!', 'green');

        hideAllModals();
        await fetchFlights();

    } catch (error) {
        console.error('שגיאה בעדכון הגיחה:', error);
        showToast('שגיאה בשמירת השינויים. בדוק את הקונסולה לפרטים.', 'red');
    }
}

export function toggleGoalStatusInModal(button) {
    const goal = button.dataset.editGoalStatus;
    const currentStatus = button.dataset.currentStatus;
    const newStatus = currentStatus === 'עמד.ה' ? 'לא עמד.ה' : 'עמד.ה';
    const isMet = newStatus === 'עמד.ה';

    const metClasses = ['bg-green-100', 'text-green-700'];
    const notMetClasses = ['bg-red-100', 'text-red-700'];

    button.dataset.currentStatus = newStatus;
    button.textContent = newStatus;

    button.classList.remove(...metClasses, ...notMetClasses);
    button.classList.add(...(isMet ? metClasses : notMetClasses));
}

export function disableEditMode() {
    const detailsActions = document.getElementById('details-modal-actions');
    const editActions = document.getElementById('details-edit-actions');
    if (detailsActions) detailsActions.classList.remove('hidden');
    if (editActions) editActions.classList.add('hidden');
}

window.showFlightDetailsModal = showFlightDetailsModal;
window.enableEditMode = enableEditMode;
window.disableEditMode = disableEditMode;
window.hideAllModals = hideAllModals;
window.confirmGoHome = confirmGoHome;