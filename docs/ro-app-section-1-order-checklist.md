# §1 typical order scenario — local checklist

Source: `docs/ro-app-migration.md` §1 “Типичный заказ”.  
Status legend: **Done (local)** · **Partial** · **Blocked / owner** · **Not built**.

| # | Scenario step | Local status | Notes |
|---|---|---|---|
| 1 | Client arrives with a vehicle; create order with service type and deadline | **Partial** | Create order + vehicle fields + deadline work. Configurable order types / per-type forms (В.2–В.3) not full RO parity. |
| 2 | Add services, labor, parts; parts deducted from warehouse | **Partial → stronger** | Line kinds when column present. Materials requested on the order; stock changes on **Issue/Return**. Issue + return from **selected warehouse** (SQL 2.1h / 2.1j). Needs those SQL files on the DB. |
| 3 | Serial numbers + warranty terms on the order total | **Partial** | Warranty plan exists in docs; full serial/warranty-on-line UX not complete RO parity. |
| 4 | Status “Ready” auto-sends SMS with amount due | **Blocked / owner** | Dry-run message log only. Real SMS providers forbidden until owner enables. Templates seedable (2.5). |
| 5 | Organization pays later; unpaid status (“!!! НЕ ОПЛАЧЕНЫ !!!”) | **Partial** | Custom statuses + transitions + board. Seed statuses cover unpaid-style states after 2.3; live labels depend on seed/apply. Settlement / advance (`clients.balance`) preserved. |
| 6 | After payment, close order; print “Акт выполненных работ” | **Partial** | Payments + close flows exist in Core. Print templates editor/preview/sanitize; seeded “act” content depends on templates in DB. |

## Supporting order capabilities (beyond §1 narrative)

| Capability | Local status |
|---|---|
| Board DnD + transition enforcement | Done (local); needs status seed |
| Calendar (month/week) | Done (local) |
| Comments + events feed | Done (local); events write needs 2.1d |
| Client discounts → persisted line + header totals | Done (local); materials need 2.1g |
| Public read-only status page | Done (local route + RPC SQL 2.1i); copy-link mint via 2.1k |
| Import from RO spreadsheet | Preview dry-run only (Settings → migration); apply blocked |

## Acceptance for “§1 complete”

Requires owner TEST cutover (phases 1–2), regression from migration §8, real or dry-run notification policy decision, and print template content review. **Not claimed complete remotely.**
