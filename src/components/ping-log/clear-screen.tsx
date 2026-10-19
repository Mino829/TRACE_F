"use client";

/**
 * The developer screen's accuracy record ends on "CLEAR!", in the pixel
 * look. The participant's own clear screens are RAY's (ray/photo.tsx and
 * ray/screens.tsx). Nothing is handed out as a reward, so the number of
 * records never reads as a score.
 */

export function ClearTitle() {
  return (
    <p className="px-clear" aria-hidden="true">
      CLEAR!
    </p>
  );
}

const CONFETTI = (() => {
  const colours = ["var(--px-yellow)", "var(--px-cyan)", "var(--px-green)", "var(--px-red)", "var(--px-ink)"];
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 30 }, (_, index) => ({
    left: `${random() * 100}%`,
    colour: colours[index % colours.length],
    dx: `${Math.round(random() * 80 - 40)}px`,
    dy: `${Math.round(55 + random() * 35)}vh`,
    duration: `${(1.4 + random() * 1).toFixed(2)}s`,
    delay: `${(random() * 0.5).toFixed(2)}s`,
  }));
})();

/** A burst of pixel squares, once. */
export function Confetti() {
  return (
    <div className="px-confetti" aria-hidden="true">
      {CONFETTI.map((piece, index) => (
        <i
          key={index}
          style={{
            left: piece.left,
            ["--c" as string]: piece.colour,
            ["--dx" as string]: piece.dx,
            ["--dy" as string]: piece.dy,
            ["--d" as string]: piece.duration,
            ["--delay" as string]: piece.delay,
          }}
        />
      ))}
    </div>
  );
}
