# ComfyUI-Stillsong: Stillsong's first-party overlay for the MiniMax Music 3
# nodes. Registers StillsongMusic3TextEncode — the official encoder plus
# composition capture (the per-frame RVQ code matrix), teacher-forced prefixes,
# and a fixed KV capacity. See stillsong_ar.py for the mechanism and README.md
# for provenance. Derived from ComfyUI (GPL-3.0); this package is GPL-3.0.
#
# The overlay is pinned to the exact ar.py it was adapted from and refuses to
# load against anything else — a silent behavioral drift under a ComfyUI bump
# would be worse than a loud failure (the app degrades to stock behavior when
# this node is absent).

import hashlib
import os

import torch

import folder_paths
import comfy.ldm.minimax_music.ar as _ar_module
import comfy.text_encoders.minimax_music as _te_module
from comfy.ldm.minimax_music.ar import AUDIO_FRAMES_PER_SECOND, CFG_SCALE, CFG_TOP_K, C0_VOCAB_SIZE, MAX_AUDIO_FRAMES

from .codes_format import decode_codes_b64, encode_codes
from .stillsong_ar import PINNED_AR_SHA256, stillsong_generate


def _guard_pinned_ar():
    with open(_ar_module.__file__, "rb") as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest != PINNED_AR_SHA256:
        raise RuntimeError(
            "ComfyUI-Stillsong is pinned to a specific comfy/ldm/minimax_music/ar.py "
            f"(sha256 {PINNED_AR_SHA256}) but found {digest}. The ComfyUI base has "
            "changed; re-verify stillsong_ar.py against the new upstream and update "
            "PINNED_AR_SHA256. Refusing to load until then."
        )


_guard_pinned_ar()


def _install_encode_patch():
    """Route generation through stillsong_generate when the token dict carries
    a 'stillsong' entry (only our node adds one); otherwise defer to upstream.
    Idempotent so a custom-node reload does not stack wrappers."""
    cls = _te_module.MiniMaxMusic3TEModel
    if hasattr(cls, "_stillsong_original_encode_token_weights"):
        return
    cls._stillsong_original_encode_token_weights = cls.encode_token_weights

    def encode_token_weights(self, token_weight_pairs):
        opts = token_weight_pairs.get("stillsong") if isinstance(token_weight_pairs, dict) else None
        if not opts:
            return cls._stillsong_original_encode_token_weights(self, token_weight_pairs)
        token_ids = [token for token, _ in token_weight_pairs["minimax_music3"][0]]
        input_ids = torch.tensor([token_ids], dtype=torch.long)
        hidden, codes = stillsong_generate(
            self,
            input_ids,
            token_weight_pairs["seed"],
            token_weight_pairs["max_audio_frames"],
            self.execution_device,
            token_weight_pairs["cfg_scale"],
            token_weight_pairs["top_k"],
            prefix_codes=opts.get("prefix_codes"),
            kv_capacity_frames=opts.get("kv_capacity_frames", 0),
        )
        return hidden.unsqueeze(0), None, {"stillsong_codes": codes}

    cls.encode_token_weights = encode_token_weights


_install_encode_patch()


def _save_codes_file(codes: torch.Tensor, filename_prefix: str) -> dict:
    full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
        filename_prefix, folder_paths.get_output_directory()
    )
    name = f"{filename}_{counter:05}_.codes.bin"
    with open(os.path.join(full_output_folder, name), "wb") as f:
        f.write(encode_codes(codes))
    return {"filename": name, "subfolder": subfolder, "type": "output"}


class StillsongMusic3TextEncode:
    """MiniMax Music3 Text Encode + composition capture, forced prefix, fixed
    KV capacity. Same conditioning contract as the official node."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": ("CLIP",),
                "caption": ("STRING", {"multiline": True, "dynamicPrompts": True}),
                "lyrics": ("STRING", {"multiline": True, "dynamicPrompts": True}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True}),
                "max_duration": ("FLOAT", {
                    "default": 120.0, "min": 0.04, "max": MAX_AUDIO_FRAMES / AUDIO_FRAMES_PER_SECOND, "step": 0.04,
                    "tooltip": "Maximum duration in seconds; the model can end the song earlier.",
                }),
                "cfg_scale": ("FLOAT", {"default": CFG_SCALE, "min": 0.0, "max": 100.0, "step": 0.1}),
                "top_k": ("INT", {"default": CFG_TOP_K, "min": 1, "max": C0_VOCAB_SIZE}),
            },
            "optional": {
                "prefix_codes": ("STRING", {
                    "default": "",
                    "tooltip": "Base64 SSC1 code matrix; teacher-forces the first N frames of the composition.",
                }),
                "save_codes_prefix": ("STRING", {
                    "default": "",
                    "tooltip": "When set, the generated code matrix is written to <output>/<prefix>_NNNNN_.codes.bin.",
                }),
                "kv_capacity_frames": ("INT", {
                    "default": 0, "min": 0, "max": MAX_AUDIO_FRAMES,
                    "tooltip": "Fixed KV cache capacity in frames (0 = size from max_duration, upstream behavior).",
                }),
            },
        }

    RETURN_TYPES = ("CONDITIONING", "FLOAT")
    RETURN_NAMES = ("conditioning", "seconds")
    FUNCTION = "encode"
    CATEGORY = "conditioning/stillsong"
    # Output node so codes-only graphs (no render) are executable — the
    # validation harness relies on this; in the app's full graph it changes
    # nothing (the node is upstream of the audio save anyway).
    OUTPUT_NODE = True

    def encode(self, clip, caption, lyrics, seed, max_duration, cfg_scale, top_k,
               prefix_codes="", save_codes_prefix="", kv_capacity_frames=0):
        max_audio_frames = min(MAX_AUDIO_FRAMES, max(1, round(max_duration * AUDIO_FRAMES_PER_SECOND)))
        tokens = clip.tokenize(
            caption, lyrics=lyrics, seed=seed, max_audio_frames=max_audio_frames, cfg_scale=cfg_scale, top_k=top_k
        )
        tokens["stillsong"] = {
            "prefix_codes": decode_codes_b64(prefix_codes) if prefix_codes else None,
            "kv_capacity_frames": int(kv_capacity_frames),
        }
        conditioning = clip.encode_from_tokens_scheduled(tokens)
        codes = None
        for cond in conditioning:
            hidden = cond[0]
            cond[1]["conditioning_scale"] = torch.ones((hidden.shape[0], 1, 1), device=hidden.device, dtype=hidden.dtype)
            codes = cond[1].pop("stillsong_codes", codes)
        seconds = conditioning[0][0].shape[1] / AUDIO_FRAMES_PER_SECOND
        ui = {}
        if save_codes_prefix and codes is not None:
            ui = {"stillsong_codes": [_save_codes_file(codes, save_codes_prefix)]}
        return {"ui": ui, "result": (conditioning, seconds)}


NODE_CLASS_MAPPINGS = {
    "StillsongMusic3TextEncode": StillsongMusic3TextEncode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "StillsongMusic3TextEncode": "Stillsong Music3 Text Encode",
}
