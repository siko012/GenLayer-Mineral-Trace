# Lodestar — Mineral provenance tracker

Lodestar traces conflict minerals along a supply chain and certifies finished goods. Each participant — miner, processor, smelter, manufacturer — registers a batch on-chain with a provenance claim. The protocol validates the trail and issues a badge.

## Data model

```
miner.processor.smelter.manufacturer
  ├── .mine(product, weight, country, claimant)
  ├── .process(batch_id, volume, output)
  ├── .smelt(batch_id, volume, output)
  └── .mint(batch_id, volumes) ──► full_traceability()
```

A `Good` struct carries:
```python
class Good(Struct):
    name: str
    _id: str
    bad_actors: list[str]
    traceability_gaps: int
    verdict: str   # CONFLICT_FREE | UNCLEAR | CONFLICT
    badge_id: str
```

## Verdict logic

| Traceability gaps | Bad actors | Verdict |
|---|---|---|
| 0 | none | CONFLICT_FREE — badge minted |
| 1–2 | — | UNCLEAR |
| ≥ 3 | — | CONFLICT |

The validator prompt reads the full provenance trail and assigns a `traceability_score` (0+). The score maps directly to the verdict. Gaps increase the score; known conflict regions increase it further.

## Contract

- **Network:** GenLayer Studionet (61999)
- **Address:** `0x4e50923b1D23db2FbE033982a3bcaec72a98587D`
- **Language:** Python (py-genlayer)

## Frontend

```sh
cd frontend
npm install
npm run dev
```

React 18 + wagmi + RainbowKit + genlayer-js. Uses d3 for supply-chain network visualisation and phosphor icons for role badges.

## License

MIT
