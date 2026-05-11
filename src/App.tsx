import { useState, useCallback, useEffect, useRef } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import {
  subscribeUserCards,
  saveCardDebounced,
  saveCard,
  deleteCard,
  upsertUserProfile,
  type CardDoc,
} from '@/lib/db'
import { AuthGate } from '@/components/AuthGate'
import { CardListScreen } from '@/components/CardListScreen'
import { CardDetailScreen } from '@/components/CardDetailScreen'
import type { CardAccount, Resolution } from '@/lib/parsers/types'
import { makeTxnId } from '@/lib/parsers/nab'

type Screen = { id: 'list' } | { id: 'detail'; accountId: string }

/**
 * One-time migration: strip legacy synthetic `remainder:credit:<id>` prefixes
 * from resolution creditIds that may have been persisted before the fix.
 * Returns the same object reference if no changes were needed.
 */
function migrateResolutionIds(doc: CardDoc): CardDoc {
  const cleaned = doc.resolutions.map(r => {
    const stripped = r.creditId.replace(/^remainder:credit:/, '')
    return stripped === r.creditId ? r : { ...r, creditId: stripped }
  })
  const changed = cleaned.some((r, i) => r !== doc.resolutions[i])
  return changed ? { ...doc, resolutions: cleaned } : doc
}

/**
 * One-time migration: re-key persisted transaction ids using the current
 * stable hashing scheme (see makeTxnId in parsers/nab.ts). Older exports
 * hashed the raw `Transaction Details` string which drifts across CSV
 * exports — same posted row could end up with two different ids and either
 * dedupe asymmetrically or appear twice. The new scheme hashes the cleaned
 * `description` field which is preserved on persisted transactions.
 *
 * All references to old ids are rewritten in lockstep:
 *   - Transaction.id
 *   - UploadedFile.transactionIds
 *   - Resolution.debitId / Resolution.creditId
 *   - excluded[]
 *   - account.creditNames keys
 *
 * If two old transactions collapse to the same new id, the duplicates are
 * dropped (this is the bug fix — they were always the same row).
 */
function migrateTransactionIds(doc: CardDoc): CardDoc {
  const oldToNew = new Map<string, string>()
  const seenNewIds = new Set<string>()
  // Track per-base counter to disambiguate within-card duplicates the same
  // way the parser does for within-CSV duplicates.
  const baseCounts = new Map<string, number>()

  const remappedTxns: typeof doc.account.transactions = []
  for (const t of doc.account.transactions) {
    const baseId = makeTxnId(t.date, t.type, t.amount, t.description, t.card)
    const count = baseCounts.get(baseId) ?? 0
    baseCounts.set(baseId, count + 1)
    const newId = count === 0 ? baseId : `${baseId}|${count}`

    if (newId === t.id) {
      // Already in new format; keep as-is
      oldToNew.set(t.id, t.id)
      seenNewIds.add(t.id)
      remappedTxns.push(t)
      continue
    }

    if (seenNewIds.has(newId)) {
      // Two old rows collapse to the same new id — drop this duplicate but
      // still record the mapping so references point to the surviving row.
      oldToNew.set(t.id, newId)
      continue
    }

    oldToNew.set(t.id, newId)
    seenNewIds.add(newId)
    remappedTxns.push({ ...t, id: newId })
  }

  // Detect whether anything actually changed to avoid spurious writes
  const changed =
    remappedTxns.length !== doc.account.transactions.length ||
    remappedTxns.some((t, i) => t !== doc.account.transactions[i])
  if (!changed) return doc

  const remap = (id: string): string => oldToNew.get(id) ?? id

  const remappedFiles = doc.account.files.map(f => ({
    ...f,
    transactionIds: Array.from(new Set(f.transactionIds.map(remap))),
  }))

  const remappedCreditNames: Record<string, string> = {}
  // creditNames may not exist on older CardAccount shapes — handle defensively
  const existingCreditNames =
    (doc.account as { creditNames?: Record<string, string> }).creditNames ?? {}
  for (const [oldId, name] of Object.entries(existingCreditNames)) {
    remappedCreditNames[remap(oldId)] = name
  }

  // Resolutions: dedupe by debitId after remap (collisions = same row)
  const seenDebitIds = new Set<string>()
  const remappedResolutions: Resolution[] = []
  for (const r of doc.resolutions) {
    const newDebitId = remap(r.debitId)
    if (seenDebitIds.has(newDebitId)) continue
    seenDebitIds.add(newDebitId)
    remappedResolutions.push({
      ...r,
      debitId: newDebitId,
      creditId: remap(r.creditId),
    })
  }

  const remappedExcluded = Array.from(new Set(doc.excluded.map(remap)))

  return {
    ...doc,
    account: {
      ...doc.account,
      transactions: remappedTxns,
      files: remappedFiles,
      // Only include creditNames if the source had them (or if non-empty after remap)
      ...(Object.keys(remappedCreditNames).length > 0 || 'creditNames' in doc.account
        ? { creditNames: remappedCreditNames }
        : {}),
    },
    resolutions: remappedResolutions,
    excluded: remappedExcluded,
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)

  const [screen, setScreen] = useState<Screen>({ id: 'list' })

  // cardDocs: map from cardId → CardDoc (source of truth from Firestore)
  const [cardDocs, setCardDocs] = useState<Map<string, CardDoc>>(new Map())

  // Track which card ids came from remote so we don't re-save them
  const remoteCardIds = useRef<Set<string>>(new Set())

  // ── Auth ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    return onAuthStateChanged(auth, async u => {
      setUser(u)
      setAuthReady(true)
      if (u && u.email) {
        // Write profile so this user is discoverable by email for sharing
        await upsertUserProfile(u.uid, u.email).catch(console.error)
      }
    })
  }, [])

  // ── Firestore subscribe ───────────────────────────────────────────────────
  useEffect(() => {
    if (!user) {
      setCardDocs(new Map())
      return
    }

    const unsub = subscribeUserCards(user.uid, docs => {
      setCardDocs(prev => {
        const next = new Map(prev)
        const incomingIds = new Set(docs.map(d => d.account.id))

        // Remove cards that were deleted remotely (no longer in query results)
        for (const id of next.keys()) {
          if (!incomingIds.has(id)) next.delete(id)
        }
        // Update/add incoming docs, migrating any legacy ids
        for (const d of docs) {
          remoteCardIds.current.add(d.account.id)
          let migrated = migrateResolutionIds(d)
          migrated = migrateTransactionIds(migrated)
          if (migrated !== d) {
            // Persist the cleaned doc back to Firestore (idempotent)
            saveCard(migrated).catch(console.error)
          }
          next.set(d.account.id, migrated)
        }
        return next
      })
    })

    return unsub
  }, [user])

  // ── Derived state ─────────────────────────────────────────────────────────
  const accounts = Array.from(cardDocs.values()).map(d => d.account)

  // ── Handlers ──────────────────────────────────────────────────────────────

  /** Called when a card is created from CardListScreen */
  const handleAddCard = useCallback((account: CardAccount) => {
    if (!user) return
    const cardDoc: CardDoc = { account, resolutions: [], excluded: [] }
    setCardDocs(prev => new Map(prev).set(account.id, cardDoc))
    saveCard(cardDoc).catch(console.error)
  }, [user])

  /** Called when a card's name/minSpend/bank/files/transactions changes */
  const handleUpdateAccount = useCallback((updated: CardAccount) => {
    setCardDocs(prev => {
      const existing = prev.get(updated.id)
      if (!existing) return prev
      const next = new Map(prev)
      const updatedDoc: CardDoc = { ...existing, account: updated }
      next.set(updated.id, updatedDoc)
      saveCard(updatedDoc).catch(console.error)
      return next
    })
  }, [])

  /** Called when a card is deleted */
  const handleDeleteCard = useCallback((accountId: string) => {
    setCardDocs(prev => {
      const next = new Map(prev)
      next.delete(accountId)
      return next
    })
    deleteCard(accountId).catch(console.error)
    setScreen({ id: 'list' })
  }, [])

  const handleAddResolution = useCallback((accountId: string, r: Resolution) => {
    setCardDocs(prev => {
      const existing = prev.get(accountId)
      if (!existing) return prev
      const next = new Map(prev)
      const resolutions = [...existing.resolutions.filter(x => x.debitId !== r.debitId), r]
      const updatedDoc: CardDoc = { ...existing, resolutions }
      next.set(accountId, updatedDoc)
      saveCardDebounced(updatedDoc)
      return next
    })
  }, [])

  const handleRemoveResolution = useCallback((accountId: string, debitId: string) => {
    setCardDocs(prev => {
      const existing = prev.get(accountId)
      if (!existing) return prev
      const next = new Map(prev)
      const resolutions = existing.resolutions.filter(r => r.debitId !== debitId)
      const updatedDoc: CardDoc = { ...existing, resolutions }
      next.set(accountId, updatedDoc)
      saveCardDebounced(updatedDoc)
      return next
    })
  }, [])

  const handleToggleExcluded = useCallback((accountId: string, txId: string) => {
    setCardDocs(prev => {
      const existing = prev.get(accountId)
      if (!existing) return prev
      const next = new Map(prev)
      const excSet = new Set(existing.excluded)
      if (excSet.has(txId)) excSet.delete(txId)
      else excSet.add(txId)
      const updatedDoc: CardDoc = { ...existing, excluded: Array.from(excSet) }
      next.set(accountId, updatedDoc)
      saveCardDebounced(updatedDoc)
      return next
    })
  }, [])

  /** Atomic state replacement — used by the "Reset & re-import" flow. */
  const handleResetFromCsv = useCallback(
    (accountId: string, next: { account: CardAccount; resolutions: Resolution[]; excluded: string[] }) => {
      setCardDocs(prev => {
        const existing = prev.get(accountId)
        if (!existing) return prev
        const updated = new Map(prev)
        const updatedDoc: CardDoc = {
          ...existing,
          account: next.account,
          resolutions: next.resolutions,
          excluded: next.excluded,
        }
        updated.set(accountId, updatedDoc)
        // Save immediately (no debounce) — this is a destructive operation
        saveCard(updatedDoc).catch(console.error)
        return updated
      })
    },
    [],
  )

  // ── Render ────────────────────────────────────────────────────────────────
  if (!authReady) return null

  const activeDoc = screen.id === 'detail' ? cardDocs.get(screen.accountId) ?? null : null

  // If the active card was deleted while on its detail screen, go back to list
  if (screen.id === 'detail' && !activeDoc) {
    setScreen({ id: 'list' })
    return null
  }

  return (
    <AuthGate user={user}>
      {screen.id === 'list' && (
        <CardListScreen
          accounts={accounts}
          cardDocs={cardDocs}
          onAddCard={handleAddCard}
          onDeleteCard={handleDeleteCard}
          onCardClick={accountId => setScreen({ id: 'detail', accountId })}
          currentUid={user?.uid ?? ''}
          onSignOut={() => signOut(auth)}
        />
      )}

      {screen.id === 'detail' && activeDoc && (
        <CardDetailScreen
          account={activeDoc.account}
          resolutions={activeDoc.resolutions}
          excluded={new Set(activeDoc.excluded)}
          cardDoc={activeDoc}
          currentUid={user?.uid ?? ''}
          onAccountChange={handleUpdateAccount}
          onAddResolution={r => handleAddResolution(activeDoc.account.id, r)}
          onRemoveResolution={debitId => handleRemoveResolution(activeDoc.account.id, debitId)}
          onToggleExcluded={txId => handleToggleExcluded(activeDoc.account.id, txId)}
          onResetFromCsv={next => handleResetFromCsv(activeDoc.account.id, next)}
          onBack={() => setScreen({ id: 'list' })}
        />
      )}
    </AuthGate>
  )
}
