import type { Transaction, Resolution } from './parsers/types'

export interface MatchResult {
  /** Debits with no exact-amount credit AND no manual resolution */
  unmatched: Transaction[]
  /** Debits consumed by exact-amount matching */
  matched: Transaction[]
  /** Credits not consumed by exact-amount matching (available for manual linking) */
  unmatchedCredits: Transaction[]
  /** All credits, for "show all" mode in resolve dialog */
  allCredits: Transaction[]
  /**
   * Remainder rows: virtual transactions produced when a resolution is
   * marked "remainder outstanding" and the credit didn't fully cover the debit.
   * amount = debit.amount - credit.amount (always > 0 here).
   * id = `remainder:${debitId}`
   */
  remainders: Transaction[]
}

/**
 * Match debits to credits by exact absolute amount (one-to-one, shared pool),
 * then apply manual resolutions on top.
 */
export function matchTransactions(
  transactions: Transaction[],
  resolutions: Resolution[],
): MatchResult {
  const debits = transactions.filter(t => t.type === 'debit')
  const credits = transactions.filter(t => t.type === 'credit')

  const allCredits = [...credits]

  // --- Phase 1: exact-amount multiset matching ---
  const creditPool = new Map<number, Transaction[]>()
  for (const credit of credits) {
    const key = Math.round(credit.amount * 100)
    const bucket = creditPool.get(key) ?? []
    bucket.push(credit)
    creditPool.set(key, bucket)
  }

  // Track which credit ids were consumed by exact matching
  const exactlyConsumedCreditIds = new Set<string>()

  const autoMatched: Transaction[] = []
  const autoUnmatched: Transaction[] = []

  for (const debit of debits) {
    const key = Math.round(debit.amount * 100)
    const bucket = creditPool.get(key)
    if (bucket && bucket.length > 0) {
      const credit = bucket.shift()!
      exactlyConsumedCreditIds.add(credit.id)
      autoMatched.push(debit)
    } else {
      autoUnmatched.push(debit)
    }
  }

  const unmatchedCredits = credits.filter(c => !exactlyConsumedCreditIds.has(c.id))

  // --- Phase 2: apply manual resolutions ---
  // Build lookup maps
  const resolutionByDebitId = new Map<string, Resolution>()
  for (const r of resolutions) {
    resolutionByDebitId.set(r.debitId, r)
  }
  const creditById = new Map<string, Transaction>()
  for (const c of allCredits) {
    creditById.set(c.id, c)
  }

  const unmatched: Transaction[] = []
  const remainders: Transaction[] = []

  for (const debit of autoUnmatched) {
    const resolution = resolutionByDebitId.get(debit.id)
    if (!resolution) {
      unmatched.push(debit)
      continue
    }

    if (resolution.fullyResolved) {
      // Fully resolved — drop it entirely
      continue
    }

    // Remainder outstanding
    const credit = creditById.get(resolution.creditId)
    if (!credit) {
      // Credit disappeared (shouldn't happen) — keep as unmatched
      unmatched.push(debit)
      continue
    }

    const gap = Math.round((debit.amount - credit.amount) * 100) / 100
    if (gap > 0) {
      // Underpaid — show remainder row
      remainders.push({
        ...debit,
        id: `remainder:${debit.id}`,
        amount: gap,
        description: debit.description,
      })
    }
    // If gap <= 0 (overpaid or exact), nothing stays outstanding
  }

  return {
    unmatched,
    matched: autoMatched,
    unmatchedCredits,
    allCredits,
    remainders,
  }
}

/** Group transactions by card, sorted by date ascending */
export function groupByCard(transactions: Transaction[]): Map<string, Transaction[]> {
  const groups = new Map<string, Transaction[]>()
  for (const t of transactions) {
    const existing = groups.get(t.card) ?? []
    existing.push(t)
    groups.set(t.card, existing)
  }
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
