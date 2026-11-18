import Tooltip from '../../../../components/ui/Tooltip';

/** Master text (a segment, a name) cut after `max` characters with "…"; the full text shows in the
    app tooltip, and screen readers still read all of it. Short text renders as it is, no tooltip. */
export default function ClipText({ text, max = 20, className }: { text: string; max?: number; className?: string }) {
  if (!text || text.length <= max) return <span className={className}>{text}</span>;
  return (
    <Tooltip label={text}>
      <span className={className} tabIndex={0}>
        <span aria-hidden>{`${text.slice(0, max).trimEnd()}…`}</span>
        <span className="visually-hidden">{text}</span>
      </span>
    </Tooltip>
  );
}
