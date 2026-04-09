import { useRef, useCallback } from 'react'
import Papa from 'papaparse'
import { detectAndParse } from '@/lib/parsers'
import type { CardAccount } from '@/lib/parsers/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface CardPickerProps {
  accounts: CardAccount[]
  onAccountsChange: (accounts: CardAccount[]) => void
  onCheck: () => void
}

/** Parse a single File into transactions + metadata */
function parseFile(file: File) {
  return new Promise<{ bank: string; transactions: ReturnType<typeof detectAndParse>['transactions'] }>(
    (resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete(results) {
          try {
            const parsed = detectAndParse(results.data)
            resolve(parsed)
          } catch (e) {
            reject(e instanceof Error ? e : new Error('Failed to parse CSV'))
          }
        },
        error(err: { message: string }) {
          reject(new Error(err.message))
        },
      })
    }
  )
}

/** Merge new transactions into existing ones, deduplicating by id */
function mergeTransactions(
  existing: CardAccount['transactions'],
  incoming: CardAccount['transactions']
): CardAccount['transactions'] {
  const seen = new Set(existing.map(t => t.id))
  const additions = incoming.filter(t => !seen.has(t.id))
  return [...existing, ...additions]
}

export function CardPicker({ accounts, onAccountsChange, onCheck }: CardPickerProps) {
  // One hidden file input per card — keyed by account id via data attribute
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  const setInputRef = (accountId: string) => (el: HTMLInputElement | null) => {
    if (el) inputRefs.current.set(accountId, el)
    else inputRefs.current.delete(accountId)
  }

  /** Add a new blank card */
  const addCard = () => {
    const newAccount: CardAccount = {
      id: crypto.randomUUID(),
      name: '',
      bank: '',
      fileNames: [],
      transactions: [],
      minSpend: null,
    }
    onAccountsChange([...accounts, newAccount])
  }

  const updateAccount = (id: string, patch: Partial<CardAccount>) => {
    onAccountsChange(accounts.map(a => (a.id === id ? { ...a, ...patch } : a)))
  }

  const removeAccount = (id: string) => {
    onAccountsChange(accounts.filter(a => a.id !== id))
  }

  /** Upload one or more CSVs into a specific card account */
  const handleFilesForAccount = useCallback(
    async (accountId: string, files: FileList | null) => {
      if (!files || files.length === 0) return
      const account = accounts.find(a => a.id === accountId)
      if (!account) return

      let merged = account.transactions
      let bank = account.bank
      const newFileNames = [...account.fileNames]

      for (const file of Array.from(files)) {
        if (!file.name.endsWith('.csv')) continue
        // Skip if this filename was already uploaded to this card
        if (newFileNames.includes(file.name)) continue
        try {
          const parsed = await parseFile(file)
          merged = mergeTransactions(merged, parsed.transactions)
          if (!bank) bank = parsed.bank
          newFileNames.push(file.name)
        } catch {
          // skip bad files silently
        }
      }

      updateAccount(accountId, {
        bank,
        transactions: merged,
        fileNames: newFileNames,
      })

      // Reset input so the same file can be re-uploaded if needed
      const input = inputRefs.current.get(accountId)
      if (input) input.value = ''
    },
    [accounts] // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** Remove one CSV from a card (removes its transactions that aren't in other files).
   *  Simple approach: re-parse is not stored, so we just remove the filename chip.
   *  Full re-parse would require storing raw rows per file — keep it simple for now:
   *  removing a filename only removes the chip (transactions stay). User can remove
   *  the whole card and re-add if they need to undo a wrong upload. */
  const removeFileName = (accountId: string, fileName: string) => {
    const account = accounts.find(a => a.id === accountId)
    if (!account) return
    const newFileNames = account.fileNames.filter(f => f !== fileName)
    updateAccount(accountId, { fileNames: newFileNames })
  }

  const totalDebits = accounts.reduce(
    (sum, a) => sum + a.transactions.filter(t => t.type === 'debit').length,
    0
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4 py-8">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">CC Matcher</h1>
          <p className="text-sm text-muted-foreground">
            Add your cards, then upload CSVs for each one
          </p>
        </div>

        {/* Card list */}
        <div className="space-y-3">
          {accounts.map(account => {
            const debitCount = account.transactions.filter(t => t.type === 'debit').length
            const creditCount = account.transactions.filter(t => t.type === 'credit').length

            return (
              <Card key={account.id}>
                <CardContent className="py-4 px-4 space-y-3">
                  {/* Name row */}
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      className="flex-1 text-sm font-medium bg-transparent border-none outline-none focus:ring-0 min-w-0"
                      value={account.name}
                      onChange={e => updateAccount(account.id, { name: e.target.value })}
                      placeholder="Card name (e.g. ANZ Rewards)"
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      {account.bank && (
                        <Badge variant="secondary" className="text-xs">
                          {account.bank}
                        </Badge>
                      )}
                      <button
                        onClick={() => removeAccount(account.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        aria-label="Remove card"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Uploaded file chips */}
                  {account.fileNames.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {account.fileNames.map(fn => (
                        <span
                          key={fn}
                          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-3 w-3 shrink-0"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                            />
                          </svg>
                          <span className="max-w-[180px] truncate">{fn}</span>
                          <button
                            onClick={() => removeFileName(account.id, fn)}
                            className="ml-0.5 hover:text-destructive transition-colors"
                            aria-label={`Remove ${fn}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Transaction stats — only when at least one CSV uploaded */}
                  {account.fileNames.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {debitCount} charge{debitCount !== 1 ? 's' : ''} · {creditCount} payment{creditCount !== 1 ? 's' : ''}
                    </p>
                  )}

                  {/* Min spend */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground shrink-0">Min spend</span>
                    <div className="relative flex-1">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        $
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        className="w-full pl-5 pr-2 py-1 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="No minimum"
                        value={account.minSpend ?? ''}
                        onChange={e => {
                          const val = e.target.value
                          updateAccount(account.id, {
                            minSpend: val === '' ? null : parseFloat(val),
                          })
                        }}
                      />
                    </div>
                  </div>

                  {/* Upload CSV button */}
                  <div
                    className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border py-2 cursor-pointer hover:border-primary/50 transition-colors text-xs text-muted-foreground"
                    onClick={() => inputRefs.current.get(account.id)?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault()
                      handleFilesForAccount(account.id, e.dataTransfer.files)
                    }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                      />
                    </svg>
                    {account.fileNames.length === 0
                      ? 'Upload CSV'
                      : '+ Upload another CSV'}
                  </div>

                  {/* Hidden file input for this card */}
                  <input
                    ref={setInputRef(account.id)}
                    type="file"
                    accept=".csv"
                    multiple
                    className="hidden"
                    onChange={e => handleFilesForAccount(account.id, e.target.files)}
                  />
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Add card button */}
        <button
          onClick={addCard}
          className="w-full flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-3 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add card
        </button>

        <Button
          className="w-full"
          disabled={accounts.length === 0 || totalDebits === 0}
          onClick={onCheck}
        >
          Check {totalDebits} transaction{totalDebits !== 1 ? 's' : ''}
        </Button>
      </div>
    </div>
  )
}
