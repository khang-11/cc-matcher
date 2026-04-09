import { useState } from 'react'
import { DropZone } from '@/components/DropZone'
import { CardPicker } from '@/components/CardPicker'
import { Results } from '@/components/Results'
import type { ParseResult } from '@/lib/parsers/types'

type Step =
  | { name: 'drop' }
  | { name: 'pick'; parseResult: ParseResult; fileName: string }
  | { name: 'results'; parseResult: ParseResult; fileName: string; selectedCards: string[] }

export default function App() {
  const [step, setStep] = useState<Step>({ name: 'drop' })

  if (step.name === 'drop') {
    return (
      <DropZone
        onParsed={(parseResult, fileName) =>
          setStep({ name: 'pick', parseResult, fileName })
        }
      />
    )
  }

  if (step.name === 'pick') {
    return (
      <CardPicker
        parseResult={step.parseResult}
        fileName={step.fileName}
        onCheck={selectedCards =>
          setStep({
            name: 'results',
            parseResult: step.parseResult,
            fileName: step.fileName,
            selectedCards,
          })
        }
        onReset={() => setStep({ name: 'drop' })}
      />
    )
  }

  // results
  return (
    <Results
      transactions={step.parseResult.transactions}
      selectedCards={step.selectedCards}
      onBack={() =>
        setStep({
          name: 'pick',
          parseResult: step.parseResult,
          fileName: step.fileName,
        })
      }
    />
  )
}
