import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

console.log('Initializing Firebase Admin SDK...');
console.log('Current environment:', process.env.NODE_ENV);

try {
  console.log('Attempting to load service account from environment...');
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64!, 'base64').toString('utf8')
  );
  console.log('Service account loaded successfully');
  console.log('Project ID:', serviceAccount.project_id);
  
  if (!admin.apps.length) {
    console.log('Initializing Firebase app...');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('Firebase app initialized successfully');
  } else {
    console.log('Firebase app already initialized');
  }
} catch (error: any) {
  console.error('Error initializing Firebase Admin SDK:', error);
  console.error('Error details:', {
    message: error?.message || 'Unknown error',
    code: error?.code || 'Unknown code',
    stack: error?.stack || 'No stack trace'
  });
  // Don't throw here, let the app continue with undefined db
}

console.log('Getting Firestore instance...');
const db = getFirestore("swap-db");
console.log('Firestore instance created');

console.log('Getting Storage bucket...');
const bucket = admin.storage().bucket("loofta.appspot.com");
console.log('Storage bucket created');

export { bucket };
export default db;
