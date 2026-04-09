import type { Transaction } from './parsers/types'

export interface UnmatchedTransaction {
  transaction: Transaction
  /** true if this debit has no corresponding credit of the same amount */
  unmatched: true
}

export interface MatchResult {
  unmatched: Transaction[]
  matched: Transaction[]
}

/**
 * Match debits to credits by exact absolute amount (one-to-one, shared pool).
 *
 * - Credits from ALL selected cards form one shared pool.
 * - Each credit can only be used once (multiset matching).
 * - All debits across selected cards are checked against the pool.
 * - Returns debits that have no matching credit.
 */
export function matchTransactions(
  transactions: Transaction[],
  selectedCards: string[],
): MatchResult {
  const selected = transactions.filter(t => selectedCards.includes(t.card))

  const debits = selected.filter(t => t.type === 'debit')
  const credits = selected.filter(t => t.type === 'credit')

  // Build a multiset of available credit amounts keyed by amount in cents
  // (use cents to avoid floating point equality issues)
  const creditPool = new Map<number, number>()
  for (const credit of credits) {
    const key = Math.round(credit.amount * 100)
    creditPool.set(key, (creditPool.get(key) ?? 0) + 1)
  }

  const unmatched: Transaction[] = []
  const matched: Transaction[] = []

  for (const debit of debits) {
    const key = Math.round(debit.amount * 100)
    const available = creditPool.get(key) ?? 0
    if (available > 0) {
      creditPool.set(key, available - 1)
      matched.push(debit)
    } else {
      unmatched.push(debit)
    }
  }

  return { unmatched, matched }
}

/** Group unmatched transactions by card, sorted by date ascending */
export function groupByCard(transactions: Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>()
  for (const t of transactions) {
    const existing = groups.get(t.card) ?? []
    existing.push(t)
    groups.set(t.card, existing)
  }
  // Sort each group by date
  for (const [card, txns] of groups) {
    groups.set(card, txns.sort((a, b) => a.date.localeCompare(b.date)))
  }
  return groups
}

export function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(amount)
}
