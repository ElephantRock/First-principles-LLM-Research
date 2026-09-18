import math
import torch
from torch import nn


def _rope(x: torch.Tensor, positions: torch.Tensor, theta: float) -> torch.Tensor:
    d = x.shape[-1]
    idx = torch.arange(0, d // 2, dtype=torch.float32, device=x.device)
    inv_freq = theta ** (-2.0 * idx / d)
    angles = positions.to(torch.float32).unsqueeze(-1) * inv_freq.unsqueeze(0)
    cos = torch.cos(angles).view(1, 1, positions.numel(), d // 2)
    sin = torch.sin(angles).view(1, 1, positions.numel(), d // 2)
    pairs = x.reshape(*x.shape[:-1], d // 2, 2)
    even, odd = pairs[..., 0], pairs[..., 1]
    return torch.stack((even * cos - odd * sin, even * sin + odd * cos), dim=-1).reshape_as(x)


class CausalSelfAttention(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.n_heads = config.n_heads
        self.n_kv_heads = config.n_kv_heads
        self.head_dim = config.head_dim
        self.d_model = config.d_model
        self.rope_theta = config.rope_theta
        self.q_proj = nn.Linear(config.d_model, config.n_heads * config.head_dim, bias=config.bias)
        self.k_proj = nn.Linear(config.d_model, config.n_kv_heads * config.head_dim, bias=config.bias)
        self.v_proj = nn.Linear(config.d_model, config.n_kv_heads * config.head_dim, bias=config.bias)
        self.o_proj = nn.Linear(config.n_heads * config.head_dim, config.d_model, bias=config.bias)

    def forward(self, x: torch.Tensor, positions: torch.Tensor | None = None) -> torch.Tensor:
        b, s, _ = x.shape
        hq, hkv, dh = self.n_heads, self.n_kv_heads, self.head_dim
        groups = hq // hkv
        if positions is None:
            positions = torch.arange(s, device=x.device)
        q = self.q_proj(x).view(b, s, hq, dh).transpose(1, 2)
        k = self.k_proj(x).view(b, s, hkv, dh).transpose(1, 2)
        v = self.v_proj(x).view(b, s, hkv, dh).transpose(1, 2)
        q = q.reshape(b, hkv, groups, s, dh)
        k = k.unsqueeze(2)
        v = v.unsqueeze(2)
        scores = torch.matmul(q, k.transpose(-2, -1)) / math.sqrt(dh)
        mask = torch.triu(torch.ones(s, s, dtype=torch.bool, device=x.device), diagonal=1)
        scores = scores.masked_fill(mask, float("-inf"))
        probabilities = torch.softmax(scores.float(), dim=-1).to(q.dtype)
        output = torch.matmul(probabilities, v)
        output = output.reshape(b, hq, s, dh).transpose(1, 2).reshape(b, s, hq * dh)
        return self.o_proj(output)
