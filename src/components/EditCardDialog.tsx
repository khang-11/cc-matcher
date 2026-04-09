import { useState } from 'react'
import type { CardAccount } from '@/lib/parsers/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface EditCardDialogProps {
  account: CardAccount
  isOwner: boolean
  onSave: (name: string, minSpend: number | null) => void
  onDelete: () => void   // for owner: delete card; for guest: leave card
  onClose: () => void
}

export function EditCardDialog({ account, isOwner, onSave, onDelete, onClose }: EditCardDialogProps) {
  const [name, setName] = useState(account.name)
  const [minSpend, setMinSpend] = useState(account.minSpend != null ? String(account.minSpend) : '')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onSave(name.trim(), minSpend === '' ? null : parseFloat(minSpend))
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
        <Card className="w-full sm:max-w-sm shadow-xl rounded-b-none sm:rounded-b-xl rounded-t-2xl">
          <CardContent className="pt-5 pb-8 sm:pb-5 px-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Edit card</h2>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {isOwner ? (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Card name</label>
                  <input
                    autoFocus
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Min spend target (optional)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={minSpend}
                      onChange={e => setMinSpend(e.target.value)}
                      className="w-full pl-7 pr-3 py-2 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder="No minimum"
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full" disabled={!name.trim()}>
                  Save changes
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                This card was shared with you. You can view and edit data, but cannot rename or delete it.
              </p>
            )}

            <div className="border-t border-border pt-3">
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full text-xs text-destructive hover:underline text-center"
                >
                  {isOwner ? 'Remove card and all its data' : 'Remove my access to this card'}
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-destructive text-center">
                    {isOwner
                      ? 'This will delete all transactions and resolutions for this card. Are you sure?'
                      : 'You will lose access to this card. Are you sure?'}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="destructive" className="flex-1 text-xs" onClick={onDelete}>
                      {isOwner ? 'Yes, delete' : 'Yes, leave'}
                    </Button>
                    <Button variant="outline" className="flex-1 text-xs" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
