#!/usr/bin/env python3
"""Smoke test: does Kokoro give us usable per-word timestamps on this machine?

Run it after setup. It prints the alignment for a few tricky sentences and
reports the synthesis speed (real-time factor) for the resolved device.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

from tts import KokoroEngine, split_words  # noqa: E402

CASES = [
    "The quick brown fox jumps over the lazy dog.",
    "In 2024 the price rose by 15% to $3.50 per unit, Dr. Wilson noted.",
    "Reading with ADHD isn't about willpower — it's about attention regulation.",
]


def main() -> int:
    eng = KokoroEngine()
    t0 = time.time()
    eng.warm()
    print(f"device={eng.resolved_device}  load+warm={time.time() - t0:.1f}s\n")

    ok = True
    for text in CASES:
        t0 = time.time()
        seg = eng.synth(text)
        dt = time.time() - t0
        rtf = seg.duration / dt if dt else 0
        print(f'"{text}"')
        print(f"  audio {seg.duration:.2f}s in {dt:.2f}s  ->  {rtf:.0f}x real time")
        src = split_words(text)
        for (cs, ce, word), w in zip(src, seg.words):
            flag = "" if (cs, ce) == (w["cs"], w["ce"]) else "  <-- OFFSET MISMATCH"
            print(f"    {w['s']:6.2f} → {w['e']:6.2f}   {word}{flag}")
            if flag:
                ok = False
        if len(src) != len(seg.words):
            print(f"    !! {len(src)} words but {len(seg.words)} timings")
            ok = False
        # Timings must be monotonic and inside the audio.
        prev = -1.0
        for w in seg.words:
            if w["s"] < prev - 1e-6 or w["e"] > seg.duration + 0.05:
                print(f"    !! non-monotonic or out-of-range timing {w}")
                ok = False
            prev = w["s"]
        print()

    print("RESULT:", "word timings look correct" if ok else "PROBLEMS FOUND")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
