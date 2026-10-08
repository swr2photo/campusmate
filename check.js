const fs = require('fs');
const env = fs.readFileSync('.env', 'utf-8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val.length) acc[key] = val.join('=').trim();
  return acc;
}, {});

const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, collection, getDocs, query, where } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.EXPO_PUBLIC_FIREBASE_APP_ID
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function check() {
  const userId = 'gJrQKDW1bNNB0LzlNQ79fqiU0kl1';
  console.log(`Checking conversations for user: ${userId}`);
  
  const convsQuery = query(collection(db, 'conversations'), where('participants', 'array-contains', userId));
  const snapshot = await getDocs(convsQuery);
  
  for (const convDoc of snapshot.docs) {
    const data = convDoc.data();
    const otherUserId = data.participants.find(id => id !== userId);
    if (!otherUserId) continue;
    
    const profileDoc = await getDoc(doc(db, 'profiles', otherUserId));
    if (!profileDoc.exists()) {
      console.log(`Conversation ${convDoc.id}: Other user ${otherUserId} is DELETED (Doc not found)`);
    } else {
      const pData = profileDoc.data();
      if (!pData.name && !pData.displayName) {
        console.log(`Conversation ${convDoc.id}: Other user ${otherUserId} exists but has NO NAME`);
      } else {
        console.log(`Conversation ${convDoc.id}: Other user ${otherUserId} is ${pData.name || pData.displayName}`);
      }
    }
  }
  process.exit(0);
}

check();
