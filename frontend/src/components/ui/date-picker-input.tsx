import { DatePickerGranafy } from '@/components/date-picker-granafy'

interface DatePickerInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
}

function DatePickerInput({
  value,
  onChange,
  placeholder,
  disabled,
  align = 'start',
}: DatePickerInputProps) {
  const alignMap = { start: 'left' as const, center: 'center' as const, end: 'right' as const }
  return (
    <DatePickerGranafy
      value={value}
      onChange={onChange}
      label={placeholder}
      compact
      alignPopover={alignMap[align]}
      disabled={disabled}
    />
  )
}

export { DatePickerInput }
