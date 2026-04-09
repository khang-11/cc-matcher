export type TransactionType = 'debit' | 'credit'
export type TransactionStatus = 'posted' | 'pending'

export interface Transaction {
  id: string            // stable hash: date+type+amount+description+card
  date: string          // YYYY-MM-DD
  description: string
  amount: number        // always positive
  type: TransactionType
  card: string          // e.g. "Card ending 2953"
  status: TransactionStatus
  raw: Record<string, string>
}

export interface ParseResult {
  transactions: Transaction[]
  bank: string
}

export interface Parser {
  name: string
  detect: (headers: string[]) => boolean
  parse: (rows: Record<string, string>[]) => Transaction[]
}

/** One card account — may have multiple CSVs merged into it */
export interface CardAccount {
  id: string                // random uuid, generated on card creation
  name: string              // user-editable
  bank: string              // detected from first CSV; empty string until first CSV uploaded
  fileNames: string[]       // one entry per uploaded CSV file (for display / removal)
  transactions: Transaction[]
  minSpend: number | null   // null = no target set
}

/** A manual link between an unmatched debit and a credit */
export interface Resolution {
  debitId: string
  creditId: string
  fullyResolved: boolean    // true = ignore any gap; false = remainder stays outstanding
}
