// public/js/core/util.js

// --- ניהול תאריכי תקופות (גלובלי) ---
let periodConfig = {
    p1Start: null,
    p2Start: null
};

// פונקציה לעדכון התאריכים (תיקרא ע"י app.js או statsManager)
export function setPeriodDates(p1, p2) {
    if (p1) periodConfig.p1Start = new Date(p1);
    if (p2) periodConfig.p2Start = new Date(p2);
}

// הפונקציה המעודכנת - בודקת לפי התאריכים שהוגדר
export function getPeriodNumber(d) {
    if (!d) return 0;
    const date = new Date(d);
    
    // שימוש בתאריכים שהוגדרו ע"י המנהל
    if (periodConfig.p2Start && date.getTime() >= periodConfig.p2Start.getTime()) return 2;
    if (periodConfig.p1Start && date.getTime() >= periodConfig.p1Start.getTime()) return 1;

    // ברירת מחדל: דצמבר עד מאי = 1, יוני עד נובמבר = 2
    const month = date.getMonth();
    return (month === 11 || month <= 4) ? 1 : 2; 
}

// פונקציית עזר חדשה לקבלת מחרוזת תצוגה עקבית (למשל 1/26)
export function getPeriodDisplay(d) {
    const date = new Date(d);
    if (isNaN(date.getTime())) return "";
    
    const pNum = getPeriodNumber(date);
    let year = date.getFullYear();
    
    // אם דצמבר, התקופה שייכת לשנה הבאה
    if (date.getMonth() === 11) {
        year++;
    }
    
    return `${pNum}/${year.toString().slice(-2)}`;
}

export function getWeekNumber(d) {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

export function calculateFlightDuration() {
    const startTimeStr = document.getElementById('start-time')?.value;
    const endTimeStr = document.getElementById('end-time')?.value;
    const durationInput = document.getElementById('flight-duration-minutes');
    const dateStr = document.getElementById('flight-date')?.value;

    // שינוי קריטי: שימוש ב-window.currentForm כדי להימנע מייבוא מעגלי
    const formObj = window.currentForm;

    if (!startTimeStr || !endTimeStr || !durationInput || !dateStr) {
        if (durationInput) durationInput.value = '';
        if (formObj) formObj.flightStartTimestamp = null;
        return 0;
    }

    try {
        const [startHour, startMinute] = startTimeStr.split(':').map(Number);
        const [endHour, endMinute] = endTimeStr.split(':').map(Number);

        const totalStartMinutes = startHour * 60 + startMinute;
        let totalEndMinutes = endHour * 60 + endMinute;

        if (totalEndMinutes < totalStartMinutes) {
            totalEndMinutes += 24 * 60;
        }

        const durationMinutes = totalEndMinutes - totalStartMinutes;

        durationInput.value = durationMinutes >= 0 ? durationMinutes : '';
        
        if (formObj && formObj.data) {
            formObj.data['שעות טיסה (דקות)'] = durationInput.value;
        }

        const isoDateTimeStr = `${dateStr}T${startTimeStr}:00`;
        if (formObj) {
            formObj.flightStartTimestamp = new Date(isoDateTimeStr).getTime();
        }

        return durationMinutes;

    } catch (e) {
        console.error("Error calculating duration:", e);
        return 0;
    }
}

export function clearFieldHighlight() {
    const fields = document.querySelectorAll('input:not([type="radio"]), textarea, select');
    fields.forEach(input => {
        input.classList.remove('border-red-500', 'ring-red-500', 'border-4');
        input.classList.add('border-gray-300');
    });
}

export function populateSystemSelect(selectElementId, selectedValue = '') {
    const selectEl = document.getElementById(selectElementId);
    if (!selectEl) return;

    selectEl.innerHTML = '<option value="">בחר מערכת...</option>';

    if (!window.systemClassifications || Object.keys(window.systemClassifications).length === 0) {
        return;
    }

    Object.keys(window.systemClassifications).sort().forEach(systemName => {
        const option = document.createElement('option');
        option.value = systemName;
        option.textContent = systemName;
        
        if (systemName === selectedValue) {
            option.selected = true;
        }
        
        selectEl.appendChild(option);
    });
}

// חשיפה לחלון
window.getWeekNumber = getWeekNumber;
window.getPeriodNumber = getPeriodNumber;
window.populateSystemSelect = populateSystemSelect;
window.getPeriodDisplay = getPeriodDisplay