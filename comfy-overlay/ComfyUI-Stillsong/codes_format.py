# SSC1: Stillsong's on-disk / on-wire format for a MiniMax Music 3 composition
# (the per-frame RVQ code matrix the AR composer feeds back to itself).
#
#   magic   4 bytes  b"SSC1"
#   version u16 LE   1
#   books   u16 LE   codebooks per frame (8 for Music 3: c0 + 7 depth codes)
#   frames  u32 LE   number of frames
#   body    frames * books * u16 LE, row-major [frame][codebook]
#
# u16 is sufficient: c0 < 16384 (C0_VOCAB_SIZE), depth codes < 1024.

import base64
import struct
from array import array

import torch

MAGIC = b"SSC1"
VERSION = 1
HEADER = struct.Struct("<HHI")


def encode_codes(codes: torch.Tensor) -> bytes:
    if codes.dim() != 2:
        raise ValueError(f"codes must be [frames, codebooks], got shape {tuple(codes.shape)}")
    t = codes.detach().to(device="cpu", dtype=torch.long)
    frames, books = t.shape
    if frames == 0:
        raise ValueError("refusing to encode an empty code matrix")
    if int(t.min()) < 0 or int(t.max()) > 0xFFFF:
        raise ValueError("code value out of u16 range")
    body = array("H", t.reshape(-1).tolist())
    return MAGIC + HEADER.pack(VERSION, books, frames) + body.tobytes()


def decode_codes(data: bytes) -> torch.Tensor:
    if len(data) < len(MAGIC) + HEADER.size or data[: len(MAGIC)] != MAGIC:
        raise ValueError("not an SSC1 codes blob")
    version, books, frames = HEADER.unpack_from(data, len(MAGIC))
    if version != VERSION:
        raise ValueError(f"unsupported SSC1 version {version}")
    body = data[len(MAGIC) + HEADER.size :]
    expected = frames * books * 2
    if len(body) != expected:
        raise ValueError(f"SSC1 body is {len(body)} bytes, expected {expected}")
    values = array("H")
    values.frombytes(body)
    return torch.tensor(values, dtype=torch.long).reshape(frames, books)


def encode_codes_b64(codes: torch.Tensor) -> str:
    return base64.b64encode(encode_codes(codes)).decode("ascii")


def decode_codes_b64(text: str) -> torch.Tensor:
    return decode_codes(base64.b64decode(text))
