const { getFirestore } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.applicationDefault(), // or use a service account if needed
});

// Get the Firestore instance for the 'miniappdb' database
const db = getFirestore('miniappdb');

module.exports = db;
