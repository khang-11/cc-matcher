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
   * Remainder debit rows: when a resolution is "remainder outstanding" and credit < debit.
   * amount = debit.amount - credit.amount. id = `remainder:debit:${debitId}`
   */
  remainders: Transaction[]
  /**
   * Remainder credit rows: when a resolution links a credit to a smaller debit.
   * amount = credit.amount - debit.amount. id = `remainder:credit:${creditId}`
   */
  remainderCredits: Transaction[]
}

/**
 * Match debits to credits by exact absolute amount (one-to-one, shared pool),
 * then apply manual resolutions on top.
 */
export function matchTransactions(
  transactions: Transaction[],
  resolutions: Resolution[],
): MatchResult {
  // Deduplicate by id — when two CSVs overlap, same transaction appears twice
  const seen = new Set<string>()
  const unique = transactions.filter(t => {
    if (seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })

  const debits = unique.filter(t => t.type === 'debit')
  const credits = unique.filter(t => t.type === 'credit')

  const allCredits = [...credits]

  // --- Phase 1: exact-amount multiset matching ---
  // Debits that already have a manual resolution are excluded from auto-matching —
  // once you've manually touched a debit its remainder must also be resolved manually.
  const resolvedDebitIds = new Set(resolutions.map(r => r.debitId))

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
    if (resolvedDebitIds.has(debit.id)) {
      // Skip auto-matching — this debit is handled by a manual resolution
      autoUnmatched.push(debit)
      continue
    }
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
  const remainderCredits: Transaction[] = []

  // Track which credits are consumed by manual resolutions (so they leave unmatchedCredits)
  const manuallyConsumedCreditIds = new Set<string>()

  for (const debit of autoUnmatched) {
    const resolution = resolutionByDebitId.get(debit.id)
    if (!resolution) {
      unmatched.push(debit)
      continue
    }

    if (resolution.fullyResolved) {
      manuallyConsumedCreditIds.add(resolution.creditId)
      continue
    }

    // Remainder outstanding
    const credit = creditById.get(resolution.creditId)
    if (!credit) {
      unmatched.push(debit)
      continue
    }

    manuallyConsumedCreditIds.add(credit.id)
    const gap = Math.round((debit.amount - credit.amount) * 100) / 100

    if (gap > 0) {
      // Credit < debit: debit remainder stays outstanding
      remainders.push({
        ...debit,
        id: `remainder:debit:${debit.id}`,
        amount: gap,
      })
    } else if (gap < 0) {
      // Credit > debit: excess credit stays as unmatched credit remainder
      remainderCredits.push({
        ...credit,
        id: `remainder:credit:${credit.id}`,
        amount: Math.abs(gap),
      })
    }
    // gap === 0: exact, nothing outstanding
  }

  // Remove manually consumed credits from unmatchedCredits, add remainder credits
  const finalUnmatchedCredits = [
    ...unmatchedCredits.filter(c => !manuallyConsumedCreditIds.has(c.id)),
    ...remainderCredits,
  ]

  return {
    unmatched,
    matched: autoMatched,
    unmatchedCredits: finalUnmatchedCredits,
    allCredits,
    remainders,
    remainderCredits,
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
