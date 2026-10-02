import * as React from 'react'

import { cn } from '../lib/utils'
import { controlClassName } from './controlStyles'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        controlClassName,
        'flex field-sizing-content min-h-20 px-3 py-2 text-base leading-relaxed md:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
