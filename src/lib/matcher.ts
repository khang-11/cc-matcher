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
   * Remainder credit rows: when one or more resolutions leave a credit partially used.
   * amount = credit.amount - sum(debits using this credit). id = `remainder:credit:${creditId}`
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
  const debitById = new Map<string, Transaction>()
  for (const d of debits) {
    debitById.set(d.id, d)
  }

  // Pre-compute effective available credit amount per debit, in resolvedAt order.
  // This handles credits used across multiple resolutions correctly.
  // Also normalise legacy synthetic creditIds (remainder:credit:<id>) → original id.
  const creditAvail = new Map<string, number>()
  for (const c of allCredits) creditAvail.set(c.id, c.amount)

  const effectiveAmountForDebit = new Map<string, number>()

  const sortedResolutions = [...resolutions].sort((a, b) =>
    (a.resolvedAt ?? '').localeCompare(b.resolvedAt ?? ''),
  )

  for (const r of sortedResolutions) {
    const rawCreditId = r.creditId.replace(/^remainder:credit:/, '')
    const debit = debitById.get(r.debitId)
    const credit = creditById.get(rawCreditId)
    if (!debit || !credit) continue

    const available = creditAvail.get(rawCreditId) ?? 0
    effectiveAmountForDebit.set(r.debitId, available)

    // How much of the credit is consumed by this debit:
    //   - overpaid (credit > debit): debit.amount consumed, remainder stays
    //   - underpaid or exact: entire available credit consumed
    const used = Math.min(debit.amount, available)
    creditAvail.set(rawCreditId, Math.max(0, available - used))
  }

  // Track which credits are consumed by manual resolutions (so they leave unmatchedCredits)
  const manuallyConsumedCreditIds = new Set<string>()

  const unmatched: Transaction[] = []
  const remainders: Transaction[] = []

  for (const debit of autoUnmatched) {
    const resolution = resolutionByDebitId.get(debit.id)
    if (!resolution) {
      unmatched.push(debit)
      continue
    }

    const rawCreditId = resolution.creditId.replace(/^remainder:credit:/, '')
    const credit = creditById.get(rawCreditId)
    if (!credit) {
      unmatched.push(debit)
      continue
    }

    manuallyConsumedCreditIds.add(rawCreditId)

    const effectiveAmount = effectiveAmountForDebit.get(debit.id) ?? credit.amount
    if (effectiveAmount <= 0) {
      // Credit was fully consumed by prior resolutions — treat debit as unmatched
      unmatched.push(debit)
      continue
    }

    const gap = Math.round((debit.amount - effectiveAmount) * 100) / 100

    if (gap > 0 && !resolution.fullyResolved) {
      // Underpaid and not forgiven: debit remainder stays outstanding
      remainders.push({
        ...debit,
        id: `remainder:debit:${debit.id}`,
        amount: gap,
      })
    }
    // gap < 0 (overpaid) and gap === 0 (exact): debit is resolved, no debit remainder
    // Credit remainder (if any) is handled below via creditAvail
  }

  // Build remainder credits from the final available balance of each manually-consumed credit.
  // Using creditAvail post-loop gives exactly one entry per credit regardless of how many
  // debits referenced it.
  const remainderCredits: Transaction[] = []
  for (const [creditId, remaining] of creditAvail) {
    if (remaining > 0 && manuallyConsumedCreditIds.has(creditId)) {
      const credit = creditById.get(creditId)!
      remainderCredits.push({
        ...credit,
        id: `remainder:credit:${creditId}`,
        amount: remaining,
      })
    }
  }

  // Remove manually consumed credits from unmatchedCredits, add remainder credits
  const postPhase2UnmatchedCredits = [
    ...unmatchedCredits.filter(c => !manuallyConsumedCreditIds.has(c.id)),
    ...remainderCredits,
  ]

  // --- Phase 3: auto-match remainder debits against unmatched credits ---
  // e.g. $50 debit partially resolved with $13 → $37 remainder; a new $37 credit should auto-match it.
  const remainderCreditPool = new Map<number, Transaction[]>()
  for (const c of postPhase2UnmatchedCredits) {
    const key = Math.round(c.amount * 100)
    const bucket = remainderCreditPool.get(key) ?? []
    bucket.push(c)
    remainderCreditPool.set(key, bucket)
  }

  const autoResolvedRemaindCreditIds = new Set<string>()
  const finalRemainders: Transaction[] = []

  for (const remainder of remainders) {
    const key = Math.round(remainder.amount * 100)
    const bucket = remainderCreditPool.get(key)
    if (bucket && bucket.length > 0) {
      const credit = bucket.shift()!
      autoResolvedRemaindCreditIds.add(credit.id)
      // remainder is resolved — drop it from outstanding
    } else {
      finalRemainders.push(remainder)
    }
  }

  const finalUnmatchedCredits = postPhase2UnmatchedCredits.filter(
    c => !autoResolvedRemaindCreditIds.has(c.id),
  )

  return {
    unmatched,
    matched: autoMatched,
    unmatchedCredits: finalUnmatchedCredits,
    allCredits,
    remainders: finalRemainders,
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
