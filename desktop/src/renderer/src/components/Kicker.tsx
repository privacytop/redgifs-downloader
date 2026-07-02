interface KickerProps {
  /** Optional running number, rendered as a zero-padded `№ NN —` prefix. */
  index?: number
  text: string
}

/** Editorial kicker: mono, uppercase, wide-tracked, dim. e.g. `№ 03 — trending`. */
export default function Kicker({ index, text }: KickerProps): JSX.Element {
  const prefix = index !== undefined ? `№ ${String(index).padStart(2, '0')} — ` : ''
  return <div className="kicker">{prefix}{text}</div>
}
