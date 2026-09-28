import { Router } from "express";
import { db } from "@workspace/db";
import {
  portalSettingsTable,
  paymentsTable,
  membershipPaymentsTable,
} from "@workspace/db/schema";
import { eq, like, or } from "drizzle-orm";
import Stripe from "stripe";
import { templeDate } from "../lib/membership";
import { extendMembershipThrough, registrationBalance } from "../lib/registration-balance";

const router = Router();

async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select().from(portalSettingsTable).where(eq(portalSettingsTable.key, key));
  return rows[0]?.value ?? null;
}

// GET /api/payments/config — returns publishable key for the frontend (safe to expose)
router.get("/config", async (_req, res) => {
  const publishableKey = await getSetting("stripe_publishable_key");
  res.json({ publishableKey: publishableKey ?? "" });
});

// POST /api/payments/create-intent — creates a Stripe PaymentIntent for a registration's
// outstanding balance. The amount is computed server-side, and online payment is offered
// only to members BHT administration has validated (new members pay at the Temple Desk).
router.post("/create-intent", async (req, res) => {
  try {
    const { studentCode, studentName, description } = req.body as {
      studentCode: string;
      studentName: string;
      description: string;
    };
    if (!studentCode || typeof studentCode !== "string") {
      res.status(400).json({ error: "studentCode is required." });
      return;
    }
    const balance = await registrationBalance(db, studentCode);
    if (!balance) {
      res.status(404).json({ error: "Registration not found." });
      return;
    }
    if (!balance.onlinePaymentEligible) {
      res.status(403).json({
        error: "Online payment is available after BHT administration validates the membership. Please pay at the Temple Administration Desk.",
        notEligible: true,
      });
      return;
    }
    const amount = Math.round(balance.total * 100);
    if (amount < 100) {
      res.status(400).json({ error: "There is no outstanding balance to pay online." });
      return;
    }

    const secretKey = await getSetting("stripe_secret_key");
    if (!secretKey || secretKey.startsWith("sk_test_placeholder") || secretKey === "") {
      res.status(503).json({
        error: "Payment gateway is not yet configured. Please contact the Gurukul office to complete payment.",
        notConfigured: true,
      });
      return;
    }

    const stripe = new Stripe(secretKey);
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      description,
      metadata: { studentCode, studentName },
    });

    res.json({ clientSecret: paymentIntent.client_secret, amount: balance.total });
  } catch (err: unknown) {
    console.error("Stripe create-intent error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to initiate payment. Please try again.",
    });
  }
});

// POST /api/payments/record-membership
// Called from the parent portal after Stripe confirms a successful payment.
//
// Security model (strictly enforced):
//  - paymentIntentId is REQUIRED — no upsert without verified Stripe proof.
//  - Stripe must be configured — endpoint rejects when secret key is missing.
//  - intent.status must === "succeeded" — no partial/pending intents accepted.
//  - intent.metadata.studentCode must === studentCode — prevents replay across students.
//  - amountDue read from portal settings server-side (never trusted from client).
//  - amountPaid derived from intent.amount/100 (Stripe-verified, cannot be forged).
router.post("/record-membership", async (req, res) => {
  try {
    const { studentCode, paymentIntentId } = req.body as {
      studentCode:     string;
      paymentIntentId: string | undefined;
    };

    if (!studentCode || typeof studentCode !== "string") {
      res.status(400).json({ error: "studentCode is required" });
      return;
    }

    // paymentIntentId is mandatory — no upsert without Stripe proof
    if (!paymentIntentId || typeof paymentIntentId !== "string") {
      res.status(400).json({ error: "paymentIntentId is required to record a membership payment" });
      return;
    }

    // Stripe must be configured
    const secretKey = await getSetting("stripe_secret_key");
    if (!secretKey || secretKey.startsWith("sk_test_placeholder") || secretKey === "") {
      res.status(503).json({
        error: "Payment gateway is not configured — please contact the Gurukul office to record your payment.",
        notConfigured: true,
      });
      return;
    }

    // Verify PaymentIntent with Stripe
    const stripe  = new Stripe(secretKey);
    const intent  = await stripe.paymentIntents.retrieve(paymentIntentId);

    // 1. Confirm payment succeeded
    if (intent.status !== "succeeded") {
      res.status(400).json({ error: "Payment has not succeeded — cannot record as paid." });
      return;
    }

    // 2. Bind intent to this specific student — prevent cross-student replay
    const metaCode = (intent.metadata as Record<string, string>).studentCode ?? "";
    if (metaCode !== studentCode) {
      res.status(403).json({ error: "PaymentIntent does not belong to this student." });
      return;
    }

    // 3. Apply the Stripe-verified amount to outstanding membership years first, then
    //    course fees. An intent is applied once: rows it paid carry its id as receipt.
    const result = await db.transaction(async tx => {
      const [alreadyApplied] = await tx.select({ id: paymentsTable.id }).from(paymentsTable)
        .where(eq(paymentsTable.receiptId, paymentIntentId)).limit(1);
      const [alreadyAppliedMembership] = await tx.select({ id: membershipPaymentsTable.id })
        .from(membershipPaymentsTable)
        .where(or(
          eq(membershipPaymentsTable.receiptId, paymentIntentId),
          like(membershipPaymentsTable.notes, `%${paymentIntentId}%`),
        )).limit(1);
      if (alreadyApplied || alreadyAppliedMembership) return { applied: 0, remaining: 0, duplicate: true };

      const balance = await registrationBalance(tx, studentCode);
      if (!balance) return null;
      const today = templeDate();
      let remaining = Math.round(intent.amount) / 100;
      let applied = 0;
      for (const item of balance.items) {
        if (item.balance <= 0 || remaining <= 0) continue;
        const payment = Math.min(item.balance, remaining);
        const amountPaid = (item.amountPaid + payment).toFixed(2);
        const paid = item.amountPaid + payment >= item.amountDue;
        const update = {
          amountPaid,
          paymentStatus: paid ? "Paid" as const : "Pending" as const,
          paymentMethod: "Stripe",
          receiptId: paymentIntentId,
          paymentDate: today,
          ...(paid ? { pendingReason: null } : {}),
        };
        if (item.kind === "course") {
          await tx.update(paymentsTable).set(update).where(eq(paymentsTable.id, item.id));
        } else {
          const [row] = await tx.update(membershipPaymentsTable)
            .set({ ...update, notes: `Verified via Stripe PaymentIntent ${paymentIntentId}` })
            .where(eq(membershipPaymentsTable.id, item.id))
            .returning({ memberId: membershipPaymentsTable.memberId, membershipYear: membershipPaymentsTable.membershipYear });
          if (paid && row) await extendMembershipThrough(tx, row.memberId, row.membershipYear);
        }
        remaining = Math.round((remaining - payment) * 100) / 100;
        applied = Math.round((applied + payment) * 100) / 100;
      }
      return { applied, remaining, duplicate: false };
    });
    if (!result) {
      res.status(404).json({ error: "Registration not found" });
      return;
    }
    const status = result.remaining > 0 ? "Pending" : "Paid";
    res.json({ success: true, status, amountPaid: result.applied, duplicate: result.duplicate });
  } catch (err: unknown) {
    console.error("record-membership error:", err);
    res.status(500).json({ error: "Failed to record membership payment" });
  }
});

export default router;
