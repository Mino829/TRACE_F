/**
 * The festival site's background: small teal and pink squares twinkling over
 * the beige. Positions come from a fixed seed so every render draws the same
 * field.
 */

type Dot = { left: number; top: number; size: number; pink: boolean; duration: number; delay: number };

/** mulberry32: a tiny deterministic generator, so the field is the same on every render. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const DOTS: Dot[] = (() => {
  const random = generator(54);
  return Array.from({ length: 30 }, (_, index) => ({
    left: random() * 100,
    top: random() * 100,
    size: 4 + Math.round(random() * 2),
    pink: index % 3 !== 0,
    duration: 2.4 + random() * 1.8,
    delay: -random() * 4,
  }));
})();

export function TwinkleField() {
  return (
    <div className="px-twinkles" aria-hidden="true">
      {DOTS.map((dot, index) => (
        <span
          key={index}
          className={`px-twinkle ${dot.pink ? "px-twinkle--pink" : ""}`}
          style={{
            left: `${dot.left}%`,
            top: `${dot.top}%`,
            width: dot.size,
            height: dot.size,
            ["--d" as string]: `${dot.duration.toFixed(2)}s`,
            ["--delay" as string]: `${dot.delay.toFixed(2)}s`,
          }}
        />
      ))}
    </div>
  );
}
