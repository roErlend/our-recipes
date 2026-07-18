import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from 'react-aria-components'
import { tv, type VariantProps } from 'tailwind-variants'

export const button = tv({
  base: [
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap',
    'cursor-pointer transition-colors select-none',
    'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
    'outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-500',
  ],
  variants: {
    variant: {
      primary:
        'bg-brand-600 text-on-brand data-[hovered]:bg-brand-700 data-[pressed]:bg-brand-800',
      secondary:
        'bg-white text-stone-800 ring-1 ring-stone-300 data-[hovered]:bg-stone-100 data-[pressed]:bg-stone-200',
      ghost:
        'bg-transparent text-stone-700 data-[hovered]:bg-stone-200/70 data-[pressed]:bg-stone-300/70',
      danger:
        'bg-red-600 text-on-brand data-[hovered]:bg-red-700 data-[pressed]:bg-red-800',
    },
    size: {
      sm: 'h-8 px-3 text-sm',
      md: 'h-10 px-4 text-sm',
      lg: 'h-11 px-5 text-base',
      icon: 'h-9 w-9 p-0',
    },
  },
  defaultVariants: {
    variant: 'primary',
    size: 'md',
  },
})

export interface ButtonProps
  extends AriaButtonProps,
    VariantProps<typeof button> {}

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return (
    <AriaButton
      className={(renderProps) =>
        button({
          variant,
          size,
          className:
            typeof className === 'function' ? className(renderProps) : className,
        })
      }
      {...props}
    />
  )
}
