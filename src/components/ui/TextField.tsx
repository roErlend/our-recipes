import {
  FieldError,
  Input,
  Label,
  Text,
  TextArea,
  TextField as AriaTextField,
  type TextFieldProps as AriaTextFieldProps,
} from 'react-aria-components'
import { tv } from 'tailwind-variants'

const fieldStyles = tv({
  slots: {
    root: 'flex flex-col gap-1.5',
    label: 'text-sm font-medium text-stone-700',
    input: [
      'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900',
      'placeholder:text-stone-400',
      'data-[hovered]:border-stone-400',
      'data-[focused]:border-brand-500 data-[focused]:ring-2 data-[focused]:ring-brand-500/30',
      'data-[invalid]:border-red-500 data-[invalid]:data-[focused]:ring-red-500/30',
      'data-[disabled]:cursor-not-allowed data-[disabled]:bg-stone-100',
    ],
    description: 'text-xs text-stone-500',
    error: 'text-xs text-red-600',
  },
})

interface BaseProps extends AriaTextFieldProps {
  label?: string
  description?: string
  placeholder?: string
}

interface InputFieldProps extends BaseProps {
  multiline?: false
}
interface TextAreaFieldProps extends BaseProps {
  multiline: true
  rows?: number
}

export type TextFieldProps = InputFieldProps | TextAreaFieldProps

export function TextField(props: TextFieldProps) {
  const { label, description, placeholder, ...rest } = props
  const styles = fieldStyles()

  return (
    <AriaTextField {...rest} className={styles.root()}>
      {label ? <Label className={styles.label()}>{label}</Label> : null}
      {props.multiline ? (
        <TextArea
          placeholder={placeholder}
          rows={props.rows ?? 4}
          className={styles.input({ className: 'resize-y' })}
        />
      ) : (
        <Input placeholder={placeholder} className={styles.input()} />
      )}
      {description ? (
        <Text slot="description" className={styles.description()}>
          {description}
        </Text>
      ) : null}
      <FieldError className={styles.error()} />
    </AriaTextField>
  )
}
