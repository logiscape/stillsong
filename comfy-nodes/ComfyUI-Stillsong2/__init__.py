# ComfyUI-Stillsong2: Stillsong 2's first-party nodes for YuE2. They keep a
# render's take (its music tokens and final latent), score a take against any
# lyric sheet or melody plan, lay a take out anew with gaps for new music, and
# perform a take again with only some frame windows re-sung while everything
# else is held. See README.md for provenance and
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
from comfy.text_encoders.yue2 import CODEC_OFFSET, CONTEXT, FRAMES_PER_SECOND

from .stillsong2_ar import PINNED_YUE2_SHA256, stillsong_encode
from .take_format import LATENT_CHANNELS, SUFFIX, inside, load_take, parse_layout, parse_ranges, save_take, window_mask


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

# {"ids": [YuE2 token id per frame]}; a take laid out anew also carries
# "gaps": [(start, stop), ...], the frames that hold no music yet.
TOKENS = "STILLSONG2_TOKENS"

_PROMPT = {
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
}


def _tokenize(clip, style, lyrics, abc, seed, mode, max_duration, temperature, top_p, top_k, repetition_penalty):
    # As YuE2GenerateMusic: no plan means "off", and the guidance default follows the mode.
    if not abc.strip():
        mode = "off"
    cfg_scale = 1.01 if mode == "off" else 1.0
    return clip.tokenize(style, lyrics=lyrics, cot=mode, seed=seed, abc=abc,
                         max_tokens=max(1, round(max_duration * FRAMES_PER_SECOND)),
                         temperature=temperature, top_p=top_p, top_k=top_k,
                         repetition_penalty=repetition_penalty, cfg_scale=cfg_scale)


def _gaps(tokens):
    return [tuple(gap) for gap in tokens.get("gaps") or []]


def _require_whole(tokens, what):
    if _gaps(tokens):
        raise ValueError(f"{what} needs a whole take; this one has gaps that were never sung.")


def _require_sung(tokens, windows):
    """Every gap of a take laid out anew must lie inside a redo window."""
    for start, stop in _gaps(tokens):
        if not any(a <= start and stop <= b for a, b in windows):
            raise ValueError(f"The gap at frames {start}-{stop} holds no music: put it inside a redo window.")


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
            "required": dict(_PROMPT),
            "optional": {
                "tokens": (TOKENS, {"tooltip": "A take to perform again."}),
                "redo": ("STRING", {"default": "", "tooltip": "Frame windows to sing anew, e.g. 583-662,2264-2338. Empty: the take as it is."}),
            },
        }

    RETURN_TYPES = ("CONDITIONING", "FLOAT", TOKENS)
    RETURN_NAMES = ("conditioning", "seconds", "tokens")
    FUNCTION = "perform"
    CATEGORY = "conditioning/stillsong2"

    def perform(self, clip, style, lyrics, abc, seed, mode, max_duration, temperature, top_p, top_k, repetition_penalty,
                tokens=None, redo=""):
        encoded = _tokenize(clip, style, lyrics, abc, seed, mode, max_duration, temperature, top_p, top_k, repetition_penalty)
        opts = {}
        frames = None
        if tokens is not None:
            ids = list(tokens["ids"])
            frames = len(ids)
            windows = parse_ranges(redo, frames)
            _require_sung(tokens, windows)
            opts = {"take": ids, "windows": windows}
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


class Stillsong2Resing:
    """Sings the `redo` windows of a take anew and returns its tokens, without
    building the acoustic conditioning. This is the quick part of performing a
    take again (about a second for a window of a few bars): try several seeds,
    score what they sang, and hand the chosen tokens to Stillsong2Perform with
    an empty `redo` to perform them in full."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                **_PROMPT,
                "tokens": (TOKENS,),
                "redo": ("STRING", {"default": "", "tooltip": "Frame windows to sing anew, e.g. 583-662,2264-2338."}),
            }
        }

    RETURN_TYPES = (TOKENS,)
    RETURN_NAMES = ("tokens",)
    FUNCTION = "resing"
    CATEGORY = "conditioning/stillsong2"

    def resing(self, clip, style, lyrics, abc, seed, mode, max_duration, temperature, top_p, top_k, repetition_penalty, tokens, redo):
        encoded = _tokenize(clip, style, lyrics, abc, seed, mode, max_duration, temperature, top_p, top_k, repetition_penalty)
        ids = list(tokens["ids"])
        windows = parse_ranges(redo, len(ids))
        if not windows:
            raise ValueError("Singing a take again needs at least one redo window.")
        _require_sung(tokens, windows)
        encoded["stillsong"] = {"take": ids, "windows": windows, "condition": False}
        sung = clip.encode_from_tokens(encoded, return_dict=True)["stillsong_semantic"]
        if len(sung) != len(ids):
            raise RuntimeError(f"The take changed length ({len(ids)} -> {len(sung)} frames).")
        return ({"ids": list(sung)},)


class Stillsong2ArrangeTake:
    """Lays a take out anew: spans of it kept, in the order given, with gaps of
    new frames between them. `layout` such as `0-2920,+340,2920-7694` opens 340
    new frames at frame 2920; `0-2000,2800-7694` takes frames 2000-2800 out.
    The gaps hold no music until a redo window covering them is sung; the other
    nodes refuse a take whose gaps were never sung."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "tokens": (TOKENS,),
                "samples": ("LATENT",),
                "layout": ("STRING", {"default": "", "tooltip": "Spans to keep (start-end) and gaps to open (+frames), e.g. 0-2920,+340,2920-7694."}),
            }
        }

    RETURN_TYPES = (TOKENS, "LATENT")
    RETURN_NAMES = ("tokens", "latent")
    FUNCTION = "arrange"
    CATEGORY = "latent/stillsong2"

    def arrange(self, tokens, samples, layout):
        _require_whole(tokens, "Laying a take out anew")
        ids = list(tokens["ids"])
        latent = samples["samples"]
        if latent.dim() != 3 or latent.shape[0] != 1 or latent.shape[1] != LATENT_CHANNELS or latent.shape[-1] != len(ids):
            raise ValueError("Expected the take's own latent [1, 64, frames].")
        parts = parse_layout(layout, len(ids))
        # Counted before anything is built: a layout can name a gap, or repeat a
        # span, far past what could ever be performed (prompt and take share the context).
        total = sum(part[1] - part[0] if isinstance(part, tuple) else part for part in parts)
        if total > CONTEXT:
            raise ValueError(f"This layout makes a take of {total} frames; the studio can hold {CONTEXT} at most.")
        out, pieces, gaps = [], [], []
        for part in parts:
            if isinstance(part, tuple):
                out += ids[part[0]:part[1]]
                pieces.append(latent[..., part[0]:part[1]])
            else:
                gaps.append((len(out), len(out) + part))
                out += [CODEC_OFFSET] * part
                pieces.append(torch.zeros((1, LATENT_CHANNELS, part), device=latent.device, dtype=latent.dtype))
        return ({"ids": out, "gaps": gaps}, _audio_latent(torch.cat(pieces, dim=-1)))


class Stillsong2Score:
    """How well does a take fit a prompt? Replays the take under the given
    style, lyric sheet and melody plan in one forward pass and returns the
    log-probability of each frame's token. Output: JSON {"frames": n, "logp":
    [...]}, also placed in the prompt's history as this node's `text`.

    Two scores of one take, under two sheets or two plans, differ where the
    take sings what only one of them asks for. Scores of two takes under one
    prompt tell a take that follows the prompt from one that does not."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": ("CLIP",),
                "style": ("STRING", {"multiline": True}),
                "lyrics": ("STRING", {"multiline": True}),
                "abc": ("STRING", {"multiline": True, "default": ""}),
                "mode": (["full", "melody"],),
                "tokens": (TOKENS,),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("series",)
    FUNCTION = "score"
    CATEGORY = "conditioning/stillsong2"
    OUTPUT_NODE = True

    def score(self, clip, style, lyrics, abc, mode, tokens):
        _require_whole(tokens, "Scoring")
        ids = list(tokens["ids"])
        if not abc.strip():
            mode = "off"
        encoded = clip.tokenize(style, lyrics=lyrics, cot=mode, seed=0, abc=abc, max_tokens=len(ids))
        encoded["stillsong"] = {"replay": ids}
        logp = clip.encode_from_tokens(encoded, return_dict=True)["stillsong_logp"]
        series = json.dumps({"frames": len(ids), "logp": [round(v, 3) for v in logp.tolist()]}, separators=(",", ":"))
        return {"ui": {"text": [series]}, "result": (series,)}


class Stillsong2ContinuePlan:
    """Writes on from the middle of a melody plan: given the plan up to some
    point, the model that writes plans goes on from there for `max_tokens`
    tokens (or to the plan's end). This is how new bars are written in the
    manner of the bars before them. Upstream's own plan sampling, unchanged:
    the only difference from YuE2GenerateABC is that the text already written
    is put in front of it. Output: the new text alone, also placed in the
    prompt's history as this node's `text`.

    `abc` should stop at a line break: the text is cut into tokens on its own,
    and the new text starts a token of its own."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": ("CLIP",),
                "style": ("STRING", {"multiline": True, "dynamicPrompts": True}),
                "lyrics": ("STRING", {"multiline": True, "dynamicPrompts": True}),
                "abc": ("STRING", {"multiline": True, "default": "", "tooltip": "The plan so far."}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True}),
                "mode": (["full", "melody"],),
                "max_tokens": ("INT", {"default": 160, "min": 1, "max": 2000}),
                # YuE2GenerateABC's own defaults.
                "temperature": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 5.0, "step": 0.05}),
                "top_p": ("FLOAT", {"default": 0.9, "min": 0.01, "max": 1.0, "step": 0.01}),
                "top_k": ("INT", {"default": 30, "min": 1, "max": 32768}),
                "repetition_penalty": ("FLOAT", {"default": 1.005, "min": 0.01, "max": 10.0, "step": 0.005}),
                "penalty_window": ("INT", {"default": 100, "min": 1, "max": 20000}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("abc",)
    FUNCTION = "write"
    CATEGORY = "conditioning/stillsong2"
    OUTPUT_NODE = True

    def write(self, clip, style, lyrics, abc, seed, mode, max_tokens, temperature, top_p, top_k, repetition_penalty, penalty_window):
        tokens = clip.tokenize(style, lyrics=lyrics, cot=mode, seed=seed, abc=abc, max_tokens=max_tokens, penalty_window=penalty_window)
        # The prompt ends where a plan begins; the plan so far follows it, as it would have been written.
        tokens["prefix"] = list(tokens["prefix"]) + list(tokens["abc_ids"])
        ids = clip.generate(tokens, max_length=max_tokens, temperature=temperature, top_p=top_p, top_k=top_k,
                            repetition_penalty=repetition_penalty, seed=seed)
        text = clip.decode(ids)
        return {"ui": {"text": [text]}, "result": (text,)}


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
        _require_whole(tokens, "Alignment")
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
        _require_whole(tokens, "Saving")
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
    "Stillsong2Resing": Stillsong2Resing,
    "Stillsong2ArrangeTake": Stillsong2ArrangeTake,
    "Stillsong2Score": Stillsong2Score,
    "Stillsong2ContinuePlan": Stillsong2ContinuePlan,
    "Stillsong2LoadTake": Stillsong2LoadTake,
    "Stillsong2HoldLatent": Stillsong2HoldLatent,
    "Stillsong2RestoreLatent": Stillsong2RestoreLatent,
    "Stillsong2Align": Stillsong2Align,
    "Stillsong2SaveTake": Stillsong2SaveTake,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Stillsong2Perform": "Stillsong 2 Perform",
    "Stillsong2Resing": "Stillsong 2 Resing",
    "Stillsong2ArrangeTake": "Stillsong 2 Arrange Take",
    "Stillsong2Score": "Stillsong 2 Score",
    "Stillsong2ContinuePlan": "Stillsong 2 Continue Plan",
    "Stillsong2LoadTake": "Stillsong 2 Load Take",
    "Stillsong2HoldLatent": "Stillsong 2 Hold Latent",
    "Stillsong2RestoreLatent": "Stillsong 2 Restore Latent",
    "Stillsong2Align": "Stillsong 2 Align",
    "Stillsong2SaveTake": "Stillsong 2 Save Take",
}
