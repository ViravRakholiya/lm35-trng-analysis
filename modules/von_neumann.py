"""Von Neumann debiasing of a bitstream.

Non-overlapping bit pairs are transformed as 01 -> 0 and 10 -> 1; equal pairs
(00, 11) are discarded. A trailing unpaired bit, if any, is ignored.
"""

from dataclasses import dataclass

import numpy as np


@dataclass
class DebiasResult:
    output_bits: np.ndarray
    input_bit_count: int
    output_bit_count: int
    retention_rate: float


def von_neumann_debias(bits: np.ndarray) -> DebiasResult:
    bits = np.asarray(bits)
    n = bits.size

    paired_length = (n // 2) * 2
    pairs = bits[:paired_length].reshape(-1, 2)
    unequal = pairs[:, 0] != pairs[:, 1]
    output = pairs[unequal, 0].astype(np.uint8)

    return DebiasResult(
        output_bits=output,
        input_bit_count=n,
        output_bit_count=output.size,
        retention_rate=(output.size / n) if n else 0.0,
    )
