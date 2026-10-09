import { Fragment } from 'react';

/** After these a long token may break: an e-mail, a config key, a path. */
const SEPARATOR = /([_\-.@/:?&=])/;

interface SoftBreakTextProps {
  children: string;
  className?: string;
}

/**
 * A technical string (an e-mail address, an event or permission key, a URL
 * path) that may wrap ONLY after its separators.
 *
 * WHY (S126, measured on the rebuilt admin pages at 390px): cells and tiles
 * use `overflow-wrap: anywhere` so nothing is ever cut, and with no break
 * opportunity inside a token the browser broke it wherever the line ended:
 * „ACCOUNT_CHECKO|UT_SESSION”, „@e|xample.com”. A `<wbr>` after `_ - . @ / :`
 * gives it places to break that a person reads as joints; `anywhere` then
 * applies only to a single segment that is itself wider than the line.
 */
export function SoftBreakTextAtom({ children, className }: SoftBreakTextProps) {
  const parts = children.split(SEPARATOR);
  return (
    <span className={className}>
      {parts.map((part, index) => (
        // The split keeps separators at odd indexes: text, sep, text, sep…
        <Fragment key={index}>
          {part}
          {index % 2 === 1 && <wbr />}
        </Fragment>
      ))}
    </span>
  );
}
