import { useState } from 'react'
import type { CardAccount } from '@/lib/parsers/types'
import { removeCardOwner, type CardDoc } from '@/lib/db'
import { matchTransactions, formatAmount } from '@/lib/matcher'
import { AddCardDialog } from '@/components/AddCardDialog'
import { EditCardDialog } from '@/components/EditCardDialog'
import { Card, CardContent } from '@/components/ui/card'

interface CardListScreenProps {
  accounts: CardAccount[]
  cardDocs: Map<string, CardDoc>
  currentUid: string
  onAddCard: (account: CardAccount) => void
  onDeleteCard: (accountId: string) => void
  onCardClick: (accountId: string) => void
  onSignOut: () => void
}

export function CardListScreen({
  accounts,
  cardDocs,
  currentUid,
  onAddCard,
  onDeleteCard,
  onCardClick,
  onSignOut,
}: CardListScreenProps) {
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingAccount, setEditingAccount] = useState<CardAccount | null>(null)

  const handleAdd = (name: string, minSpend: number | null) => {
    const newAccount: CardAccount = {
      id: crypto.randomUUID(),
      name,
      bank: '',
      files: [],
      transactions: [],
      minSpend,
      owners: [currentUid],
    }
    onAddCard(newAccount)
    setShowAddDialog(false)
  }

  const handleSaveEdit = (id: string, name: string, minSpend: number | null) => {
    // Edit is handled via onAccountChange in CardDetailScreen; here just update via onAddCard path
    // Actually editing from list just changes name/minSpend — find account and update it
    const account = accounts.find(a => a.id === id)
    if (!account) return
    const doc = cardDocs.get(id)
    if (!doc) return
    // We don't have a direct updateAccount here, so reuse onAddCard with updated account
    // (saveCard will overwrite the doc). Use onAddCard which calls saveCard.
    onAddCard({ ...account, name, minSpend })
    setEditingAccount(null)
  }

  const handleDelete = (id: string) => {
    onDeleteCard(id)
    setEditingAccount(null)
  }

  const handleLeave = async (account: CardAccount) => {
    const doc = cardDocs.get(account.id)
    if (!doc) return
    await removeCardOwner(doc, currentUid).catch(console.error)
    setEditingAccount(null)
  }

  const accountStats = accounts.map(account => {
    const doc = cardDocs.get(account.id)
    const resolutions = doc?.resolutions ?? []
    const excluded = new Set(doc?.excluded ?? [])
    const { unmatched, remainders } = matchTransactions(account.transactions, resolutions)
    const outstanding = [...unmatched, ...remainders].reduce((s, t) => s + t.amount, 0)
    const qualifyingSpend = account.transactions
      .filter(t => t.type === 'debit' && !excluded.has(t.id))
      .reduce((s, t) => s + t.amount, 0)
    return { id: account.id, outstanding, qualifyingSpend }
  })

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <div className="px-4 pt-12 pb-4 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">CC Matcher</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Your cards</p>
        </div>
        <button
          onClick={onSignOut}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors pb-1"
        >
          Sign out
        </button>
      </div>

      {/* Card list */}
      <div className="flex-1 px-4 space-y-2">
        {accounts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <div className="rounded-full bg-muted p-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground">No cards yet. Add one to get started.</p>
          </div>
        )}

        {accounts.map(account => {
          const stats = accountStats.find(s => s.id === account.id)!
          const hasOutstanding = stats.outstanding > 0
          const hasMinSpend = account.minSpend != null && account.minSpend > 0
          const progress = hasMinSpend ? Math.min(stats.qualifyingSpend / account.minSpend!, 1) : null
          const debitCount = account.transactions.filter(t => t.type === 'debit').length
          const isShared = account.owners.length > 1

          return (
            <Card
              key={account.id}
              className="cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => onCardClick(account.id)}
            >
              <CardContent className="py-4 px-4">
                <div className="flex items-center justify-between gap-3">
                  {/* Left: icon + name/subtitle */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="shrink-0 rounded-lg bg-muted p-2.5">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium truncate">{account.name}</p>
                        {isShared && (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {debitCount > 0
                          ? `${debitCount} transaction${debitCount !== 1 ? 's' : ''}${account.bank ? ` · ${account.bank}` : ''}`
                          : 'No transactions yet'}
                      </p>
                    </div>
                  </div>

                  {/* Right: status + edit */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      {hasOutstanding ? (
                        <p className="text-sm font-semibold text-destructive tabular-nums">
                          {formatAmount(stats.outstanding)}
                        </p>
                      ) : account.transactions.length > 0 ? (
                        <p className="text-sm font-medium text-green-500">All clear</p>
                      ) : null}
                      {hasMinSpend && progress !== null && (
                        <p className="text-xs text-muted-foreground">
                          {progress >= 1
                            ? <span className="text-green-500">Min reached</span>
                            : `${Math.round(progress * 100)}% of min`}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setEditingAccount(account) }}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      aria-label="Edit card"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>

                {/* Min spend progress bar */}
                {hasMinSpend && progress !== null && progress < 1 && (
                  <div className="mt-3 h-1 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress * 100}%` }} />
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Add card button */}
      <div className="px-4 py-6">
        <button
          onClick={() => setShowAddDialog(true)}
          className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-4 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add card
        </button>
      </div>

      {showAddDialog && (
        <AddCardDialog onAdd={handleAdd} onClose={() => setShowAddDialog(false)} />
      )}

      {editingAccount && (() => {
        const isOwner = editingAccount.owners[0] === currentUid
        return (
          <EditCardDialog
            account={editingAccount}
            isOwner={isOwner}
            onSave={(name, minSpend) => handleSaveEdit(editingAccount.id, name, minSpend)}
            onDelete={isOwner ? () => handleDelete(editingAccount.id) : () => handleLeave(editingAccount)}
            onClose={() => setEditingAccount(null)}
          />
        )
      })()}
    </div>
  )
}
