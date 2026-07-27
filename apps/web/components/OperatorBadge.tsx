import { operatorShape, operatorStyle, type Operator } from '@ielts-map/core';

/**
 * The operator label, tinted to match its map pin. The shape marker repeats the
 * pin's silhouette so the badge and the map are readable as one key.
 */
export function OperatorBadge({
  operator,
  size = 'sm',
}: {
  operator: Operator;
  size?: 'sm' | 'md';
}) {
  const style = operatorStyle(operator);
  const shape = operatorShape(operator);

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium ${
        size === 'md' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'
      }`}
      style={{ background: style.soft, color: style.text }}
    >
      <span
        aria-hidden
        className="inline-block h-2 w-2 shrink-0"
        style={{
          background: style.base,
          borderRadius: shape === 'circle' ? '9999px' : '1px',
          transform: shape === 'diamond' ? 'rotate(45deg)' : undefined,
        }}
      />
      {operator}
    </span>
  );
}
