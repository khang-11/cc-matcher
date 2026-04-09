/**
 * Firestore persistence for the full app state.
 *
 * Layout:
 *   appState/shared          — the single shared document (accounts, resolutions, excluded)
 *   config/allowlist         — { emails: string[] }  (managed via Firebase console)
 *
 * Writes are debounced 1 s so rapid state changes don't spam Firestore.
 */

import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { CardAccount, Resolution } from '@/lib/parsers/types'

export interface AppState {
  accounts: CardAccount[]
  resolutions: Resolution[]
  excluded: string[]   // serialised as array; Set in React
}

const STATE_DOC = doc(db, 'appState', 'shared')
const ALLOWLIST_DOC = doc(db, 'config', 'allowlist')

// ── Allowlist ────────────────────────────────────────────────────────────────

/** Returns true if the given email is on the allowlist. */
export async function isAllowlisted(email: string): Promise<boolean> {
  const snap = await getDoc(ALLOWLIST_DOC)
  if (!snap.exists()) return false
  const data = snap.data() as { emails?: string[] }
  return (data.emails ?? []).map(e => e.toLowerCase()).includes(email.toLowerCase())
}

// ── State load ───────────────────────────────────────────────────────────────

/** One-time load of the current state. Returns null if the document doesn't exist yet. */
export async function loadState(): Promise<AppState | null> {
  const snap = await getDoc(STATE_DOC)
  if (!snap.exists()) return null
  return snap.data() as AppState
}

// ── State save (debounced) ───────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null

export function saveState(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    await setDoc(STATE_DOC, state)
  }, 1000)
}

// ── Real-time listener ───────────────────────────────────────────────────────

/**
 * Subscribe to live updates on the shared state document.
 * Calls `onUpdate` whenever another client writes a change.
 * Returns the unsubscribe function.
 */
export function subscribeState(onUpdate: (state: AppState) => void): Unsubscribe {
  return onSnapshot(STATE_DOC, snap => {
    if (snap.exists()) {
      onUpdate(snap.data() as AppState)
    }
  })
}
