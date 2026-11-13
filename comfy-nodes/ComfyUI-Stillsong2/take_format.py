# The take file: what a performance needs to be partly re-sung later. One
# safetensors file (never pickle) holding the music tokens as codec codes and
# the final audio latent.
#
#   codes   int16   [frames]        YuE2 codec code per 25 Hz frame (0..32767)
#   latent  float32 [64, frames]    the latent the VAE decoded
#   metadata: format = "stillsong2-take", version = "1"

import os

import torch
from safetensors import safe_open
from safetensors.torch import load_file, save_file

FORMAT = "stillsong2-take"
VERSION = "1"
SUFFIX = ".take.safetensors"
CODE_COUNT = 32768
LATENT_CHANNELS = 64


def parse_ranges(text, frames):
    """'583-662,2264-2338' -> [(583, 662), (2264, 2338)]: half-open frame windows,
    ascending, non-overlapping, inside [0, frames]."""
    windows = []
    for part in (p.strip() for p in str(text).split(",")):
        if not part:
            continue
        pieces = part.split("-")
        if len(pieces) != 2 or not pieces[0].isdigit() or not pieces[1].isdigit():
            raise ValueError(f"Bad frame range '{part}'; expected start-end.")
        start, stop = int(pieces[0]), int(pieces[1])
        if not (0 <= start < stop <= frames):
            raise ValueError(f"Frame range {start}-{stop} is outside the take (0-{frames}).")
        if windows and start < windows[-1][1]:
            raise ValueError("Frame ranges must be ascending and must not overlap.")
        windows.append((start, stop))
    return windows


def window_mask(windows, frames):
    """Bool [frames]: True inside a window."""
    mask = torch.zeros((frames,), dtype=torch.bool)
    for start, stop in windows:
        mask[start:stop] = True
    return mask


def check_take(codes, latent):
    if codes.dtype != torch.int16 or codes.dim() != 1 or codes.numel() == 0:
        raise ValueError("Take codes must be a non-empty int16 vector.")
    if int(codes.min()) < 0:
        raise ValueError("Take codes are out of range.")
    if latent.dtype != torch.float32 or latent.dim() != 2 or latent.shape[0] != LATENT_CHANNELS:
        raise ValueError(f"Take latent must be float32 [{LATENT_CHANNELS}, frames].")
    if latent.shape[1] != codes.shape[0]:
        raise ValueError("Take codes and latent disagree about the number of frames.")


def save_take(path, codes, latent):
    check_take(codes, latent)
    save_file({"codes": codes.contiguous(), "latent": latent.contiguous()}, path,
              metadata={"format": FORMAT, "version": VERSION})


def load_take(path):
    with safe_open(path, framework="pt", device="cpu") as handle:
        metadata = handle.metadata() or {}
    if metadata.get("format") != FORMAT or metadata.get("version") != VERSION:
        raise ValueError("Not a Stillsong 2 take file (or a version this studio does not know).")
    tensors = load_file(path, device="cpu")
    if "codes" not in tensors or "latent" not in tensors:
        raise ValueError("Take file is missing its codes or latent.")
    check_take(tensors["codes"], tensors["latent"])
    return tensors["codes"], tensors["latent"]


def inside(path, base):
    """Whether the real path lies inside the real base directory."""
    real, root = os.path.realpath(path), os.path.realpath(base)
    try:
        return os.path.commonpath([real, root]) == root
    except ValueError:  # different drives
        return False
