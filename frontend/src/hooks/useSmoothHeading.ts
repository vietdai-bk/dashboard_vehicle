import { useEffect, useRef, useState } from "react";

/**
 * Trả về góc liên tục (không wrap 359→0) để CSS transition xoay kim mượt,
 * không giật khi heading nhảy qua 0°.
 */
export function useSmoothHeading(heading: number): number {
  const acc = useRef(heading);
  const [value, setValue] = useState(heading);
  useEffect(() => {
    const current = ((acc.current % 360) + 360) % 360;
    let delta = heading - current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    acc.current += delta;
    setValue(acc.current);
  }, [heading]);
  return value;
}
