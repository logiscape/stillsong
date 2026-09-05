# Stillsong's adaptation of the MiniMax Music 3 AR generation loop
# (comfy/ldm/minimax_music/ar.py, ComfyUI 0.34.1 — see PINNED_AR_SHA256).
# Derived from ComfyUI, GPL-3.0. Three additions, each marked "Stillsong:":
#
#   1. CAPTURE — every generated frame's feedback code row (c0 + 7 depth
#      codes) is recorded and returned alongside the hidden conditioning.
#      The code matrix IS the composition; saving it makes a song replayable
#      and editable.
#   2. FORCED PREFIX — an optional [N, 8] code matrix teacher-forces the
#      first N frames: sampling still runs (so the RNG stream advances
#      exactly as an unforced run's would — free generation after the prefix
#      resumes from the original run's generator state), but the sampled
#      codes are discarded in favor of the given ones. Forced frames never
#      stop. This makes "finish the song" and "re-compose from my edit"
#      exact by construction, independent of floating-point drift.
#   3. FIXED KV CAPACITY — the KV cache can be allocated at a fixed frame
#      capacity instead of the duration cap, so changing the cap does not
#      change kernel scheduling (and therefore numerics) for the frames both
#      runs share.
#
# Everything not marked "Stillsong:" is a faithful copy of the pinned
# upstream loop — resist the urge to tidy it; byte-for-byte behavior of the
# unforced path is the contract.

import torch

import comfy.model_management
import comfy.model_prefetch
import comfy.utils
from comfy.ldm.minimax_music.ar import (
    AUDIO_CODE_OFFSET,
    CFG_SCALE,
    CFG_TOP_K,
    C0_VOCAB_SIZE,
    MAX_AUDIO_FRAMES,
    MAX_PROMPT_TOKENS,
    derive_seed,
    sample_topk,
)
from comfy.ldm.minimax_music.prompt import SPECIAL_TOKEN_IDS

# sha256 of comfy/ldm/minimax_music/ar.py this file was adapted from.
# __init__.py refuses to load the overlay against a different ar.py.
PINNED_AR_SHA256 = "25927897f219685bc3a80341c97285065070842c5a161f2caa6ef123be9b6671"


def _depth_codes_forced(ar_self, hidden, c0, c0_embed, generator, execution_dtype, cfg_scale, top_k, force_row):
    """_depth_codes with teacher forcing: identical decoder forwards and RNG
    consumption, but each sampled depth code is replaced by force_row's."""
    decoder = ar_self.model.audio_decoder
    sequence = [decoder.projection(hidden).unsqueeze(1)]
    sequence.append(decoder.projection(c0_embed).unsqueeze(1))
    codes = [c0]
    hidden_parts = []
    for index in range(1, ar_self.num_codebooks):
        out = decoder(torch.cat(sequence, dim=1))[:, -1]
        hidden_parts.append(out[:1].detach())
        logits = decoder.audio_heads[index - 1](out)
        conditioned = logits[:1].float()
        unconditioned = logits[1:2].float()
        # Stillsong: sample and discard — RNG stream alignment only.
        sample_topk(unconditioned + (conditioned - unconditioned) * cfg_scale, top_k, generator)
        code = force_row[index].reshape(1).repeat(2)
        codes.append(code)
        if index < ar_self.num_codebooks - 1:
            embedding = ar_self.model.audio_extra_embedding(
                code + (index - 1) * ar_self.audio_vocab_size,
                out_dtype=execution_dtype,
            )
            sequence.append(decoder.projection(embedding).unsqueeze(1))
    return torch.stack(codes, dim=1), torch.cat(hidden_parts, dim=-1)


def stillsong_generate(
    ar_self,
    input_ids,
    seed,
    max_audio_frames,
    device,
    cfg_scale=CFG_SCALE,
    top_k=CFG_TOP_K,
    prefix_codes=None,
    kv_capacity_frames=0,
):
    """Upstream MiniMaxMusic3AR.generate plus capture / forcing / fixed
    capacity. Returns (hidden_frames [frames, dim] on CPU, codes [rows, 8]
    on CPU). codes has one row per feedback frame, including the frame-0 row
    whose hidden conditioning upstream deliberately drops — forcing must
    replay it too or a changed prompt would diverge at the very first frame."""
    prompt_tokens = int(input_ids.shape[1])
    if prompt_tokens > MAX_PROMPT_TOKENS:
        raise ValueError(f"MiniMax Music3 prompt has {prompt_tokens} tokens; maximum is {MAX_PROMPT_TOKENS}")

    input_ids = input_ids.to(device)
    if comfy.model_management.should_use_bf16(device):
        execution_dtype = torch.bfloat16
    else:
        execution_dtype = torch.float32
    unconditioned = input_ids.clone()
    unconditioned[:, 1:-2] = SPECIAL_TOKEN_IDS["<|audio_cfg|>"]
    text_ids = torch.cat((input_ids, unconditioned), dim=0)
    if ar_self.model.pruned_embedding:
        text_embeds = ar_self.model.embed_tokens_prefill(text_ids, out_dtype=execution_dtype)
    else:
        text_embeds = ar_self.model.embed_tokens(text_ids, out_dtype=execution_dtype)
    decode_limit = min(int(max_audio_frames), MAX_AUDIO_FRAMES)
    # Stillsong: decouple KV capacity from the duration cap when requested,
    # so a re-run with a higher cap shares kernel shapes with the original.
    capacity = decode_limit
    if kv_capacity_frames and int(kv_capacity_frames) > 0:
        capacity = min(max(int(kv_capacity_frames), decode_limit), MAX_AUDIO_FRAMES)
    past = ar_self.model.init_kv_cache(2, prompt_tokens + capacity + 1, device, execution_dtype)
    output = ar_self.model(None, embeds=text_embeds, past_key_values=past, dtype=execution_dtype)
    last_hidden = output[0][:, -1]
    past = output[2]

    generator = torch.Generator(device=device).manual_seed(derive_seed(seed, "ar"))
    decoder = ar_self.model.audio_decoder
    depth_io = {
        "hidden": torch.empty_like(last_hidden),
        "c0": torch.empty((last_hidden.shape[0],), dtype=torch.long, device=device),
        "c0_embed": torch.empty_like(last_hidden),
        "codes": torch.empty((last_hidden.shape[0], ar_self.num_codebooks), dtype=torch.long, device=device),
        "depth_hidden": torch.empty((1, last_hidden.shape[-1] * (ar_self.num_codebooks - 1)), dtype=execution_dtype, device=device),
    }
    decoder._comfy_cross_step_state = depth_io
    comfy.model_management._register_cross_step(decoder)

    # Stillsong: forcing + capture state.
    forced = None
    n_forced = 0
    if prefix_codes is not None and prefix_codes.numel():
        if prefix_codes.dim() != 2 or prefix_codes.shape[1] != ar_self.num_codebooks:
            raise ValueError(f"prefix codes must be [frames, {ar_self.num_codebooks}], got {tuple(prefix_codes.shape)}")
        forced = prefix_codes.to(device=device, dtype=torch.long)
        n_forced = min(int(forced.shape[0]), decode_limit + 1)
    captured = torch.empty((decode_limit + 1, ar_self.num_codebooks), dtype=torch.long, device=device)
    captured_rows = 0

    hidden_frames = []
    pending_code = None
    stop_token = None
    pending_event = None
    pending_hidden = None
    progress = comfy.utils.ProgressBar(decode_limit)
    cuda_device = torch.device(device).type == "cuda"
    vocab_mask = None
    if not ar_self.model.pruned_lm_head:
        vocab_mask = torch.ones(ar_self.model.vocab_size, dtype=torch.bool, device=device)
        vocab_mask[AUDIO_CODE_OFFSET:AUDIO_CODE_OFFSET + C0_VOCAB_SIZE] = False
        vocab_mask[SPECIAL_TOKEN_IDS["<|audio_end|>"]] = False

    for frame_index in comfy.utils.model_trange(decode_limit + 1, desc="AR sampling"):
        comfy.model_management.throw_exception_if_processing_interrupted()
        if pending_code is not None:
            if pending_event is not None:
                pending_event.synchronize()
            if int(pending_code.item()) == stop_token:
                pending_hidden = None
                # Stillsong: the previous iteration fed back the stop frame's
                # placeholder codes (upstream computes them too, then drops the
                # frame) — do not keep that row in the captured composition.
                captured_rows = max(captured_rows - 1, 0)
                break
            if pending_hidden is not None:
                hidden_frames.append(pending_hidden)
                progress.update_absolute(len(hidden_frames))
                if len(hidden_frames) >= decode_limit:
                    break

        force_row = forced[frame_index] if frame_index < n_forced else None
        c0, code_or_stop, stop_token = ar_self._sample_c0(last_hidden, cfg_scale, top_k, generator, vocab_mask)
        if force_row is not None:
            # Stillsong: the sample above ran only to advance the RNG stream;
            # the forced frame supplies the codes and can never be a stop.
            c0 = force_row[0].reshape(1)
            code_or_stop = torch.full_like(code_or_stop, -1)
        if pending_code is None:
            pending_code = torch.empty_like(code_or_stop, device="cpu", pin_memory=cuda_device)
            if cuda_device:
                pending_event = torch.cuda.Event()
        pending_code.copy_(code_or_stop, non_blocking=cuda_device)
        if pending_event is not None:
            pending_event.record()

        c0 = c0.repeat(2)
        c0_embed = ar_self._embed_c0(c0, execution_dtype)
        depth_io["hidden"].copy_(last_hidden)
        depth_io["c0"].copy_(c0)
        depth_io["c0_embed"].copy_(c0_embed)

        if force_row is None:
            def depth_core():
                codes, depth_hidden = ar_self._depth_codes(
                    depth_io["hidden"], depth_io["c0"], depth_io["c0_embed"], generator, execution_dtype, cfg_scale, top_k
                )
                depth_io["codes"].copy_(codes)
                depth_io["depth_hidden"].copy_(depth_hidden)
            enable_graph = True
        else:
            def depth_core():
                codes, depth_hidden = _depth_codes_forced(
                    ar_self, depth_io["hidden"], depth_io["c0"], depth_io["c0_embed"], generator, execution_dtype,
                    cfg_scale, top_k, force_row,
                )
                depth_io["codes"].copy_(codes)
                depth_io["depth_hidden"].copy_(depth_hidden)
            # Stillsong: the forced core has data-dependent inputs per frame,
            # which CUDA graph capture cannot express — run it eagerly.
            enable_graph = False

        depth_queue = comfy.model_prefetch.make_prefetch_queue(
            [[decoder, ar_self.model.audio_extra_embedding]], device, {"prefetch_dynamic_vbars": True}
        )
        comfy.model_prefetch.prefetch_queue_pop(
            depth_queue, device, decoder, execution_dtype, core=depth_core, enable_graph=enable_graph, generator=generator
        )
        comfy.model_prefetch.prefetch_queue_pop(depth_queue, device, None)
        feedback_codes = depth_io["codes"]
        # Stillsong: record the frame exactly as it is fed back.
        captured[frame_index].copy_(feedback_codes[0])
        captured_rows = frame_index + 1
        depth_hidden = depth_io["depth_hidden"]
        frame_hidden = torch.cat((last_hidden[:1].detach(), depth_hidden), dim=-1)
        if frame_index > 0:
            pending_hidden = frame_hidden[0].clone()

        feedback = ar_self._embed_audio_frame(feedback_codes, execution_dtype)
        output = ar_self.model(None, embeds=feedback, past_key_values=past, dtype=execution_dtype)
        last_hidden = output[0][:, -1]
        past = output[2]

    if pending_hidden is not None and len(hidden_frames) < decode_limit:
        if pending_event is not None:
            pending_event.synchronize()
        if int(pending_code.item()) != stop_token:
            hidden_frames.append(pending_hidden)

    if not hidden_frames:
        raise ValueError("MiniMax Music3 generated zero audio frames")
    return torch.stack(hidden_frames).to(device="cpu"), captured[:captured_rows].to(device="cpu")
