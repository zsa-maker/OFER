// --- קבועים לסטטוסים במערכת (System Constants) ---
export const EXECUTION_STATUS_NOT_REPORTED = 'טרם דווחה'; // מצב התחלתי של גיחה עתידית
export const EXECUTION_STATUS_REPORTED = 'דווחה';         // גיחה עתידית שדיווחו עליה (מלא או חלקי)
export const EXECUTION_STATUS_MANUAL = 'בוצעה ידנית';     // גיחה שנוצרה ידנית (מלא או חלקי)
export const EXECUTION_STATUS_CANCELLED = 'בוטלה';        // גיחה שבוטלה

/**
 * פונקציה שמחזירה את אלמנט ה-HTML של התג (Badge) בהתאם לנתוני הגיחה.
 * הפונקציה בודקת את הסטטוס הראשי וגם את הנתונים הפנימיים (כמו "סוג ביצוע")
 * כדי להציג את הצבע והטקסט הנכונים.
 * * @param {Object} flight - אובייקט הגיחה המלא
 * @returns {string} - מחרוזת HTML של התג
 */
export function getExecutionStatusBadge(flight) {
    if (!flight) return '';

    const status = flight.executionStatus;
    const executionType = flight.data ? flight.data['סוג ביצוע'] : ''; // 'מלא' או 'חלקי'

    // סגנונות בסיסיים לתגים
    const baseClasses = "px-2 inline-flex text-xs leading-5 font-semibold rounded-full";

    // 1. מקרה "גיחה בוטלה" (אדום)
    // בודק אם הסטטוס הוא 'בוטלה' או שיש סיבת ביטול מוזנת
    if (status === EXECUTION_STATUS_CANCELLED || status === 'בוטלה' || (flight.data && flight.data['סיבת ביטול'])) {
        return `<span class="${baseClasses} bg-red-100 text-red-800">
                    גיחה בוטלה
                </span>`;
    }

    // 2. מקרה "טרם דווחה" (אפור)
    // זהו המצב הדיפולטיבי של גיחות עתידיות שטרם נגעו בהן
    if (status === EXECUTION_STATUS_NOT_REPORTED) {
        return `<span class="${baseClasses} bg-gray-100 text-gray-800">
                    טרם דווחה
                </span>`;
    }

    // 3. מקרה "גיחה חלקית" (כתום) - התיקון הנדרש
    // בודק אם הגיחה דווחה/בוצעה ידנית, אבל סוג הביצוע סומן כ"חלקי"
    if (executionType === 'חלקי') {
        return `<span class="${baseClasses} bg-orange-100 text-orange-800">
                    גיחה חלקית
                </span>`;
    }

    // 4. מקרה "גיחה בוצעה" (ירוק) - ברירת המחדל להצלחה
    // אם הגענו לכאן, הגיחה דווחה או בוצעה ידנית, ואינה חלקית או מבוטלת
    if (status === EXECUTION_STATUS_REPORTED || status === EXECUTION_STATUS_MANUAL || status === 'בוצעה') {
        return `<span class="${baseClasses} bg-green-100 text-green-800">
                    גיחה בוצעה
                </span>`;
    }

    // גיבוי למקרה לא צפוי
    return `<span class="${baseClasses} bg-gray-100 text-gray-800">
                ${status || 'לא ידוע'}
            </span>`;
}