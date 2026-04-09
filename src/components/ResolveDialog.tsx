import { useState } from 'react'
import type { Transaction, Resolution } from '@/lib/parsers/types'
import { formatAmount } from '@/lib/matcher'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface ResolveDialogProps {
  debit: Transaction
  unmatchedCredits: Transaction[]
  allCredits: Transaction[]
  onResolve: (r: Resolution) => void
  onClose: () => void
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`
}

export function ResolveDialog({
  debit,
  unmatchedCredits,
  allCredits,
  onResolve,
  onClose,
}: ResolveDialogProps) {
  const [showAll, setShowAll] = useState(false)
  const [selectedCreditId, setSelectedCreditId] = useState<string | null>(null)

  const credits = showAll ? allCredits : unmatchedCredits
  const selectedCredit = credits.find(c => c.id === selectedCreditId) ??
    allCredits.find(c => c.id === selectedCreditId)

  const gap = selectedCredit
    ? Math.round((debit.amount - selectedCredit.amount) * 100) / 100
    : null

  const isExact = gap === 0
  const isUnderpaid = gap !== null && gap > 0
  const isOverpaid = gap !== null && gap < 0

  const handleResolve = (fullyResolved: boolean) => {
    if (!selectedCreditId) return
    onResolve({ debitId: debit.id, creditId: selectedCreditId, fullyResolved })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
        <div className="bg-background rounded-xl w-full max-w-md shadow-xl flex flex-col max-h-[85vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
            <h2 className="text-base font-semibold">Link payment</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Charge being resolved */}
          <div className="mx-5 mb-4 rounded-lg bg-muted/50 px-4 py-3 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{debit.description}</span>
                  {debit.status === 'pending' && (
                    <Badge variant="outline" className="text-xs shrink-0">Pending</Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{formatDate(debit.date)}</span>
              </div>
              <span className="text-sm font-bold text-destructive ml-3 shrink-0">
                {formatAmount(debit.amount)}
              </span>
            </div>
          </div>

          <Separator />

          {/* Credit list header */}
          <div className="flex items-center justify-between px-5 py-2.5 shrink-0">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {showAll ? 'All payments' : 'Available payments'}
            </span>
            <button
              onClick={() => setShowAll(s => !s)}
              className="text-xs text-primary hover:underline"
            >
              {showAll ? 'Show unmatched only' : 'Show all payments'}
            </button>
          </div>

          {/* Scrollable credit list */}
          <div className="overflow-y-auto flex-1 min-h-0">
            {credits.length === 0 ? (
              <div className="px-5 py-6 text-center text-sm text-muted-foreground">
                No available payments.{' '}
                <button onClick={() => setShowAll(true)} className="text-primary hover:underline">
                  Show all payments
                </button>
              </div>
            ) : (
              credits.map((credit, i) => {
                const isSelected = credit.id === selectedCreditId
                const isAlreadyConsumed = !unmatchedCredits.find(c => c.id === credit.id)
                return (
                  <div key={credit.id}>
                    {i > 0 && <Separator />}
                    <button
                      onClick={() => setSelectedCreditId(isSelected ? null : credit.id)}
                      className={`w-full text-left px-5 py-3 transition-colors flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-primary/10'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm truncate">{credit.description}</span>
                          {isAlreadyConsumed && showAll && (
                            <Badge variant="outline" className="text-xs shrink-0 text-muted-foreground">Used</Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(credit.date)} · {credit.card}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-semibold text-green-600 tabular-nums">
                          {formatAmount(credit.amount)}
                        </span>
                        {isSelected && (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {/* Gap summary + actions */}
          {selectedCredit && (
            <>
              <Separator />
              <div className="px-5 py-4 space-y-3 shrink-0">
                {/* Gap display */}
                <div className={`rounded-lg px-4 py-2.5 text-sm ${
                  isExact
                    ? 'bg-green-500/10 text-green-600'
                    : isUnderpaid
                    ? 'bg-amber-500/10 text-amber-600'
                    : 'bg-blue-500/10 text-blue-600'
                }`}>
                  {isExact && 'Exact match'}
                  {isUnderpaid && `${formatAmount(gap!)} still outstanding after linking`}
                  {isOverpaid && `Overpaid by ${formatAmount(Math.abs(gap!))}`}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2">
                  {isUnderpaid ? (
                    <>
                      <Button
                        className="flex-1"
                        onClick={() => handleResolve(false)}
                      >
                        Keep {formatAmount(gap!)} outstanding
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => handleResolve(true)}
                      >
                        Mark fully resolved
                      </Button>
                    </>
                  ) : (
                    <Button
                      className="flex-1"
                      onClick={() => handleResolve(true)}
                    >
                      Mark resolved
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
