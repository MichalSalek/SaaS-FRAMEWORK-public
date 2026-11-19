import { Fragment } from 'react';
import { splitUnbreakablePieces } from '../../shared/typography/keep-together';
import styles from './KeepTogetherText.module.css';

interface KeepTogetherTextProps {
  children: string;
}

/**
 * A sentence whose unbreakable pieces stay whole: a hint in parentheses, a
 * number with its unit, a short head before a hyphen („E-Mail”, „QR-Code”).
 *
 * DECISION: `keepHyphenatedTogether` inserts an invisible character and so must not be used on
 * pages that search engines read; this atom wraps the piece in a plain `<span>`, so the HTML text
 * stays untouched and it works everywhere. Use it where a sentence with such a piece stands in a
 * narrow column (the line under the hero button, a step description, a panel footnote). The piece
 * is an inline-block with its own `max-width`, so in a column narrower than itself it wraps
 * instead of overflowing; a link underline does not pass into an inline-block, so do not put this
 * atom inside link text. It exists because after the body weight and tracking change lines broke
 * in other places and `qa:align` showed "30 / dni", "E- / Mail", "QR- / Code" on public pages.
 */
export function KeepTogetherTextAtom({ children }: KeepTogetherTextProps) {
  const pieces = splitUnbreakablePieces(children);
  if (!pieces.some(piece => piece.keep)) {
    return <>{children}</>;
  }
  return (
    <>
      {pieces.map((piece, index) => (
        <Fragment key={index}>
          {piece.keep ? (
            <span className={styles.piece}>{piece.text}</span>
          ) : (
            piece.text
          )}
        </Fragment>
      ))}
    </>
  );
}
