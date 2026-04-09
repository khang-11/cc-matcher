/**
 * Firestore persistence — per-card documents.
 *
 * Layout:
 *   userProfiles/{uid}        { email: string }
 *   cards/{cardId}            { ...CardAccount, owners: string[], resolutions: Resolution[], excluded: string[] }
 *
 * Security: a card is readable/writable only by users whose UID is in owners[].
 * Sharing: to add a collaborator, look up their UID via userProfiles (queried by email),
 * then add to owners[].
 */

import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { CardAccount, Resolution } from '@/lib/parsers/types'

// ── Types ─────────────────────────────────────────────────────────────────────

/** The shape of a card document in Firestore */
export interface CardDoc {
  account: CardAccount          // all card fields (id, name, bank, files, transactions, minSpend, owners)
  resolutions: Resolution[]
  excluded: string[]
}

// ── User profiles ─────────────────────────────────────────────────────────────

/** Write/update the current user's profile doc so their email is discoverable */
export async function upsertUserProfile(uid: string, email: string): Promise<void> {
  await setDoc(doc(db, 'userProfiles', uid), { email }, { merge: true })
}

/** Look up a UID by email. Returns null if not found. */
export async function lookupUidByEmail(email: string): Promise<string | null> {
  const q = query(
    collection(db, 'userProfiles'),
    where('email', '==', email.toLowerCase().trim())
  )
  const snap = await getDocs(q)
  if (snap.empty) return null
  return snap.docs[0].id  // doc id = uid
}

/** Look up the email for a given UID. Returns null if profile not found. */
export async function lookupEmailByUid(uid: string): Promise<string | null> {
  const snap = await getDoc(doc(db, 'userProfiles', uid))
  if (!snap.exists()) return null
  return (snap.data() as { email: string }).email
}

// ── Card CRUD ─────────────────────────────────────────────────────────────────

function cardRef(cardId: string) {
  return doc(db, 'cards', cardId)
}

/** Strip the `raw` field from transactions before persisting — it's parse-only data */
function serializeCardDoc(cardDoc: CardDoc): object {
  return {
    ...cardDoc,
    account: {
      ...cardDoc.account,
      transactions: cardDoc.account.transactions.map(({ raw: _raw, ...rest }) => rest),
    },
  }
}

/** Save (create or overwrite) a card document */
export async function saveCard(cardDoc: CardDoc): Promise<void> {
  await setDoc(cardRef(cardDoc.account.id), serializeCardDoc(cardDoc))
}

/** Delete a card document */
export async function deleteCard(cardId: string): Promise<void> {
  await deleteDoc(cardRef(cardId))
}

/** Subscribe to all cards the current user owns. Returns unsubscribe fn. */
export function subscribeUserCards(
  uid: string,
  onUpdate: (cards: CardDoc[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'cards'),
    where('account.owners', 'array-contains', uid)
  )
  return onSnapshot(q, snap => {
    const cards = snap.docs.map(d => d.data() as CardDoc)
    onUpdate(cards)
  })
}

/** One-time fetch of all cards for a user */
export async function fetchUserCards(uid: string): Promise<CardDoc[]> {
  const q = query(
    collection(db, 'cards'),
    where('account.owners', 'array-contains', uid)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => d.data() as CardDoc)
}

/** Add a user UID to a card's owners array */
export async function addCardOwner(cardDoc: CardDoc, newOwnerUid: string): Promise<void> {
  if (cardDoc.account.owners.includes(newOwnerUid)) return
  const updated: CardDoc = {
    ...cardDoc,
    account: {
      ...cardDoc.account,
      owners: [...cardDoc.account.owners, newOwnerUid],
    },
  }
  await saveCard(updated)
}

/** Remove a user UID from a card's owners array */
export async function removeCardOwner(cardDoc: CardDoc, uidToRemove: string): Promise<void> {
  const updated: CardDoc = {
    ...cardDoc,
    account: {
      ...cardDoc.account,
      owners: cardDoc.account.owners.filter(uid => uid !== uidToRemove),
    },
  }
  await saveCard(updated)
}

// ── Debounced per-card save ───────────────────────────────────────────────────

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function saveCardDebounced(cardDoc: CardDoc, delayMs = 1000): void {
  const id = cardDoc.account.id
  const existing = saveTimers.get(id)
  if (existing) clearTimeout(existing)
  saveTimers.set(id, setTimeout(() => {
    saveCard(cardDoc).catch(console.error)
    saveTimers.delete(id)
  }, delayMs))
}
