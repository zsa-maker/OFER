// public/js/features/missionDatabase.js

import { getExecutionStatusBadge } from './executionStatusManager.js';
import { showToast } from '../components/modals.js';

const missionDatabase = {
    allData: [],
    selectedFlights: new Set(),
    selectionMode: false,

    // מיפוי בין ה-ID של הפילטר ב-HTML לשדה בנתונים או לערך מחושב
    KEY_MAP: {
        'db-filter-period': 'period',
        'db-filter-week': 'week',
        'db-filter-date': 'date',
        'db-filter-status': 'statusText', // שדה מחושב חדש לסטטוס
        'db-filter-flight-name': 'שם גיחה',
        'db-filter-type': 'סוג גיחה',
        'db-filter-simulator': 'סימולטור',
        'db-filter-instructor': 'instructor_calculated',
        'db-filter-instructorFem': 'מדריכה',
        'db-filter-pilot': 'pilot_calculated'
    },

    /**
     * אתחול המסך - טעינת נתונים, הגדרת פילטרים ובדיקת הרשאות
     */
    init: async function (data) {
        this.allData = data || [];
        if (!this.selectedFlights) this.selectedFlights = new Set();
        this.selectedFlights.clear();

        this.selectionMode = false;
        this.updateSelectionModeUI();

        const isAdmin = !document.getElementById('nav-admin')?.classList.contains('hidden');

        // הצגת כפתור "מצב בחירת גיחות" לכולם
        const adminFooter = document.getElementById('admin-management-footer');
        if (adminFooter) adminFooter.style.display = 'flex';

        // אזור המחיקה לפי תאריכים למנהלים בלבד
        const adminControls = document.getElementById('admin-delete-controls');
        if (adminControls) adminControls.style.display = isAdmin ? 'flex' : 'none';

        if (window.firestoreFunctions && window.db) {
            try {
                const { doc, getDoc } = window.firestoreFunctions;
                const snap = await getDoc(doc(window.db, "settings", "planning"));
                if (snap.exists()) {
                    window.planningSettings = snap.data();
                }
            } catch (e) {
                console.error("Failed to load planning settings", e);
            }
        }

        this.populateSelect('db-filter-period', 'period', this.allData);
        this.populateSelect('db-filter-week', 'week', this.allData);

        const dynamicFilters = [
            'db-filter-date', 'db-filter-status', 'db-filter-flight-name',
            'db-filter-type', 'db-filter-simulator',
            'db-filter-instructor', 'db-filter-instructorFem', 'db-filter-pilot'
        ];

        dynamicFilters.forEach(id => {
            this.populateSelect(id, this.KEY_MAP[id], this.allData);
        });

        const selectAll = document.getElementById('select-all-flights');
        if (selectAll) {
            selectAll.disabled = false;
            selectAll.parentElement.style.visibility = 'visible';
            selectAll.onchange = (e) => this.toggleSelectAll(e.target.checked);
        }

        this.applyFilters();
    },

    toggleSelectionMode: function () {
        this.selectionMode = !this.selectionMode;
        this.updateSelectionModeUI();
        this.renderTable(this.currentFilteredData || this.allData); // רינדור מחדש להצגת/הסתרת התיבות
    },

    updateSelectionModeUI: function () {
        const headerCheckbox = document.getElementById('admin-col-header');
        const bulkActions = document.getElementById('bulk-actions-container');
        const toggleBtn = document.querySelector('#admin-management-footer button');

        if (this.selectionMode) {
            if (headerCheckbox) headerCheckbox.classList.remove('hidden');
            if (bulkActions) bulkActions.classList.remove('hidden');
            if (toggleBtn) {
                toggleBtn.innerHTML = '<i class="fas fa-times ml-2"></i> צא ממצב ניהול';
                toggleBtn.classList.replace('bg-gray-700', 'bg-gray-500');
            }
        } else {
            if (headerCheckbox) headerCheckbox.classList.add('hidden');
            if (bulkActions) bulkActions.classList.add('hidden');
            if (toggleBtn) {
                toggleBtn.innerHTML = '<i class="fas fa-edit ml-2"></i> בחירת גיחות';
                toggleBtn.classList.replace('bg-gray-500', 'bg-gray-700');
            }
            // איפוס בחירות ביציאה
            this.selectedFlights.clear();
            this.updateBulkDeleteUI();
        }
    },

    /**
     * חילוץ ערך מתוך אובייקט גיחה עבור טבלה או סינון
     */
    getValue: function (item, key) {
        if (!item) return '';
        const planning = window.planningSettings || {};

        // --- חישובי תאריך, שבוע ותקופה ---
        if (key === 'period' || key === 'week' || key === 'date') {
            let dateObj = item.date;
            if (typeof dateObj === 'string') dateObj = new Date(dateObj);
            if (!dateObj || isNaN(dateObj.getTime())) return '';

            // חישוב שם תקופה (למשל 1/26)
            if (key === 'period') {
                let year = dateObj.getFullYear();
                const month = dateObj.getMonth();
                if (month === 11) return `1/${(year + 1).toString().slice(-2)}`;
                const yearShort = year.toString().slice(-2);
                const periodNum = month < 5 ? "1" : "2";
                return `${periodNum}/${yearShort}`;
            }

            // חישוב שבוע
            if (key === 'week') {
                const pNext = planning.periodNextStart ? new Date(planning.periodNextStart) : null;
                const pCurr = planning.periodCurrStart ? new Date(planning.periodCurrStart) : null;
                const pPrev = planning.periodPrevStart ? new Date(planning.periodPrevStart) : null;

                let relevantStart = null;
                // מציאת יום ראשון של תחילת התקופה הרלוונטית
                const getStartSunday = (d) => {
                    if (!d) return null;
                    const s = new Date(d);
                    s.setHours(0, 0, 0, 0);
                    s.setDate(s.getDate() - s.getDay());
                    return s;
                };

                const dateSunday = getStartSunday(dateObj);
                const pNextSun = getStartSunday(pNext);
                const pCurrSun = getStartSunday(pCurr);
                const pPrevSun = getStartSunday(pPrev);

                if (pNextSun && dateSunday >= pNextSun) relevantStart = pNextSun;
                else if (pCurrSun && dateSunday >= pCurrSun) relevantStart = pCurrSun;
                else if (pPrevSun && dateSunday >= pPrevSun) relevantStart = pPrevSun;

                if (!relevantStart) return '';
                const diffTime = dateSunday.getTime() - relevantStart.getTime();
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                return Math.floor(diffDays / 7) + 1;
            }

            // החזרת תאריך בפורמט למכונה (עבור ה-Input Date)
            if (key === 'date') {
                const y = dateObj.getFullYear();
                const m = String(dateObj.getMonth() + 1).padStart(2, '0');
                const d = String(dateObj.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            }
        }

        // --- לוגיקה לסינון סטטוס (חדש) ---
        if (key === 'statusText') {
            const status = item.executionStatus;
            const d = item.data || {};

            if (status === 'בוטלה' || d['סיבת ביטול'] || d['סוג גיחה'] === 'ביטול גיחה') return 'בוטלה';
            if (d['סוג ביצוע'] === 'חלקי' || d['סוג גיחה'] === 'ביצוע חלקי') return 'חלקית';
            if (['דווחה', 'בוצעה ידנית', 'בוצעה'].includes(status)) return 'בוצעה';
            if (status === 'טרם דווחה') return 'טרם בוצעה';
            return 'אחר';
        }

        // --- שדות מחושבים נוספים ---
        if (key === 'pilot_calculated') {
            const d = item.data || {};
            return [d['טייס ימין'], d['טייס שמאל'], d['pilot-right'], d['pilot-left']].filter(Boolean);
        }

        // if (key === 'instructor_calculated') {
        //     const d = item.data || {};
        //     return (d['instructor-main'] || d['מדריך'] || item['instructor-main'] || item['מדריך'] || '').trim();
        // }

        if (key === 'מדריכה') {
            const d = item.data || {};
            return (d['מדריכה'] || d['instructor-name-1'] || '').trim();
        }

        // חילוץ רגיל
        let val = item[key] !== undefined ? item[key] : (item.data && item.data[key] !== undefined ? item.data[key] : '');
        if (!val && key === 'סוג גיחה' && item.trainingType) return item.trainingType;
        if (key === 'סימולטור' && typeof val === 'string') return val.toUpperCase().replace(/\s+/g, '');

        return val;
    },

    /**
     * אכלוס רשימות הבחירה (Dropdowns) בפילטרים
     */
    populateSelect: function (elementId, dataKey, dataSource) {
        const select = document.getElementById(elementId);
        if (!select) return;

        const currentVal = select.value;
        select.innerHTML = '<option value="">הכל</option>';

        let allValues = [];
        dataSource.forEach(item => {
            const val = this.getValue(item, dataKey);
            if (Array.isArray(val)) allValues.push(...val);
            else allValues.push(val);
        });

        let uniqueValues = [...new Set(allValues)].filter(v => v !== '');

        // מיון מיוחד לתאריכים או מספרים
        uniqueValues.sort((a, b) => {
            // אם זה נראה כמו תאריך YYYY-MM-DD
            if (typeof a === 'string' && a.match(/^\d{4}-\d{2}-\d{2}$/)) return a.localeCompare(b);
            return String(a).localeCompare(String(b));
        });

        uniqueValues.forEach(val => {
            const option = document.createElement('option');
            option.value = val;
            // תצוגה יפה לתאריך בתוך הפילטר
            option.textContent = (dataKey === 'date') ? val.split('-').reverse().join('/') : val;
            select.appendChild(option);
        });

        if (currentVal && uniqueValues.includes(currentVal)) select.value = currentVal;
    },

    /**
     * החלת הפילטרים על הנתונים ורינדור הטבלה מחדש
     */
    applyFilters: function () {
        const getVal = (id) => document.getElementById(id)?.value || '';

        const finalData = this.allData.filter(item => {
            // בדיקת התאמה לכל הפילטרים (AND)
            return this.checkMatch(item, 'period', getVal('db-filter-period')) &&
                this.checkMatch(item, 'week', getVal('db-filter-week')) &&
                this.checkMatch(item, 'date', getVal('db-filter-date')) &&
                this.checkMatch(item, 'statusText', getVal('db-filter-status')) &&
                this.checkMatch(item, 'שם גיחה', getVal('db-filter-flight-name')) &&
                this.checkMatch(item, 'סוג גיחה', getVal('db-filter-type')) &&
                this.checkMatch(item, 'סימולטור', getVal('db-filter-simulator')) &&
                this.checkMatch(item, 'instructor_calculated', getVal('db-filter-instructor')) &&
                this.checkMatch(item, 'מדריכה', getVal('db-filter-instructorFem')) &&
                this.checkMatch(item, 'pilot_calculated', getVal('db-filter-pilot'));
        });

        this.renderTable(finalData);

        // עדכון הרשימות הנפתחות בהתאם לסינון הנוכחי (כדי להראות רק אופציות רלוונטיות)
        // הערה: ניתן לבטל את זה אם רוצים שהרשימות תמיד יהיו מלאות
        const filtersToUpdate = Object.keys(this.KEY_MAP).filter(k => k !== 'db-filter-period' && k !== 'db-filter-week');
        // filtersToUpdate.forEach(id => this.populateSelect(id, this.KEY_MAP[id], finalData)); 
    },

    checkMatch: function (item, key, filterValue) {
        if (!filterValue) return true;
        const itemVal = this.getValue(item, key);
        if (Array.isArray(itemVal)) return itemVal.some(v => String(v).toLowerCase() === String(filterValue).toLowerCase());
        return String(itemVal).toLowerCase() === String(filterValue).toLowerCase();
    },

    /**
     * רינדור הטבלה ל-HTML
     */
    renderTable: function (data) {
        this.currentFilteredData = data;
        const tbody = document.getElementById('flight-table-body-db');
        const countSpan = document.getElementById('visible-rows-count');
        if (!tbody) return;

        if (countSpan) countSpan.textContent = data.length;
        tbody.innerHTML = '';

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-500">לא נמצאו גיחות תואמות</td></tr>';
            return;
        }

        // מיון: קודם לפי תאריך יורד, ואז לפי שעה יורדת
        data.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            if (dateB - dateA !== 0) return dateB - dateA;
            const timeA = (a.data && a.data['שעת התחלה']) || '00:00';
            const timeB = (b.data && b.data['שעת התחלה']) || '00:00';
            return timeB.localeCompare(timeA);
        });

        const isAdmin = !document.getElementById('nav-admin')?.classList.contains('hidden');

        data.forEach((row, index) => {
            const tr = document.createElement('tr');
            tr.className = (index % 2 === 0 ? 'bg-white' : 'bg-gray-50') + ' hover:bg-ofer-primary-50 transition cursor-pointer';

            // תמיכה בבחירה מרובה
            const isChecked = this.selectedFlights.has(row.id);
            const rawDate = this.getValue(row, 'date');
            const displayDate = rawDate.includes('-') ? rawDate.split('-').reverse().join('/') : rawDate;

            // תא ה-Checkbox: מוצג רק למנהל
            const checkboxCell = this.selectionMode ?
                `<td class="px-4 py-4" onclick="event.stopPropagation()">
                    <input type="checkbox" class="flight-checkbox" data-id="${row.id}" 
                        ${this.selectedFlights.has(row.id) ? 'checked' : ''} 
                        onchange="missionDatabase.toggleFlightSelection('${row.id}')">
                 </td>` :
                `<td class="hidden"></td>`; // מוסתר אם המצב כבוי

            tr.innerHTML = `
                ${checkboxCell}
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${data.length - index}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium" onclick="window.showFlightDetails('${row.id}')">${getExecutionStatusBadge(row)}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-bold">${row.data?.['שעת התחלה'] || '---'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${row.data?.['שעת סיום'] || '---'}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${this.getValue(row, 'סוג גיחה')}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${this.getValue(row, 'שם גיחה')}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${this.getValue(row, 'מדריכה')}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${displayDate}</td>
            `;
            tbody.appendChild(tr);
        });
    },

    // --- פונקציות בחירה ומחיקה (למנהלים) ---

    toggleFlightSelection: function (id) {
        if (this.selectedFlights.has(id)) this.selectedFlights.delete(id);
        else this.selectedFlights.add(id);
        this.updateBulkDeleteUI();
    },

    toggleSelectAll: function (checked) {
        const checkboxes = document.querySelectorAll('.flight-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = checked;
            const id = cb.dataset.id;
            if (checked) this.selectedFlights.add(id);
            else this.selectedFlights.delete(id);
        });
        this.updateBulkDeleteUI();
    },

    updateBulkDeleteUI: function () {
        const bulkContainer = document.getElementById('bulk-actions-container');
        const deleteBtn = document.getElementById('delete-selected-btn');
        const exportBtn = document.getElementById('export-selected-btn');
        const count = document.getElementById('selected-count-label');
        const isAdmin = !document.getElementById('nav-admin')?.classList.contains('hidden');

        if (bulkContainer && count) {
            const size = this.selectedFlights.size;

            if (size > 0) {
                bulkContainer.classList.remove('hidden');
                bulkContainer.style.display = 'flex';
                count.textContent = size;

                // כפתור מחיקה למנהלים בלבד
                if (deleteBtn) deleteBtn.style.display = isAdmin ? 'inline-block' : 'none';
                if (exportBtn) exportBtn.style.display = 'inline-block';
            } else {
                bulkContainer.classList.add('hidden');
                bulkContainer.style.display = 'none';
            }
        }
    },
    exportSelectedToExcel: function () {
        if (this.selectedFlights.size === 0) return;

        const selectedData = this.allData.filter(item => this.selectedFlights.has(item.id));

        // 1. עמודות בסיס שתמיד נרצה להציג בהתחלה (מידע כללי)
        const baseHeaders = [
            'תאריך', 'שם גיחה', 'סוג גיחה', 'סימולטור', 'סטטוס ביצוע',
            'מדריכה', 'טייסים', 'שעת התחלה', 'שעת סיום', 'סיכום מדריכה', 'יעדים', 'תקלות', 'מדדי ביצוע'
        ];

        // 2. סריקת כל הגיחות לאיסוף שדות דינמיים נוספים (כל מה שמעבר למידע הכללי)
        const dynamicHeaders = new Set();
        // רשימת שדות שנטפל בהם ידנית ולכן לא נרצה להוסיף אותם שוב באופן אוטומטי
        const ignoredKeys = ['goals', 'faults', 'שעת התחלה', 'שעת סיום', 'סיכום מדריכה', 'instructor-summary', 'מדדי ביצוע'];

        selectedData.forEach(flight => {
            if (flight.data) {
                Object.keys(flight.data).forEach(key => {
                    if (!baseHeaders.includes(key) && !ignoredKeys.includes(key)) {
                        dynamicHeaders.add(key);
                    }
                });
            }
        });

        // 3. איחוד כל הכותרות (קבועות + דינמיות)
        const allHeaders = [...baseHeaders, ...Array.from(dynamicHeaders)];

        const escapeCSV = (str) => {
            if (str === null || str === undefined) return '""';
            const text = String(str).replace(/"/g, '""'); // הכפלת מרכאות (הגנה לשבירת אקסל)
            return `"${text}"`; // עטיפת כל תא במרכאות
        };

        // יצירת שורת הכותרות
        let csvContent = allHeaders.map(escapeCSV).join(',') + '\n';

        // 4. בניית שורות הנתונים לכל גיחה
        selectedData.forEach(flight => {
            const d = flight.data || {};

            // המרת יעדים
            let goalsText = "";
            if (flight.goalsStatus && typeof flight.goalsStatus === 'object') {
                const goalsArr = [];
                let i = 1;
                for (const [goalName, status] of Object.entries(flight.goalsStatus)) {
                    let goalStr = `${i}. ${goalName} - ${status}`;
                    if (status === 'לא עמד.ה' && flight.goalsDetails && flight.goalsDetails[goalName]) {
                        goalStr += ` (סיבה: ${flight.goalsDetails[goalName]})`;
                    }
                    goalsArr.push(goalStr);
                    i++;
                }
                goalsText = goalsArr.join('\n');
            }

            // המרת תקלות
            let faultsText = "";
            if (flight.faults && Array.isArray(flight.faults)) {
                faultsText = flight.faults.map((f, i) => {
                    const sys = f.systemClassification || '';
                    const desc = f.description || '';
                    return `${i + 1}. ${sys ? sys + ' - ' : ''}${desc}`;
                }).join('\n');
            }

            // המרת מדדי ביצוע (אם קיימים)
            let metricsText = "";
            if (d['מדדי ביצוע'] && Array.isArray(d['מדדי ביצוע'])) {
                metricsText = d['מדדי ביצוע'].map(m => `- ${m.main}: ${m.value}`).join('\n');
            }

            // שליפת ערך לכל עמודה (קבועה או דינמית)
            const row = allHeaders.map(header => {
                // בדיקה אם זו אחת מעמודות הבסיס שלנו
                if (header === 'תאריך') return this.getValue(flight, 'date');
                if (header === 'שם גיחה') return this.getValue(flight, 'שם גיחה');
                if (header === 'סוג גיחה') return this.getValue(flight, 'סוג גיחה');
                if (header === 'סימולטור') return this.getValue(flight, 'סימולטור');
                if (header === 'סטטוס ביצוע') return this.getValue(flight, 'statusText');
                if (header === 'מדריכה') return this.getValue(flight, 'מדריכה');
                if (header === 'טייסים') return (this.getValue(flight, 'pilot_calculated') || []).join(', ');
                if (header === 'שעת התחלה') return d['שעת התחלה'] || '';
                if (header === 'שעת סיום') return d['שעת סיום'] || '';
                if (header === 'סיכום מדריכה') return d['סיכום מדריכה'] || d['instructor-summary'] || '';
                if (header === 'יעדים') return goalsText;
                if (header === 'תקלות') return faultsText;
                if (header === 'מדדי ביצוע') return metricsText;

                // אם זו לא עמודת בסיס, מדובר בשדה דינמי שנשלף מתוך הטופס
                return d[header] !== undefined ? d[header] : '';
            });

            csvContent += row.map(escapeCSV).join(',') + '\n';
        });

        // הוספת \uFEFF לקידוד UTF-8 שעובד טוב באקסל בעברית
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);

        const dateStr = new Date().toLocaleDateString('he-IL').replace(/\./g, '-');

        link.setAttribute("href", url);
        link.setAttribute("download", `ייצוא_גיחות_${dateStr}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    deleteSelected: async function () {
        if (this.selectedFlights.size === 0) return;
        if (!confirm(`האם למחוק לצמיתות ${this.selectedFlights.size} גיחות?`)) return;

        const { doc, deleteDoc } = window.firestoreFunctions;
        showToast("מוחק גיחות...", "blue");

        try {
            for (const id of this.selectedFlights) {
                await deleteDoc(doc(window.db, "flights", id));
            }
            showToast("המחיקה הושלמה", "green");
            // טעינה מחדש של הנתונים במקום ריענון מלא של הדף
            if (window.fetchFlights) await window.fetchFlights();
        } catch (e) {
            console.error(e);
            showToast("שגיאה במחיקה", "red");
        }
    }
};

// --- מחיקת טווח (למנהלים בלבד) ---
window.deleteFlightsInRange = async function () {
    const start = document.getElementById('delete-start-date').value;
    const end = document.getElementById('delete-end-date').value;
    if (!start || !end) return showToast("נא לבחור טווח תאריכים", "yellow");

    const toDelete = window.savedFlights.filter(f => {
        const d = f.date instanceof Date ? f.date.toISOString().split('T')[0] : f.date;
        return d >= start && d <= end;
    });

    if (toDelete.length === 0) return showToast("לא נמצאו גיחות בטווח זה", "yellow");
    if (!confirm(`נמצאו ${toDelete.length} גיחות. האם למחוק את כולן?`)) return;

    const { doc, deleteDoc } = window.firestoreFunctions;
    showToast("מוחק...", "blue");

    try {
        for (const f of toDelete) await deleteDoc(doc(window.db, "flights", f.id));
        showToast("הטווח נמחק בהצלחה", "green");
        if (window.fetchFlights) await window.fetchFlights();
    } catch (e) {
        console.error(e);
        showToast("שגיאה במחיקה", "red");
    }
};

// חשיפה ל-Window
window.missionDatabase = missionDatabase;
export default missionDatabase;