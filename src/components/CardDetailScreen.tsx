import { useRef, useCallback, useState, useMemo } from 'react'
import Papa from 'papaparse'
import { detectAndParse } from '@/lib/parsers'
import type { CardAccount, Resolution, Transaction, UploadedFile } from '@/lib/parsers/types'
import type { CardDoc } from '@/lib/db'
import { addCardOwner, lookupUidByEmail } from '@/lib/db'
import { matchTransactions, formatAmount } from '@/lib/matcher'
import { ResolveDialog } from '@/components/ResolveDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

type Tab = 'mismatches' | 'transactions' | 'csvs' | 'history'

interface CardDetailScreenProps {
  account: CardAccount
  resolutions: Resolution[]
  excluded: Set<string>
  cardDoc: CardDoc
  onAccountChange: (updated: CardAccount) => void
  onAddResolution: (r: Resolution) => void
  onRemoveResolution: (debitId: string) => void
  onToggleExcluded: (txId: string) => void
  onBack: () => void
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`
}

function parseFile(file: File) {
  return new Promise<{ bank: string; transactions: Transaction[] }>((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        try {
          const parsed = detectAndParse(results.data)
          resolve(parsed)
        } catch (e) {
          reject(e instanceof Error ? e : new Error('Failed to parse CSV'))
        }
      },
      error(err: { message: string }) { reject(new Error(err.message)) },
    })
  })
}

export function CardDetailScreen({
  account,
  resolutions,
  excluded,
  cardDoc,
  onAccountChange,
  onAddResolution,
  onRemoveResolution,
  onToggleExcluded,
  onBack,
}: CardDetailScreenProps) {
  const [tab, setTab] = useState<Tab>('mismatches')
  const [resolveTarget, setResolveTarget] = useState<{ tx: Transaction; mode: 'debit' | 'credit' } | null>(null)
  const [chargesOpen, setChargesOpen] = useState(true)
  const [paymentsOpen, setPaymentsOpen] = useState(true)
  const [showShareDialog, setShowShareDialog] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const [txFilterOpen, setTxFilterOpen] = useState(false)
  const [txFilter, setTxFilter] = useState<'all' | 'debits' | 'credits'>('all')
  const [txFromDate, setTxFromDate] = useState('')
  const [txToDate, setTxToDate] = useState('')

  // Resolutions are already scoped to this card (from cardDoc)
  const myResolutions = resolutions

  const { unmatched, unmatchedCredits, allCredits, remainders } = useMemo(
    () => matchTransactions(account.transactions, myResolutions),
    [account.transactions, myResolutions]
  )

  const outstandingRows = useMemo(
    () => [...unmatched, ...remainders].sort((a, b) => a.date.localeCompare(b.date)),
    [unmatched, remainders]
  )

  const totalOutstanding = outstandingRows.reduce((s, t) => s + t.amount, 0)

  const allTxnsSorted = useMemo(
    () => [...account.transactions].sort((a, b) => b.date.localeCompare(a.date)),
    [account.transactions]
  )

  const filteredTxns = useMemo(() => {
    return allTxnsSorted.filter(t => {
      if (txFilter === 'debits' && t.type !== 'debit') return false
      if (txFilter === 'credits' && t.type !== 'credit') return false
      if (txFromDate && t.date < txFromDate) return false
      if (txToDate && t.date > txToDate) return false
      return true
    })
  }, [allTxnsSorted, txFilter, txFromDate, txToDate])

  const unmatchedDebitIds = useMemo(() => new Set(unmatched.map(t => t.id)), [unmatched])

  const resolutionByDebitId = useMemo(() => {
    const map = new Map<string, Resolution>()
    for (const r of myResolutions) map.set(r.debitId, r)
    return map
  }, [myResolutions])

  const qualifyingSpend = account.transactions
    .filter(t => t.type === 'debit' && !excluded.has(t.id))
    .reduce((s, t) => s + t.amount, 0)

  const hasMinSpend = account.minSpend != null && account.minSpend > 0
  const progress = hasMinSpend ? Math.min(qualifyingSpend / account.minSpend!, 1) : null

  const isDebitRemainder = (t: Transaction) => t.id.startsWith('remainder:debit:')
  const originalDebitId = (t: Transaction) => t.id.replace(/^remainder:debit:/, '')

  // ── CSV upload ────────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return

    let updatedTransactions = [...account.transactions]
    let updatedFiles = [...account.files]
    let bank = account.bank

    const existingIds = new Set(account.transactions.map(t => t.id))
    const existingFileNames = new Set(account.files.map(f => f.name))

    const uniqueFileName = (name: string): string => {
      if (!existingFileNames.has(name)) return name
      const ext = name.endsWith('.csv') ? '.csv' : ''
      const base = ext ? name.slice(0, -ext.length) : name
      let n = 2
      while (existingFileNames.has(`${base} (${n})${ext}`)) n++
      return `${base} (${n})${ext}`
    }

    for (const file of Array.from(files)) {
      if (!file.name.endsWith('.csv')) continue
      const fileName = uniqueFileName(file.name)
      existingFileNames.add(fileName)
      try {
        const parsed = await parseFile(file)
        const newTxns = parsed.transactions.filter(t => !existingIds.has(t.id))
        newTxns.forEach(t => existingIds.add(t.id))
        updatedTransactions = [...updatedTransactions, ...newTxns]
        if (!bank) bank = parsed.bank
        const uploadedFile: UploadedFile = {
          name: fileName,
          uploadedAt: new Date().toISOString(),
          transactionIds: parsed.transactions.map(t => t.id),
        }
        updatedFiles = [...updatedFiles, uploadedFile]
      } catch { /* skip bad files */ }
    }

    onAccountChange({ ...account, bank, transactions: updatedTransactions, files: updatedFiles })
    if (inputRef.current) inputRef.current.value = ''
  }, [account, onAccountChange])

  // ── Remove CSV ────────────────────────────────────────────────────────────
  const removeFile = (fileName: string) => {
    const file = account.files.find(f => f.name === fileName)
    if (!file) return

    // Find transaction ids exclusively from this file (not in any other file)
    const otherFileIds = new Set(
      account.files
        .filter(f => f.name !== fileName)
        .flatMap(f => f.transactionIds)
    )
    const idsToRemove = new Set(file.transactionIds.filter(id => !otherFileIds.has(id)))

    const updatedTransactions = account.transactions.filter(t => !idsToRemove.has(t.id))
    const updatedFiles = account.files.filter(f => f.name !== fileName)

    onAccountChange({ ...account, transactions: updatedTransactions, files: updatedFiles })

    // Remove resolutions that referenced removed transactions
    for (const id of idsToRemove) {
      onRemoveResolution(id)
    }
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'mismatches', label: 'Mismatches', count: (outstandingRows.length + unmatchedCredits.length) || undefined },
    { id: 'transactions', label: 'Transactions', count: allTxnsSorted.length || undefined },
    { id: 'csvs', label: 'CSVs', count: account.files.length || undefined },
    { id: 'history', label: 'History', count: myResolutions.length || undefined },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <div className="px-4 pt-10 pb-4 space-y-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Cards
        </button>

        {/* Card title row */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold truncate">{account.name}</p>
            {account.bank && <p className="text-sm text-muted-foreground">{account.bank}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right">
              {totalOutstanding > 0 ? (
                <p className="text-sm font-semibold text-destructive">{formatAmount(totalOutstanding)} outstanding</p>
              ) : account.transactions.length > 0 ? (
                <p className="text-sm text-green-600 font-medium">All matched</p>
              ) : (
                <p className="text-sm text-muted-foreground">No transactions yet</p>
              )}
              {hasMinSpend && progress !== null && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {progress >= 1 ? 'Min spend reached' : `${formatAmount(qualifyingSpend)} / ${formatAmount(account.minSpend!)} min spend`}
                </p>
              )}
            </div>
            {/* Share button */}
            <button
              onClick={() => setShowShareDialog(true)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Share card"
              title="Share card"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
        {hasMinSpend && progress !== null && (
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="px-4 flex rounded-lg border border-border overflow-hidden mx-4 mb-4">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === t.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}{t.count != null ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 px-4 pb-8 space-y-4">

        {/* ── MISMATCHES TAB ── */}
        {tab === 'mismatches' && (
          <>
            {outstandingRows.length === 0 && unmatchedCredits.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                  {account.transactions.length === 0 ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                      <p className="text-sm text-muted-foreground text-center">Upload a CSV in the CSVs tab to get started.</p>
                      <Button size="sm" variant="outline" onClick={() => setTab('csvs')}>Go to CSVs</Button>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-sm text-muted-foreground text-center">Every charge has a matching payment.</p>
                    </>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Summary text fields */}
                {(outstandingRows.length > 0 || unmatchedCredits.length > 0) && (
                  <div className="flex gap-4 px-1">
                    {outstandingRows.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground">Total unmatched charges</p>
                        <p className="text-sm font-semibold text-destructive tabular-nums">{formatAmount(totalOutstanding)}</p>
                      </div>
                    )}
                    {unmatchedCredits.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground">Total unmatched payments</p>
                        <p className="text-sm font-semibold text-green-600 tabular-nums">
                          +{formatAmount(unmatchedCredits.reduce((s, c) => s + c.amount, 0))}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {outstandingRows.length > 0 && (
                  <Card>
                    {/* Collapsible header */}
                    <button
                      onClick={() => setChargesOpen(o => !o)}
                      className="w-full flex items-center justify-between px-5 py-3 text-left"
                    >
                      <span className="text-sm font-medium text-muted-foreground">
                        Unmatched charges ({outstandingRows.length})
                      </span>
                      <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 text-muted-foreground transition-transform ${chargesOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {chargesOpen && (
                      <CardContent className="px-0 pb-0 pt-0">
                        <Separator />
                        {outstandingRows.map((t, i) => {
                          const remainder = isDebitRemainder(t)
                          const origId = remainder ? originalDebitId(t) : t.id
                          const resolution = resolutionByDebitId.get(origId)
                          const isExcluded = excluded.has(t.id) || excluded.has(origId)

                          return (
                            <div key={t.id}>
                              {i > 0 && <Separator />}
                              <div className="flex items-start justify-between px-5 py-3 gap-3">
                                <div className="flex flex-col gap-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-sm font-medium truncate ${remainder ? 'text-muted-foreground' : ''}`}>
                                      {t.description}
                                    </span>
                                    {remainder && (
                                      <Badge variant="outline" className="text-xs shrink-0 border-amber-500/50 text-amber-600">Partial</Badge>
                                    )}
                                    {isExcluded && (
                                      <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">Excluded</Badge>
                                    )}
                                  </div>
                                  <span className="text-xs text-muted-foreground">{formatDate(t.date)}</span>
                                  {!remainder && (
                                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                                      {!resolution ? (
                                        <button
                                          onClick={() => setResolveTarget({ tx: t, mode: 'debit' })}
                                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                          </svg>
                                          Link payment
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => onRemoveResolution(t.id)}
                                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                                        >
                                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                          </svg>
                                          Unlink
                                        </button>
                                      )}
                                      <button
                                        onClick={() => onToggleExcluded(t.id)}
                                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                      >
                                        {isExcluded ? 'Include in min spend' : 'Exclude from min spend'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                                <span className="text-sm font-semibold text-destructive shrink-0 mt-0.5">
                                  {formatAmount(t.amount)}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </CardContent>
                    )}
                  </Card>
                )}

                {unmatchedCredits.length > 0 && (
                  <Card>
                    {/* Collapsible header */}
                    <button
                      onClick={() => setPaymentsOpen(o => !o)}
                      className="w-full flex items-center justify-between px-5 py-3 text-left"
                    >
                      <span className="text-sm font-medium text-muted-foreground">
                        Unmatched payments ({unmatchedCredits.length})
                      </span>
                      <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 text-muted-foreground transition-transform ${paymentsOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {paymentsOpen && (
                      <CardContent className="px-0 pb-0 pt-0">
                        <Separator />
                        {unmatchedCredits.map((c, i) => (
                          <div key={c.id}>
                            {i > 0 && <Separator />}
                            <div className="flex items-center justify-between px-5 py-3 gap-3">
                              <div className="flex flex-col gap-0.5 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm truncate">{c.description}</span>
                                  {c.id.startsWith('remainder:credit:') && (
                                    <Badge variant="outline" className="text-xs shrink-0 border-amber-500/50 text-amber-600">Partial</Badge>
                                  )}
                                </div>
                                <span className="text-xs text-muted-foreground">{formatDate(c.date)} · {c.card}</span>
                                <button
                                  onClick={() => setResolveTarget({ tx: c, mode: 'credit' })}
                                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1 w-fit"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                  </svg>
                                  Link to charge
                                </button>
                              </div>
                              <span className="text-sm font-semibold text-green-600 tabular-nums shrink-0">
                                +{formatAmount(c.amount)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    )}
                  </Card>
                )}
              </>
            )}
          </>
        )}

        {/* ── TRANSACTIONS TAB ── */}
        {tab === 'transactions' && (
          <>
            {allTxnsSorted.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <p className="text-sm text-muted-foreground text-center">Upload a CSV in the CSVs tab to get started.</p>
                  <Button size="sm" variant="outline" onClick={() => setTab('csvs')}>Go to CSVs</Button>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Header row: count + filter icon */}
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs text-muted-foreground">
                    {filteredTxns.length}{filteredTxns.length !== allTxnsSorted.length ? ` of ${allTxnsSorted.length}` : ''} transaction{allTxnsSorted.length !== 1 ? 's' : ''}
                  </span>
                  <div className="relative">
                    <button
                      onClick={() => setTxFilterOpen(o => !o)}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                        txFilter !== 'all' || txFromDate || txToDate
                          ? 'border-foreground text-foreground bg-foreground/5'
                          : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
                      }`}
                      aria-label="Filter transactions"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
                      </svg>
                      Filter
                      {(txFilter !== 'all' || txFromDate || txToDate) && (
                        <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
                      )}
                    </button>

                    {/* Popover */}
                    {txFilterOpen && (
                      <>
                        {/* backdrop */}
                        <div className="fixed inset-0 z-10" onClick={() => setTxFilterOpen(false)} />
                        <div className="absolute right-0 top-full mt-1.5 z-20 w-56 rounded-xl border border-border bg-background shadow-lg p-4 space-y-4">
                          {/* Type */}
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground">Type</p>
                            <div className="flex flex-col gap-1">
                              {(['all', 'debits', 'credits'] as const).map(f => (
                                <button
                                  key={f}
                                  onClick={() => setTxFilter(f)}
                                  className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg transition-colors text-left ${txFilter === f ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted'}`}
                                >
                                  {f === 'all' ? 'All' : f === 'debits' ? 'Charges only' : 'Payments only'}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Date range */}
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground">Date range</p>
                            <div className="space-y-1.5">
                              <div className="flex flex-col gap-0.5">
                                <label className="text-xs text-muted-foreground">From</label>
                                <input
                                  type="date"
                                  value={txFromDate}
                                  onChange={e => setTxFromDate(e.target.value)}
                                  className="w-full px-2 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              </div>
                              <div className="flex flex-col gap-0.5">
                                <label className="text-xs text-muted-foreground">To</label>
                                <input
                                  type="date"
                                  value={txToDate}
                                  onChange={e => setTxToDate(e.target.value)}
                                  className="w-full px-2 py-1.5 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Clear */}
                          {(txFilter !== 'all' || txFromDate || txToDate) && (
                            <button
                              onClick={() => { setTxFilter('all'); setTxFromDate(''); setTxToDate('') }}
                              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                            >
                              Clear filters
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {filteredTxns.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No transactions match the filters.</p>
                ) : (
                  <Card>
                    <CardContent className="px-0 pb-0">
                      {filteredTxns.map((t, i) => {
                        const isExcluded = excluded.has(t.id)
                        const isUnmatched = t.type === 'debit' && unmatchedDebitIds.has(t.id)
                        return (
                          <div key={t.id}>
                            {i > 0 && <Separator />}
                            <div className="flex items-start justify-between px-5 py-3 gap-3">
                              <div className="flex flex-col gap-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm font-medium truncate">{t.description}</span>
                                  {isUnmatched && <Badge variant="outline" className="text-xs shrink-0 border-destructive/50 text-destructive">Unmatched</Badge>}
                                  {isExcluded && <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">Excluded</Badge>}
                                </div>
                                <span className="text-xs text-muted-foreground">{formatDate(t.date)} · {t.card}</span>
                                {t.type === 'debit' && (
                                  <button
                                    onClick={() => onToggleExcluded(t.id)}
                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-0.5 w-fit"
                                  >
                                    {isExcluded ? 'Include in min spend' : 'Exclude from min spend'}
                                  </button>
                                )}
                              </div>
                              <span className={`text-sm font-semibold shrink-0 mt-0.5 tabular-nums ${t.type === 'credit' ? 'text-green-600' : 'text-foreground'}`}>
                                {t.type === 'credit' ? '+' : ''}{formatAmount(t.amount)}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </>
        )}

        {/* ── CSVs TAB ── */}
        {tab === 'csvs' && (
          <>
            {account.files.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-sm text-muted-foreground text-center">No CSVs uploaded yet.</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="px-0 pb-0">
                  {account.files.map((f, i) => {
                    const txCount = f.transactionIds.length
                    const uploadDate = new Date(f.uploadedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
                    return (
                      <div key={f.name}>
                        {i > 0 && <Separator />}
                        <div className="flex items-center justify-between px-5 py-3 gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{f.name}</p>
                              <p className="text-xs text-muted-foreground">{txCount} transaction{txCount !== 1 ? 's' : ''} · uploaded {uploadDate}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => removeFile(f.name)}
                            className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                            aria-label={`Remove ${f.name}`}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            )}

            {/* Upload button */}
            <div
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-5 cursor-pointer hover:border-primary/50 transition-colors text-sm text-muted-foreground"
              onClick={() => inputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              {account.files.length === 0 ? 'Upload CSV' : '+ Upload another CSV'}
            </div>
            <input ref={inputRef} type="file" accept=".csv" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
          </>
        )}

        {/* ── HISTORY TAB ── */}
        {tab === 'history' && (
          <>
            {myResolutions.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm text-muted-foreground text-center">No manual resolutions yet.</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Manual resolutions</CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  {[...myResolutions]
                    .sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt))
                    .map((r, i) => {
                      const debit = account.transactions.find(t => t.id === r.debitId)
                      const credit = account.transactions.find(t => t.id === r.creditId)
                      const resolvedDate = new Date(r.resolvedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
                      const gap = debit && credit
                        ? Math.round((debit.amount - credit.amount) * 100) / 100
                        : null

                      return (
                        <div key={r.debitId}>
                          {i > 0 && <Separator />}
                          <div className="px-5 py-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-muted-foreground">{resolvedDate}</span>
                              <div className="flex items-center gap-2">
                                {r.fullyResolved ? (
                                  <Badge variant="outline" className="text-xs border-green-500/50 text-green-600">Resolved</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-600">Partial</Badge>
                                )}
                                <button
                                  onClick={() => onRemoveResolution(r.debitId)}
                                  className="text-muted-foreground hover:text-destructive transition-colors"
                                  aria-label="Remove resolution"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            </div>

                            {/* Charge row */}
                            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground mb-0.5">Charge</p>
                                <p className="text-sm font-medium truncate">{debit?.description ?? r.debitId}</p>
                                {debit && <p className="text-xs text-muted-foreground">{formatDate(debit.date)}</p>}
                              </div>
                              <span className="text-sm font-semibold text-destructive tabular-nums ml-3 shrink-0">
                                {debit ? formatAmount(debit.amount) : '—'}
                              </span>
                            </div>

                            {/* Payment row */}
                            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground mb-0.5">Payment</p>
                                <p className="text-sm font-medium truncate">{credit?.description ?? r.creditId}</p>
                                {credit && <p className="text-xs text-muted-foreground">{formatDate(credit.date)}</p>}
                              </div>
                              <span className="text-sm font-semibold text-green-600 tabular-nums ml-3 shrink-0">
                                {credit ? `+${formatAmount(credit.amount)}` : '—'}
                              </span>
                            </div>

                            {/* Gap note */}
                            {gap !== null && gap !== 0 && (
                              <p className="text-xs text-muted-foreground px-1">
                                {gap > 0
                                  ? `${formatAmount(gap)} remainder ${r.fullyResolved ? 'marked resolved' : 'still outstanding'}`
                                  : `Overpaid by ${formatAmount(Math.abs(gap))}`
                                }
                              </p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Resolve dialog */}
      {resolveTarget && (
        <ResolveDialog
          anchor={resolveTarget.tx}
          mode={resolveTarget.mode}
          unmatchedCredits={unmatchedCredits}
          allCredits={allCredits}
          unmatchedDebits={unmatched}
          allDebits={account.transactions.filter(t => t.type === 'debit')}
          onResolve={r => {
            onAddResolution({ ...r, resolvedAt: new Date().toISOString() })
            setResolveTarget(null)
          }}
          onClose={() => setResolveTarget(null)}
        />
      )}

      {/* Share dialog */}
      {showShareDialog && (
        <ShareDialog
          account={account}
          cardDoc={cardDoc}
          onAccountChange={onAccountChange}
          onClose={() => setShowShareDialog(false)}
        />
      )}
    </div>
  )
}

// ── Share Dialog ──────────────────────────────────────────────────────────────

function ShareDialog({
  account,
  cardDoc,
  onAccountChange,
  onClose,
}: {
  account: CardAccount
  cardDoc: CardDoc
  onAccountChange: (updated: CardAccount) => void
  onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'not-found' | 'already-shared' | 'error'>('idle')

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return

    if (trimmed === account.owners.find(() => true)) {
      // edge case — skip
    }

    setStatus('loading')
    try {
      const uid = await lookupUidByEmail(trimmed)
      if (!uid) {
        setStatus('not-found')
        return
      }
      if (account.owners.includes(uid)) {
        setStatus('already-shared')
        return
      }
      await addCardOwner(cardDoc, uid)
      // Update local state so the owners array reflects immediately
      onAccountChange({ ...account, owners: [...account.owners, uid] })
      setStatus('success')
      setEmail('')
    } catch {
      setStatus('error')
    }
  }

  const ownerCount = account.owners.length

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-background rounded-2xl shadow-xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Share card</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          {ownerCount === 1
            ? 'Only you have access. Enter an email to share.'
            : `${ownerCount} people have access.`}
        </p>

        <form onSubmit={handleShare} className="space-y-3">
          <input
            type="email"
            required
            placeholder="colleague@example.com"
            value={email}
            onChange={e => { setEmail(e.target.value); setStatus('idle') }}
            className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />

          {status === 'not-found' && (
            <p className="text-xs text-destructive">No account found with that email. They need to sign up first.</p>
          )}
          {status === 'already-shared' && (
            <p className="text-xs text-muted-foreground">This person already has access.</p>
          )}
          {status === 'success' && (
            <p className="text-xs text-green-600">Access granted.</p>
          )}
          {status === 'error' && (
            <p className="text-xs text-destructive">Something went wrong. Try again.</p>
          )}

          <Button type="submit" className="w-full" disabled={status === 'loading'}>
            {status === 'loading' ? 'Adding…' : 'Add person'}
          </Button>
        </form>
      </div>
    </div>
  )
}
