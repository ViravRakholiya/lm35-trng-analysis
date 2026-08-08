"""Extracts least-significant bits from raw ADC readings into a bitstream.

For num_bits > 1, each sample contributes its bits in order from bit 0 (LSB)
up to bit (num_bits - 1), before moving to the next sample.
"""

import numpy as np


def extract_lsb_bitstream(raw_adc: np.ndarray, num_bits: int = 1) -> np.ndarray:
    if not 1 <= num_bits <= 4:
        raise ValueError(f"num_bits must be between 1 and 4, got {num_bits}")

    raw_adc = np.asarray(raw_adc)
    shifts = np.arange(num_bits, dtype=raw_adc.dtype)
    bits = (raw_adc[:, None] >> shifts) & 1
    return bits.reshape(-1).astype(np.uint8)
