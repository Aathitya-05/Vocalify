// Firebase configuration template
// Copy this file to firebase-config.js and fill in your actual credentials.
export const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID",
    measurementId: "YOUR_MEASUREMENT_ID",
    
    // Set your backend FastAPI URL here (e.g. "https://vocalify-unri.onrender.com")
    // Keep empty "" for relative path (default, when backend and frontend are on the same domain)
    apiBaseUrl: ""
};

// Helper function to check if the Firebase config has been initialized with actual keys
export function isFirebaseConfigured() {
    return firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY" && firebaseConfig.apiKey !== "";
}
