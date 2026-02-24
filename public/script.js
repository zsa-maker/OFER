const trainingTemplates = {
    'GENERIC_FLIGHT': { // זו התבנית האחת והיחידה כעת
        goals: ['יעד 1', 'יעד 2'], // *** שינוי: רק שני יעדים קבועים ***
        step2: [], // מרוקן: אין שדות טופס דינמיים
        step3: [] // מרוקן: אין שדות שלב 3
    }
};

// *** רשימות התקלות הקבועות הוסרו - הן יבנו דינמית ב-processFaultsData ***
const simulatorFaults = {
    'מאמן גדול': [],
    'מאמן VIPT': []
};

const flightTypes = ['גיחה רגילה', 'ביצוע חלקי', 'ביטול גיחה'];
const flightGroundingOptions = ['גיחה', 'קרקוע'];
const crewRoles = ['טייס', 'מדריכה', 'מכונן', 'נווט'];
const elementCategories = ['אחר', 'הטסה', 'משימה', 'אלמנט טקטי', 'מדריכות', 'תקלות'];
const elementOptions = ['אלמנט 1', 'אלמנט 2', 'אלמנט 3', 'אלמנט 4'];
const performanceOptions = ['בוצע', 'לא בוצע', 'נוסף לשיקול המדריכה'];

let savedFlights = [];
let currentForm = {};
let currentViewFlight = null;
let currentScreen = 'flight-form-screen';

// *** חדש: מאגר תקלות מאוחד וקבוע לסיכום נתונים (יטען ב-fetchFlights) ***
let unifiedFaultsDatabase = {};

// *** עדכון: מאגר סטטוס טיפול בתקלות (עתה נטען מ-Firebase) ***
let faultResolutionStatus = {}; // מאותחל כריק - ייטען מ-Firebase


// ******************************************************
// פונקציית טעינת גיחות (מעודכן: טוען סטטוסים ראשון)
// ******************************************************
async function fetchFlights() {
    // *** הגנה: קורא את currentUsername מהאובייקט הגלובלי (שמוגדר ב-auth.js) ***
    if (!window.currentUsername) return;

    // השתמש/י ב-window.db שהוגדר ב-index.html
    if (typeof window.db === 'undefined' || typeof window.firestoreFunctions === 'undefined') {
        console.error('Firebase DB/Functions are not initialized (fetchFlights).');
        if (savedFlights.length > 0) {
            showToast('שגיאה בטעינת הנתונים: Firebase לא מאותחל.', 'red');
        }
        return;
    }

    // משיכת הפונקציות הגלובליות שנחשפו ב-index.html
    const { getDocs, collection } = window.firestoreFunctions;

    // *** חדש: טעינת סטטוסי הטיפול (Fault Resolutions) מ-Firebase ***
    try {
        const resolutionCollection = collection(window.db, "fault_resolutions");
        const resSnapshot = await getDocs(resolutionCollection);

        // בונה את אובייקט faultResolutionStatus מהמסמכים ב-Firebase
        faultResolutionStatus = {};
        resSnapshot.docs.forEach(doc => {
            const data = doc.data();

            // *** תיקון השגיאה: בודק אם data.timestamp הוא אובייקט Timestamp (עם toMillis) או מספר ***
            let resolutionTs;
            if (data.timestamp && typeof data.timestamp.toMillis === 'function') {
                resolutionTs = data.timestamp.toMillis();
            } else if (data.timestamp) {
                resolutionTs = data.timestamp; // זה כבר מספר
            } else {
                resolutionTs = Date.now();
            }

            // משתמשים במפתח התקלה כאינדקס. הוספת resolutionTimestamp
            faultResolutionStatus[data.faultKey] = {
                isResolved: true,
                date: data.date,
                time: data.time,
                resolutionTimestamp: resolutionTs // המרת Timestamp ל-ms
            };
        });
    } catch (error) {
        console.error('שגיאה בטעינת סטטוסי הטיפול מ-Firebase:', error);
        // נמשיך עם faultResolutionStatus כפי שהוא (ריק) במקרה של שגיאה
    }
    // ******************************************************

    try {
        const flightsCollection = collection(window.db, "flights");
        const snapshot = await getDocs(flightsCollection);

        const flights = snapshot.docs.map(doc => {
            const flight = doc.data();

            // המערכת שומרת את התאריך כמחרוזת (YYYY-MM-DD) או כ-Timestamp
            if (flight.date && typeof flight.date === 'string') {
                // לגיחות חדשות שנשמרו כמחרוזת
                flight.date = new Date(flight.date);
            } else if (flight.date && flight.date.toDate) {
                // לגיחות ישנות שנשמרו כ-Firebase Timestamp (אם יש)
                flight.date = flight.date.toDate();
            }

            // נשמור את זמן ההתחלה המדויק
            const dateStr = flight.data['תאריך'];
            const timeStr = flight.data['שעת התחלה'];
            if (dateStr && timeStr) {
                // מניח שהתאריך הוא בפורמט YYYY-MM-DD
                const isoDateTimeStr = `${dateStr}T${timeStr}:00`;
                flight.flightStartTimestamp = new Date(isoDateTimeStr).getTime();
            } else if (flight.date) {
                // אם אין שעה, נשתמש רק בתאריך שנטען לעיל
                flight.flightStartTimestamp = flight.date.getTime();
            }

            flight.id = doc.id;

            return flight;
        });

        savedFlights = flights;
        processFaultsData(); // *** עדכון: עיבוד נתוני התקלות משתמש כעת בסטטוסים מ-Firebase ***
        renderFlightTable();
    } catch (error) {
        console.error('שגיאה קריטית בטעינת הגיחות מ-Firebase:', error);
        showToast('שגיאה בטעינת הנתונים.', 'red');
    }
}

/**
 * מוחק את כל המסמכים מאוסף "flights".
 */
async function deleteAllFlights() {
    // *** הגנה ***
    if (!window.currentUsername) return;

    if (typeof window.db === 'undefined' || typeof window.firestoreFunctions === 'undefined') {
        showToast('שגיאה: Firebase לא מאותחל.', 'red');
        return;
    }

    // משיכת הפונקציות הגלובליות
    const { getDocs, collection, doc, deleteDoc } = window.firestoreFunctions;

    try {
        const flightsCollection = collection(window.db, "flights");
        const snapshot = await getDocs(flightsCollection);

        const deletePromises = snapshot.docs.map(flightDoc => {
            return deleteDoc(doc(window.db, "flights", flightDoc.id));
        });

        await Promise.all(deletePromises);

        // *** חדש: מחיקת סטטוס התקלות המקומי לאחר מחיקת כל הגיחות ***
        faultResolutionStatus = {};

        savedFlights = []; // מנקה את הנתונים המקומיים
        renderFlightTable(); // מרנדר טבלה ריקה
        showToast(`נמחקו בהצלחה ${deletePromises.length} גיחות.`, 'green');

    } catch (error) {
        console.error('שגיאה קריטית במחיקת הנתונים מ-Firebase:', error);
        showToast('שגיאה במחיקת הנתונים.', 'red');
    }
}


/**
 * עדכון: כולל קריאה ל-renderFaultDatabaseTable במסך מאגר תקלות
 */
function showScreen(screenId) {
    // *** הגנה: קורא את currentUsername מהאובייקט הגלובלי ***
    if (!window.currentUsername) {
        // אם לא מחובר, מוודא שמסך ההתחברות מוצג
        document.getElementById('login-screen').classList.remove('hidden');
        return;
    }

    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.add('hidden');
    });

    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.remove('hidden');
    }

    hideAllModals();

    currentScreen = screenId; // שמירת המסך הנוכחי

    if (screenId === 'flight-form-screen' || screenId === 'mission-database-screen') {
        populateFilters(screenId);
        fetchFlights();
    } else if (screenId === 'fault-database-screen') {
        fetchFlights().then(() => { // ודא שהנתונים נטענו לפני הרינדור
            renderFaultDatabaseTable();
        });
    }
}

function populateFilters(screenId = 'flight-form-screen') {
    // איתור הפילטרים הרלוונטיים במסך הנוכחי
    const container = document.getElementById(screenId);
    if (!container) return;

    // ודא שאתה משתמש ב-ID הנכון, מאחר ו-index.html משתמש באותם IDs לשני המסכים
    // נשתמש ב-container.querySelector כדי למצוא את האלמנטים בתוך המסך הנוכחי
    const periodSelect = container.querySelector('#period-select');
    const weekSelect = container.querySelector('#week-select');

    // אם לא נמצאו אלמנטים לפילטרים במסך הנוכחי, יוצאים
    if (!periodSelect || !weekSelect) return;

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    let currentPeriod = currentMonth >= 1 && currentMonth <= 6 ? 1 : 2;

    periodSelect.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'בחר תקופה...';
    periodSelect.appendChild(placeholder);

    for (let year = currentYear - 1; year <= currentYear + 1; year++) {
        for (let period = 1; period <= 2; period++) {
            let option = document.createElement('option');
            option.value = `${period}/${String(year).slice(-2)}`;
            option.textContent = `${period}/${String(year).slice(-2)}`;
            periodSelect.appendChild(option);
            // בחירת תקופת ברירת מחדל רק במסך המאגר, לא במסך הטופס (שם הוא מוסתר)
            if (screenId === 'mission-database-screen' && year === currentYear && period === currentPeriod) {
                option.selected = true;
            }
        }
    }

    // קוראים ל-populateWeekOptions עם הפילטרים הספציפיים
    populateWeekOptions(periodSelect, weekSelect);
}

function populateWeekOptions(periodSelect, weekSelect) {
    // אין צורך לחפש שוב לפי ID, משתמשים באובייקטים שהועברו
    if (!periodSelect || !weekSelect) return;

    const selectedPeriod = periodSelect.value;
    weekSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'בחר שבוע...';
    placeholder.selected = true;
    weekSelect.appendChild(placeholder);

    if (selectedPeriod) {
        const [periodNum, year] = selectedPeriod.split('/').map(Number);
        let startWeek, endWeek;

        if (periodNum === 1) {
            startWeek = 1;
            endWeek = 26;
        } else {
            startWeek = 27;
            endWeek = 54;
        }

        for (let i = startWeek; i <= endWeek; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = `שבוע ${i}`;
            weekSelect.appendChild(option);
        }
    }
}

function showFormStep2(flightStatus) {
    // *** הגנה: קורא את currentUsername מהאובייקט הגלובלי ***
    if (!window.currentUsername) return;

    hideAllModals();
    const formStep2 = document.getElementById('form-step-2');
    if (!formStep2) return;
    formStep2.classList.remove('hidden');

    // *** השינוי המרכזי: שימוש בתבנית הגנרית הקבועה ***
    const trainingType = 'GENERIC_FLIGHT';
    const flightType = flightStatus;

    // Reset currentForm data for a new form
    currentForm = {
        trainingType: trainingType, // קבוע: GENERIC_FLIGHT
        flightType: flightType,     // מצב גיחה (רגילה/חלקית/ביטול)
        flightGrounding: 'גיחה', // נשאר כברירת מחדל פנימית
        goalsStatus: {},
        goalsDetails: {},
        data: {},
        crew: [], // מרוקן
        elements: [], // מרוקן
        flightTimes: [], // מרוקן
        faults: [], // *** חדש: רשימת תקלות ***
        // *** חדש: שדה זמן תחילת גיחה שיחושב ויתעדכן לאחר הזנת שעות ***
        flightStartTimestamp: null
    };

    const template = trainingTemplates[trainingType];
    const goalsContainer = document.getElementById('goals-container');
    const flightTypeSelect = document.getElementById('flight-type-select'); // ID מעודכן

    // Clear and reset containers
    if (goalsContainer) {
        goalsContainer.innerHTML = '';
    }

    // *** התיקון שהיה חסר: אתחול שדה סוג הגיחה ***
    if (flightTypeSelect) {
        // מילוי מחדש של ה-Select עם האפשרויות הקיימות ב-HTML
        const originalSelect = document.querySelector('select[data-field="סוג גיחה"]');
        if (originalSelect) {
            flightTypeSelect.innerHTML = originalSelect.innerHTML;
            flightTypeSelect.value = ''; // ודא שברירת המחדל נשארת ריקה
        }
    }


    // Reset fixed fields
    const flightName = document.getElementById('flight-name');
    if (flightName) flightName.value = '';

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');

    const flightDate = document.getElementById('flight-date');
    if (flightDate) flightDate.value = `${year}-${month}-${day}`;

    const startTime = document.getElementById('start-time');
    if (startTime) startTime.value = '';

    const endTime = document.getElementById('end-time');
    if (endTime) endTime.value = '';

    const durationMinutes = document.getElementById('flight-duration-minutes');
    if (durationMinutes) durationMinutes.value = ''; // מנקה את שדה הדקות

    // *** איפוס שדה מתצפת ***
    const observer = document.getElementById('observer');
    if (observer) observer.value = '';

    // *** איפוס שדה סימולטור בנתונים הכלליים ***
    const simulatorSelectGeneral = document.getElementById('simulator-select');
    if (simulatorSelectGeneral) {
        simulatorSelectGeneral.value = ''; // איפוס
    }


    // Goals (טעינת היעדים מהתבנית הגנרית)
    if (goalsContainer && template) {
        goalsContainer.innerHTML = '<h3 class="text-xl font-bold mb-2">יעדי אימון</h3>';
        template.goals.forEach(goal => {
            currentForm.goalsStatus[goal] = 'עמד.ה';
            currentForm.goalsDetails[goal] = '';

            // *** שינוי: שימוש בקלאסים הבהירים (100) לעיצוב אחיד ***
            goalsContainer.innerHTML += `
                <div class="flex items-start mb-4">
                    <div class="w-1/4">
                        <span class="block font-medium">${goal}</span>
                        <button class="goal-button text-sm font-semibold py-1 px-3 rounded-lg mt-1 transition-colors duration-200 
                                bg-green-100 text-green-700" 
                                data-status="met" data-goal="${goal}">
                            עמד.ה
                        </button>
                    </div>
                    <div class="flex-grow">
                        <label class="block text-sm font-medium text-gray-700">פירוט (חובה)</label>
                        <textarea class="mt-1 block w-full rounded-md border-gray-300 shadow-sm" rows="2" data-field-goal-detail="${goal}"></textarea>
                    </div>
                </div>
            `;
        });
    }

    // *** שינוי הסדר: מזיז את קטע התקלות שיהיה אחרי קטע היעדים ***
    const faultReportingSection = document.getElementById('fault-reporting-section');
    if (goalsContainer && faultReportingSection && goalsContainer.parentNode) {
        // משתמשים ב-insertBefore עם nextSibling כדי להבטיח שקטע התקלות יבוא מיד אחרי קטע היעדים
        goalsContainer.parentNode.insertBefore(faultReportingSection, goalsContainer.nextSibling);
    }
    // *** סוף שינוי הסדר ***


    // *** איפוס שדות התקלה (חדש - קורא ל-populateFaultOptions עם null) ***
    // זה יביא למצב של "יש לבחור סימולטור בנתונים הכלליים..."
    populateFaultOptions(null);

    // *** איפוס קטע התקלות (הטבלה) ***
    const faultsContainer = document.getElementById('faults-list-container');
    if (faultsContainer) {
        faultsContainer.innerHTML = `<p class="text-gray-500 mt-2">לא דווחו תקלות בגיחה זו.</p>`; // איפוס הודעת התקלה
    }

    // *** איפוס שדה 'אחר' ***
    const otherFaultGroup = document.getElementById('other-fault-group');
    if (otherFaultGroup) otherFaultGroup.classList.add('hidden');


    // מנקה סימון אדום אם קיים מהפעלה קודמת
    clearFieldHighlight();
}

function saveCurrentStepData() {
    // שמירת הנתונים הכלליים בלבד
    const inputs = document.querySelectorAll('#general-data-section [data-field], #flight-name, #flight-date, #start-time, #end-time');
    inputs.forEach(input => {
        const field = input.dataset.field || input.id;
        currentForm.data[field] = input.value.trim();
    });

    // שמירת יעדים בלבד
    document.querySelectorAll('[data-field-goal-detail]').forEach(input => {
        const goal = input.dataset.fieldGoalDetail;
        currentForm.goalsDetails[goal] = input.value.trim();
    });

    // *** שינוי: הוסר הטיפול ב-flightGrounding, crew, elements, flightTimes ו-videoRadio ***
}

function restoreCurrentStepData() {
    // 1. שדות קבועים וכלליים
    const flightNameInput = document.getElementById('flight-name');
    if (flightNameInput) flightNameInput.value = currentForm.data['שם גיחה'] || '';

    // *** עדכון: שחזור שדה סוג גיחה ***
    const flightTypeSelect = document.getElementById('flight-type-select');
    if (flightTypeSelect) flightTypeSelect.value = currentForm.data['סוג גיחה'] || '';

    // *** שחזור סימולטור ***
    const simulatorSelect = document.getElementById('simulator-select');
    if (simulatorSelect) simulatorSelect.value = currentForm.data['סימולטור'] || '';

    const flightDate = document.getElementById('flight-date');
    if (flightDate) flightDate.value = currentForm.data['תאריך'] || '';

    const startTime = document.getElementById('start-time');
    if (startTime) startTime.value = currentForm.data['שעת התחלה'] || '';

    const endTime = document.getElementById('end-time');
    if (endTime) endTime.value = currentForm.data['שעת סיום'] || '';

    // שחזור שעות הטיסה (מחושב אוטומטית בעת שינוי)
    const durationMinutes = document.getElementById('flight-duration-minutes');
    if (durationMinutes) durationMinutes.value = currentForm.data['שעות טיסה (דקות)'] || '';

    // 2. שדות טופס דינמיים (אין יותר)

    // 3. Goals Details
    document.querySelectorAll('[data-field-goal-detail]').forEach(input => {
        const goal = input.dataset.fieldGoalDetail;
        if (currentForm.goalsDetails[goal]) {
            input.value = currentForm.goalsDetails[goal];
        }
    });

    // 4. הוסר שחזור רדיו
}

/**
 * מנקה סימון אדום מכל השדות.
 */
function clearFieldHighlight() {
    const fields = document.querySelectorAll('input:not([type="radio"]), textarea, select');

    fields.forEach(input => {
        input.classList.remove('border-red-500', 'ring-red-500', 'border-4');
        input.classList.add('border-gray-300');
    });
}

/**
 * מחשב את משך הטיסה בדקות בין שעת התחלה לשעת סיום.
 * *** עדכון: מחשב ומעדכן גם את currentForm.flightStartTimestamp ***
 * @returns {number} משך הטיסה בדקות.
 */
function calculateFlightDuration() {
    const startTimeStr = document.getElementById('start-time')?.value;
    const endTimeStr = document.getElementById('end-time')?.value;
    const durationInput = document.getElementById('flight-duration-minutes');
    const dateStr = document.getElementById('flight-date')?.value;

    if (!startTimeStr || !endTimeStr || !durationInput || !dateStr) {
        if (durationInput) durationInput.value = '';
        currentForm.flightStartTimestamp = null; // אפס גם את ה-timestamp
        return 0;
    }

    try {
        // חישוב משך הזמן בדקות
        const [startHour, startMinute] = startTimeStr.split(':').map(Number);
        const [endHour, endMinute] = endTimeStr.split(':').map(Number);

        const totalStartMinutes = startHour * 60 + startMinute;
        let totalEndMinutes = endHour * 60 + endMinute;

        if (totalEndMinutes < totalStartMinutes) {
            totalEndMinutes += 24 * 60;
        }

        const durationMinutes = totalEndMinutes - totalStartMinutes;

        durationInput.value = durationMinutes >= 0 ? durationMinutes : '';
        currentForm.data['שעות טיסה (דקות)'] = durationInput.value;

        // *** חדש: חישוב flightStartTimestamp ***
        const isoDateTimeStr = `${dateStr}T${startTimeStr}:00`;
        currentForm.flightStartTimestamp = new Date(isoDateTimeStr).getTime();


        return durationMinutes;

    } catch (e) {
        durationInput.value = '';
        currentForm.flightStartTimestamp = null; // אפס גם את ה-timestamp
        console.error("שגיאה בחישוב משך הטיסה:", e);
        return 0;
    }
}


// ******************************************************
// פונקציות ניהול תקלות (מעודכן: לוגיקת מחזור חיים מדויקת)
// ******************************************************

/**
 * מעבד את כל הגיחות שנשמרו ומייצר מאגר תקלות מאוחד 
 * בהתאם ללוגיקה החדשה: פתיחה מחדש כשהתקלה נסגרה לפני הדיווח.
 */
function processFaultsData() {
    const currentResolutionStatus = faultResolutionStatus;
    unifiedFaultsDatabase = {};

    savedFlights.forEach(flight => {
        if (flight.faults && flight.faults.length > 0 && flight.flightStartTimestamp) {
            flight.faults.forEach(fault => {
                const faultDescription = fault.description;
                const simulator = fault.simulator;
                const flightStartTimestamp = flight.flightStartTimestamp; // זמן תחילת הגיחה
                const baseKey = `${simulator}|${faultDescription}`;
                // *** שינוי: ה-timestamp של התקלה הוא כעת זמן תחילת הגיחה ***
                const reportTimestamp = fault.timestamp || flightStartTimestamp;

                let openCycleKey = null;
                let isJoined = false;

                // שלב 1: חיפוש מחזור חיים קיים שהדיווח מצטרף אליו
                Object.keys(unifiedFaultsDatabase).forEach(key => {
                    const currentFault = unifiedFaultsDatabase[key];
                    if (currentFault.baseKey === baseKey) {

                        const cycleStatus = currentResolutionStatus[key] || { isResolved: false, resolutionTimestamp: Infinity };

                        if (!cycleStatus.isResolved) {
                            // א. אם המחזור פתוח: הדיווח מצטרף למחזור הפתוח
                            openCycleKey = key;
                            isJoined = true;
                        } else if (reportTimestamp < cycleStatus.resolutionTimestamp) {
                            // ב. אם המחזור סגור, אך הדיווח נרשם לפני שהתקלה נסגרה:
                            // הלוגיקה החדשה מחייבת שדיווח חדש יצטרף למחזור קיים רק אם הוא פתוח. 
                            // אם הוא סגור, כל דיווח שבא אחריו אמור לפתוח מחזור חדש.
                            // דיווח שה-timestamp שלו קטן מזמן הפתרון, מעיד על תקלה שדווחה *כשהמחזור היה פתוח*
                            // אך הדיווח שלה נרשם רק עכשיו. נתעלם מהמקרה המורכב הזה ונשאיר את הדגש על פתיחה מחדש
                        }
                    }
                });

                // שלב 2: אם לא הצטרף לאף מחזור פתוח, יצירת מחזור חיים חדש
                if (!isJoined) {

                    // יצירת מפתח חדש המבוסס על זמן הדיווח הנוכחי (הפתיחה)
                    // (זה מבטיח מפתח ייחודי גם כשהתקלה נפתחת מחדש)
                    openCycleKey = `${baseKey}|${reportTimestamp}`;

                    if (!unifiedFaultsDatabase[openCycleKey]) {
                        unifiedFaultsDatabase[openCycleKey] = {
                            key: openCycleKey,
                            baseKey: baseKey,
                            simulator: simulator,
                            description: faultDescription,
                            reportCount: 0,
                            firstReportTimestamp: reportTimestamp,
                            lastReportTimestamp: reportTimestamp,
                            status: { isResolved: false, date: null, time: null }
                        };
                    }
                    isJoined = true;
                }

                // עדכון המחזור שאליו הצטרף/נפתח
                if (isJoined && unifiedFaultsDatabase[openCycleKey]) {
                    unifiedFaultsDatabase[openCycleKey].reportCount += 1;
                    if (reportTimestamp > unifiedFaultsDatabase[openCycleKey].lastReportTimestamp) {
                        unifiedFaultsDatabase[openCycleKey].lastReportTimestamp = reportTimestamp;
                    }
                }
            });
        }
    });

    // שלב 3: שחזור סטטוסי טיפול ועדכון המשתנה הגלובלי לטבלה
    Object.keys(unifiedFaultsDatabase).forEach(key => {
        if (currentResolutionStatus[key]) {
            unifiedFaultsDatabase[key].status = currentResolutionStatus[key];
        }
        // מעדכן את המשתנה הגלובלי לכל המחזורים
        faultResolutionStatus[key] = unifiedFaultsDatabase[key].status;
    });

    // *** עדכון: עדכון רשימת התקלות הפתוחות לשימוש בטופס ***
    ['מאמן גדול', 'מאמן VIPT'].forEach(sim => {
        simulatorFaults[sim] = Object.keys(unifiedFaultsDatabase)
            .map(key => unifiedFaultsDatabase[key])
            .filter(f => f.simulator === sim && !f.status.isResolved)
            .map(f => f.description);
    });
}

/**
 * מטפל בהוספת תקלה חדשה מהטופס
 */
function addFaultFromForm() {
    // *** הגנה ***
    if (!window.currentUsername) return;

    // הסימולטור כעת נקרא מחוץ לקטע התקלות, אך הנתון שלו כבר שמור ב-currentForm.data
    const simulatorId = currentForm.data['סימולטור'];

    const faultSelect = document.getElementById('fault-select');
    const otherFaultInput = document.getElementById('other-fault-text');

    if (!simulatorId) {
        // מצב זה אמור להימנע אם המשתמש מילא את הנתונים הכלליים, אך כגיבוי:
        showToast('שגיאה: יש לבחור סימולטור בנתונים הכלליים.', 'red');
        return;
    }
    if (!faultSelect) return;

    // *** חדש: בדיקה האם זמן הגיחה קיים ***
    if (!currentForm.flightStartTimestamp) {
        showToast('שגיאה: יש למלא תאריך ושעת התחלה של הגיחה לפני דיווח תקלה.', 'red');
        return;
    }

    let faultDescription;
    let isNewFault = false;

    // *** לוגיקת בחירת התיאור והבדיקה האם היא תקלה חדשה ***

    if (faultSelect.disabled === true) {
        // מצב 1: ה-SELECT מנוטרל (אין פתוחות), חייב להיות OTHER
        if (otherFaultInput && otherFaultInput.value.trim() === '') {
            showToast('יש למלא את תיאור התקלה.', 'red');
            return;
        }
        faultDescription = otherFaultInput.value.trim();
        isNewFault = true;

    } else if (faultSelect.value === 'OTHER') {
        // מצב 2: ה-SELECT פעיל, נבחרה אופציית OTHER
        if (otherFaultInput && otherFaultInput.value.trim() === '') {
            showToast('יש למלא את תיאור התקלה.', 'red');
            return;
        }
        faultDescription = otherFaultInput.value.trim();
        isNewFault = true;

    } else if (faultSelect.value) {
        // מצב 3: ה-SELECT פעיל, נבחרה תקלה קיימת
        faultDescription = faultSelect.value;
        isNewFault = false;

    } else {
        // לא נבחר כלום
        showToast('שגיאה: יש לבחור תקלה קיימת או להזין תקלה חדשה.', 'red');
        return;
    }

    // בדיקה למניעת כפילות באותה הגיחה
    if (currentForm.faults.some(f => f.description === faultDescription && f.simulator === simulatorId)) {
        showToast('תקלה זו כבר דווחה בגיחה הנוכחית.', 'red');
        return;
    }

    const newFault = {
        simulator: simulatorId,
        description: faultDescription,
        // *** שינוי קריטי: שימוש בזמן תחילת הגיחה כזמן הדיווח ***
        timestamp: currentForm.flightStartTimestamp
    };

    // הוספה לנתונים הנוכחיים
    currentForm.faults.push(newFault);
    renderFaultsTable(currentForm.faults);

    // ניקוי הטופס
    faultSelect.value = '';
    if (otherFaultInput) otherFaultInput.value = '';

    // מאפס את שדה הבחירה ומחזיר למצב תקין
    populateFaultOptions(simulatorId); // משתמש ב-simulatorId
    showToast('תקלה נוספה בהצלחה.', 'green');
}

/**
 * מרנדר את טבלת התקלות בטופס הוספה חדשה
 */
function renderFaultsTable(faults) {
    const container = document.getElementById('faults-list-container');
    if (!container) return;

    if (faults.length === 0) {
        container.innerHTML = `<p class="text-gray-500 mt-2">לא דווחו תקלות בגיחה זו.</p>`;
        return;
    }

    let html = `
        <h4 class="text-md font-semibold mb-2 mt-4">תקלות שדווחו:</h4>
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">סימולטור</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">תיאור תקלה</th>
                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">מחק</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
    `;

    faults.forEach((fault, index) => {
        html += `
            <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${fault.simulator}</td>
                <td class="px-6 py-4 text-sm text-gray-900">${fault.description}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-red-500">
                    <button data-fault-index="${index}" class="delete-fault-btn text-red-600 hover:text-red-900">
                        מחק
                    </button>
                </td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;
    container.innerHTML = html;
}

/**
 * ממלא את אפשרויות התקלה בהתאם לסימולטור שנבחר (מעודכן: תקלות פתוחות בלבד)
 * *** עדכון: מטפל בהצגת/הסתרת שדות בחירת הסימולטור ***
 */
function populateFaultOptions(simulatorId) {
    const faultSelect = document.getElementById('fault-select');
    const addFaultBtn = document.getElementById('add-fault-btn');
    const otherFaultGroup = document.getElementById('other-fault-group');
    const otherFaultInput = document.getElementById('other-fault-text');

    // *** חדש: רכיבי UX/UI לשליטה בתצוגה ***
    const simulatorDisplay = document.getElementById('simulator-display');
    const selectedSimulatorName = document.getElementById('selected-simulator-name');
    const simulatorSelectContainer = document.getElementById('simulator-select-container');
    const faultEntryArea = document.getElementById('fault-entry-area');
    const faultsContainer = document.getElementById('faults-list-container');


    if (!faultSelect || !addFaultBtn || !otherFaultGroup || !otherFaultInput || !simulatorDisplay || !simulatorSelectContainer || !faultEntryArea || !faultsContainer) return;


    if (simulatorId) {
        // 1. נבחר סימולטור: מציג את השם כטקסט קבוע, ומציג את שדות התקלה
        selectedSimulatorName.textContent = simulatorId;
        simulatorDisplay.classList.remove('hidden');
        simulatorSelectContainer.classList.add('hidden');
        faultEntryArea.classList.remove('hidden');
        // נרנדר את טבלת התקלות (או ההודעה "לא דווחו")
        renderFaultsTable(currentForm.faults);

    } else {
        // 2. לא נבחר סימולטור: מסתיר את שדות התקלה ומציג הודעה
        simulatorDisplay.classList.add('hidden');
        simulatorSelectContainer.classList.remove('hidden');
        faultEntryArea.classList.add('hidden');

        // איפוס שדות התקלה ונטרול כפתור ההוספה
        addFaultBtn.disabled = true;
        faultSelect.innerHTML = '<option value="" disabled selected>בחר תקלה...</option>';
        faultsContainer.innerHTML = `<p class="text-gray-500 mt-2">לא דווחו תקלות בגיחה זו.</p>`; // איפוס
        otherFaultGroup.classList.add('hidden');
        return;
    }


    // *** הקוד הקיים של מילוי אפשרויות התקלה (משתמש ב-openFaults) ***
    const openFaults = simulatorFaults[simulatorId] || [];

    // מפעיל את כפתור ההוספה
    addFaultBtn.disabled = false;
    faultSelect.innerHTML = ''; // מנקה את התוכן הקודם

    if (openFaults.length === 0) {
        // *** מצב 1: אין תקלות פתוחות ***
        faultSelect.disabled = true;
        faultSelect.innerHTML = `<option value="OTHER" selected>אין תקלות פתוחות למאמן זה. הוסף תקלה...</option>`;

        // מציג את תיבת הטקסט ישירות
        otherFaultGroup.classList.remove('hidden');
        if (otherFaultInput) otherFaultInput.focus();

    } else {
        // *** מצב 2: יש תקלות פתוחות ***
        faultSelect.disabled = false;
        faultSelect.innerHTML = '<option value="" disabled selected>בחר תקלה קיימת...</option>';

        openFaults.forEach(fault => {
            faultSelect.innerHTML += `<option value="${fault}">${fault}</option>`;
        });

        faultSelect.innerHTML += '<option value="OTHER">אחר</option>';

        // מסתיר את תיבת הטקסט בהתחלה
        otherFaultGroup.classList.add('hidden');
    }

    // מוודא שהערך של שדה "אחר" נקי
    otherFaultInput.value = '';
}

/**
 * מציג/מסתיר את שדה "אחר" (רלוונטי רק כשיש תקלות פתוחות)
 */
function toggleOtherFaultInput(selectElement) {
    const otherFaultGroup = document.getElementById('other-fault-group');
    const otherFaultInput = document.getElementById('other-fault-text');
    // קורא את הסימולטור מהטופס הראשי
    const simulatorId = document.getElementById('simulator-select')?.value;
    const hasOpenFaults = simulatorId && simulatorFaults[simulatorId]?.length > 0;

    if (!otherFaultGroup || !otherFaultInput) return;

    if (hasOpenFaults) {
        // אם יש תקלות פתוחות (מצב 2), אנחנו מציגים את התיבה רק אם נבחר "אחר"
        if (selectElement.value === 'OTHER') {
            otherFaultGroup.classList.remove('hidden');
            otherFaultInput.focus();
        } else {
            otherFaultGroup.classList.add('hidden');
            otherFaultInput.value = '';
        }
    } else {
        // אם אין תקלות פתוחות (מצב 1), התיבה תמיד מוצגת
        // אין צורך לעשות כלום, היא מוצגת מתוך populateFaultOptions
    }
}


// ******************************************************
// פונקציית שמירת גיחות (מעודכן: חישוב flightStartTimestamp מוקדם)
// ******************************************************
async function saveFlightForm() {
    // *** הגנה ***
    if (!window.currentUsername) return;

    saveCurrentStepData();
    clearFieldHighlight(); // מנקה סימון לפני הבדיקה

    // *** חדש: חישוב flightStartTimestamp לפני בדיקות התקלות/שמירה ***
    calculateFlightDuration();

    let allRequiredFilled = true;
    let fieldsToHighlight = [];

    // --- 1. בדיקת שדות חובה כלליים (כולל הסימולטור) ---
    const requiredGeneralInputs = [
        document.getElementById('flight-name'),
        document.getElementById('flight-date'),
        document.getElementById('start-time'),
        document.getElementById('end-time'),
        document.getElementById('simulator-select'), // הסימולטור חזר לכאן
        document.getElementById('instructor-name-1'), // מדריכה
        document.getElementById('pilot-right'), // טייס ימין
        document.getElementById('pilot-left') // טייס שמאל
    ].filter(input => input !== null);

    // בדיקת שדה "סוג גיחה" כחובה
    const flightTypeSelect = document.getElementById('flight-type-select');
    if (flightTypeSelect && flightTypeSelect.value.trim() === '') {
        allRequiredFilled = false;
        fieldsToHighlight.push(flightTypeSelect);
    }

    // *** בדיקת הסימולטור כחובה (שדה שחזר לנתונים הכלליים) ***
    const simulatorSelect = document.getElementById('simulator-select');
    if (simulatorSelect && simulatorSelect.value.trim() === '') {
        allRequiredFilled = false;
        fieldsToHighlight.push(simulatorSelect);
    }


    requiredGeneralInputs.forEach(input => {
        if (input && input.value.trim() === '') {
            allRequiredFilled = false;
            fieldsToHighlight.push(input);
        }
    });

    // *** בדיקת שעת התחלה (חשוב ל-flightStartTimestamp) ***
    if (!currentForm.flightStartTimestamp) {
        // שדה ה-date או ה-start-time ריקים וזה נבדק ב-calculateFlightDuration()
        allRequiredFilled = false;
        fieldsToHighlight.push(document.getElementById('flight-date'));
        fieldsToHighlight.push(document.getElementById('start-time'));
    }


    // --- 2. בדיקת פירוט יעדים (שדה חובה) ---
    const goalDetailInputs = document.querySelectorAll('[data-field-goal-detail]');
    goalDetailInputs.forEach(input => {
        if (input.value.trim() === '') {
            allRequiredFilled = false;
            fieldsToHighlight.push(input);
        }
    });


    if (!allRequiredFilled) {
        // סימון שדות ריקים
        fieldsToHighlight.forEach(input => {
            input.classList.add('border-red-500', 'ring-red-500', 'border-4');
            input.classList.remove('border-gray-300');
        });

        showToast('יש למלא את כל שדות החובה המסומנים.', 'red');
        return;
    }


    // --- 3. שמירה ל-FIREBASE ---
    if (typeof window.db === 'undefined' || typeof window.getServerTimestamp === 'undefined' || typeof window.firestoreFunctions === 'undefined') {
        showToast('שגיאה בשמירת הטופס (Firebase לא מאותחל).', 'red');
        return;
    }

    // שמירת סוג האימון כתבנית הגנרית
    currentForm.data['סוג'] = currentForm.trainingType; // GENERIC_FLIGHT
    currentForm.data['סוג גיחה'] = flightTypeSelect.value; // הנתון שנבחר ב-select

    // שמירת התאריך כמחרוזת
    const flightDateString = currentForm.data['תאריך'];
    currentForm.date = flightDateString;

    // חישוב שבוע/תקופה
    const tempDate = new Date(flightDateString);
    currentForm.week = getWeekNumber(tempDate);
    currentForm.period = getPeriodNumber(tempDate);

    // משיכת הפונקציות הגלובליות
    const { collection, addDoc } = window.firestoreFunctions;

    try {
        const dataToSave = {
            ...currentForm,
            // מנקים רשימות שנשארו ריקות אבל קיימות:
            crew: [],
            elements: [],
            flightTimes: [],
            // faults: [מוכנס אוטומטית מ-currentForm], (זה בסדר כי לא חובה להזין תקלה)
            timestamp: window.getServerTimestamp()
        };

        const flightsCollection = collection(window.db, "flights");
        await addDoc(flightsCollection, dataToSave);

        showToast('הגיחה נשמרה בהצלחה לפתקית המשותפת!', 'green');

        await fetchFlights();
        showScreen('flight-form-screen'); // חזרה למסך הראשי
    } catch (error) {
        console.error('שגיאה בשמירה ל-Firebase:', error);
        showToast('שגיאה בשמירת הטופס. בדוק את הקונסולה לפרטים.', 'red');
    }
}

function toggleGoalStatus(event) {
    const button = event.target;
    const goal = button.dataset.goal;
    const newStatus = button.dataset.status === 'met' ? 'not-met' : 'met';
    const newText = newStatus === 'met' ? 'עמד.ה' : 'לא עמד.ה';

    // הגדרת מחרוזות הקלאסים
    const metColorString = 'bg-green-100 text-green-700';
    const notMetColorString = 'bg-red-100 text-red-700';

    // יצירת מערכי קלאסים לפיצול
    const metClasses = metColorString.split(' ');
    const notMetClasses = notMetColorString.split(' ');

    button.dataset.status = newStatus;
    button.textContent = newText;

    // *** תיקון: הסרת כל הקלאסים האפשריים באמצעות פיצול ושחזור ***
    // מנקה את כל הקלאסים הקודמים (500 ו-100)
    button.classList.remove('bg-green-500', 'bg-red-500', ...metClasses, ...notMetClasses);

    // מוסיף את העיצוב החדש
    button.classList.add(...(newStatus === 'met' ? metClasses : notMetClasses));

    currentForm.goalsStatus[goal] = newText;
}

function confirmGoHome() {
    // *** הגנה ***
    if (!window.currentUsername) return;

    const alertModal = document.getElementById('alert-modal');
    const alertTitle = document.getElementById('alert-title');
    const alertMessage = document.getElementById('alert-message');
    const confirmButton = document.getElementById('alert-confirm-button');

    if (!alertModal || !alertTitle || !alertMessage || !confirmButton) return;

    alertTitle.textContent = 'אזהרה';
    alertMessage.textContent = 'הפעולה עלולה להוביל לאובדן הנתונים. האם להשלים את הפעולה?';

    // ודא שכפתור האישור מוגדר בחזרה לפונקציה הרגילה
    confirmButton.textContent = 'המשך';
    confirmButton.classList.remove('bg-red-700', 'hover:bg-red-800');
    confirmButton.classList.add('bg-red-500', 'hover:bg-red-600');
    confirmButton.onclick = goHomeConfirmed;

    alertModal.classList.remove('hidden');
}

function goHomeConfirmed() {
    // *** הגנה ***
    if (!window.currentUsername) return;
    hideAlert();
    showScreen('flight-form-screen');
}

function hideAlert() {
    const alertModal = document.getElementById('alert-modal');
    if (alertModal) {
        alertModal.classList.add('hidden');
    }
}

function hideAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.classList.add('hidden');
    });
}

function showToast(message, type) {
    const toast = document.getElementById('toast-notification');
    if (!toast) return;

    toast.textContent = message;
    // מנקה את כל הקלאסים הקודמים
    toast.classList.remove('bg-green-500', 'bg-red-500', 'hidden', 'bg-yellow-500');

    let colorClass;
    if (type === 'green') {
        colorClass = 'bg-green-500';
    } else if (type === 'red') {
        colorClass = 'bg-red-500';
    } else {
        colorClass = 'bg-yellow-500'; // לשימוש בהודעות אזהרה אחרות
    }

    toast.classList.add(colorClass);
    toast.classList.remove('hidden');
    // מציג הודעות רגילות למשך 3 שניות
    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3000);
}

function renderFlightTable() {
    // *** הגנה ***
    if (!window.currentUsername) return;

    // בודק איזה מסך מוצג כדי לקבוע היכן להציג את הטבלה
    const isDashboardScreen = currentScreen === 'mission-database-screen';
    const tableBody = document.getElementById(isDashboardScreen ? 'flight-table-body-db' : 'flight-table-body');

    // אם אין טבלה לבנייה, יוצאים
    if (!tableBody) return;

    // קביעת מסננים
    const missionDatabaseScreen = document.getElementById('mission-database-screen');
    const periodSelect = missionDatabaseScreen ? missionDatabaseScreen.querySelector('#period-select') : null;
    const weekSelect = missionDatabaseScreen ? missionDatabaseScreen.querySelector('#week-select') : null;

    const periodFilter = periodSelect ? periodSelect.value : '';
    const weekFilter = weekSelect ? weekSelect.value : '';

    const nowTimestamp = Date.now();
    const oneWeekInMs = 7 * 24 * 60 * 60 * 1000;
    const oneWeekAgo = nowTimestamp - oneWeekInMs;

    tableBody.innerHTML = '';

    const filteredFlights = savedFlights.filter(flight => {
        if (!(flight.date instanceof Date) || isNaN(flight.date.getTime())) {
            return false;
        }

        const flightDateTimestamp = flight.date.getTime();

        if (!isDashboardScreen) {
            // "טופס גיחה" - הצגת שבוע אחרון בלבד
            return flightDateTimestamp >= oneWeekAgo;
        } else {
            // "מאגר גיחות" - סינון מלא

            const flightYear = flight.date.getFullYear();
            const flightYearShort = String(flightYear).slice(-2);

            // יצירת פורמט התקופה: 1/25
            const flightPeriodFormat = getPeriodNumber(flight.date) + '/' + flightYearShort;
            const matchesPeriod = !periodFilter || flightPeriodFormat === periodFilter;

            // סינון שבוע
            const flightWeek = getWeekNumber(flight.date);
            const matchesWeek = !weekFilter || flightWeek === parseInt(weekFilter);

            return matchesPeriod && matchesWeek;
        }
    });

    filteredFlights.sort((a, b) => {
        return b.date - a.date;
    });

    if (filteredFlights.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-gray-500">אין גיחות להצגה.</td></tr>`;
        return;
    }

    filteredFlights.forEach((flight, index) => {
        const row = document.createElement('tr');
        // *** שינוי: שימוש ב-hover:bg-ofer-primary-50 ***
        row.className = (index % 2 === 0 ? 'bg-white' : 'bg-gray-50') + ' cursor-pointer hover:bg-ofer-primary-50 transition duration-150';
        row.setAttribute('data-flight-id', flight.id);

        const flightData = flight.data || {};

        const flightName = flightData['שם גיחה'] || '---';
        const flightType = flightData['סוג גיחה'] || flight.trainingType || '---';
        const flightGrounding = flight.flightGrounding || '---';

        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">${flightData['שעת סיום'] || '---'}</td>
            <td class="px-6 py-4 whitespace-nowrap">${flightData['שעת התחלה'] || '---'}</td>
            <td class="px-6 py-4 whitespace-nowrap">${flightGrounding}</td>
            <td class="px-6 py-4 whitespace-nowrap">${flightName}</td>
            <td class="px-6 py-4 whitespace-nowrap">${flightType}</td>
            <td class="px-6 py-4 whitespace-nowrap">${new Date(flight.date).toLocaleDateString('he-IL')}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${savedFlights.length - index}</td>
        `;
        tableBody.appendChild(row);
    });
}

// ...
/**
 * *** חדש: מרנדר את טבלת מאגר התקלות מכלל הגיחות ***
 */
function renderFaultDatabaseTable() {
    // *** הגנה ***
    if (!window.currentUsername) return;

    const tableBody = document.getElementById('fault-database-body');
    const screen = document.getElementById('fault-database-screen');
    if (!tableBody || !screen) return;

    // ולידציה שוב של הנתונים כדי לוודא עדכניות
    processFaultsData();

    // --- סינון ---
    const simulatorFilter = screen.querySelector('#fault-simulator-filter')?.value || 'ALL';
    const statusFilter = screen.querySelector('#fault-status-filter')?.value || 'ALL';

    let filteredFaults = Object.keys(unifiedFaultsDatabase).map(key => unifiedFaultsDatabase[key]);

    if (simulatorFilter !== 'ALL') {
        filteredFaults = filteredFaults.filter(f => f.simulator === simulatorFilter);
    }

    if (statusFilter !== 'ALL') {
        const isResolved = statusFilter === 'RESOLVED';
        filteredFaults = filteredFaults.filter(f => f.status.isResolved === isResolved);
    }
    // -------------

    // מיון לפי זמן הדיווח האחרון (החדש ביותר למעלה)
    filteredFaults.sort((a, b) => b.lastReportTimestamp - a.lastReportTimestamp);

    if (filteredFaults.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-500">לא נמצאו תקלות תואמות לסינון.</td></tr>`;
        return;
    }

    tableBody.innerHTML = '';

    // רינדור השורות
    filteredFaults.forEach(fault => {
        const statusText = fault.status.isResolved ? 'טופלה' : 'פתוחה';
        const statusClass = fault.status.isResolved ? 'text-green-600 font-bold' : 'text-red-600';

        const firstReportDate = new Date(fault.firstReportTimestamp).toLocaleDateString('he-IL');

        const row = document.createElement('tr');
        // *** שינוי: שימוש ב-hover:bg-ofer-primary-50 ***
        row.className = 'bg-white border-b cursor-pointer hover:bg-ofer-primary-50';
        // נשתמש ב-dataset כדי להעביר את המפתח הייחודי לפתיחת המודל החדש
        row.setAttribute('data-fault-key', fault.key);

        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${fault.simulator}</td>
            <td class="px-6 py-4 text-sm text-gray-900">${fault.description}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${firstReportDate}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${statusClass}">${statusText}</td>
        `;
        tableBody.appendChild(row);
    });
}

function getWeekNumber(d) {
    const date = new Date(d.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function getPeriodNumber(d) {
    const month = d.getMonth();
    return month >= 0 && month <= 5 ? 1 : 2;
}

// ************************************************************
// לוגיקת צפייה ועריכה ב-Modal החדש
// ************************************************************
async function showFlightDetailsModal(flightId) {
    // *** הגנה ***
    if (!window.currentUsername) return;

    hideAllModals();
    const flight = savedFlights.find(f => f.id === flightId);
    if (!flight) {
        showToast('שגיאה: פרטי הגיחה לא נמצאו.', 'red');
        return;
    }

    currentViewFlight = flight; // שמירת הגיחה הנוכחית גלובלית
    const modal = document.getElementById('flight-details-modal');
    const content = document.getElementById('flight-details-content');
    const title = document.getElementById('details-modal-title');

    if (!modal || !content || !title) return; // יציאה אם האלמנטים לא נמצאו

    title.textContent = `פרטי גיחה: ${flight.data['שם גיחה'] || flight.data['סוג גיחה']}`;
    content.innerHTML = ''; // ניקוי תוכן קודם

    // 1. נתונים כלליים ויעדים (מהשדות הקיימים ב-HTML)
    let generalHtml = '<h3 class="text-xl font-bold border-b pb-1 mb-2">נתונים כלליים</h3>';

    // *** תיקון: עדכון מיפוי השדות הכלליים כך שיכלול את כל שדות הקלט הנדרשים בטופס ***
    const generalFieldsMap = [
        { label: 'שם גיחה', key: 'שם גיחה' },
        { label: 'סוג גיחה', key: 'סוג גיחה' },
        { label: 'סימולטור', key: 'סימולטור' },
        { label: 'תאריך', key: 'תאריך' },
        { label: 'שעת התחלה', key: 'שעת התחלה' },
        { label: 'שעת סיום', key: 'שעת סיום' },
        { label: 'שעות טיסה (דקות)', key: 'שעות טיסה (דקות)' },
        { label: 'מדריכה', key: 'מדריכה' },
        { label: 'מדריכה נוספת', key: 'מדריכה נוספת' },
        { label: 'מתצפת', key: 'מתצפת' },
        { label: 'טייס ימין', key: 'טייס ימין' },
        { label: 'טייס שמאל', key: 'טייס שמאל' },
    ];

    generalHtml += `<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">`;

    generalFieldsMap.forEach(field => {
        // טפלו בתאריך במיוחד כדי לוודא שפורמט ה-input date נשמר (YYYY-MM-DD)
        let value = flight.data[field.key] || '---';
        if (field.key === 'תאריך' && flight.date) {
            value = new Date(flight.date).toISOString().split('T')[0];
        } else if (field.key !== 'שעות טיסה (דקות)' && value === '---') {
            // אם זה שדה חובה שהיה ריק, יציג מחרוזת ריקה לצורך עריכה
            value = '';
        }

        const isDuration = field.key === 'שעות טיסה (דקות)';
        const type = (field.key === 'תאריך') ? 'date' : (field.key.startsWith('שעת') ? 'time' : 'text');

        // נשתמש ב-input type text גנרי למרבית השדות
        generalHtml += `
            <div class="flex flex-col ${isDuration ? 'opacity-60' : ''}">
                <label class="block text-sm font-medium text-gray-700"><strong>${field.label}:</strong></label>
                <input type="${type}" data-edit-field="${field.key}" value="${value}" ${isDuration ? 'readonly disabled' : 'readonly'} 
                       class="mt-1 block w-full rounded-md border border-gray-300 shadow-sm ${isDuration ? 'bg-gray-100 cursor-not-allowed' : 'bg-gray-50'} p-2 text-sm transition-all">
            </div>
        `;
    });

    generalHtml += `</div>`;

    // שדות טקסט גדולים (לקחי מתאמן)
    generalHtml += `
        <div class="mt-4">
            <label class="block text-sm font-medium text-gray-700"><strong>לקחי מתאמן - ימין:</strong></label>
            <textarea data-edit-field="לקחי מתאמן - ימין" rows="2" readonly 
                      class="mt-1 block w-full rounded-md border border-gray-300 shadow-sm bg-gray-50 p-2 text-sm transition-all">${flight.data['לקחי מתאמן - ימין'] || ''}</textarea>
        </div>
        <div class="mt-2">
            <label class="block text-sm font-medium text-gray-700"><strong>לקחי מתאמן - שמאל:</strong></label>
            <textarea data-edit-field="לקחי מתאמן - שמאל" rows="2" readonly 
                      class="mt-1 block w-full rounded-md border border-gray-300 shadow-sm bg-gray-50 p-2 text-sm transition-all">${flight.data['לקחי מתאמן - שמאל'] || ''}</textarea>
        </div>
        <hr class="mt-4">
    `;


    // 2. יעדים
    let goalsHtml = '<h3 class="text-xl font-bold border-b pb-1 mb-2 mt-4">יעדי אימון</h3>';
    const goals = trainingTemplates['GENERIC_FLIGHT'].goals;

    goals.forEach(goal => {
        const detail = flight.goalsDetails[goal] || '';
        const status = flight.goalsStatus[goal] || 'לא דווח';
        const isMet = status === 'עמד.ה'; // לוגיקה לבחירת צבע וטקסט

        goalsHtml += `
            <div class="flex items-start mb-2 border-b py-2">
                <div class="w-1/4" data-goal-status-container="${goal}">
                    <span class="block font-medium text-gray-700">${goal}:</span>
                    <button data-edit-goal-status="${goal}" data-current-status="${status}" disabled
                        class="goal-status-edit-btn text-sm font-semibold py-1 px-2 rounded mt-1 transition-colors duration-200 ${isMet ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                        ${status}
                    </button>
                </div>
                <div class="flex-grow p-1 text-sm text-gray-600">
                    <label class="block text-sm font-medium text-gray-700">פירוט (חובה):</label>
                    <textarea data-edit-field="פירוט - ${goal}" rows="2" readonly 
                              class="mt-1 block w-full rounded-md border border-gray-300 shadow-sm bg-gray-50 p-2 text-sm transition-all">${detail}</textarea>
                </div>
            </div>
        `;
    });


    // 3. תקלות (הצגת התקלות שנשמרו)
    let faultsHtml = '';
    const flightSimulator = flight.data['סימולטור'] || 'לא נבחר';

    faultsHtml += `
        <h3 class="text-xl font-bold border-b pb-1 mb-2 mt-4">תקלות שדווחו</h3>
        <p class="text-lg font-semibold text-gray-800 mb-2">סימולטור שנבחר: <span class="text-ofer-orange">${flightSimulator}</span></p>
    `;

    if (flight.faults && flight.faults.length > 0) {
        faultsHtml += `
            <div class="bg-white rounded-lg shadow-sm overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">סימולטור</th>
                            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">תיאור תקלה</th>
                            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">סטטוס</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
        `;
        flight.faults.forEach(fault => {
            // חיפוש מחזור חיים מדויק באמצעות מפתח שמשלב את ה-timestamp
            const baseKey = `${fault.simulator}|${fault.description}`;
            let statusCell = `<span class="text-gray-500">סטטוס לא ידוע</span>`;

            // חיפוש מחזור החיים הרלוונטי (באמצעות בולת הזמן של הדיווח בגיחה זו)
            // נחפש לפי המפתח המדויק
            const cycleKey = Object.keys(unifiedFaultsDatabase).find(key =>
                unifiedFaultsDatabase[key].baseKey === baseKey &&
                unifiedFaultsDatabase[key].firstReportTimestamp === fault.timestamp
            );

            if (cycleKey) {
                const resolvedStatus = unifiedFaultsDatabase[cycleKey].status;
                const isResolved = resolvedStatus && resolvedStatus.isResolved;

                statusCell = isResolved
                    ? `<span class="text-green-600 font-bold">טופלה (${resolvedStatus.date})</span>`
                    : `<span class="text-red-600">פתוחה</span>`;
            } else {
                // גיבוי למקרה בו המחזור נסגר אחרי כן, אבל הדיווח נכנס למחזור חיים קודם.
                // (הדבר אמור להיות מטופל ב-processFaultsData, אך נשאיר את החיפוש המדויק)
            }

            faultsHtml += `
                <tr>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${fault.simulator}</td>
                    <td class="px-6 py-4 text-sm text-gray-900">${fault.description}</td>
                    <td class="px-6 py-4 text-sm">${statusCell}</td>
                </tr>
            `;
        });
        faultsHtml += `
                    </tbody>
                </table>
            </div>
        `;
    } else {
        faultsHtml += `<p class="text-gray-500 mt-2">לא דווחו תקלות בגיחה זו.</p>`;
    }


    // *** שמירה על עקביות: יעדים ואז תקלות גם במודל הפרטים ***
    content.innerHTML = generalHtml + goalsHtml + faultsHtml;

    // הצגת המודל במצב קריאה בלבד
    disableEditMode();
    modal.classList.remove('hidden');
}

/**
 * מציג מודל פירוט תקלה מאוחדת ומאפשר לסמן כטופלה
 */
async function showFaultDetailsModal(faultKey) {
    // *** הגנה ***
    if (!window.currentUsername) return;

    hideAllModals();
    const fault = unifiedFaultsDatabase[faultKey];
    if (!fault) {
        showToast('שגיאה: פרטי התקלה לא נמצאו.', 'red');
        return;
    }

    const modal = document.getElementById('fault-resolution-modal');
    const title = document.getElementById('fault-resolution-modal-title');
    const content = document.getElementById('fault-resolution-content');

    if (!modal || !title || !content) return;

    title.textContent = `ניהול תקלה: ${fault.description}`;

    const firstReportDate = new Date(fault.firstReportTimestamp);
    const resolved = fault.status.isResolved;

    const resolutionDate = fault.status.date || new Date().toISOString().split('T')[0];
    const resolutionTime = fault.status.time || new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

    content.innerHTML = `
        <div class="space-y-4">
            <h4 class="text-lg font-bold">סיכום דיווחים</h4>
            <div class="grid grid-cols-2 gap-4 text-sm">
                <div><strong>מאמן:</strong> ${fault.simulator}</div>
                <div><strong>דווח בגיחות:</strong> ${fault.reportCount}</div>
                <div><strong>שעת פתיחה (ראשון):</strong> ${firstReportDate.toLocaleTimeString('he-IL')}</div>
                <div><strong>תאריך פתיחה (ראשון):</strong> ${firstReportDate.toLocaleDateString('he-IL')}</div>
            </div>
            
            <hr>

            <h4 class="text-lg font-bold ${resolved ? 'text-green-600' : 'text-red-600'}">
                סטטוס: ${resolved ? 'טופלה' : 'פתוחה'}
            </h4>

            <div id="resolution-controls" class="space-y-3 p-4 border rounded-lg ${resolved ? 'bg-green-50' : 'bg-gray-50'}">
                
                ${resolved ? `
                    <div class="text-sm">
                        <p><strong>טופלה בתאריך:</strong> ${fault.status.date} בשעה: ${fault.status.time}</p>
                    </div>
                ` : `
                    <p class="text-sm font-semibold">סמן/י כטופלה:</p>
                    <input type="date" id="resolution-date" value="${resolutionDate}" required 
                        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2">
                    <input type="time" id="resolution-time" value="${resolutionTime}" required 
                        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm p-2">
                    <button id="mark-resolved-btn" data-fault-key="${faultKey}"
                        class="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-2 rounded-lg mt-2">
                        סמן כטופלה
                    </button>
                `}
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
}


/**
 * שומר את סטטוס הטיפול בתקלה (מעודכן לשמירה ב-Firebase)
 */
async function saveFaultResolutionStatus(faultKey) {
    // *** הגנה ***
    if (!window.currentUsername) return;

    const resolutionDateInput = document.getElementById('resolution-date');
    const resolutionTimeInput = document.getElementById('resolution-time');

    if (!resolutionDateInput || !resolutionTimeInput) return;

    const resolutionDate = resolutionDateInput.value;
    const resolutionTime = resolutionTimeInput.value;

    if (!resolutionDate || !resolutionTime) {
        showToast('חובה להזין תאריך ושעת טיפול.', 'red');
        return;
    }

    if (typeof window.db === 'undefined' || typeof window.firestoreFunctions === 'undefined') {
        showToast('שגיאה: Firebase לא מאותחל.', 'red');
        return;
    }

    const { doc, setDoc } = window.firestoreFunctions;

    try {
        // *** שינוי קריטי: שימוש ב-getServerTimestamp() במקום Date.now() ***
        const resolutionTimestamp = window.getServerTimestamp();
        const resolutionRef = doc(window.db, "fault_resolutions", faultKey);

        const statusData = {
            faultKey: faultKey,
            date: resolutionDate,
            time: resolutionTime,
            timestamp: resolutionTimestamp, // זה נשמר כאובייקט Timestamp תקין
        };

        await setDoc(resolutionRef, statusData);

        // כעת, כאשר resolutionTimestamp הוא אובייקט Timestamp, אנחנו צריכים להמיר אותו
        // למילישניות כדי לשמור ב-faultResolutionStatus (או להשתמש ב-Date.now() לצורך עדכון מקומי מהיר)
        let localResolutionTs;
        if (typeof resolutionTimestamp.toMillis === 'function') {
            localResolutionTs = resolutionTimestamp.toMillis();
        } else {
            // אם הוא כבר מספר (למשל, כאשר getServerTimestamp() לא סיים עדיין), נשתמש בזמן הנוכחי
            localResolutionTs = Date.now();
        }

        // עדכון המשתנה הגלובלי המקומי (faultResolutionStatus)
        faultResolutionStatus[faultKey] = {
            isResolved: true,
            date: resolutionDate,
            time: resolutionTime,
            resolutionTimestamp: localResolutionTs
        };

        // ודא שגם המאגר המאוחד מתעדכן
        if (unifiedFaultsDatabase[faultKey]) {
            unifiedFaultsDatabase[faultKey].status = faultResolutionStatus[faultKey];
        }

        showToast('התקלה סומנה כטופלה בהצלחה ושונתה במחשבים אחרים!', 'green');
        hideAllModals();

        // טעינה מחדש של הגיחות כדי לעדכן את רשימת התקלות הפתוחות לטופס
        fetchFlights().then(() => {
            renderFaultDatabaseTable(); // מרנדר מחדש את טבלת מאגר התקלות
        });

    } catch (error) {
        console.error('שגיאה בשמירת סטטוס הטיפול ב-Firebase:', error);
        showToast('שגיאה בשמירת סטטוס הטיפול.', 'red');
    }
}


function toggleGoalStatusInModal(button) {
    const goal = button.dataset.editGoalStatus;
    const currentStatus = button.dataset.currentStatus;
    const newStatus = currentStatus === 'עמד.ה' ? 'לא עמד.ה' : 'עמד.ה';
    const isMet = newStatus === 'עמד.ה';

    const metClasses = ['bg-green-100', 'text-green-700'];
    const notMetClasses = ['bg-red-100', 'text-red-700'];

    button.dataset.currentStatus = newStatus;
    button.textContent = newStatus;

    // הסרת כל הקלאסים
    button.classList.remove(...metClasses, ...notMetClasses);

    // הוספת הקלאסים הנכונים
    button.classList.add(...(isMet ? metClasses : notMetClasses));
}


function enableEditMode() {
    // *** הגנה ***
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
            input.classList.remove('bg-gray-50');
            // *** השינוי כאן: שימוש ב-ofer-primary-500 ל-focus/border (כתום) ***
            input.classList.add('bg-white', 'border-ofer-primary-500', 'ring-1', 'ring-ofer-primary-500');

            // הסרת ה-disabled וה-bg-gray-100 משדות שצריכים להיות עריכים
            if (input.dataset.editField !== 'שעות טיסה (דקות)') {
                input.removeAttribute('disabled');
                input.classList.remove('bg-gray-100', 'cursor-not-allowed');
            }
        }
    });

    // *** הפעלת כפתורי סטטוס יעד ***
    document.querySelectorAll('.goal-status-edit-btn').forEach(btn => {
        btn.removeAttribute('disabled');
        btn.classList.add('cursor-pointer', 'hover:opacity-80');
    });

    showToast('מצב עריכה הופעל.', 'yellow');
}

function disableEditMode() {
    const content = document.getElementById('flight-details-content');
    const detailsActions = document.getElementById('details-modal-actions');
    const editActions = document.getElementById('details-edit-actions');

    if (!content || !detailsActions || !editActions) return;

    detailsActions.classList.remove('hidden');
    editActions.classList.add('hidden');

    const allEditableFields = content.querySelectorAll('[data-edit-field]');

    allEditableFields.forEach(input => {
        input.setAttribute('readonly', true);
        input.classList.add('bg-gray-50');
        // *** השינוי כאן: הסרת קלאסי ה-ofer-primary-500 ***
        input.classList.remove('bg-white', 'border-ofer-primary-500', 'ring-1', 'ring-ofer-primary-500');
        input.classList.remove('border-red-500', 'ring-red-500', 'border-4'); // מנקה סימוני ולידציה אדומים

        // *** נטרול שעות טיסה (דקות) שוב ***
        if (input.dataset.editField === 'שעות טיסה (דקות)') {
            input.setAttribute('disabled', true);
            input.classList.add('bg-gray-100', 'cursor-not-allowed');
        } else {
            input.removeAttribute('disabled'); // נניח ששאר השדות לא צריכים להיות מנוטרלים
        }
    });

    // *** נטרול כפתורי סטטוס יעד ***
    document.querySelectorAll('.goal-status-edit-btn').forEach(btn => {
        btn.setAttribute('disabled', true);
        btn.classList.remove('cursor-pointer', 'hover:opacity-80');
    });

    // *** שחזור נתונים מקומי ***
    if (currentViewFlight) {
        allEditableFields.forEach(input => {
            const key = input.dataset.editField;
            let originalValue;

            if (key.startsWith('פירוט - ')) {
                // שחזור פירוט יעדים
                const goalName = key.replace('פירוט - ', '');
                originalValue = currentViewFlight.goalsDetails[goalName] || '';
            } else {
                // שחזור שדות נתונים כלליים
                originalValue = currentViewFlight.data[key] || '';

                // טיפול בתאריך: יצירת פורמט תאריך נכון
                if (key === 'תאריך' && currentViewFlight.date) {
                    originalValue = new Date(currentViewFlight.date).toISOString().split('T')[0];
                }
            }

            // עדכון ערך השדה (לקחנו בחשבון שזה יכול להיות input או textarea)
            input.value = originalValue;
        });

        // *** שחזור סטטוס היעדים המקורי ***
        document.querySelectorAll('.goal-status-edit-btn').forEach(button => {
            const goal = button.dataset.editGoalStatus;
            const originalStatus = currentViewFlight.goalsStatus[goal] || 'לא דווח';
            const isMet = originalStatus === 'עמד.ה';

            button.dataset.currentStatus = originalStatus;
            button.textContent = originalStatus;
            button.classList.remove('bg-green-100', 'text-green-700', 'bg-red-100', 'text-red-700');
            button.classList.add(isMet ? 'bg-green-100' : 'bg-red-100', isMet ? 'text-green-700' : 'text-red-700');
        });
    }
}

async function saveEditedFlight() {
    // *** הגנה ***
    if (!window.currentUsername) return;

    // הלוגיקה המעודכנת לעריכה ושמירה
    if (!currentViewFlight) return;

    const dataToUpdate = { ...currentViewFlight.data };
    const goalsToUpdate = { ...currentViewFlight.goalsDetails };
    const goalsStatusToUpdate = { ...currentViewFlight.goalsStatus }; // *** אובייקט לסטטוס ***
    let allRequiredFilled = true;

    // 1. איסוף נתונים כלליים ופירוט יעדים
    document.querySelectorAll('#flight-details-content [data-edit-field]').forEach(input => {
        const key = input.dataset.editField;
        // שימוש ב-value במקום ב-innerHTML או textContent
        const value = input.value;

        // הסרת סימון אדום לפני בדיקות ולידציה
        input.classList.remove('border-red-500', 'ring-red-500', 'border-4');
        input.classList.add('border-gray-300');


        // טיפול בפירוט יעדים והפרדתם מה-data הכללי
        if (key.startsWith('פירוט - ')) {
            const goalName = key.replace('פירוט - ', '');
            goalsToUpdate[goalName] = value;

            // וולידציה לפירוט יעדים (חובה)
            if (value.trim() === '') {
                allRequiredFilled = false;
                input.classList.add('border-red-500', 'ring-red-500', 'border-4');
                input.classList.remove('border-gray-300');
            }
        } else {
            // שמירת שדות נתונים כלליים
            dataToUpdate[key] = value;
        }

        // וולידציה לשדות חובה גנריים
        const requiredKeys = ['שם גיחה', 'סוג גיחה', 'תאריך', 'שעת התחלה', 'שעת סיום', 'מדריכה', 'סימולטור', 'טייס ימין', 'טייס שמאל'];
        if (requiredKeys.includes(key) && (value.trim() === '' || value.trim() === '---')) {
            allRequiredFilled = false;
            // סימון שדה חובה שנערך וריק
            if (!key.startsWith('פירוט - ')) { // פירוט מטופל למעלה
                input.classList.add('border-red-500', 'ring-red-500', 'border-4');
                input.classList.remove('border-gray-300');
            }
        }
    });

    // *** איסוף סטטוס היעדים המעודכן ***
    document.querySelectorAll('.goal-status-edit-btn').forEach(button => {
        const goal = button.dataset.editGoalStatus;
        goalsStatusToUpdate[goal] = button.dataset.currentStatus;
    });

    if (!allRequiredFilled) {
        showToast('יש למלא את כל שדות החובה כולל פירוט היעדים.', 'red');
        return;
    }


    if (typeof window.db === 'undefined' || typeof window.firestoreFunctions === 'undefined') {
        showToast('שגיאה: Firebase לא מאותחל.', 'red');
        return;
    }

    const { doc, updateDoc } = window.firestoreFunctions;

    try {
        const flightRef = doc(window.db, "flights", currentViewFlight.id);

        // חישוב מחדש של ה-flightStartTimestamp אם התאריך/שעה השתנה
        const flightDateString = dataToUpdate['תאריך'];
        const startTimeStr = dataToUpdate['שעת התחלה'];
        // מוודא שהערכים קיימים לפני החישוב
        let flightStartTimestamp = currentViewFlight.flightStartTimestamp; // ברירת מחדל: הערך הישן
        if (flightDateString && startTimeStr) {
            const isoDateTimeStr = `${flightDateString}T${startTimeStr}:00`;
            flightStartTimestamp = new Date(isoDateTimeStr).getTime();
        }

        // יש לחשב את שעות הטיסה מחדש אם הנתונים השתנו
        const start = dataToUpdate['שעת התחלה'];
        const end = dataToUpdate['שעת סיום'];
        let durationMinutes = currentViewFlight.data['שעות טיסה (דקות)']; // שומר על הערך המקורי כברירת מחדל

        if (start && end) {
            const [startHour, startMinute] = start.split(':').map(Number);
            const [endHour, endMinute] = end.split(':').map(Number);

            const totalStartMinutes = startHour * 60 + startMinute;
            let totalEndMinutes = endHour * 60 + endMinute;

            if (totalEndMinutes < totalStartMinutes) {
                totalEndMinutes += 24 * 60;
            }

            durationMinutes = totalEndMinutes - totalStartMinutes;
            dataToUpdate['שעות טיסה (דקות)'] = durationMinutes; // עדכון הנתון לשמירה
        }


        await updateDoc(flightRef, {
            data: dataToUpdate,
            goalsDetails: goalsToUpdate,
            goalsStatus: goalsStatusToUpdate, // *** שמירת הסטטוס המעודכן ***
            flightStartTimestamp: flightStartTimestamp, // *** עדכון השדה ***
            // faults: [שמירת התקלות אינה אפשרית כרגע במודל העריכה] - משאיר את הנתון הישן
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

function initializeEventListeners() {
    // *** המאזינים להתחברות/התנתקות הועברו ל-auth.js ***

    document.querySelectorAll('#sidebar button[data-screen-id]').forEach(button => {
        button.addEventListener('click', (event) => {
            const screenId = event.target.getAttribute('data-screen-id');
            showScreen(screenId);
        });
    });

    // *** יצירת טופס לפי מצב הגיחה שנבחר ***
    document.querySelectorAll('.flight-status-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            const flightStatus = event.target.getAttribute('data-flight-status');
            showFormStep2(flightStatus); // מעביר את מצב הגיחה
        });
    });

    // *** שינוי: המאזין של כפתור השמירה החדש בשלב 2 ***
    const saveButtonStep2 = document.getElementById('save-form-button-step-2');
    if (saveButtonStep2) {
        saveButtonStep2.addEventListener('click', saveFlightForm);
    }

    // *** תיקון: עוטף את confirmGoHome בפונקציה אנונימית כדי להבטיח נגישות ***
    document.querySelectorAll('button[data-action="confirm-go-home"]').forEach(button => {
        button.addEventListener('click', () => {
            confirmGoHome();
        });
    });

    // *** תיקונים קריטיים לשגיאות ה-null (כולל goHomeConfirmed) ***
    const confirmButton = document.getElementById('alert-confirm-button');
    const cancelButton = document.getElementById('alert-cancel-button');
    if (confirmButton) {
        // *** תיקון: עוטף את goHomeConfirmed בפונקציה אנונימית ***
        confirmButton.addEventListener('click', () => {
            goHomeConfirmed();
        });
    }
    if (cancelButton) {
        cancelButton.addEventListener('click', hideAlert);
    }

    // *** הוספת מאזין לכפתור מחיקת הכל - הפתרון לשגיאה המקורית ***
    const deleteAllBtn = document.getElementById('delete-all-flights-btn');
    if (deleteAllBtn) {
        // *** תיקון: עוטף את confirmDeleteAll בפונקציה אנונימית ***
        deleteAllBtn.addEventListener('click', () => {
            // לוגיקת אישור המחיקה נמצאת בפונקציה אחרת שאינה מובאת כאן
            // נניח שזו הדרך הנכונה לקרוא לה
            if (window.confirm('האם אתה בטוח שברצונך למחוק את כל הגיחות? פעולה זו בלתי הפיכה!')) {
                deleteAllFlights();
            }
        });
    }


    // *** מאזינים למסך מאגר גיחות/תקלות ***
    const missionDatabaseScreen = document.getElementById('mission-database-screen');
    if (missionDatabaseScreen) {
        missionDatabaseScreen.addEventListener('change', (e) => {
            const target = e.target;
            const periodSelect = missionDatabaseScreen.querySelector('#period-select');
            const weekSelect = missionDatabaseScreen.querySelector('#week-select');

            if (target.id === 'period-select' && periodSelect && weekSelect) {
                populateWeekOptions(periodSelect, weekSelect);
                renderFlightTable();
            } else if (target.id === 'week-select') {
                renderFlightTable();
            }
        });
    }

    // *** מאזינים למסך מאגר תקלות (סינון וצפייה) ***
    const faultDatabaseScreen = document.getElementById('fault-database-screen');
    if (faultDatabaseScreen) {
        // מאזין לשינוי הסינון
        faultDatabaseScreen.addEventListener('change', (e) => {
            if (e.target.id === 'fault-simulator-filter' || e.target.id === 'fault-status-filter') {
                renderFaultDatabaseTable();
            }
        });

        // מאזין ללחיצה על שורת התקלה בטבלה
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


    // Delegating all click events and change events on form-step-2
    const formStep2 = document.getElementById('form-step-2');
    if (formStep2) {
        formStep2.addEventListener('click', (e) => {
            const target = e.target;
            if (target.classList.contains('goal-button')) {
                toggleGoalStatus(e);
            }

            // *** מאזין למחיקת תקלה ***
            const deleteBtn = target.closest('.delete-fault-btn');
            if (deleteBtn) {
                const index = parseInt(deleteBtn.dataset.faultIndex);
                if (currentForm.faults[index]) {
                    currentForm.faults.splice(index, 1);
                    renderFaultsTable(currentForm.faults);
                    showToast('תקלה נמחקה.', 'red');
                }
            }

            // *** מאזין לכפתור הוספת תקלה ***
            if (target.id === 'add-fault-btn') {
                // *** שינוי: שימוש ב-bg-ofer-orange במקום bg-gray-500 ***
                addFaultFromForm();
            }
        });

        formStep2.addEventListener('change', (e) => {
            const target = e.target;

            // ניקוי סימון אדום בעת הזנת טקסט, בחירה, או הקלדה בשדות
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
                target.classList.remove('border-red-500', 'ring-red-500', 'border-4');
                target.classList.add('border-gray-300');

                // *** הפעלת חישוב משך הטיסה (מעדכן גם flightStartTimestamp) ***
                if (target.id === 'start-time' || target.id === 'end-time' || target.id === 'flight-date') {
                    calculateFlightDuration();
                }
            }

            // *** מאזין לשינוי סימולטור (מעדכן תקלות) ***
            if (target.id === 'simulator-select') {
                // שומר את הנתונים הכלליים כדי שנוכל לקרוא את הסימולטור
                saveCurrentStepData();
                // קורא ל-processFaultsData כדי לוודא שיש רשימה עדכנית של תקלות פתוחות
                processFaultsData();
                // קורא לפופולייט עם הערך החדש של הסימולטור
                populateFaultOptions(target.value);
            }

            // *** מאזין לבחירת תקלה (מציג שדה 'אחר') ***
            if (target.id === 'fault-select') {
                toggleOtherFaultInput(target);
            }
        });
    }


    // ניקוי סימון אדום לשדות הקבועים בנתונים כלליים
    document.querySelectorAll('#flight-name, #flight-type-select, #flight-date, #start-time, #end-time, #simulator-select, #instructor-name-1, #pilot-right, #pilot-left').forEach(input => {
        input.addEventListener('change', (e) => {
            const target = e.target;
            target.classList.remove('border-red-500', 'ring-red-500', 'border-4');
            target.classList.add('border-gray-300');
        });
    });

    // *** לוגיקה לצפייה ועריכת גיחות (לחיצה על שורה) ***

    // יירוט קליקים על שורות בטבלת הגיחות (מסך טופס)
    const flightTableContainer = document.getElementById('flight-table-container');
    if (flightTableContainer) {
        flightTableContainer.addEventListener('click', (e) => {
            const row = e.target.closest('tr[data-flight-id]');
            if (row) {
                showFlightDetailsModal(row.dataset.flightId);
            }
        });
    }

    // יירוט קליקים על שורות בטבלת הגיחות בבסיס הנתונים (מסך מאגר)
    const flightTableContainerDb = document.getElementById('flight-table-container-db');
    if (flightTableContainerDb) {
        flightTableContainerDb.addEventListener('click', (e) => {
            const row = e.target.closest('tr[data-flight-id]');
            if (row) {
                showFlightDetailsModal(row.dataset.flightId);
            }
        });
    }

    // *** מאזין לשינוי סטטוס ב-Modal של פרטי הגיחה ***
    const flightDetailsModal = document.getElementById('flight-details-modal');
    if (flightDetailsModal) {
        flightDetailsModal.addEventListener('click', (e) => {
            const button = e.target.closest('.goal-status-edit-btn');
            // ודא שהכפתור קיים ואינו מנוטרל (disabled)
            if (button && !button.disabled) {
                toggleGoalStatusInModal(button);
            }
        });

        // מאזין לשינוי שדות תאריך/שעה כדי לעדכן שעות טיסה מחושבות
        flightDetailsModal.addEventListener('change', (e) => {
            const target = e.target;
            // בדיקה האם המשתמש משנה שעת התחלה/סיום או תאריך במצב עריכה
            if (target.dataset.editField === 'שעת התחלה' || target.dataset.editField === 'שעת סיום' || target.dataset.editField === 'תאריך') {

                // איסוף הערכים מה-Modal
                const startTimeStr = document.querySelector('[data-edit-field="שעת התחלה"]')?.value;
                const endTimeStr = document.querySelector('[data-edit-field="שעת סיום"]')?.value;
                const dateStr = document.querySelector('[data-edit-field="תאריך"]')?.value;
                const durationInput = document.querySelector('[data-edit-field="שעות טיסה (דקות)"]');

                if (startTimeStr && endTimeStr && durationInput && dateStr) {
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

                        // הערה: הנתון נשמר רק ב-saveEditedFlight, כאן רק מעדכנים את התצוגה.
                    } catch (e) {
                        durationInput.value = '';
                    }
                }
            }
        });
    }

    // *** מאזינים לכפתורים ב-Modal טיפול בתקלות ***
    const faultResolutionModal = document.getElementById('fault-resolution-modal');
    if (faultResolutionModal) {
        const closeButton = document.getElementById('fault-resolution-close-button');
        if (closeButton) closeButton.addEventListener('click', hideAllModals);

        // Delegation ללחצן סימון כטופלה (מופיע רק כשהיא פתוחה)
        faultResolutionModal.addEventListener('click', (e) => {
            const button = e.target.closest('#mark-resolved-btn');
            if (button) {
                saveFaultResolutionStatus(button.dataset.faultKey);
            }
        });
    }

    // קליקים ב-Modal הצפייה/עריכה
    const detailsCloseButton = document.getElementById('details-close-button');
    const detailsEditButton = document.getElementById('details-edit-button');
    const detailsCancelEditButton = document.getElementById('details-cancel-edit-button');
    const detailsSaveEditButton = document.getElementById('details-save-edit-button');

    if (detailsCloseButton) detailsCloseButton.addEventListener('click', hideAllModals);
    if (detailsEditButton) detailsEditButton.addEventListener('click', enableEditMode);
    if (detailsCancelEditButton) detailsCancelEditButton.addEventListener('click', disableEditMode);
    if (detailsSaveEditButton) detailsSaveEditButton.addEventListener('click', saveEditedFlight);
}

// *** חשיפת פונקציות קריטיות לשימוש גלובלי (עבור auth.js) ***
// ************************************************************
window.showScreen = showScreen;
window.populateFilters = populateFilters;
window.fetchFlights = fetchFlights;
window.showToast = showToast;
// *** חשיפה חובה לתיקון הלוגין ***
window.hideAllModals = hideAllModals;


document.addEventListener('DOMContentLoaded', () => {
    // *** שינוי: קוד זה כבר לא מפעיל את לוגיקת האימות, אלא רק את המאזינים הכלליים ***
    const userGreeting = document.getElementById('user-greeting');
    if (userGreeting) userGreeting.innerText = `שלום משתמש/ת`;

    initializeEventListeners();
});