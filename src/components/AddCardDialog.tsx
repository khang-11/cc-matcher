import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface AddCardDialogProps {
  onAdd: (name: string, minSpend: number | null) => void
  onClose: () => void
}

export function AddCardDialog({ onAdd, onClose }: AddCardDialogProps) {
  const [name, setName] = useState('')
  const [minSpend, setMinSpend] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onAdd(name.trim(), minSpend === '' ? null : parseFloat(minSpend))
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-sm shadow-xl">
          <CardContent className="pt-5 pb-5 px-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Add card</h2>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

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
                  placeholder="e.g. NAB Qantas Rewards"
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
                Add card
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
