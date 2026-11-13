# Stillsong 2's additions to YuE2's music-token stage: a take can be performed
# again with only some frame windows re-sung, and replayed under another lyric
# sheet to see where its words are sung.
#
# `stillsong_generate` is adapted from YuE2TEModel._generate in
# comfy/text_encoders/yue2.py of ComfyUI 0.42.4 (GPL-3.0); this file is GPL-3.0.
# Modified from the original on 2026-11-13: the modifications are the blocks
# marked `Stillsong:`. `stillsong_encode` mirrors YuE2TEModel.encode_token_weights
# of the same file. Ordinary renders never reach `stillsong_generate`: they run
# upstream's own `_generate` and only have their tokens handed out.

import logging

import torch

import comfy.model_management
import comfy.model_prefetch
import comfy.utils
from comfy.text_encoders.llama import FixedKV, rope_matrix
from comfy.text_encoders.yue2 import (
    ABC_END,
    ABC_START,
    EOD,
    FRAMES_PER_SECOND,
    MUSIC_END,
    MUSIC_START,
    distribution,
)

# sha256 of the comfy/text_encoders/yue2.py this file was derived from (ComfyUI
# 0.42.4). __init__.py refuses to load the package against any other.
PINNED_YUE2_SHA256 = "c4b14f6279d8393e385894ec367640b6592fd12a468e440bf87189da4565f13f"

# Positions scored per lm_head call during a replay (the vocabulary is ~185k wide).
REPLAY_CHUNK = 256


def stillsong_generate(te, prefix, seed, max_tokens, phase, dtype, forced, negative=None, cfg_scale=1.0, legacy_off=False, **sampling):
    """YuE2TEModel._generate with some steps teacher-forced.

    forced: 1-D long tensor, one entry per step: a token id to force, or -1 to
    sample freely. A forced step still draws (advancing the RNG stream exactly as
    an unforced run would) and discards the draw.
    """
    if max(len(prefix), len(negative or [])) + max_tokens > te.config.max_position_embeddings:
        raise ValueError("YuE2 prompt plus generation budget exceeds the model context; reduce the token budget or prompt length.")
    device = te.execution_device
    rng_device = device if torch.device(device).type != "mps" else "cpu"
    generator = torch.Generator(device=rng_device).manual_seed(seed)
    prefixes = [prefix] if cfg_scale == 1.0 else [prefix, negative]
    prefix_length = max(map(len, prefixes))
    logits, cache, mask = te._prefill(prefixes, prefix_length + max_tokens, dtype)
    fixed_kv = isinstance(cache[0], FixedKV)
    positions = torch.tensor([[len(p)] for p in prefixes], device=device, dtype=torch.long)
    # Decoder inputs and rotary tensors must keep their addresses across graph replays.
    decode_buffers = (torch.empty((len(prefixes), 1, te.config.hidden_size), device=device, dtype=dtype),
                      rope_matrix(te.model.compute_freqs_cis(positions, device)))
    history = []
    end = ABC_END if phase == "abc" else MUSIC_END
    progress = comfy.utils.ProgressBar(max_tokens)
    # Sampling stays on the device (EOD is masked in both phases, so it pads the penalty window)
    # and the host reads tokens back in batches instead of syncing on every step.
    penalty_window = sampling.pop("penalty_window")
    recent = torch.full((1, penalty_window), EOD, device=device, dtype=torch.long)
    tokens = torch.empty((max_tokens,), device=device, dtype=torch.long)
    step_index = torch.zeros((), device=device, dtype=torch.long)

    # Stillsong: the head below is captured as a CUDA graph, so nothing in it may
    # branch on the step in Python. Per-step choices live in device tensors read
    # by step_index: the token to force, and a block on the end token for free
    # steps that have forced steps after them (a re-sung window must not end the song).
    force_at = torch.full((max_tokens,), -1, device=device, dtype=torch.long)
    count = min(int(forced.shape[0]), max_tokens)
    force_at[:count] = forced[:count].to(device=device, dtype=torch.long)
    end_block = torch.zeros((max_tokens,), device=device, dtype=torch.float32)
    held = (force_at >= 0).nonzero()
    if held.numel() > 0:
        last = int(held[-1])
        end_block[:last] = torch.where(force_at[:last] < 0, float("-inf"), 0.0)

    def head():
        guided = logits if cfg_scale == 1.0 else logits[1:] + cfg_scale * (logits[:1] - logits[1:])
        scores = distribution(guided, recent, step, phase, legacy_off=legacy_off, **sampling)
        # Stillsong: no end token inside a re-sung window.
        scores[..., end] = scores[..., end] + end_block.index_select(0, step_index.view(1)).to(scores.dtype)
        if sampling["temperature"] == 0:
            next_id = scores.argmax(-1, keepdim=True)
        else:
            probabilities = scores.softmax(-1).to(rng_device)
            next_id = torch.multinomial(probabilities, 1, generator=generator).to(device)
        # Stillsong: a forced step keeps the take's token; the draw above is discarded.
        want = force_at.index_select(0, step_index.view(1)).view_as(next_id)
        next_id = torch.where(want >= 0, want, next_id)
        tokens.index_copy_(0, step_index.view(1), next_id.view(1))
        recent.scatter_(1, (step_index % penalty_window).view(1, 1), next_id)
        step_index.add_(1)
        decode_buffers[0].copy_(te.model.embed_tokens(next_id.expand(len(prefixes), 1), out_dtype=dtype))

    try:
        for step in comfy.utils.model_trange(max_tokens, desc="YuE2 ABC sampling" if phase == "abc" else "YuE2 music sampling", unit="token"):
            comfy.model_management.throw_exception_if_processing_interrupted()
            # Keep decode allocations stable.
            if fixed_kv:
                comfy.model_prefetch.malloc_graph_begin(device)
            # `step` is baked into the head graph, so capture only once the end token is no longer blocked.
            head_queue = comfy.model_prefetch.make_prefetch_queue([te.model.embed_tokens], device, {"prefetch_dynamic_vbars": te.model.prefetch_dynamic_vbars})
            comfy.model_prefetch.prefetch_queue_pop(head_queue, device, te.model.embed_tokens, dtype, core=head,
                                                    enable_graph=step >= sampling["min_tokens"], generator=generator, malloc_scope="head")
            comfy.model_prefetch.prefetch_queue_pop(head_queue, device, None, malloc_scope="head")
            progress.update_absolute(step + 1)
            output = te.model(None, embeds=decode_buffers[0], past_key_values=cache, dtype=dtype, position_ids=positions,
                              attention_mask=mask[:, :prefix_length + step + 1] if mask is not None and not fixed_kv else None,
                              decode_buffers=decode_buffers)
            logits.copy_(te.model.lm_head(output[0][:, -1]))
            cache = output[2]
            del output
            if fixed_kv:
                comfy.model_prefetch.malloc_graph_end()
            positions.add_(1)
            if (step + 1) % 16 == 0 or step + 1 == max_tokens:
                for token in tokens[len(history):step + 1].tolist():
                    if token == end:
                        return history, False
                    history.append(token)
    finally:
        # Each phase has different KV buffers and may change the CFG batch size.
        comfy.model_prefetch.cleanup_prefetch_queues()
    logging.warning("YuE2 %s reached its token budget before the end token.", phase)
    return history, True


def stillsong_replay(te, prefix, take_ids, dtype):
    """Log-probability the model gives each token of a take, in one forward pass.

    The take is read, not sampled: prompt + take go through the backbone once
    (as upstream's acoustic conditioning does) and each position is scored for
    the token that actually follows it. Returns a float32 CPU tensor, one value
    per take token.
    """
    if len(prefix) + len(take_ids) > te.config.max_position_embeddings:
        raise ValueError("The take does not fit the model context with this prompt.")
    device = te.execution_device
    ids = torch.tensor([prefix + list(take_ids)], device=device, dtype=torch.long)
    cache = te.model.init_kv_cache(1, ids.shape[1], device, dtype)
    hidden = te.model(ids, past_key_values=cache, dtype=dtype)[0]
    del cache
    target = torch.tensor(list(take_ids), device=device, dtype=torch.long)
    first = len(prefix) - 1  # the position that predicts the take's first token
    parts = []
    for start in range(0, len(take_ids), REPLAY_CHUNK):
        comfy.model_management.throw_exception_if_processing_interrupted()
        stop = min(start + REPLAY_CHUNK, len(take_ids))
        scores = te.model.lm_head(hidden[:, first + start:first + stop]).float()
        parts.append(torch.log_softmax(scores, dim=-1)[0].gather(-1, target[start:stop, None])[:, 0].cpu())
    return torch.cat(parts)


def stillsong_encode(te, tokens):
    """YuE2TEModel.encode_token_weights, with the generated music tokens handed
    out, optional forcing, and a replay-only mode. `tokens["stillsong"]`:
      {}                      perform as upstream does, and hand the tokens out
      {"forced": LongTensor}  perform with those steps forced (see stillsong_generate)
      {"replay": [ids]}       score a take under this prompt; no music is written
    """
    opts = tokens["stillsong"]
    device = te.execution_device
    dtype = torch.bfloat16 if comfy.model_management.should_use_bf16(device) else torch.float32
    prefix = tokens["prefix"]
    abc_ids = tokens["abc_ids"]
    cot = tokens["cot"]
    if cot == "off":
        abc_ids = []
    prefix = prefix + abc_ids + [ABC_END, MUSIC_START]
    negative = tokens["negative"] + ([MUSIC_START] if cot == "off" else [ABC_START] + abc_ids + [ABC_END, MUSIC_START])

    replay = opts.get("replay")
    if replay is not None:
        return torch.zeros((1, 1, 1)), None, {"stillsong_logp": stillsong_replay(te, prefix, replay, dtype)}

    context = te.config.max_position_embeddings
    max_tokens = min(tokens["max_tokens"], context - max(len(prefix), len(negative)))
    # One acoustic frame needs two positions plus three boundary tokens.
    if max_tokens < 1 or len(prefix) + 5 > context:
        raise ValueError("YuE2 prompt leaves no room for music; shorten the style, lyrics, or ABC.")
    if max_tokens < tokens["max_tokens"]:
        logging.info("YuE2 music budget reduced to %d tokens (%.2f seconds) to fit the prompt.", max_tokens, max_tokens / FRAMES_PER_SECOND)
    sampling = dict(
        negative=negative, cfg_scale=tokens["cfg_scale"], legacy_off=cot == "off",
        temperature=tokens["temperature"], top_p=tokens["top_p"], top_k=tokens["top_k"],
        repetition_penalty=tokens["repetition_penalty"], penalty_window=50,
        min_tokens=min(200, max_tokens),
    )
    forced = opts.get("forced")
    if forced is None:
        semantic, semantic_truncated = te._generate(prefix, tokens["seed"], max_tokens, "semantic", dtype, **sampling)
    else:
        # The last entry forces the end token; the take itself must fit the budget.
        if int(forced.shape[0]) - 1 > max_tokens:
            raise ValueError("The take is longer than the music budget this prompt leaves.")
        semantic, semantic_truncated = stillsong_generate(te, prefix, tokens["seed"], max_tokens, "semantic", dtype, forced, **sampling)
    conditioning, chunks = te._acoustic_conditioning(prefix, semantic, dtype)
    return conditioning, None, {
        "yue2_chunks": chunks, "yue2_abc_ids": abc_ids, "yue2_frames": len(semantic),
        "yue2_truncated": semantic_truncated, "stillsong_semantic": semantic,
    }
