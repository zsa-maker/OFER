// ==========================================================
// js/auth/auth.js
// גרסה מתוקנת: כוללת חשיפה של פונקציית האדמין לחלון (Window)
// ==========================================================

import { showToast, hideAllModals } from '../components/modals.js';
import { showScreen } from '../core/global.js';
import { getAuth, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

// משתנים גלובליים
window.currentUsername = null;
window.isAdmin = false;

// קבועים
const ADMIN_PASSWORD = "oferAdmin";
const VALID_USERNAME = "ofer";
const INITIAL_PASSWORD = "superUser";
const PASSWORD_DOC_ID = "app_master_password";

let currentAppPassword = null;

/**
 * טעינת סיסמת האפליקציה מ-Firebase
 */
async function fetchCurrentPassword() {
    try {
        if (!window.firestoreFunctions) return false;
        const { getDoc, doc, setDoc } = window.firestoreFunctions;
        const passwordRef = doc(window.db, "settings", PASSWORD_DOC_ID);

        const docSnap = await getDoc(passwordRef);

        if (docSnap.exists()) {
            currentAppPassword = docSnap.data().value;
            return true;
        } else {
            await setDoc(passwordRef, { value: INITIAL_PASSWORD });
            currentAppPassword = INITIAL_PASSWORD;
            return true;
        }
    } catch (error) {
        console.error("Error loading password:", error);
        currentAppPassword = INITIAL_PASSWORD;
        return false;
    }
}

/**
 * לוגיקה לכניסת משתמש רגיל (מהמסך הראשי)
 */
async function handleLogin() {
    const usernameInput = document.getElementById('username-input');
    const passwordInput = document.getElementById('password-input');
    const errorMessage = document.getElementById('login-error-message');

    if (!usernameInput || !passwordInput) return;

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    errorMessage.classList.add('hidden');

    if (!currentAppPassword) {
        await fetchCurrentPassword();
    }

    const passwordToCheck = currentAppPassword || INITIAL_PASSWORD;

    // בדיקה: האם זה אדמין שמנסה להיכנס מהמסך הראשי?
    if (username === 'admin' && password === ADMIN_PASSWORD) {
        performAdminLogin();
        return;
    }

    // בדיקה: משתמש רגיל
    if (username === VALID_USERNAME && password === passwordToCheck) {
        console.log("User login successful");
        window.currentUsername = username;
        window.isAdmin = false;
        updateAdminUI(false);
        
        // הסתרת כפתור הניהול
        const adminBtn = document.getElementById('nav-admin');
        if (adminBtn) adminBtn.classList.add('hidden');

        setAppStateToLoggedIn();
    } else {
        errorMessage.textContent = 'שם משתמש או סיסמה שגויים.';
        errorMessage.classList.remove('hidden');
        passwordInput.value = '';
    }
}

/**
 * פונקציה המבצעת את פעולות הכניסה לאדמין
 */
function performAdminLogin() {
    console.log("Admin login successful");
    window.currentUsername = 'System Admin';
    window.isAdmin = true;
    updateAdminUI(true);

    // חשיפת כפתור הניהול
    const adminBtn = document.getElementById('nav-admin');
    if (adminBtn) adminBtn.classList.remove('hidden');

    if (window.showToast) window.showToast("מחובר כמנהל מערכת", "green");
    setAppStateToLoggedIn();
}

/**
 * פונקציה המטפלת בלחיצה על "התחבר" במודל של האדמין (בסרגל הצד)
 * זו הפונקציה שהייתה חסרה לך קודם
 */
async function handleAdminLogin() {
    console.log("Attempting Admin Login via Modal...");
    
    const emailInput = document.getElementById('admin-email-input');
    const passInput = document.getElementById('admin-pass-input');
    const modal = document.getElementById('admin-login-modal');
    
    // הגנה מפני שגיאות אם האלמנטים לא קיימים
    if (!emailInput || !passInput) {
        console.error("Admin inputs not found");
        return;
    }

    const password = passInput.value.trim();
    
    // בדיקת סיסמה
    if (password === ADMIN_PASSWORD) { 
        performAdminLogin(); // קורא לפונקציה המשותפת למעלה
        
        // סגירת המודל וניקוי
        if (modal) modal.classList.add('hidden');
        emailInput.value = '';
        passInput.value = '';
    } else {
        if (window.showToast) window.showToast("סיסמה שגויה", "red");
        passInput.value = '';
    }
}

// ===============================================================
// *** החלק הקריטי: חשיפת הפונקציה לחלון (Window) ***
// בלי זה, ה-HTML לא מכיר את הפונקציה וזורק ReferenceError
// ===============================================================
window.handleAdminLogin = handleAdminLogin;
// ===============================================================


/**
 * שינוי סיסמה (למשתמשים)
 */
async function saveNewPasswordAndLogin() {
    const { doc, updateDoc } = window.firestoreFunctions;
    // ... לוגיקה קיימת של שינוי סיסמה ...
    // (קיצרתי כאן כי זה לא רלוונטי לבעיה, אבל תשאיר את הקוד הקיים שלך כאן אם יש)
}

// פונקציות עזר ל-UI
function setAppStateToLoggedIn() {
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) {
        loginScreen.classList.add('hidden');
        loginScreen.classList.remove('flex');
    }

    if (window.hideAllModals) window.hideAllModals();

    const greeting = document.getElementById('user-greeting');
    if(greeting) greeting.innerText = `שלום ${window.currentUsername}`;
    
    document.getElementById('logout-button')?.classList.remove('hidden');

    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.remove('hidden');
        sidebar.querySelectorAll('button').forEach(btn => btn.disabled = false);
    }

    if (window.showScreen) window.showScreen('flight-form-screen');
}

function handleLogout() {
    window.currentUsername = null;
    window.isAdmin = false;
    updateAdminUI(false);
    document.getElementById('nav-admin')?.classList.add('hidden');
    
    // איפוס מלא של המסך
    location.reload(); 
}

/**
 * אתחול מאזינים
 */
export function initializeAuth() {
    fetchCurrentPassword();

    const loginScreen = document.getElementById('login-screen');
    if(loginScreen) {
        loginScreen.classList.remove('hidden');
        loginScreen.classList.add('flex');
    }

    document.getElementById('login-button')?.addEventListener('click', handleLogin);
    document.getElementById('logout-button')?.addEventListener('click', handleLogout);
    
    // תמיכה ב-Enter
    document.getElementById('password-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
}
function updateAdminUI(isAdmin) {
    const adminDeleteControls = document.getElementById('admin-delete-controls');
    if (adminDeleteControls) {
        if (isAdmin) {
            adminDeleteControls.classList.remove('hidden');
            adminDeleteControls.classList.add('flex');
        } else {
            adminDeleteControls.classList.add('hidden');
            adminDeleteControls.classList.remove('flex');
        }
    }
}
