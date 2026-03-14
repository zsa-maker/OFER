// קובץ: executionManager.js
// מנהל את סטטוסי הביצוע (דווחה/בוטלה/טרם דווחה) ואת כללי הולידציה ב-Modal העריכה.

export const EXECUTION_STATUSES = ['דווחה', 'בוטלה', 'טרם דווחה']; // *** שינוי: שינוי "בוצעה" ל"דווחה" ו"טרם בוצעה" ל"טרם דווחה" ***
const REQUIRED_FIELDS_FOR_EXECUTION = [
    'שם גיחה', 'סוג גיחה', 'תאריך', 'שעת התחלה', 'שעת סיום', 'מדריכה',
    'סימולטור', 'טייס ימין', 'טייס שמאל', 
];

/**
 * מפעיל/מנטרל את מצב העריכה המלא (ולידציה חובה) בהתאם לסטטוס שנבחר.
 * @param {string} status סטטוס הביצוע החדש שנבחר.
 */

export function toggleEditingByStatus(status) {
    const isFullEditMode = status === 'דווחה'; // *** שינוי: שימוש בסטטוס 'דווחה' ***
    const content = document.getElementById('flight-details-content');
    if (!content) return;

    // שמור את הסטטוס הנוכחי בדאטה-אטריביוט לצורך שימוש ב-saveEditedFlight
    content.dataset.currentExecutionStatus = status;

    // כל שדות הקלט
    const editableFields = content.querySelectorAll('[data-edit-field]');

    // הלוגיקה כאן מאפשרת עריכה תמיד
    editableFields.forEach(input => {

        // 1. הסרת מצב קריאה-בלבד
        input.removeAttribute('readonly');

        // 2. הסרת קלאסי ניטרול הצפייה
        input.classList.remove('bg-gray-50', 'cursor-not-allowed', 'bg-gray-100');

        // 3. הוספת עיצוב עריכה (לבן וגבול הכתום)
        input.classList.add('bg-white');

        // 4. ניקוי סימוני ולידציה אדומים קודמים
        input.classList.remove('border-red-500', 'ring-red-500', 'border-4');

        // 5. הוספת עיצוב פוקוס (כדי שייראה עריך)
        input.classList.add('border-ofer-primary-500', 'ring-1', 'ring-ofer-primary-500', 'border-gray-300');

        // 6. תיקון שדה שעות טיסה (חייב להישאר מנוטרל)
        if (input.dataset.editField === 'שעות טיסה (דקות)') {
            input.setAttribute('readonly', 'true');
            input.setAttribute('disabled', 'true');
            input.classList.remove('bg-white');
            input.classList.add('bg-gray-100', 'cursor-not-allowed');
        } else {
            // 7. הסרת disabled מכל השדות האחרים (textarea/input)
            input.removeAttribute('disabled');
        }
    });

    // אפשר את כפתורי סטטוס היעד (אם כי זה מטופל גם ב-enableEditMode)
    document.querySelectorAll('.goal-status-edit-btn').forEach(btn => btn.removeAttribute('disabled'));
}

/**
 * מטפל בלחיצה על כפתור סטטוס הביצוע ב-Modal העריכה.
 * @param {HTMLElement} button הכפתור שנלחץ (שהוא חלק מהקלאס execution-status-select-btn).
 */
export function handleExecutionStatusSelection(button) {
    const status = button.dataset.executionStatus;

    if (!status) {
        console.error("Execution status data attribute is missing.");
        return;
    }

    // 1. ניקוי סימון מכל הכפתורים
    document.querySelectorAll('.execution-status-select-btn').forEach(btn => {
        btn.classList.remove('border-4', 'border-ofer-dark-brown');
    });

    // 2. סימון הכפתור הנוכחי
    button.classList.add('border-4', 'border-ofer-dark-brown');

    // 3. הפעלת שינוי מצב העריכה (בעיקר עבור חוקי הולידציה ב-saveEditedFlight)
    toggleEditingByStatus(status);
}

/**
 * מחזיר את הסטטוס המעודכן שנבחר ב-Modal.
 * @returns {string} הסטטוס שנבחר, או null אם לא נבחר.
 */
export function getSelectedExecutionStatus() {
    const selectedButton = document.querySelector('#execution-status-buttons .border-4');
    return selectedButton ? selectedButton.dataset.executionStatus : null;
}

/**
 * מחזיר את רשימת שדות החובה הקריטיים
 * @returns {string[]} רשימת המפתחות של שדות חובה.
 */
export function getRequiredFields() {
    return REQUIRED_FIELDS_FOR_EXECUTION;
}

window.ExecutionManager = {
    toggleEditingByStatus,
    handleExecutionStatusSelection
};