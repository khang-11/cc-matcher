import type { Parser, ParseResult } from './types'
import { NABParser } from './nab'

// Register new bank parsers here — nothing else needs to change
const PARSERS: Parser[] = [
  NABParser,
  // ANZParser,
  // WestpacParser,
]

export function detectAndParse(rows: Record<string, string>[]): ParseResult {
  if (rows.length === 0) throw new Error('CSV file is empty')

  const headers = Object.keys(rows[0])

  const parser = PARSERS.find(p => p.detect(headers))
  if (!parser) {
    throw new Error(
      `Unrecognised CSV format. Headers found: ${headers.join(', ')}\n` +
      `Supported formats: ${PARSERS.map(p => p.name).join(', ')}`
    )
  }

  return {
    bank: parser.name,
    transactions: parser.parse(rows),
  }
}
