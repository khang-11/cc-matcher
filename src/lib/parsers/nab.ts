import type { Parser, Transaction, TransactionStatus } from './types'

// NAB CSV headers:
// Date,Amount,Account Number,,Transaction Type,Transaction Details,Balance,Category,Merchant Name,Processed On

const NAB_HEADERS = ['Date', 'Amount', 'Account Number', 'Transaction Type', 'Transaction Details', 'Balance']

function parseDate(raw: string): string {
  // "08 Apr 26" → "2026-04-08"
  const months: Record<string, string> = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  }
  const parts = raw.trim().split(' ')
  if (parts.length !== 3) return raw
  const [day, mon, yr] = parts
  const month = months[mon] ?? '01'
  const year = yr.length === 2 ? `20${yr}` : yr
  return `${year}-${month}-${day.padStart(2, '0')}`
}

export const NABParser: Parser = {
  name: 'NAB',

  detect(headers: string[]): boolean {
    return NAB_HEADERS.every(h => headers.includes(h))
  },

  parse(rows: Record<string, string>[]): Transaction[] {
    return rows
      .filter(row => row['Date']?.trim() && row['Amount']?.trim())
      .map(row => {
        const rawAmount = parseFloat(row['Amount'].replace(/,/g, ''))
        const type = rawAmount >= 0 ? 'credit' : 'debit'
        const amount = Math.abs(rawAmount)

        // Pending if no "Processed On" date
        const processedOn = row['Processed On']?.trim()
        const status: TransactionStatus = processedOn ? 'posted' : 'pending'

        // Use Merchant Name if available, fall back to Transaction Details
        const merchantName = row['Merchant Name']?.trim()
        const details = row['Transaction Details']?.trim() ?? ''
        const description = merchantName || details

        return {
          date: parseDate(row['Date'].trim()),
          description,
          amount,
          type,
          card: row['Account Number']?.trim() ?? 'Unknown',
          status,
          raw: row,
        }
      })
  },
}
