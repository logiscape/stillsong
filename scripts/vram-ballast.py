# Pins N GiB of VRAM and holds it until killed (Ctrl+C) - the honest half of
# Patient-tier emulation. --reserve-vram only constrains ComfyUI's *voluntary*
# accounting; this makes the memory genuinely unavailable, so KV-cache
# pre-allocation and WDDM-spill behavior are measured for real.
#
# Run with the components venv (has CUDA torch), BEFORE starting ComfyUI or
# llama-server, and kill it the moment the measurement run ends:
#
#   & "$env:LOCALAPPDATA\com.logiscape.stillsong\components\python-env\Scripts\python.exe" `
#       scripts\vram-ballast.py 8
#
# Worst case if oversized: this process gets a clean CUDA OOM, or WDDM spills
# allocations to shared memory (visible in nvidia-smi / mem-sampler output).
# Nothing here can harm the machine - it is one killable process holding memory.

import sys
import time

import torch

CHUNK_MB = 256


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: vram-ballast.py <GiB to pin>")
    want_bytes = int(float(sys.argv[1]) * 1024**3)
    if not torch.cuda.is_available():
        sys.exit("CUDA is not available in this interpreter")

    dev = torch.device("cuda:0")
    chunks = []
    held = 0
    try:
        while held < want_bytes:
            size = min(CHUNK_MB * 1024**2, want_bytes - held)
            chunks.append(torch.empty(size, dtype=torch.uint8, device=dev))
            held += size
    except torch.cuda.OutOfMemoryError:
        print(f"OOM after {held / 1024**3:.2f} GiB - holding what was allocated")

    free, total = torch.cuda.mem_get_info(dev)
    print(
        f"holding {held / 1024**3:.2f} GiB on {torch.cuda.get_device_name(dev)}; "
        f"device now {free / 1024**3:.2f} GiB free of {total / 1024**3:.2f} GiB",
        flush=True,
    )
    print("Ctrl+C (or kill this process) to release", flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
