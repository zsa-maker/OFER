const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin SDK using your service account
const serviceAccount = require('./serviceAccountKey.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

/**
 * Recursively fetches all documents and nested subcollections.
 */
async function backupCollection(collectionRef) {
  const collectionData = {};
  const snapshot = await collectionRef.get();

  for (const doc of snapshot.docs) {
    const docData = doc.data();
    const subcollections = await doc.ref.listCollections();
    
    const subcollectionData = {};
    for (const subcol of subcollections) {
      subcollectionData[subcol.id] = await backupCollection(subcol);
    }

    collectionData[doc.id] = {
      ...docData,
      ...(Object.keys(subcollectionData).length > 0 && { _subcollections: subcollectionData })
    };
  }

  return collectionData;
}

/**
 * Exports all root collections to a JSON file.
 */
async function exportFirestore() {
  try {
    console.log('Starting full Firestore backup...');
    
    // Fetch all root collections
    const collections = await db.listCollections();
    const allData = {};

    for (const collection of collections) {
      console.log(`Exporting collection: ${collection.id}`);
      allData[collection.id] = await backupCollection(collection);
    }

    // Save to file
    const outputFile = path.join(__dirname, 'firestore_backup.json');
    fs.writeFileSync(outputFile, JSON.stringify(allData, null, 2), 'utf-8');

    console.log(`\nBackup successfully saved to: ${outputFile}`);
  } catch (error) {
    console.error('Error performing backup:', error);
  } finally {
    process.exit();
  }
}

exportFirestore();