import { Fragment, memo } from 'react';

/**
 * A money string inside a fixed-width column. Offers a break after every group
 * separator, so a very large amount wraps at a comma instead of being clipped.
 */
function AmountBase({ text, className }: { text: string; className?: string }) {
  /* UAX #14 gives no break between a comma and a digit, so a long amount has
     nowhere to wrap on its own — these are the only openings it gets. */
  const parts = text.split(/(?<=,)/);

  return (
    <span className={className} title={text}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && <wbr />}
        </Fragment>
      ))}
    </span>
  );
}

export const Amount = memo(AmountBase);
export default Amount;
