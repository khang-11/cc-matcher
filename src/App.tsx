import { useState, useCallback } from 'react'
import { CardPicker } from '@/components/CardPicker'
import { Results } from '@/components/Results'
import type { CardAccount, Resolution } from '@/lib/parsers/types'

type Step = 'pick' | 'results'

export default function App() {
  const [step, setStep] = useState<Step>('pick')
  const [accounts, setAccounts] = useState<CardAccount[]>([])
  const [resolutions, setResolutions] = useState<Resolution[]>([])
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const addResolution = useCallback((r: Resolution) => {
    setResolutions(prev => {
      // Replace existing resolution for this debit if any
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

  if (step === 'pick') {
    return (
      <CardPicker
        accounts={accounts}
        onAccountsChange={setAccounts}
        onCheck={() => setStep('results')}
      />
    )
  }

  return (
    <Results
      accounts={accounts}
      resolutions={resolutions}
      excluded={excluded}
      onAddResolution={addResolution}
      onRemoveResolution={removeResolution}
      onToggleExcluded={toggleExcluded}
      onBack={() => setStep('pick')}
    />
  )
}
