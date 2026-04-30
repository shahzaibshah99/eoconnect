'use client'

import { useRouter } from 'next/navigation'
import { deleteService } from '@/actions/services'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface ServiceActionsProps {
  serviceId: string
  serviceTitle: string
}

export function ServiceActions({ serviceId, serviceTitle }: ServiceActionsProps) {
  const router = useRouter()

  return (
    <ConfirmDialog
      trigger={<Button variant="destructive" size="sm">Delete</Button>}
      title="Delete this service?"
      description={
        <>
          Are you sure you want to delete <strong className="text-foreground">{serviceTitle}</strong>?
          This cannot be undone.
        </>
      }
      confirmLabel="Delete service"
      onConfirm={async () => {
        const result = await deleteService(serviceId)
        if (result?.error) throw new Error(result.error)
        router.refresh()
      }}
    />
  )
}
