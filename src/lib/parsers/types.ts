export type TransactionType = 'debit' | 'credit'
export type TransactionStatus = 'posted' | 'pending'

export interface Transaction {
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
