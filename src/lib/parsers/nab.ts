import type { Parser, Transaction } from './types'

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

/** Simple stable id: deterministic string from key fields */
function makeId(date: string, type: string, amount: number, description: string, card: string): string {
  return `${date}|${type}|${Math.round(amount * 100)}|${description}|${card}`
}

export const NABParser: Parser = {
  name: 'NAB',

  detect(headers: string[]): boolean {
    return NAB_HEADERS.every(h => headers.includes(h))
  },

  parse(rows: Record<string, string>[]): Transaction[] {
    // Track counts per base-id to handle duplicates (same date/amount/description)
    const idCounts = new Map<string, number>()

    return rows
      .filter(row => row['Date']?.trim() && row['Amount']?.trim())
      .map(row => {
        const rawAmount = parseFloat(row['Amount'].replace(/,/g, ''))
        const type = rawAmount >= 0 ? 'credit' : 'debit'
        const amount = Math.abs(rawAmount)

        // Use Merchant Name if available, fall back to Transaction Details
        const merchantName = row['Merchant Name']?.trim()
        const details = row['Transaction Details']?.trim() ?? ''
        const description = merchantName || details

        const date = parseDate(row['Date'].trim())
        const card = row['Account Number']?.trim() ?? 'Unknown'

        // Pending = authorisation not yet settled (no Processed On date)
        const txnType = row['Transaction Type']?.trim() ?? ''
        const processedOn = row['Processed On']?.trim() ?? ''
        const pending = txnType.endsWith('AUTHORISATION') && !processedOn

        // Make id unique even for duplicate rows
        const baseId = makeId(date, type, amount, details, card)
        const count = idCounts.get(baseId) ?? 0
        idCounts.set(baseId, count + 1)
        const id = count === 0 ? baseId : `${baseId}|${count}`

        return {
          id,
          date,
          description,
          amount,
          type,
          card,
          pending,
          raw: row,
        }
      })
  },
}
