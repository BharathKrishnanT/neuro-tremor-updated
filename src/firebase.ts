import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
  getDocFromServer,
  onSnapshot,
  query,
  where,
  orderBy,
  deleteDoc,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

export const checkFirestoreConnectivity = async (): Promise<{
  connected: boolean;
  latencyMs?: number;
  error?: string;
}> => {
  const start = Date.now();
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { connected: true, latencyMs: Date.now() - start };
  } catch (error: any) {
    if (
      error.code === 'permission-denied' ||
      error.message?.includes('Missing or insufficient permissions')
    ) {
      return { connected: true, latencyMs: Date.now() - start };
    }
    const isOffline =
      error.message?.includes('client is offline') || error.code === 'unavailable';
    return {
      connected: !isOffline,
      latencyMs: Date.now() - start,
      error: isOffline ? 'Firestore client appears offline or blocked' : error.message,
    };
  }
};

export const signInWithGoogle = async () => {
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (error: any) {
    if (error.code !== 'auth/popup-closed-by-user') {
      console.error('Error signing in with Google', error);
    }
    throw error;
  }
};

export const signInAsGuest = async () => {
  try {
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (error: any) {
    console.error('Error signing in anonymously', error);
    throw error;
  }
};

export const logOut = async () => {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Error signing out', error);
    throw error;
  }
};

export {
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
  getDocFromServer,
  onSnapshot,
  query,
  where,
  orderBy,
  deleteDoc,
  onAuthStateChanged,
};
