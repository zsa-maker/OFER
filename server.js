const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

{
    // tihkur123
    //tihkurofer@gmail.com
}
// הגדרות קבועות (סיסמאות)
const ADMIN_PASSWORD = "oferAdmin";
const INITIAL_PASSWORD = "superUser";
const VALID_USERNAME = "ofer";

// נתיבים לקבצי הנתונים (נשמרים באותה תיקייה)
const flightsFilePath = path.join(__dirname, 'flights.json');
const passwordFilePath = path.join(__dirname, 'password.json');

// ----------------------------------------------------
// Middleware והגשת קבצים סטטיים
// ----------------------------------------------------

// פתרון חירום: הסרת ה-CSP אם הדבר גורם לבעיות (ברוב המקרים אין צורך בזה)
app.use((req, res, next) => {
    next();
});

// מאפשר לשרת לנתח גוף בקשות בפורמט JSON
app.use(express.json());

// *** תיקון קריטי: מגיש קבצים סטטיים מתוך תיקיית 'public' ***
// השימוש ב-path.join מבטיח שהשרת ימצא את index.html בנתיב הנכון, כיוון שהוא נמצא בתוך 'public'.
app.use(express.static(path.join(__dirname, 'public')));


// ----------------------------------------------------
// אתחול קבצי נתונים (JSON)
// ----------------------------------------------------

// 1. בדיקה ויצירת flights.json (אם לא קיים)
if (!fs.existsSync(flightsFilePath)) {
    fs.writeFileSync(flightsFilePath, '[]');
}

// 2. בדיקה ויצירת password.json (אם לא קיים)
if (!fs.existsSync(passwordFilePath)) {
    // יוצר את הקובץ עם הסיסמה הראשונית
    fs.writeFileSync(passwordFilePath, JSON.stringify({ currentAppPassword: INITIAL_PASSWORD }));
}


// ----------------------------------------------------
// Endpoints לניהול טיסות וסיסמה
// ----------------------------------------------------

// Endpoint לקבלת כל הטיסות
app.get('/api/flights', (req, res) => {
    fs.readFile(flightsFilePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error reading flights data.');
        }
        res.json(JSON.parse(data));
    });
});

// Endpoint להוספת טיסה חדשה
app.post('/api/flights', (req, res) => {
    const newFlight = req.body;
    fs.readFile(flightsFilePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error reading flights data.');
        }
        const flights = JSON.parse(data);
        flights.push(newFlight);
        fs.writeFile(flightsFilePath, JSON.stringify(flights, null, 2), (err) => {
            if (err) {
                return res.status(500).send('Error saving new flight.');
            }
            res.status(201).json(newFlight);
        });
    });
});

// Endpoint לקבלת הסיסמה הנוכחית
app.get('/api/password', (req, res) => {
    fs.readFile(passwordFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading password data:', err);
            return res.status(500).send('Error reading password data.');
        }
        try {
            const passwordData = JSON.parse(data);
            res.json(passwordData);
        } catch (e) {
            return res.status(500).send('Error parsing password data.');
        }
    });
});

// Endpoint לעדכון הסיסמה
app.post('/api/password', (req, res) => {
    const { currentPassword, adminPassword, newPassword } = req.body;

    fs.readFile(passwordFilePath, 'utf8', (err, data) => {
        if (err) {
            return res.status(500).send('Error reading password data.');
        }

        let passwordData;
        try {
            passwordData = JSON.parse(data);
        } catch (e) {
            return res.status(500).send('Error parsing password data.');
        }

        // --- שלב 1: אימות סיסמת מנהלים ---
        if (adminPassword !== ADMIN_PASSWORD) {
            return res.status(403).json({ success: false, message: 'סיסמת מנהלים שגויה.' });
        }

        // --- שלב 2: אימות סיסמה נוכחית ---
        if (currentPassword !== passwordData.currentAppPassword) {
            return res.status(401).json({ success: false, message: 'הסיסמה הנוכחית שגויה.' });
        }

        // --- שלב 3: שמירת הסיסמה החדשה ---
        passwordData.currentAppPassword = newPassword;

        fs.writeFile(passwordFilePath, JSON.stringify(passwordData, null, 2), (err) => {
            if (err) {
                console.error('Error saving new password:', err);
                return res.status(500).json({ success: false, message: 'שגיאה בשמירת הסיסמה בשרת.' });
            }
            res.json({ success: true, message: 'הסיסמה עודכנה בהצלחה ונשמרה בשרת.' });
        });
    });
});


// ----------------------------------------------------
// הפעלת השרת
// ----------------------------------------------------

// *** תיקון: השרת מאזין על '0.0.0.0' כדי להיות נגיש ציבורית ברשת המקומית ***
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running and publically accessible on port ${PORT}`);
    console.log(`Access the application via: http://localhost:${PORT}`); // שימוש בנתיב הקצר
});