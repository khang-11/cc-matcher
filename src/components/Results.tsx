import { useMemo, useState } from 'react'
import type { CardAccount, Transaction, Resolution } from '@/lib/parsers/types'
import { matchTransactions, formatAmount } from '@/lib/matcher'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ResolveDialog } from '@/components/ResolveDialog'

interface ResultsProps {
  accounts: CardAccount[]
  resolutions: Resolution[]
  excluded: Set<string>
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

export function Results({
  accounts,
  resolutions,
  excluded,
  onAddResolution,
  onRemoveResolution,
  onToggleExcluded,
  onBack,
}: ResultsProps) {
  const [resolveTarget, setResolveTarget] = useState<Transaction | null>(null)

  // Merge all transactions across accounts
  const allTransactions = useMemo(
    () => accounts.flatMap(a => a.transactions),
    [accounts]
  )

  const { unmatched, unmatchedCredits, allCredits, remainders } = useMemo(
    () => matchTransactions(allTransactions, resolutions),
    [allTransactions, resolutions]
  )

  // All outstanding rows = unmatched + remainders, sorted by date
  const outstandingRows = useMemo(() =>
    [...unmatched, ...remainders].sort((a, b) => a.date.localeCompare(b.date)),
    [unmatched, remainders]
  )

  const totalOutstanding = useMemo(
    () => outstandingRows.reduce((s, t) => s + t.amount, 0),
    [outstandingRows]
  )

  // Net balance per account
  const accountStats = useMemo(() => {
    return accounts.map(account => {
      const txns = account.transactions
      const totalDebits = txns.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0)
      const totalCredits = txns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
      const netBalance = totalDebits - totalCredits

      // Min spend progress: all debits not excluded
      const qualifyingSpend = txns
        .filter(t => t.type === 'debit' && !excluded.has(t.id))
        .reduce((s, t) => s + t.amount, 0)

      return { account, netBalance, qualifyingSpend }
    })
  }, [accounts, excluded])

  // Check if a debit has a manual resolution
  const resolutionByDebitId = useMemo(() => {
    const map = new Map<string, Resolution>()
    for (const r of resolutions) map.set(r.debitId, r)
    return map
  }, [resolutions])

  const isRemainder = (t: Transaction) => t.id.startsWith('remainder:')
  const originalId = (t: Transaction) => t.id.replace(/^remainder:/, '')

  return (
    <div className="flex min-h-screen justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 px-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </Button>
          <h1 className="text-lg font-semibold">
            {outstandingRows.length === 0
              ? 'All payments matched'
              : `${outstandingRows.length} outstanding charge${outstandingRows.length !== 1 ? 's' : ''}`}
          </h1>
        </div>

        {/* Per-account summary cards */}
        {accountStats.map(({ account, netBalance, qualifyingSpend }) => {
          const hasMinSpend = account.minSpend !== null && account.minSpend > 0
          const progress = hasMinSpend
            ? Math.min(qualifyingSpend / account.minSpend!, 1)
            : null
          // netBalance = debits - credits
          // positive = you owe; negative = credit balance (they owe you)
          const owes = netBalance > 0
          const inCredit = netBalance < 0

          return (
            <Card key={account.id}>
              <CardContent className="py-4 px-5 space-y-3">
                {/* Account name + net balance */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{account.name}</span>
                  <span className={`text-sm font-semibold tabular-nums ${owes ? 'text-destructive' : inCredit ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {inCredit ? '+' : owes ? '-' : ''}{formatAmount(Math.abs(netBalance))}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground -mt-1">
                  {owes ? 'You owe' : inCredit ? 'Credit balance' : 'Settled'}
                </p>

                {/* Min spend progress */}
                {hasMinSpend && progress !== null && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Min spend</span>
                      <span className="tabular-nums">
                        {formatAmount(qualifyingSpend)}
                        <span className="text-muted-foreground"> / {formatAmount(account.minSpend!)}</span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${progress * 100}%` }}
                      />
                    </div>
                    {progress < 1 && (
                      <p className="text-xs text-muted-foreground">
                        {formatAmount(account.minSpend! - qualifyingSpend)} to go
                      </p>
                    )}
                    {progress >= 1 && (
                      <p className="text-xs text-green-500 font-medium">Min spend reached</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}

        {/* All clear */}
        {outstandingRows.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-muted-foreground text-center">
                Every charge has a matching payment. You're all caught up!
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Unmatched charges</CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                {outstandingRows.map((t, i) => {
                  const remainder = isRemainder(t)
                  const origId = remainder ? originalId(t) : t.id
                  const resolution = resolutionByDebitId.get(origId)
                  const isExcluded = excluded.has(t.id) || excluded.has(origId)

                  return (
                    <div key={t.id}>
                      {i > 0 && <Separator />}
                      <div className="flex items-start justify-between px-5 py-3 gap-3">
                        {/* Left: description + badges */}
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-sm font-medium truncate ${remainder ? 'text-muted-foreground' : ''}`}>
                              {t.description}
                            </span>
                            {t.status === 'pending' && !remainder && (
                              <Badge variant="outline" className="text-xs shrink-0">Pending</Badge>
                            )}
                            {remainder && (
                              <Badge variant="outline" className="text-xs shrink-0 border-amber-500/50 text-amber-600">Partial</Badge>
                            )}
                            {isExcluded && (
                              <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">Excluded</Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">{formatDate(t.date)}</span>

                          {/* Action buttons */}
                          {!remainder && (
                            <div className="flex items-center gap-2 mt-1">
                              {/* Link payment button */}
                              {!resolution && (
                                <button
                                  onClick={() => setResolveTarget(t)}
                                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                  </svg>
                                  Link payment
                                </button>
                              )}
                              {/* Unlink button if already resolved */}
                              {resolution && (
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
                              {/* Exclude toggle */}
                              <button
                                onClick={() => onToggleExcluded(t.id)}
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 7l10 10M7 17L17 7" />
                                </svg>
                                {isExcluded ? 'Include' : 'Exclude from min spend'}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Right: amount */}
                        <span className="text-sm font-semibold text-destructive shrink-0 mt-0.5">
                          {formatAmount(t.amount)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            {/* Total outstanding */}
            <Card className="bg-destructive/5 border-destructive/20">
              <CardContent className="flex items-center justify-between py-4 px-5">
                <span className="text-sm font-medium">Total outstanding</span>
                <span className="text-base font-bold text-destructive tabular-nums">
                  {formatAmount(totalOutstanding)}
                </span>
              </CardContent>
            </Card>

            {/* Unmatched credits — payments with no corresponding charge */}
            {unmatchedCredits.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Unmatched payments ({unmatchedCredits.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  {unmatchedCredits.map((c, i) => (
                    <div key={c.id}>
                      {i > 0 && <Separator />}
                      <div className="flex items-center justify-between px-5 py-3">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-sm truncate">{c.description}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(c.date)} · {c.card}
                          </span>
                        </div>
                        <span className="text-sm font-semibold text-green-600 tabular-nums ml-3 shrink-0">
                          +{formatAmount(c.amount)}
                        </span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Resolve dialog */}
      {resolveTarget && (
        <ResolveDialog
          debit={resolveTarget}
          unmatchedCredits={unmatchedCredits}
          allCredits={allCredits}
          onResolve={r => {
            onAddResolution(r)
            setResolveTarget(null)
          }}
          onClose={() => setResolveTarget(null)}
        />
      )}
    </div>
  )
}
