# Warranty & Closed Order Status — Implementation Plan

**Status:** planning / documentation only (no migrations executed, no feature code in this pass)  
**Target:** Core App orders lifecycle + warranty activation on closure  
**Last updated:** 2026-10-30 (rev: closed ⇒ fully paid via ledger)

---

## 0. Mandatory business rule (new)

> **`closed` means fully paid.**  
> An order may transition to `closed` **only** when the append-only payment/refund ledger shows a remaining balance of **exactly zero** for that order (within the app’s money epsilon).  
> Choosing “Close order” must **open the payment-recording flow**, not flip `orders.status` by itself.  
> Warranty activates **only after** a successful transition to `closed` (full payment + closure persisted).

`paid` (status / `is_paid`) and `closed` are **not** interchangeable:

| Concept | Meaning |
| --- | --- |
| `paid` / `is_paid` | Existing payment-related status/flag (legacy + Paid lock rules) |
| Ledger remaining = 0 | Source of truth for “fully paid” when ledger rows exist |
| **`closed`** | New explicit business status; allowed **only** after ledger remaining is zero, via the close flow |

---

## 1. Current state (inspected) — retained audit findings

### 1.1 Order status model (application)

| Value | Meaning today | Notes |
| --- | --- | --- |
| `new` | New work | Default on create |
| `in-progress` | Active work | |
| `waiting-parts` | Blocked on parts/supplies | Industry label variants |
| `completed` | Work finished | Dashboard “completed today” via `updated_at` — **not** closed |
| `paid` | Status that also sets `is_paid` | Owner-only unlock to leave Paid |
| `cancelled` | Cancelled | Excluded from outstanding balances |

Sources: `src/lib/types.ts`, `src/features/industries/industryWorkflow.ts` (`ORDER_STATUSES`), `src/services/apiOrders.ts`.

**There is no dedicated `closed` status today.**  
`completed` must **not** be treated as equivalent to `closed`.

### 1.2 “Closed” naming already in code (different concept)

`src/features/orders/orderVisibility.ts`:

```ts
CLOSED_STATUSES = completed | paid | cancelled   // “not open work” for deadlines only
OPEN_ORDER_STATUSES = new | in-progress | waiting-parts
```

Rename during implementation (e.g. `NON_OPEN_WORK_STATUSES`) and **include the new `closed` status** so closed orders leave overdue/upcoming. Do not confuse this helper with status key `closed`.

### 1.3 Database / RLS (orders)

- `orders.status` is unconstrained `text` (default `'new'`). **No status CHECK** in baseline.
- **No `orders.closed_at`.**
- RLS: workspace members can SELECT/INSERT/UPDATE/DELETE orders; no status-specific policies.
- Trigger: `orders_prevent_workspace_change` only.

Writing `status = 'closed'` is possible at the text level, but **closure timestamp, warranty snapshots, and safe payment+close atomicity need schema/RPC proposals** (see §4–§5).

### 1.4 Status transitions & permissions (today)

- Free-choice status list in `OrderActionsMenu` / `OrderDetailPanel`, except:
  - **Paid lock** for non-owners;
  - **Tax invoice gate** when entering `paid`.
- Edit gated by **subscription write**; not by status (except Paid).
- No industry transition graph.

### 1.5 Filters, badges, copy

- List filter: all current `ORDER_STATUSES`.
- Deadline filters use `OPEN_ORDER_STATUSES`.
- Badges: six variants in `OrderStatusBadge`.
- i18n: `status.order.*` EN/RO/RU.

### 1.6 Warranty groundwork already present

| Piece | State |
| --- | --- |
| `workspaces.warranty_start` | `'created_at' \| 'closed_at'` |
| Settings UI | Warranty starts from creation vs closure |
| Line warranty / snapshots / activation | **Not implemented** |

### 1.7 Payment ledger (source of truth for close eligibility)

Inspected: `src/features/finance/paymentCalculations.ts`, `PaymentFormDialog`, `PaymentHistorySection`, `useRecordPayment`.

**Valid ledger row** (`isValidLedgerPayment`): kind ∈ {`payment`,`refund`}, finite positive amount, parseable `paidAt`, non-empty currency.

**Net collected:** sum of signed amounts (payment +, refund −), invalid rows skipped; money rounded to cents (`roundMoney`); compare with `MONEY_EPS` (0.005).

**Order balance** (`orderPaymentBalance` → `computePaymentBalance`):

- Total = `orders.total_price` (`Order.totalPrice`).
- Linked rows = payments for `order_id`, and when an invoice exists for the order, invoice-linked rows that affect the order (`paymentsAffectingOrder`).
- `netPaid` = max(0, net collected) when ledger rows exist.
- `remaining` = max(0, total − netPaid) when ledger exists.
- `overpayment` reported separately; remaining clamped at 0 for display.
- **Legacy:** if **no** ledger rows, falls back to `is_paid` / `status === 'paid'` for display only — **close eligibility must not treat legacy flags as sufficient** once the close flow runs; require ledger proof of full payment (see §3.2). Prefer recording an explicit settlement payment or reconciling legacy paid orders into the ledger before close.

**Existing UI to reuse:** `PaymentFormDialog` / `PaymentHistorySection` already show amount due, amount paid (net), remaining, amount/method/date fields, and default the amount to remaining.

**Outstanding filter today:** `orderHasOutstandingBalance` uses ledger remaining (and excludes `cancelled`); also treats legacy paid flags as settled when no ledger — close-order must be stricter (ledger remaining === 0).

---

## 2. Product distinction (updated)

| Status | Role | Payment | Warranty |
| --- | --- | --- | --- |
| `completed` | Work finished | May be unpaid/partial/full | Does **not** activate warranty |
| `paid` | Existing payment-related status/flag | Not proof for `closed` by itself | Does **not** mean closed |
| `cancelled` | Voided | N/A | No warranty |
| **`closed` (new)** | Explicit business closure | **Requires ledger remaining = 0** | Activates on **successful** close only |

---

## 3. Business rules for Close order

### 3.1 Eligibility

- Cancelled orders: **cannot** close.
- Partially paid (ledger remaining > ε): **remain open**; user may pay inside the close dialog or later.
- Fully paid on ledger (remaining ≤ ε): may be **explicitly** closed; **never** auto-closed merely because remaining is 0 or status is `paid`/`completed`.
- Existing standalone payment recording (Finance / order detail) **continues unchanged** and does **not** set `closed`.

### 3.2 Close eligibility condition (authoritative)

```
eligible_to_close ⇔
  order.status ≠ 'cancelled'
  ∧ order.status ≠ 'closed'   // already closed → idempotent path
  ∧ orderPaymentBalance(...).remaining ≤ MONEY_EPS
  ∧ (prefer: balance.hasLedger === true
        OR an explicit reconciliation policy for legacy-paid-with-empty-ledger
           approved separately — default: require at least one valid ledger
           settlement covering the total before close)
```

Do **not** use `is_paid` or `status === 'paid'` alone as the gate when implementing close.

### 3.3 Overpayment

- Close-order payment amount **must not exceed** current remaining (reuse / tighten `PaymentFormDialog` validation).
- If ledger already shows overpayment, remaining is 0 — user may close without a new payment, but the close flow still goes through the dialog summary (no silent status flip from the list).

---

## 4. Close-order UI flow (mandatory)

1. User selects **Close order** (actions menu / detail). **Do not** change status yet.
2. Open existing **`PaymentFormDialog`** (or a dedicated close dialog that **embeds the same form + validation** and balance summary).
3. Display at minimum:
   - total order amount (`balance.total`);
   - total valid recorded payments (gross payments; and/or net collected — UI should show **net paid** as today plus explicit **refunds** total from ledger);
   - total refunds (sum of valid refund rows for the order);
   - remaining amount due (`balance.remaining`);
   - new payment amount (default = remaining, capped at remaining);
   - payment method and date (existing fields).
4. User may record a payment (subscription write required).
5. After success, **recalculate** balance from the ledger (invalidate payment queries).
6. If remaining > ε: keep order **open**; allow closing the dialog and paying again later. **No** status change.
7. If remaining ≤ ε: run **close transition** (status → `closed`, stamp `closed_at` if null, activate warranties). Prefer chaining this in the same user gesture after the settling payment, with clear success/failure messaging.
8. If payment recording fails: order stays open; show error; no `closed_at` / warranty.
9. If payment succeeded but closure fails: show a **clear recovery message** (“Payment recorded; order not closed — retry Close”) without creating a duplicate payment; Close retry must be idempotent on ledger and closure.

**Generic status dropdown:** do **not** allow picking `closed` as a silent status change. Selecting Closed (if shown) must open this same flow. Prefer a dedicated **Close order** action only.

---

## 5. Status transitions (updated)

| From | Enter close flow? | Become `closed`? |
| --- | --- | --- |
| `new`, `in-progress`, `waiting-parts`, `completed` | Yes | Only when ledger remaining = 0 after flow |
| `paid` | Yes (explicit) | Only when ledger remaining = 0; still not auto |
| `cancelled` | No | No |
| `closed` | Close again | Idempotent no-op (no new `closed_at`, no warranty restart) |

**Forbidden:** `updateOrderStatus(id, "closed")` as a raw status write without payment validation.

**API shape (conceptual):**

1. `recordPayment` — existing append-only insert (unchanged for normal payments).
2. `closeOrder(orderId)` — verifies ledger remaining = 0 in DB, sets `status = closed`, sets `closed_at` only if null, activates warranty once.  
   Optionally a single RPC `record_payment_and_close_if_settled` for the settling payment (see §6).

**Reopen:** `reopenOrder(orderId, nextStatus)` — see §8.

---

## 6. Atomicity, races, and failure recovery

### 6.1 Failure modes to prevent

| Failure | Required handling |
| --- | --- |
| Closed without full payment | DB/API reject close unless remaining ≤ ε from ledger |
| Duplicate payment on retry | Idempotency key on payment insert and/or client disable + server unique constraint on client request id |
| Payment OK, UI says nothing recorded | Trust mutation result + query invalidation; toast from existing payment hooks |
| Closure OK, payment failed | Impossible if close only runs after payment success / inside one RPC that inserts payment first |
| Concurrent two closes / two settlements | Row lock on order or RPC `SELECT … FOR UPDATE`; second close idempotent; second payment rejected if remaining already 0 |

### 6.2 Recommended Supabase approach (proposal only)

**Preferred:** SECURITY DEFINER RPC, e.g. `close_order_if_settled(p_order_id uuid, p_workspace_id uuid)` and optionally `settle_and_close_order(...)` that:

1. Asserts caller is workspace member (and subscription/write checked in app; optional claim checks in RPC).
2. Locks the order row.
3. Computes net from `payments` (valid kinds only) for that `order_id` (+ invoice-linked rows per existing app rules, mirrored in SQL).
4. If already `closed`: return success payload (idempotent).
5. If remaining > ε: return structured error `not_settled` (no status write).
6. Else: `UPDATE orders SET status = 'closed', closed_at = COALESCE(closed_at, now())`; insert warranty snapshots with `ON CONFLICT DO NOTHING`.
7. Preserve append-only ledger (no payment UPDATEs/DELETEs).

**Settling payment + close in one shot (optional RPC):** insert payment with amount ≤ remaining, then same settlement check — single transaction so payment cannot succeed while close is skipped silently without a clear client code path.

App layer still uses subscription write guards and RLS-friendly RPCs (`SECURITY DEFINER` with explicit workspace checks).

### 6.3 Client recovery UX

- States: `payment_failed` | `payment_ok_close_failed` | `closed`.
- On `payment_ok_close_failed`: primary CTA **Retry close** (calls `closeOrder` only — no second payment).
- On already closed: toast “already closed”.

---

## 7. Schema & constraints (describe only)

### 7.1 Still required beyond unconstrained status text

| Change | Why |
| --- | --- |
| `orders.closed_at timestamptz null` | First closure timestamp; warranty when `warranty_start = closed_at` |
| Optional `orders.reopened_at` / audit | Reopen history without clearing `closed_at` |
| Optional `orders_status_check` including `'closed'` | Harden values; must include all seven statuses after live data check |
| Warranty duration on catalog/lines | Snapshot source |
| `order_line_warranty_snapshots` (+ uniqueness) | One-time activation |
| Optional `payment_idempotency_keys` / column on payments | Safe retries |
| RPC(s) for settle/close | Atomicity §6 |

**RLS:** snapshots and RPCs remain workspace-isolated; ledger stays append-only.

**Back-compat:** no backfill of `completed`/`paid` → `closed`; `closed_at` null until explicit successful close.

---

## 8. Reopening and refunds after closure

### 8.1 Reopen

- First-class **Reopen** action (privileged roles; suggestion: owner/admin/manager + subscription write).
- Sets status to an open/work status (`new` | `in-progress` | `waiting-parts` | `completed` — product choice; default restore to `completed` or `in-progress`).
- **Never** clears `closed_at` or deletes warranty snapshots; **never** restarts warranty periods.
- May set `reopened_at = now()`.
- UI shows historical Closed at even when current status ≠ `closed`.
- Paid-lock rules remain orthogonal if navigating through `paid`.

### 8.2 Refunds after closure — decision required (no destructive default)

**Facts:** refunds reduce net collected; remaining can become > 0 while `status` is still `closed` if refunds are allowed post-close.

**Options (product must pick one; plan default = A):**

| Option | Behavior |
| --- | --- |
| **A — Recommended default** | Allow refunds on closed orders via existing refund flow (authorized roles). **Do not** auto-reopen or clear `closed_at`/warranties. Surface a warning: “Order is closed; refund does not void warranty or closure date.” Optionally flag `closure_payment_broken = true` for reporting when remaining > 0 after refund. |
| **B** | Block refunds while `status = closed` until an authorized **Reopen** (or explicit “Authorize refund on closed order”). |
| **C** | Refund forces a mandatory reopen workflow before the refund is accepted. |

**Do not** invent automatic status flip to open on refund, and **do not** erase closure/warranty history.

Reopen after refunds: allowed under §8.1; still preserves snapshots and `closed_at`.

---

## 9. Warranty activation (tied to successful close)

1. Runs **only** after order has successfully become `closed` with ledger remaining = 0.
2. **Not** when opening the payment dialog; **not** on partial payment.
3. Start instant:
   - `warranty_start = closed_at` → `orders.closed_at` (set at successful close);
   - `warranty_start = created_at` → `orders.created_at`.
4. Capture **initial mileage / line snapshots** at that same successful closure event (immutable).
5. Repeat close: no new snapshots, no period restart (`ON CONFLICT DO NOTHING`).
6. Reopen/refund: snapshots and original `closed_at` remain.

---

## 10. Application surface area (when implementing)

### 10.1 Types & visibility

- Add `"closed"` to `OrderStatus` / `ORDER_STATUSES` / hydrate allow-list.
- Rename deadline helper set; include `closed`.

### 10.2 UI

- Close order → payment/close dialog (§4).
- Badge variant for `closed` (distinct from `completed` success).
- Filters, detail **Closed at**, reopen action.
- Show refunds total in close dialog summary.
- EN/RO/RU: status label, close/reopen/payment-recovery copy.

### 10.3 Payments

- Reuse `orderPaymentBalance` / `PaymentFormDialog` validation; cap amount at remaining.
- Keep Finance / detail **Record payment** paths; they must not set `closed`.

### 10.4 Editability recommendation (unchanged intent)

While `status === 'closed'`: core fields/lines read-only; view + privileged reopen (+ refund policy per §8.2); subscription read-only still applies.

---

## 11. Existing orders & payment behavior

- Partially paid → stay open.
- Fully paid on ledger → may be closed **explicitly** only.
- No silent close when remaining hits 0 from a normal payment.
- No conversion of existing `paid` / `completed` rows to `closed`.
- Legacy paid with **empty** ledger: default require reconciliation/settlement payment before close (§3.2); do not close on flag alone.

---

## 12. Implementation order

1. **Docs/SQL proposal:** `closed_at`, snapshots, optional idempotency, RPC `close_order_if_settled` / `settle_and_close_order` (manual SQL only when approved).
2. Types, visibility rename, i18n, badge/filter.
3. Close UI → payment dialog; wire remaining recalculation; block overpay.
4. `closeOrder` after settle; recovery path for payment-ok/close-fail.
5. Warranty activation at successful close.
6. Reopen + refund policy (A/B/C) implementation.
7. Tests: ledger gates, idempotent close, no auto-close on pay, race/retry, EN/RO/RU.

---

## 13. Acceptance criteria

- [ ] Cannot set `closed` without going through close → payment validation flow.
- [ ] Order stays open while ledger remaining > ε.
- [ ] Transitions to `closed` only when remaining ≤ ε; then `closed_at` set once.
- [ ] New close-flow payment cannot exceed remaining.
- [ ] Payment failure ⇒ not closed.
- [ ] Payment success + close failure ⇒ clear recovery, no duplicate payment on retry close.
- [ ] Concurrent settle/close cannot yield closed-without-pay or double pay.
- [ ] Warranty/mileage snapshots only on successful close; not on dialog open or partial pay.
- [ ] Second close does not reset `closed_at` or warranties.
- [ ] Reopen preserves `closed_at` and snapshots; no warranty restart.
- [ ] Refund-after-close follows chosen policy without erasing closure/warranty history.
- [ ] Normal Record payment never auto-closes.
- [ ] No backfill of historical `paid`/`completed` → `closed`.
- [ ] Workspace RLS + subscription write restrictions preserved; ledger append-only.

---

## 14. Explicit non-goals of documentation passes

- No migrations created or applied; no remote SQL.
- No Close/Reopen/payment UI implemented in doc-only tasks.
- No edit-lock or warranty tables created here.
