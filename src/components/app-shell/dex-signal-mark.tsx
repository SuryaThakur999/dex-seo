import Image from 'next/image';

export type DexSignalPose = 'idle' | 'complete';

/**
 * Dex's brand mark, cropped from the new comic-splash "DEX" logo (public/brand/dex-mark.png)
 * down to just the D bubble-letter — the full splash's fine detail (SEO badge, sunglasses,
 * outline strokes) doesn't survive at the 24-32px sizes this component is used at. `pose` is
 * kept for call-site compatibility but no longer changes the rendered mark — the old
 * completion-sparkle accent was specific to the retired SVG mascot design.
 */
export function DexSignalMark({ pose = 'idle', size = 32 }: { pose?: DexSignalPose; size?: number }) {
  return (
    <Image
      src="/brand/dex-mark.png"
      alt={pose === 'complete' ? 'Dex, audit complete' : 'Dex'}
      width={size}
      height={size}
      unoptimized
    />
  );
}
