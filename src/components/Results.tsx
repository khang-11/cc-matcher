import { useMemo } from 'react'
import type { Transaction } from '@/lib/parsers/types'
import { matchTransactions, groupByCard, formatAmount } from '@/lib/matcher'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface ResultsProps {
  transactions: Transaction[]
  selectedCards: string[]
  onBack: () => void
}

export function Results({ transactions, selectedCards, onBack }: ResultsProps) {
  const { unmatched } = useMemo(
    () => matchTransactions(transactions, selectedCards),
    [transactions, selectedCards]
  )

  const grouped = useMemo(() => groupByCard(unmatched), [unmatched])

  const total = useMemo(
    () => unmatched.reduce((sum, t) => sum + t.amount, 0),
    [unmatched]
  )

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
            {unmatched.length === 0
              ? 'All payments matched'
              : `${unmatched.length} unmatched charge${unmatched.length !== 1 ? 's' : ''}`}
          </h1>
        </div>

        {unmatched.length === 0 ? (
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
            {/* Cards with unmatched transactions */}
            {Array.from(grouped.entries()).map(([card, txns]) => (
              <Card key={card}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{card}</CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  {txns.map((t, i) => (
                    <div key={`${t.date}-${t.description}-${t.amount}-${i}`}>
                      {i > 0 && <Separator />}
                      <div className="flex items-center justify-between px-6 py-3">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{t.description}</span>
                            {t.status === 'pending' && (
                              <Badge variant="outline" className="text-xs shrink-0">Pending</Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(t.date)}
                          </span>
                        </div>
                        <span className="text-sm font-semibold text-destructive ml-4 shrink-0">
                          {formatAmount(t.amount)}
                        </span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}

            {/* Total */}
            <Card className="bg-destructive/5 border-destructive/20">
              <CardContent className="flex items-center justify-between py-4 px-6">
                <span className="text-sm font-medium">Total outstanding</span>
                <span className="text-base font-bold text-destructive">{formatAmount(total)}</span>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`
}
