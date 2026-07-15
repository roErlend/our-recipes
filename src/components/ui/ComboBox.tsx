import {
  Button as AriaButton,
  ComboBox as AriaComboBox,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
} from 'react-aria-components'
import { Check, ChevronDown } from 'lucide-react'

/**
 * A text input with a filterable suggestion list, built on React Aria's
 * ComboBox. Unlike a native `<datalist>` (which silently degrades to a plain
 * text field inside an iOS PWA / WKWebView), this renders its own popover, so
 * the autocomplete works everywhere. `allowsCustomValue` keeps the field
 * free-text — you can pick a suggestion or type a brand-new value.
 *
 * Controlled by the input text (`value`/`onChange`); the value *is* the string,
 * not a key, which suits free-form fields like an ingredient's category.
 */
export interface ComboBoxProps {
  items: string[]
  value: string
  onChange: (value: string) => void
  'aria-label': string
  placeholder?: string
  maxLength?: number
  /** Applied to the outer field (use for width / flex sizing). */
  className?: string
  /**
   * Suppress the on-screen keyboard (`inputMode="none"`). The field still
   * focuses and opens its suggestion list, so you pick by tapping instead of
   * typing — handy on mobile when you're almost always choosing an existing
   * value. Physical keyboards still type, so desktop is unaffected.
   */
  suppressKeyboard?: boolean
}

export function ComboBox({
  items,
  value,
  onChange,
  placeholder,
  maxLength,
  className,
  suppressKeyboard,
  'aria-label': ariaLabel,
}: ComboBoxProps) {
  return (
    <AriaComboBox
      aria-label={ariaLabel}
      allowsCustomValue
      inputValue={value}
      onInputChange={onChange}
      // Open the suggestions as soon as the field is focused — friendlier on
      // touch, where there's no hover affordance.
      menuTrigger="focus"
      className={className}
    >
      <div className="relative flex items-center">
        <Input
          placeholder={placeholder}
          maxLength={maxLength}
          inputMode={suppressKeyboard ? 'none' : undefined}
          className={[
            'w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 pr-8 text-sm text-stone-700',
            'placeholder:text-stone-400 outline-none',
            'data-[hovered]:border-stone-400',
            'data-[focused]:border-brand-500 data-[focused]:ring-2 data-[focused]:ring-brand-500/30',
          ].join(' ')}
        />
        <AriaButton className="absolute right-1 inline-flex h-6 w-6 items-center justify-center rounded text-stone-400 outline-none data-[hovered]:text-stone-600">
          <ChevronDown className="h-4 w-4" />
        </AriaButton>
      </div>
      <Popover
        // Prefer opening upward. On mobile the on-screen keyboard covers the
        // bottom half of the screen, but React Aria positions against the
        // layout viewport (which the keyboard doesn't shrink), so a downward
        // popover ends up hidden behind the keyboard — and the combobox closes
        // the list the moment you scroll to reach it. Opening above keeps the
        // options in the visible area; React Aria still flips down when the
        // field is near the top of the screen and there's no room above.
        placement="top"
        className="max-h-60 w-[var(--trigger-width)] overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg outline-none"
      >
        <ListBox className="outline-none" renderEmptyState={() => null}>
          {items.map((item) => (
            <ListBoxItem
              key={item}
              id={item}
              textValue={item}
              className="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm text-stone-700 outline-none data-[focused]:bg-brand-50 data-[focused]:text-brand-800 data-[selected]:font-medium"
            >
              {({ isSelected }) => (
                <>
                  <span className="truncate">{item}</span>
                  {isSelected && (
                    <Check className="h-4 w-4 shrink-0 text-brand-600" />
                  )}
                </>
              )}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaComboBox>
  )
}
