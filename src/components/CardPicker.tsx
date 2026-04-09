import { useRef, useCallback } from 'react'
import Papa from 'papaparse'
import { detectAndParse } from '@/lib/parsers'
import type { CardAccount } from '@/lib/parsers/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface CardPickerProps {
  accounts: CardAccount[]
  onAccountsChange: (accounts: CardAccount[]) => void
  onCheck: () => void
}

function defaultName(fileName: string): string {
  return fileName.replace(/\.csv$/i, '')
}

function parseFile(file: File): Promise<CardAccount> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        try {
          const parsed = detectAndParse(results.data)
          const account: CardAccount = {
            id: crypto.randomUUID(),
            name: defaultName(file.name),
            bank: parsed.bank,
            fileName: file.name,
            transactions: parsed.transactions,
            minSpend: null,
          }
          resolve(account)
        } catch (e) {
          reject(e instanceof Error ? e : new Error('Failed to parse CSV'))
        }
      },
      error(err: { message: string }) {
        reject(new Error(err.message))
      },
    })
  })
}

export function CardPicker({ accounts, onAccountsChange, onCheck }: CardPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const results: CardAccount[] = []
    for (const file of Array.from(files)) {
      if (!file.name.endsWith('.csv')) continue
      try {
        const account = await parseFile(file)
        results.push(account)
      } catch {
        // skip bad files silently — could add per-file error state later
      }
    }
    if (results.length > 0) {
      onAccountsChange([...accounts, ...results])
    }
  }, [accounts, onAccountsChange])

  const updateAccount = (id: string, patch: Partial<CardAccount>) => {
    onAccountsChange(accounts.map(a => a.id === id ? { ...a, ...patch } : a))
  }

  const removeAccount = (id: string) => {
    onAccountsChange(accounts.filter(a => a.id !== id))
  }

  const totalDebits = accounts.reduce((sum, a) =>
    sum + a.transactions.filter(t => t.type === 'debit').length, 0
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-4 py-8">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">CC Matcher</h1>
          <p className="text-sm text-muted-foreground">
            Upload one CSV per card account
          </p>
        </div>

        {/* Account list */}
        {accounts.length > 0 && (
          <div className="space-y-3">
            {accounts.map((account, i) => {
              const debitCount = account.transactions.filter(t => t.type === 'debit').length
              const creditCount = account.transactions.filter(t => t.type === 'credit').length
              return (
                <Card key={account.id}>
                  {i > 0 && <Separator />}
                  <CardContent className="py-4 px-4 space-y-3">
                    {/* Name row */}
                    <div className="flex items-center justify-between gap-2">
                      <input
                        className="flex-1 text-sm font-medium bg-transparent border-none outline-none focus:ring-0 min-w-0"
                        value={account.name}
                        onChange={e => updateAccount(account.id, { name: e.target.value })}
                        placeholder="Account name"
                      />
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary" className="text-xs">{account.bank}</Badge>
                        <button
                          onClick={() => removeAccount(account.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          aria-label="Remove"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="truncate">{account.fileName}</span>
                      <span className="shrink-0">{debitCount} charges · {creditCount} payments</span>
                    </div>

                    {/* Min spend */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0">Min spend</span>
                      <div className="relative flex-1">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
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
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Drop zone / add button */}
        <Card
          className={`cursor-pointer border-2 border-dashed transition-colors border-border hover:border-primary/50`}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
        >
          <CardContent className="flex flex-col items-center justify-center py-8 gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-sm font-medium">
              {accounts.length === 0 ? 'Drop a CSV or click to upload' : '+ Add another CSV'}
            </p>
            <p className="text-xs text-muted-foreground">Supports: NAB export</p>
          </CardContent>
        </Card>

        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          multiple
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />

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
