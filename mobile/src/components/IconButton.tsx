interface IconButtonProps {
  label: string
  onClick: () => void
  children: React.ReactNode
  variant?: 'ghost' | 'solid'
  className?: string
}

/**
 * The single icon-only button primitive. Fixes the recurring bug where a raw
 * <svg> dropped into a text button rendered at the wrong size — `.icon-btn svg`
 * pins it. Used for header back/gear, player close, etc., so every icon control
 * looks and sizes the same.
 */
export default function IconButton({
  label,
  onClick,
  children,
  variant = 'ghost',
  className
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn-${variant} ${className ?? ''}`}
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </button>
  )
}
