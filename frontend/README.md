# Lodestar

Conflict-free mineral provenance.

The contract logic runs fully on-chain. A decentralised panel of GenLayer validators reads the
submitted evidence, reaches consensus on the outcome, and stores the result on-chain so it cannot be
quietly changed after the fact.

## Contract

- Network: GenLayer Studionet
- Address: `0x11e0D6504B89b48D81b1795B5b9026320A073A2D`

## Develop

```bash
npm install
npm run dev      # http://localhost:5380
```

## Build

```bash
npm run build    # static output in dist/
```

## Deploy

This is a static Vite single-page app. Push this folder to a GitHub repository and import it on
Vercel (no configuration needed), or run `npx vercel` from here. The included `vercel.json`
handles single-page-app routing.