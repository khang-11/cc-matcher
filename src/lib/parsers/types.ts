export type TransactionType = 'debit' | 'credit'

export interface Transaction {
  id: string            // stable hash: date+type+amount+description+card
  date: string          // YYYY-MM-DD
  description: string
  amount: number        // always positive
  type: TransactionType
  card: string          // e.g. "Card ending 2953"
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

/**
 * One uploaded CSV file stored inside a CardAccount.
 * Keeping transactionIds per-file lets us cleanly remove a file's
 * transactions (and their resolutions) when the file is deleted.
 */
export interface UploadedFile {
  name: string
  uploadedAt: string       // ISO timestamp
  transactionIds: string[] // ids of transactions sourced from this file
}

/** One card account — may have multiple CSVs merged into it */
export interface CardAccount {
  id: string                // random uuid, generated on card creation
  name: string              // user-editable
  bank: string              // detected from first CSV; empty string until first CSV uploaded
  files: UploadedFile[]     // one entry per uploaded CSV file (replaces flat fileNames[])
  transactions: Transaction[]
  minSpend: number | null   // null = no target set
  owners: string[]          // Firebase UIDs of users who have access to this card
}

/** A manual link between an unmatched debit and a credit */
export interface Resolution {
  debitId: string
  creditId: string
  fullyResolved: boolean    // true = ignore any gap; false = remainder stays outstanding
  resolvedAt: string        // ISO timestamp — for history tab
}
