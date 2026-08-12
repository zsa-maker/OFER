const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin SDK
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

/**
 * Recursively writes documents and their nested subcollections back to Firestore.
 */
async function restoreCollection(data, currentRef) {
  for (const [docId, docData] of Object.entries(data)) {
    console.log(`Restoring document: ${currentRef.path}/${docId}`);
    
    // Isolate subcollections to prevent them from being saved as standard fields
    const subcollections = docData._subcollections;
    const cleanData = { ...docData };
    delete cleanData._subcollections;

    // Write the document data (using .set() to overwrite or create)
    const docRef = currentRef.doc(docId);
    await docRef.set(cleanData);

    // Recursively restore any nested subcollections
    if (subcollections) {
      for (const [subColId, subColData] of Object.entries(subcollections)) {
        const subColRef = docRef.collection(subColId);
        await restoreCollection(subColData, subColRef);
      }
    }
  }
}

/**
 * Reads the local JSON file and begins the import process.
 */
async function importFirestore() {
  try {
    console.log('Starting Firestore restore...');
    const inputFile = path.join(__dirname, 'firestore_backup.json');
    
    // Check if the backup file exists
    if (!fs.existsSync(inputFile)) {
      console.error('Error: firestore_backup.json not found!');
      process.exit(1);
    }

    const fileContent = fs.readFileSync(inputFile, 'utf-8');
    const allData = JSON.parse(fileContent);

    // Iterate through all root collections in the JSON
    for (const [collectionId, collectionData] of Object.entries(allData)) {
      console.log(`\nRestoring root collection: ${collectionId}`);
      const colRef = db.collection(collectionId);
      await restoreCollection(collectionData, colRef);
    }

    console.log('\nRestore completed successfully!');
  } catch (error) {
    console.error('Error during restore:', error);
  } finally {
    process.exit();
  }
}

importFirestore();

//node restore.js