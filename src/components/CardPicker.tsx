import { useState, useMemo } from 'react'
import type { ParseResult, Transaction } from '@/lib/parsers/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'

interface CardPickerProps {
  parseResult: ParseResult
  fileName: string
  onCheck: (selectedCards: string[]) => void
  onReset: () => void
}

export function CardPicker({ parseResult, fileName, onCheck, onReset }: CardPickerProps) {
  const { transactions, bank } = parseResult

  // Derive unique cards and their debit counts
  const cards = useMemo(() => {
    const map = new Map<string, { debits: number; credits: number }>()
    for (const t of transactions) {
      const existing = map.get(t.card) ?? { debits: 0, credits: 0 }
      if (t.type === 'debit') existing.debits++
      else existing.credits++
      map.set(t.card, existing)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [transactions])

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(cards.map(([card]) => card))
  )

  const toggle = (card: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(card)) next.delete(card)
      else next.add(card)
      return next
    })
  }

  const totalDebits = useMemo(() => {
    return transactions.filter(
      (t: Transaction) => t.type === 'debit' && selected.has(t.card)
    ).length
  }, [transactions, selected])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Card Payment Checker</h1>
        </div>

        {/* File info */}
        <Card>
          <CardContent className="py-3 px-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-sm font-medium truncate max-w-[200px]">{fileName}</span>
              <Badge variant="secondary">{bank}</Badge>
            </div>
            <Button variant="ghost" size="sm" onClick={onReset} className="text-xs">
              Change
            </Button>
          </CardContent>
        </Card>

        {/* Card selector */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select cards to check</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {cards.map(([card, stats]) => (
              <div key={card} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id={card}
                    checked={selected.has(card)}
                    onCheckedChange={() => toggle(card)}
                  />
                  <label htmlFor={card} className="text-sm cursor-pointer select-none">
                    {card}
                  </label>
                </div>
                <span className="text-xs text-muted-foreground">
                  {stats.debits} charges · {stats.credits} payments
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Button
          className="w-full"
          disabled={selected.size === 0 || totalDebits === 0}
          onClick={() => onCheck(Array.from(selected))}
        >
          Check {totalDebits} transaction{totalDebits !== 1 ? 's' : ''}
        </Button>
      </div>
    </div>
  )
}
