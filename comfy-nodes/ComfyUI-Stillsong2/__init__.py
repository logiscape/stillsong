# ComfyUI-Stillsong2: Stillsong 2's first-party nodes for YuE2. They keep a
# render's take (its music tokens and final latent), find where a take sings
# given words, and perform a take again with only some frame windows re-sung
# while everything else is held. See README.md for provenance and
# stillsong2_ar.py for the mechanism. Derived from ComfyUI (GPL-3.0); this
# package is GPL-3.0.
#
# The package is pinned to the exact comfy/text_encoders/yue2.py it was derived
# from and refuses to load against anything else: a silent behavioral drift
# under a ComfyUI bump would be worse than a loud failure (the app falls back to
# the core nodes, without takes, when these nodes are absent).

import hashlib
import json
import os

import torch

import comfy.text_encoders.yue2 as _yue2
import folder_paths
from comfy.text_encoders.yue2 import CODEC_OFFSET, FRAMES_PER_SECOND, MUSIC_END

from .stillsong2_ar import PINNED_YUE2_SHA256, stillsong_encode
from .take_format import LATENT_CHANNELS, SUFFIX, inside, load_take, parse_ranges, save_take, window_mask


def _guard_pinned_yue2():
    with open(_yue2.__file__, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest()
    if digest != PINNED_YUE2_SHA256:
        raise RuntimeError(
            "ComfyUI-Stillsong2 is pinned to a specific comfy/text_encoders/yue2.py "
            f"(sha256 {PINNED_YUE2_SHA256}) but found {digest}. The ComfyUI base has "
            "changed; re-derive stillsong2_ar.py against the new upstream and update "
            "PINNED_YUE2_SHA256. Refusing to load until then."
        )


_guard_pinned_yue2()


def _install_encode_patch():
    """Route encoding through stillsong_encode when the token dict carries a
    'stillsong' entry (only these nodes add one); otherwise defer to upstream.
    Idempotent so a custom-node reload does not stack wrappers."""
    cls = _yue2.YuE2TEModel
    if hasattr(cls, "_stillsong_original_encode_token_weights"):
        return
    cls._stillsong_original_encode_token_weights = cls.encode_token_weights

    def encode_token_weights(self, tokens):
        if isinstance(tokens, dict) and "stillsong" in tokens:
            return stillsong_encode(self, tokens)
        return cls._stillsong_original_encode_token_weights(self, tokens)

    cls.encode_token_weights = encode_token_weights


_install_encode_patch()

TOKENS = "STILLSONG2_TOKENS"  # {"ids": [YuE2 token id per frame]}


def _audio_latent(samples):
    return {"samples": samples, "type": "audio", "downscale_ratio_temporal": 1920}


def _take_path(name):
    """A take named 'sub/file.take.safetensors [temp]' or '... [output]'; nothing
    outside those two ComfyUI folders is ever read."""
    bare, base = folder_paths.annotated_filepath(name.strip())
    if base is None or os.path.realpath(base) not in (
        os.path.realpath(folder_paths.get_temp_directory()),
        os.path.realpath(folder_paths.get_output_directory()),
    ):
        raise ValueError("A take is read from ComfyUI's temp or output folder: end its name with [temp] or [output].")
    path = os.path.join(base, bare)
    if not bare.endswith(SUFFIX) or not inside(path, base) or not os.path.isfile(path):
        raise ValueError(f"Take not found: {name}")
    return path


class Stillsong2Perform:
    """YuE2 Generate Music, with the music tokens it wrote as a third output.
    Given a take's tokens and `redo` frame windows it performs that take again:
    tokens outside the windows are kept, the windows are sung anew."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": ("CLIP",),
                "style": ("STRING", {"multiline": True, "dynamicPrompts": True}),
                "lyrics": ("STRING", {"multiline": True, "dynamicPrompts": True}),
                "abc": ("STRING", {"multiline": True, "default": ""}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True}),
                "mode": (["full", "melody"],),
                "max_duration": ("FLOAT", {"default": 360.0, "min": 0.04, "max": 900.0, "step": 0.04}),
                "temperature": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 5.0, "step": 0.05}),
                "top_p": ("FLOAT", {"default": 0.95, "min": 0.01, "max": 1.0, "step": 0.01}),
                "top_k": ("INT", {"default": 100, "min": 1, "max": 32768}),
                "repetition_penalty": ("FLOAT", {"default": 1.2, "min": 0.01, "max": 10.0, "step": 0.01}),
            },
            "optional": {
                "tokens": (TOKENS, {"tooltip": "A take to perform again; needs redo."}),
                "redo": ("STRING", {"default": "", "tooltip": "Frame windows to sing anew, e.g. 583-662,2264-2338."}),
            },
        }

    RETURN_TYPES = ("CONDITIONING", "FLOAT", TOKENS)
    RETURN_NAMES = ("conditioning", "seconds", "tokens")
    FUNCTION = "perform"
    CATEGORY = "conditioning/stillsong2"

    def perform(self, clip, style, lyrics, abc, seed, mode, max_duration, temperature, top_p, top_k, repetition_penalty,
                tokens=None, redo=""):
        # As YuE2GenerateMusic: no plan means "off", and the guidance default follows the mode.
        if not abc.strip():
            mode = "off"
        cfg_scale = 1.01 if mode == "off" else 1.0
        encoded = clip.tokenize(style, lyrics=lyrics, cot=mode, seed=seed, abc=abc,
                                max_tokens=max(1, round(max_duration * FRAMES_PER_SECOND)),
                                temperature=temperature, top_p=top_p, top_k=top_k,
                                repetition_penalty=repetition_penalty, cfg_scale=cfg_scale)
        opts = {}
        frames = None
        if tokens is not None:
            ids = tokens["ids"]
            frames = len(ids)
            windows = parse_ranges(redo, frames)
            if not windows:
                raise ValueError("Performing a take again needs at least one redo window.")
            # One entry per frame plus the end token, so the take ends where it did.
            forced = torch.tensor(list(ids) + [MUSIC_END], dtype=torch.long)
            forced[:frames][window_mask(windows, frames)] = -1
            opts["forced"] = forced
        encoded["stillsong"] = opts
        conditioning = clip.encode_from_tokens_scheduled(encoded)
        semantic = None
        for cond in conditioning:
            semantic = cond[1].pop("stillsong_semantic", semantic)
        if semantic is None:
            raise RuntimeError("The YuE2 encoder did not hand back its music tokens.")
        if frames is not None and len(semantic) != frames:
            raise RuntimeError(f"The take changed length ({frames} -> {len(semantic)} frames).")
        seconds = conditioning[0][1]["yue2_frames"] / FRAMES_PER_SECOND
        return (conditioning, seconds, {"ids": list(semantic)})


class Stillsong2LoadTake:
    """Reads a take file from ComfyUI's temp or output folder."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"take": ("STRING", {"default": "", "tooltip": "e.g. stillsong2/abcd1234.take.safetensors [temp]"})}}

    RETURN_TYPES = (TOKENS, "LATENT")
    RETURN_NAMES = ("tokens", "latent")
    FUNCTION = "load"
    CATEGORY = "latent/stillsong2"

    def load(self, take):
        codes, latent = load_take(_take_path(take))
        ids = (codes.to(torch.long) + CODEC_OFFSET).tolist()
        return ({"ids": ids}, _audio_latent(latent.unsqueeze(0)))

    @classmethod
    def IS_CHANGED(cls, take):
        digest = hashlib.sha256()
        with open(_take_path(take), "rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
        return digest.hexdigest()


class Stillsong2HoldLatent:
    """Marks the redo windows of an audio latent for the sampler (noise mask 1);
    every other frame is held."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"samples": ("LATENT",), "redo": ("STRING", {"default": ""})}}

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "hold"
    CATEGORY = "latent/stillsong2"

    def hold(self, samples, redo):
        latent = samples["samples"]
        if latent.dim() != 3 or latent.shape[0] != 1 or latent.shape[1] != LATENT_CHANNELS:
            raise ValueError("Expected one YuE2 audio latent [1, 64, frames].")
        frames = latent.shape[-1]
        windows = parse_ranges(redo, frames)
        if not windows:
            raise ValueError("Holding a latent needs at least one redo window.")
        out = _audio_latent(latent)
        out["noise_mask"] = window_mask(windows, frames).to(torch.float32).reshape(1, 1, frames)
        return (out,)


class Stillsong2RestoreLatent:
    """After sampling: puts the take's own frames back outside the redo windows.
    The sampler's last step leaves held frames a rounding error away from the
    original; this makes them bit-equal, so repeated edits cannot drift."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"samples": ("LATENT",), "take": ("LATENT",), "redo": ("STRING", {"default": ""})}}

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "restore"
    CATEGORY = "latent/stillsong2"

    def restore(self, samples, take, redo):
        sampled, original = samples["samples"], take["samples"]
        if sampled.shape != original.shape:
            raise ValueError("The sampled latent and the take differ in shape.")
        frames = sampled.shape[-1]
        keep = ~window_mask(parse_ranges(redo, frames), frames)
        out = sampled.clone()
        out[..., keep] = original[..., keep].to(device=out.device, dtype=out.dtype)
        return (_audio_latent(out),)


class Stillsong2Align:
    """Where does a take sing words that lyric sheet B no longer has?

    Replays the take under sheet A and under sheet B (same style and plan) and
    returns, per frame, log p(token | B) - log p(token | A). Words of A that B
    lacks show as sharp drops. Output: JSON {"frames": n, "drop": [...]}, also
    placed in the prompt's history as this node's `text`.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": ("CLIP",),
                "style": ("STRING", {"multiline": True}),
                "abc": ("STRING", {"multiline": True, "default": ""}),
                "mode": (["full", "melody"],),
                "tokens": (TOKENS,),
                "lyrics_a": ("STRING", {"multiline": True}),
                "lyrics_b": ("STRING", {"multiline": True}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("series",)
    FUNCTION = "align"
    CATEGORY = "conditioning/stillsong2"
    OUTPUT_NODE = True

    def align(self, clip, style, abc, mode, tokens, lyrics_a, lyrics_b):
        ids = list(tokens["ids"])
        if not abc.strip():
            mode = "off"

        def replay(lyrics):
            encoded = clip.tokenize(style, lyrics=lyrics, cot=mode, seed=0, abc=abc, max_tokens=len(ids))
            encoded["stillsong"] = {"replay": ids}
            return clip.encode_from_tokens(encoded, return_dict=True)["stillsong_logp"]

        drop = replay(lyrics_b) - replay(lyrics_a)
        series = json.dumps({"frames": len(ids), "drop": [round(v, 3) for v in drop.tolist()]}, separators=(",", ":"))
        return {"ui": {"text": [series]}, "result": (series,)}


class Stillsong2SaveTake:
    """Writes the take (music tokens + final latent) to
    <output>/<prefix>_NNNNN_.take.safetensors."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"samples": ("LATENT",), "tokens": (TOKENS,), "filename_prefix": ("STRING", {"default": "audio/take"})}}

    RETURN_TYPES = ()
    FUNCTION = "save"
    CATEGORY = "latent/stillsong2"
    OUTPUT_NODE = True

    def save(self, samples, tokens, filename_prefix):
        latent = samples["samples"]
        if latent.dim() != 3 or latent.shape[0] != 1:
            raise ValueError("Expected one YuE2 audio latent [1, 64, frames].")
        codes = (torch.tensor(tokens["ids"], dtype=torch.long) - CODEC_OFFSET).to(torch.int16)
        folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, folder_paths.get_output_directory())
        name = f"{filename}_{counter:05}_{SUFFIX}"
        save_take(os.path.join(folder, name), codes, latent[0].detach().to(device="cpu", dtype=torch.float32))
        return {"ui": {"stillsong_take": [{"filename": name, "subfolder": subfolder, "type": "output"}]}}


NODE_CLASS_MAPPINGS = {
    "Stillsong2Perform": Stillsong2Perform,
    "Stillsong2LoadTake": Stillsong2LoadTake,
    "Stillsong2HoldLatent": Stillsong2HoldLatent,
    "Stillsong2RestoreLatent": Stillsong2RestoreLatent,
    "Stillsong2Align": Stillsong2Align,
    "Stillsong2SaveTake": Stillsong2SaveTake,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Stillsong2Perform": "Stillsong 2 Perform",
    "Stillsong2LoadTake": "Stillsong 2 Load Take",
    "Stillsong2HoldLatent": "Stillsong 2 Hold Latent",
    "Stillsong2RestoreLatent": "Stillsong 2 Restore Latent",
    "Stillsong2Align": "Stillsong 2 Align",
    "Stillsong2SaveTake": "Stillsong 2 Save Take",
}
