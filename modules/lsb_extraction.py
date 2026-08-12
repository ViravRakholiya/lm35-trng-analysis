"""Extracts a single bit-plane from raw ADC readings into a bitstream.

Bit position 0 is the LSB. Each bit position is treated as an independent
bitstream (one bit per sample) rather than concatenated with others, so
downstream stages (SP 800-90B, Von Neumann, SP 800-22) always see a genuine
single-bit-per-symbol stream — the bit-plane-analysis convention used for
ADC-based TRNG evaluation, answering "which bit position is most random?"
rather than "how many combined bits can we extract?".
"""

import numpy as np


def extract_bit_position_stream(raw_adc: np.ndarray, bit_position: int = 0) -> np.ndarray:
    if not 0 <= bit_position <= 3:
        raise ValueError(f"bit_position must be between 0 and 3, got {bit_position}")

    raw_adc = np.asarray(raw_adc)
    return ((raw_adc >> bit_position) & 1).astype(np.uint8)
