
import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'

import { cn } from '../lib/utils'

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // min-h (not fixed h) so labels keep their own vertical space; overflow scrolls horizontally without clipping text.
        'bg-secondary text-muted-foreground inline-flex min-h-9 w-fit max-w-full min-w-0 shrink-0 items-center justify-start overflow-x-auto overscroll-x-contain rounded-lg p-[3px]',
        // Hide the scrollbar chrome so it never overlays labels; trackpad/touch/shift-wheel/keyboard scrolling still work.
        '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:bg-transparent',
        className,
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const ref = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    const node = ref.current
    if (!node) return

    const ensureActiveVisible = () => {
      if (node.getAttribute('data-state') !== 'active') return
      node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }

    ensureActiveVisible()
    const observer = new MutationObserver(ensureActiveVisible)
    observer.observe(node, { attributes: true, attributeFilter: ['data-state'] })
    return () => observer.disconnect()
  }, [])

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      data-slot="tabs-trigger"
      className={cn(
        "text-muted-foreground hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-foreground dark:data-[state=active]:bg-muted focus-visible:ring-ring/35 inline-flex h-8 min-w-fit shrink-0 grow cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-1 text-[13px] font-medium whitespace-nowrap outline-none transition-[color,background-color,box-shadow] duration-150 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
