import { showToast } from '../components/modals.js';
import { fetchFlights } from '../core/global.js';
import { getWeekNumber, getPeriodNumber } from '../core/util.js';
import { EXECUTION_STATUS_NOT_REPORTED } from './executionStatusManager.js';
// *** ייבוא הפונקציה לעדכון הרשימות ***
import { updateListsFromImport } from './adminManager.js';

export const EXECUTION_STATUS_DEFAULT = EXECUTION_STATUS_NOT_REPORTED;

function normalizeTime(timeStr) {
    if (!timeStr) return '';
    let cleanStr = timeStr.toString().replace(/\"/g, '').trim();
    if (/^\d{1,2}$/.test(cleanStr)) {
        return cleanStr.padStart(2, '0') + ':00';
    }
    if (cleanStr.includes(':')) {
        const parts = cleanStr.split(':');
        if (parts.length >= 2) {
            const h = parts[0].trim().padStart(2, '0');
            const m = parts[1].trim().padStart(2, '0');
            return `${h}:${m}`;
        }
    } else if (cleanStr.includes('.')) {
        const parts = cleanStr.split('.');
        if (parts.length >= 2) {
            const h = parts[0].trim().padStart(2, '0');
            const m = parts[1].trim().padStart(2, '0');
            return `${h}:${m}`;
        }
    }
    return cleanStr;
}

export async function importFlightsFromExcel(file) {
    if (!window.db || !window.firestoreFunctions) {
        console.error('שגיאה: Firebase לא מאותחל.');
        return;
    }

    if (!file.name.endsWith('.csv')) {
        showToast('יש לייבא קובץ בפורמט CSV בלבד.', 'red');
        return;
    }

    const { collection, addDoc, serverTimestamp } = window.firestoreFunctions;
    const reader = new FileReader();

    reader.onload = async function (event) {
        const csvData = event.target.result;
        let lines = csvData.split('\n').filter(line => line.trim() !== '');

        if (lines.length === 0) {
            showToast('הקובץ ריק.', 'red');
            return;
        }

        let delimiter = ',';
        if (lines[0].includes('\t')) delimiter = '\t';
        else if (lines[0].includes(';')) delimiter = ';';

        const headers = lines[0].trim().split(delimiter).map(h => h.replace(/\"/g, '').trim());
        const dataLines = lines.slice(1).filter(line => line.trim() !== '');

        const flightsToSave = [];
        
        // *** סטים לאיסוף שמות חדשים (מונע כפילויות) ***
        const newPilots = new Set();
        // const newInstructorsMale = new Set();
        const newInstructorsFemale = new Set();

        for (const line of dataLines) {
            const values = line.trim().split(delimiter).map(v => v.replace(/\"/g, '').trim());
            // if (values.length < headers.length * 0.5) continue;

            let flightData = {};
            headers.forEach((header, index) => {
                flightData[header.trim()] = values[index] ? values[index].trim() : '';
            });

            const flightName = flightData['שם גיחה'] || flightData['שם גיחה (חובה)'];
            let flightDateStr = flightData['תאריך'] || flightData['תאריך (חובה)'];

            if (!flightName || !flightDateStr) continue;

            // --- איסוף שמות למאגרים ---
            if (flightData['טייס ימין']) newPilots.add(flightData['טייס ימין']);
            if (flightData['טייס שמאל']) newPilots.add(flightData['טייס שמאל']);
            if (flightData['מדריכה']) newInstructorsFemale.add(flightData['מדריכה']);
            // ---------------------------

            // טיפול בתאריך
            let rawDateStr = flightDateStr.replace(/\"/g, '').trim();
            let parts = rawDateStr.split(/[\/\.]/);
            let flightDate;

            if (parts.length === 3) {
                let day = parts[0];
                let month = parts[1];
                let year = parts[2];
                if (year.length === 2) year = '20' + year;
                flightDateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                flightDate = new Date(flightDateStr);
            } else {
                flightDate = new Date(rawDateStr);
            }

            if (isNaN(flightDate.getTime())) continue;

            const normalizedStartTime = normalizeTime(flightData['שעת התחלה']);
            const normalizedEndTime = normalizeTime(flightData['שעת סיום']);

            const dataFields = {
                'שם גיחה': flightName,
                'תאריך': flightDateStr,
                'סוג גיחה': flightData['סוג גיחה'] || 'לא מוגדר',
                'סימולטור': flightData['סימולטור'] || 'לא מוגדר',
                'שעת התחלה': normalizedStartTime,
                'שעת סיום': normalizedEndTime,
                // 'מדריך': flightData['מדריך'] || '',
                'מדריכה': flightData['מדריכה'] || '',
                'טייס ימין': flightData['טייס ימין'] || '',
                'טייס שמאל': flightData['טייס שמאל'] || '',
            };

            const flightRecord = {
                executionStatus: EXECUTION_STATUS_DEFAULT,
                data: dataFields,
                goalsStatus: {},
                goalsDetails: {},
                faults: [],
                date: flightDateStr,
                week: getWeekNumber(flightDate),
                period: getPeriodNumber(flightDate),
                timestamp: serverTimestamp(),
                trainingType: 'GENERIC_FLIGHT',
            };

            flightsToSave.push(flightRecord);
        }

        if (flightsToSave.length > 0) {
            const batchPromises = flightsToSave.map(flight => {
                const flightsCollection = collection(window.db, "flights");
                return addDoc(flightsCollection, flight);
            });
            await Promise.all(batchPromises);
            
            // *** קריאה לעדכון הרשימות הגלובליות ***
            await updateListsFromImport({
                pilots: Array.from(newPilots),
                // instructorsMale: Array.from(newInstructorsMale),
                instructorsFemale: Array.from(newInstructorsFemale)
            });

            showToast(`יוצרו בהצלחה ${flightsToSave.length} גיחות ועודכנו רשימות כוח אדם!`, 'green');
            fetchFlights();
        } else {
            showToast('לא נמצאו גיחות תקינות לייבוא.', 'red');
        }
    };
    reader.readAsText(file, 'UTF-8');
}