import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyACPwvYOrzMDgNYUK4hXxSenVmnaaVPXqs',
  authDomain: 'campusmate-7f1ab.firebaseapp.com',
  projectId: 'campusmate-7f1ab',
  messagingSenderId: '865275661439',
  appId: '1:865275661439:web:a8b550238c9115a1c9c34a',
};

export const auth = getAuth(initializeApp(firebaseConfig));
