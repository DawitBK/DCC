import type { AnalyticsPointDto } from '@dcc/contracts';

const WIDTH = 120;
const HEIGHT = 32;
const PAD = 3;

/**
 * The path of one series, drawn on its own scale. A point with no reading breaks the line: a gap is a
 * gap, never a zero. Returns the line pieces and the lone points (a piece of one reading draws nothing).
 */
export function sparklineShape(points: AnalyticsPointDto[]): {
  lines: string[];
  dots: Array<[number, number]>;
} {
  const values = points.flatMap((point) => (point.value === null ? [] : [point.value]));
  if (values.length === 0) return { lines: [], dots: [] };
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low;
  const step = points.length > 1 ? (WIDTH - PAD * 2) / (points.length - 1) : 0;
  const lines: string[] = [];
  const dots: Array<[number, number]> = [];
  let run: Array<[number, number]> = [];
  const flush = () => {
    if (run.length === 1) dots.push(run[0]!);
    else if (run.length > 1) lines.push(run.map(([x, y]) => `${x},${y}`).join(' '));
    run = [];
  };
  points.forEach((point, index) => {
    if (point.value === null) return flush();
    const x = points.length > 1 ? PAD + step * index : WIDTH / 2;
    // A flat series sits in the middle.
    const y =
      span === 0 ? HEIGHT / 2 : HEIGHT - PAD - ((point.value - low) / span) * (HEIGHT - PAD * 2);
    run.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  });
  flush();
  return { lines, dots };
}

/**
 * A small line of one series. It is decoration: the same readings are in the table next to it, so it is
 * hidden from screen readers. Each series has its own scale and no axis, so it shows shape, never size.
 */
export function Sparkline({ points }: { points: AnalyticsPointDto[] }) {
  const { lines, dots } = sparklineShape(points);
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      aria-hidden="true"
      focusable="false"
    >
      {lines.map((line) => (
        <polyline
          key={line}
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {dots.map(([x, y]) => (
        <circle key={`${x},${y}`} cx={x} cy={y} r="2.5" fill="currentColor" />
      ))}
    </svg>
  );
}
