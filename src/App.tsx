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

type Screen = { id: 'list' } | { id: 'detail'; accountId: string }

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
        // Update/add incoming docs
        for (const d of docs) {
          remoteCardIds.current.add(d.account.id)
          next.set(d.account.id, d)
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
          onAccountChange={handleUpdateAccount}
          onAddResolution={r => handleAddResolution(activeDoc.account.id, r)}
          onRemoveResolution={debitId => handleRemoveResolution(activeDoc.account.id, debitId)}
          onToggleExcluded={txId => handleToggleExcluded(activeDoc.account.id, txId)}
          onBack={() => setScreen({ id: 'list' })}
        />
      )}
    </AuthGate>
  )
}
