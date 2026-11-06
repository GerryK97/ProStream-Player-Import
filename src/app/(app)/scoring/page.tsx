import { Suspense } from 'react'
import { ImportScoring } from '@/components/ImportScoring'

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ImportScoring />
    </Suspense>
  )
}
