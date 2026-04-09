import { useState, useCallback, useEffect, useRef } from 'react'
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { loadState, saveState, subscribeState } from '@/lib/db'
import { AuthGate } from '@/components/AuthGate'
import { CardPicker } from '@/components/CardPicker'
import { Results } from '@/components/Results'
import type { CardAccount, Resolution } from '@/lib/parsers/types'

type Step = 'pick' | 'results'

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)

  const [step, setStep] = useState<Step>('pick')
  const [accounts, setAccounts] = useState<CardAccount[]>([])
  const [resolutions, setResolutions] = useState<Resolution[]>([])
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  // Track whether we're applying a remote update so we don't echo it back
  const applyingRemote = useRef(false)

  // ── Auth listener ────────────────────────────────────────────────────────
  useEffect(() => {
    return onAuthStateChanged(auth, u => {
      setUser(u)
      setAuthReady(true)
    })
  }, [])

  // ── Load + subscribe to Firestore once logged in ─────────────────────────
  useEffect(() => {
    if (!user) return

    // One-time load on login
    loadState().then(state => {
      if (state) {
        applyingRemote.current = true
        setAccounts(state.accounts ?? [])
        setResolutions(state.resolutions ?? [])
        setExcluded(new Set(state.excluded ?? []))
        applyingRemote.current = false
      }
    })

    // Real-time subscription for multi-user live sync
    const unsub = subscribeState(state => {
      applyingRemote.current = true
      setAccounts(state.accounts ?? [])
      setResolutions(state.resolutions ?? [])
      setExcluded(new Set(state.excluded ?? []))
      applyingRemote.current = false
    })

    return unsub
  }, [user])

  // ── Persist state to Firestore on every change ───────────────────────────
  // Skip on the very first render and when we're applying a remote snapshot
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    if (!user) return
    if (applyingRemote.current) return
    saveState({ accounts, resolutions, excluded: Array.from(excluded) })
  }, [accounts, resolutions, excluded, user])

  // ── State handlers ────────────────────────────────────────────────────────
  const addResolution = useCallback((r: Resolution) => {
    setResolutions(prev => {
      const next = prev.filter(x => x.debitId !== r.debitId)
      next.push(r)
      return next
    })
  }, [])

  const removeResolution = useCallback((debitId: string) => {
    setResolutions(prev => prev.filter(r => r.debitId !== debitId))
  }, [])

  const toggleExcluded = useCallback((txId: string) => {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(txId)) next.delete(txId)
      else next.add(txId)
      return next
    })
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  if (!authReady) {
    // Firebase is checking stored credentials — show nothing to avoid flash
    return null
  }

  return (
    <AuthGate user={user}>
      {/* Sign-out button — always visible when logged in */}
      <div className="fixed top-3 right-4 z-50">
        <button
          onClick={() => signOut(auth)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign out
        </button>
      </div>

      {step === 'pick' ? (
        <CardPicker
          accounts={accounts}
          onAccountsChange={setAccounts}
          onCheck={() => setStep('results')}
        />
      ) : (
        <Results
          accounts={accounts}
          resolutions={resolutions}
          excluded={excluded}
          onAddResolution={addResolution}
          onRemoveResolution={removeResolution}
          onToggleExcluded={toggleExcluded}
          onBack={() => setStep('pick')}
        />
      )}
    </AuthGate>
  )
}
