
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

type DragSession = {
  pointerId: number
  startX: number
  startScrollLeft: number
  active: boolean
  moved: boolean
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === 'function') {
    ref(value)
    return
  }
  ;(ref as React.MutableRefObject<T | null>).current = value
}

function TabsList({
  className,
  ref,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<DragSession | null>(null)
  const [overflows, setOverflows] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)

  const updateOverflow = React.useCallback(() => {
    const el = listRef.current
    if (!el) {
      setOverflows(false)
      return
    }
    setOverflows(el.scrollWidth > el.clientWidth)
  }, [])

  React.useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    updateOverflow()
    const observer = new ResizeObserver(() => updateOverflow())
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateOverflow])

  const endDrag = React.useCallback((el: HTMLDivElement, session: DragSession) => {
    dragRef.current = null
    setDragging(false)
    if (!session.moved) return
    const suppressClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      el.removeEventListener('click', suppressClick, true)
    }
    el.addEventListener('click', suppressClick, true)
  }, [])

  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node
      assignRef(ref, node)
    },
    [ref],
  )

  return (
    <TabsPrimitive.List
      {...props}
      ref={setRefs}
      data-slot="tabs-list"
      className={cn(
        // min-h (not fixed h) so labels keep their own vertical space; overflow scrolls horizontally without clipping text.
        'bg-secondary text-muted-foreground inline-flex min-h-9 w-fit max-w-full min-w-0 shrink-0 items-center justify-start overflow-x-auto overscroll-x-contain rounded-lg p-[3px]',
        // Hide the scrollbar chrome so it never overlays labels; trackpad/touch/shift-wheel/keyboard scrolling still work.
        '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:bg-transparent',
        overflows && !dragging && 'cursor-grab',
        dragging && 'cursor-grabbing select-none',
        className,
      )}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        if (event.defaultPrevented) return
        if (event.pointerType !== 'mouse' || event.button !== 0) return
        const el = listRef.current
        if (!el) return
        // Re-check overflow so a stale ResizeObserver state cannot enable drag.
        if (el.scrollWidth <= el.clientWidth) return
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startScrollLeft: el.scrollLeft,
          active: false,
          moved: false,
        }
      }}
      onPointerMove={(event) => {
        onPointerMove?.(event)
        if (event.defaultPrevented) return
        const session = dragRef.current
        const el = listRef.current
        if (!session || !el || session.pointerId !== event.pointerId) return
        const dx = event.clientX - session.startX
        if (!session.active) {
          if (Math.abs(dx) <= 5) return
          session.active = true
          session.moved = true
          el.setPointerCapture(event.pointerId)
          setDragging(true)
        }
        el.scrollLeft = session.startScrollLeft - dx
        event.preventDefault()
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event)
        const session = dragRef.current
        const el = listRef.current
        if (!session || !el || session.pointerId !== event.pointerId) return
        endDrag(el, session)
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event)
        const session = dragRef.current
        const el = listRef.current
        if (!session || !el || session.pointerId !== event.pointerId) return
        endDrag(el, session)
      }}
      onLostPointerCapture={(event) => {
        onLostPointerCapture?.(event)
        const session = dragRef.current
        const el = listRef.current
        if (!session || !el || session.pointerId !== event.pointerId) return
        endDrag(el, session)
      }}
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
