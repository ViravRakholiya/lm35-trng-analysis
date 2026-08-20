"""Extracts the k least-significant bits of each ADC reading, combined.

"k LSBs" means the k least-significant bits taken together as a group, per
the standard definition: for a reading of 173 = 0b10101101, the 3 LSBs are
bits {2,1,0} = "101" = 5, not bit position 2 analyzed alone. extract_lsb_group
returns that combined value (0..2^k-1) per sample -- the natural symbol for
an SP 800-90B min-entropy estimate with bits_per_symbol=k. unpack_bits then
expands each symbol into its k individual bits (MSB of the group first, i.e.
the same left-to-right order as the binary string above) for stages that need
an actual bitstream: Von Neumann debiasing and SP 800-22.
"""

import numpy as np


def extract_lsb_group(raw_adc: np.ndarray, num_bits: int) -> np.ndarray:
    if not 1 <= num_bits <= 4:
        raise ValueError(f"num_bits must be between 1 and 4, got {num_bits}")

    raw_adc = np.asarray(raw_adc)
    mask = (1 << num_bits) - 1
    return (raw_adc & mask).astype(np.uint8)


def unpack_bits(symbols: np.ndarray, num_bits: int) -> np.ndarray:
    """Expands each num_bits-wide symbol into its individual bits, MSB first,
    concatenated across samples into one flat bitstream."""
    symbols = np.asarray(symbols, dtype=np.uint8)
    shifts = np.arange(num_bits - 1, -1, -1)
    return ((symbols[:, None] >> shifts) & 1).astype(np.uint8).reshape(-1)
