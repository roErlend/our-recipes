import { Check } from 'lucide-react'
import {
  Checkbox as AriaCheckbox,
  type CheckboxProps as AriaCheckboxProps,
} from 'react-aria-components'
import { tv } from 'tailwind-variants'

const styles = tv({
  slots: {
    root: 'group flex items-center gap-2.5 text-sm text-stone-800 cursor-pointer select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
    box: [
      'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white transition-colors',
      'group-data-[hovered]:border-brand-400',
      'group-data-[selected]:border-brand-600 group-data-[selected]:bg-brand-600',
      'group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-brand-500',
    ],
    icon: 'h-3.5 w-3.5 text-white opacity-0 group-data-[selected]:opacity-100',
  },
})

export interface CheckboxProps extends AriaCheckboxProps {
  children?: React.ReactNode
}

export function Checkbox({ children, className, ...props }: CheckboxProps) {
  const s = styles()
  return (
    <AriaCheckbox
      className={(rp) =>
        s.root({
          className: typeof className === 'function' ? className(rp) : className,
        })
      }
      {...props}
    >
      <div className={s.box()}>
        <Check className={s.icon()} strokeWidth={3} />
      </div>
      {children}
    </AriaCheckbox>
  )
}
