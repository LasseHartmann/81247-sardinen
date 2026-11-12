import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';

export interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  appId: string;
}

const rawConfig: FirebaseEnvConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY ?? '').trim(),
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '').trim(),
  databaseURL: (import.meta.env.VITE_FIREBASE_DATABASE_URL ?? '').trim(),
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '').trim(),
  appId: (import.meta.env.VITE_FIREBASE_APP_ID ?? '').trim(),
};

export const isFirebaseConfigured: boolean = Boolean(
  rawConfig.apiKey &&
    rawConfig.authDomain &&
    rawConfig.databaseURL &&
    rawConfig.projectId &&
    rawConfig.appId
);

export interface FirebaseClients {
  app: FirebaseApp;
  auth: Auth;
  db: Database;
}

let cachedClients: FirebaseClients | null = null;

export function getFirebaseClients(): FirebaseClients | null {
  if (!isFirebaseConfigured) {
    return null;
  }
  if (cachedClients) {
    return cachedClients;
  }
  const app =
    getApps().length > 0 ? getApps()[0] : initializeApp(rawConfig);
  const auth = getAuth(app);
  const db = getDatabase(app);
  cachedClients = { app, auth, db };
  return cachedClients;
}
