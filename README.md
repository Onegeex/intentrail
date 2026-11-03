# IntentRail

**The seatbelt for AI agents that touch money.**

Primary audience: **agent builders**. The trader UI on the hosted site is the proof.

**Live site:** https://intentrail-neon.vercel.app — no local install required for judges or users.

## Judge steps (hosted)

1. Open https://intentrail-neon.vercel.app  
2. **Connect NEAR wallet**  
3. Toggle **Live mode** → select **mainnet** → tick risk acknowledgement  
4. Propose **USDC → NEAR**, amount **$1** → Approve  
5. **Prepare executable quote** → review deposit → **Sign deposit** in wallet  
6. Watch status until `SUCCESS` / `REFUNDED` / `FAILED`  
7. Also try **Show blocked bad trade** and `/demo` (no wallet)

## Tracks

| Track | Fit |
| --- | --- |
| `security` | Fail-closed guardrails, kill switch, operator `MAINNET_DISABLED` |
| `defi` | NEAR Intents / 1Click dry + hosted ≤$1 executable path |
| `agents` | Guardrailed agent spending (simulated) |
| `swarms` | Multi-agent consensus feeding the guardrail |

## Seatbelt API

`POST /api/guard/check` — same fail-closed engine other agents can call.

## Caps (mainnet Live)

- **$1** per swap (server + client)  
- **$3** per wallet per day  
- Allowlist, slippage, consensus, kill switch  
- Rate limits per IP and per wallet  
- Operator: `MAINNET_DISABLED=true` shuts mainnet Live off globally (default **off** / allowed)

## Real vs simulated

| Real on hosted site | Simulated |
| --- | --- |
| Guard API, consensus, CoinGecko, dry quotes | Agent spend micro-budget |
| Live ≤$1 prepare + wallet-signed deposit + status | — |

Server **never** holds keys or funds.

## License

MIT
